/**
 * 9-ops-daemon.mjs
 * Persistent execution brain for 9 Enterprises — Phase 1 MVP.
 *
 * Identity: 9-Ops. NOT 9. NEVER speaks to Owner.
 * Reports to: 9 (via SQLite tables 9ops_task_queue + 9ops_push_notifications)
 * Charter: memory/agent_9ops_charter.md
 *
 * Loop:
 *  - Poll 9ops_task_queue every 2s for status='pending'
 *  - Pick up task atomically (SET status='in_progress' in transaction)
 *  - Execute via Claude API (Opus for architecture, Sonnet for routine)
 *  - Write result back to queue row
 *  - Write push notification to 9ops_push_notifications for anything worth 9's attention
 *  - Crash-safe: on startup, any in_progress row (orphaned from prior crash) → back to pending
 *
 * Push channel: 9ops_push_notifications table, read by check-messages.sh via PostToolUse hook
 * Reply lock: owner_reply_lock table — 9-Ops NEVER acquires this lock
 *
 * LaunchAgent: com.9.9-ops-daemon
 * Health: GET http://localhost:3461/health
 *
 * — 9-Ops, Execution, 9 Enterprises
 */

import { createRequire } from 'module';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { createServer }  from 'http';
import { execSync }      from 'child_process';
import https             from 'https';
import path              from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── .env ─────────────────────────────────────────────────────────────────────
const envPath = path.join(PROJECT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && !k.startsWith('#')) process.env[k] = v;
    }
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const HEALTH_PORT    = 3461;
const POLL_INTERVAL  = 2_000;   // 2s — task pickup target
const DB_PATH        = path.join(PROJECT, 'data/9-memory.db');
const LOG_FILE       = path.join(PROJECT, 'logs/9-ops-daemon.log');
const MEMORY_DIR     = path.join(
  process.env.HOME || '/Users/jassonfishback',
  '.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory'
);
const CHARTER_PATH   = path.join(MEMORY_DIR, 'agent_9ops_charter.md');

// Model IDs — mirrors model-constants.mjs
const MODEL_OPUS   = 'claude-opus-4-20250514';
const MODEL_SONNET = 'claude-sonnet-4-5';

// Task execution timeout: 5 minutes per task max
const TASK_TIMEOUT_MS = 5 * 60 * 1000;

// Max tokens per task response
const MAX_TOKENS = 4096;

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] [9-Ops] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── Encryption key ──────────────────────────────────────────────────────────
function loadEncryptionKey() {
  try {
    const key = execSync(
      'security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w',
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    if (key) return key;
  } catch {}
  return process.env.SQLITE_ENCRYPTION_KEY || null;
}

// ─── SQLite ──────────────────────────────────────────────────────────────────
const _require    = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3-multiple-ciphers');
} catch {
  Database = _require('better-sqlite3');
}

const ENCRYPTION_KEY = loadEncryptionKey();
let _db;

function getDb() {
  if (_db && _db.open) return _db;
  _db = new Database(DB_PATH);
  if (ENCRYPTION_KEY) {
    _db.pragma(`key = '${ENCRYPTION_KEY}'`);
    _db.pragma('cipher = sqlcipher');
  }
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

// ─── Prepared statements (lazy) ───────────────────────────────────────────────
let _stmts;
function stmts() {
  if (_stmts) return _stmts;
  const db = getDb();
  _stmts = {
    // Atomically claim one pending task (highest priority first, then oldest)
    claimTask: db.prepare(`
      UPDATE "9ops_task_queue"
      SET    status = 'in_progress',
             picked_up_at = datetime('now'),
             updated_at   = datetime('now'),
             session_id   = ?
      WHERE  id = (
        SELECT id FROM "9ops_task_queue"
        WHERE  status = 'pending'
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 1
            WHEN 'high'     THEN 2
            WHEN 'medium'   THEN 3
            ELSE                 4
          END,
          created_at ASC
        LIMIT 1
      )
    `),
    // Fetch the task we just claimed (by session_id + in_progress)
    fetchClaimed: db.prepare(`
      SELECT * FROM "9ops_task_queue"
      WHERE  status = 'in_progress'
        AND  session_id = ?
      ORDER BY picked_up_at DESC
      LIMIT 1
    `),
    // Mark done
    markDone: db.prepare(`
      UPDATE "9ops_task_queue"
      SET    status           = 'done',
             response_payload = ?,
             completed_at     = datetime('now'),
             updated_at       = datetime('now')
      WHERE  id = ?
    `),
    // Mark failed
    markFailed: db.prepare(`
      UPDATE "9ops_task_queue"
      SET    status       = 'failed',
             error_detail = ?,
             completed_at = datetime('now'),
             updated_at   = datetime('now')
      WHERE  id = ?
    `),
    // Reset orphaned in_progress rows to pending (crash recovery)
    recoverOrphans: db.prepare(`
      UPDATE "9ops_task_queue"
      SET    status     = 'pending',
             updated_at = datetime('now'),
             session_id = NULL
      WHERE  status = 'in_progress'
    `),
    // Write push notification
    pushNotification: db.prepare(`
      INSERT INTO "9ops_push_notifications"
        (severity, tag, task_id, message)
      VALUES (?, ?, ?, ?)
    `),
    // Verify reply lock is NOT held by 9-Ops (it should always be 'none' or '9')
    checkReplyLock: db.prepare(`
      SELECT locked_by FROM owner_reply_lock WHERE id = 1
    `),
    // Count pending tasks
    pendingCount: db.prepare(`
      SELECT count(*) AS c FROM "9ops_task_queue" WHERE status = 'pending'
    `),
    // Count in-progress tasks
    inProgressCount: db.prepare(`
      SELECT count(*) AS c FROM "9ops_task_queue" WHERE status = 'in_progress'
    `),
  };
  return _stmts;
}

// ─── Charter / system prompt ──────────────────────────────────────────────────
function loadCharter() {
  try {
    if (existsSync(CHARTER_PATH)) {
      return readFileSync(CHARTER_PATH, 'utf-8');
    }
  } catch (e) {
    log(`Warning: could not load charter from ${CHARTER_PATH}: ${e.message}`);
  }
  // Minimal inline fallback if file is missing
  return `You are 9-Ops. You are NOT 9. You NEVER speak to Owner.
You are the execution brain of 9 Enterprises.
You execute tasks assigned by 9 and report results back via SQLite tables only.
You NEVER acquire the owner_reply_lock. You NEVER send to Telegram.`;
}

// ─── Memory context (read-through, max 60s staleness) ────────────────────────
let _memCache = { loaded_at: 0, content: '' };
const MEM_TTL = 60_000;

function loadMemoryContext() {
  if (Date.now() - _memCache.loaded_at < MEM_TTL) return _memCache.content;

  const snippets = [];

  // Active authority rules from SQLite
  try {
    const db = getDb();
    const rules = db.prepare(
      `SELECT permission || ': ' || description AS rule FROM authority WHERE status='active' LIMIT 20`
    ).all();
    if (rules.length > 0) {
      snippets.push('## Active Authority Rules\n' + rules.map(r => `- ${r.rule}`).join('\n'));
    }
  } catch (e) {
    log(`Memory load warning (authority): ${e.message}`);
  }

  // Open tasks (not this daemon's queue — the main tasks table for context)
  try {
    const db = getDb();
    const tasks = db.prepare(`
      SELECT priority || ' | ' || assigned_to || ' | ' || title AS t
      FROM tasks
      WHERE status NOT IN ('completed','failed')
      ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
      LIMIT 10
    `).all();
    if (tasks.length > 0) {
      snippets.push('## Open Tasks (context)\n' + tasks.map(r => `- ${r.t}`).join('\n'));
    }
  } catch (e) {
    log(`Memory load warning (tasks): ${e.message}`);
  }

  // Read key memory files (lightweight — just the ones most likely relevant)
  const keyFiles = [
    'project_universe_audit_april5.md',
    'feedback_verify_before_assert.md',
  ];
  for (const f of keyFiles) {
    const fp = path.join(MEMORY_DIR, f);
    try {
      if (existsSync(fp)) {
        const content = readFileSync(fp, 'utf-8');
        // Cap each file at 2000 chars to keep context window sane
        snippets.push(`## ${f}\n${content.slice(0, 2000)}`);
      }
    } catch {}
  }

  _memCache = { loaded_at: Date.now(), content: snippets.join('\n\n') };
  return _memCache.content;
}

// ─── Claude API call (raw https — no SDK, matches comms-hub.mjs pattern) ────
function callClaude({ model, systemPrompt, userMessage, maxTokens = MAX_TOKENS }) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY_TC || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error('No Anthropic API key in environment'));
      return;
    }

    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    };

    const timer = setTimeout(() => reject(new Error(`Claude API timeout after ${TASK_TIMEOUT_MS}ms`)), TASK_TIMEOUT_MS);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Claude API error: ${parsed.error.message}`));
            return;
          }
          const text = parsed.content?.[0]?.text || '';
          resolve({ text, usage: parsed.usage });
        } catch (e) {
          reject(new Error(`Claude API parse error: ${e.message} — raw: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ─── Session ID ───────────────────────────────────────────────────────────────
const SESSION_ID = `9ops-${Date.now()}-${process.pid}`;

// ─── Task executor ────────────────────────────────────────────────────────────
async function executeTask(task) {
  log(`Executing task #${task.id}: "${task.title}" (priority: ${task.priority}, model_hint: ${task.model_hint})`);

  const charter      = loadCharter();
  const memContext   = loadMemoryContext();

  // Choose model per hint. Never Haiku.
  const model = task.model_hint === 'opus' ? MODEL_OPUS : MODEL_SONNET;
  log(`Model selected: ${model}`);

  // Build system prompt
  const systemPrompt = `${charter}

---

## Your current context (read-through, max 60s old)
${memContext}

---

## 9-Ops Operating Rules (always active)
- You are 9-Ops. You are NOT 9. You NEVER speak to Owner directly.
- Your only output is the text of this response — it goes into 9ops_task_queue.response_payload.
- 9 will read this response and decide what to surface to Owner.
- Be precise, complete, and honest. No padding. No people-pleasing.
- If you cannot complete the task, say so clearly. Do not fabricate results.
- Verify before asserting. Never claim something is done without evidence.
- Format your response as structured text that 9 can relay cleanly to Owner.
- End your response with: "— 9-Ops, Execution, 9 Enterprises"
`;

  // Build user message from task payload
  let payload = {};
  try { payload = JSON.parse(task.request_payload || '{}'); } catch {}

  const userMessage = `## Task #${task.id}: ${task.title}

${payload.task || task.title}

${payload.context ? `### Context\n${payload.context}` : ''}
${payload.constraints ? `### Constraints\n${payload.constraints}` : ''}
${payload.files ? `### Files to consider\n${payload.files}` : ''}

Execute this task now. Return your complete result.`;

  const { text, usage } = await callClaude({ model, systemPrompt, userMessage });

  log(`Task #${task.id} complete. Input tokens: ${usage?.input_tokens}, output tokens: ${usage?.output_tokens}`);

  return {
    result:       text,
    model_used:   model,
    session_id:   SESSION_ID,
    completed_at: new Date().toISOString(),
    usage,
  };
}

// ─── Push notification helper ─────────────────────────────────────────────────
function pushNotification({ severity, tag, taskId, message }) {
  try {
    // FORT check: 9-Ops NEVER acquires owner_reply_lock. Verify we're not holding it.
    const lock = stmts().checkReplyLock.get();
    if (lock && lock.locked_by === '9-ops') {
      log('SECURITY VIOLATION: owner_reply_lock is somehow held by 9-ops. Releasing immediately.');
      // This should never happen — but if it does, free it and log it loudly.
      getDb().prepare(`UPDATE owner_reply_lock SET locked_by='none', locked_at=NULL WHERE id=1`).run();
    }

    stmts().pushNotification.run(severity, tag, taskId ?? null, message);
    log(`Push notification written: [${tag}] ${message.slice(0, 80)}`);
  } catch (e) {
    log(`Failed to write push notification: ${e.message}`);
  }
}

// ─── Main poll loop ────────────────────────────────────────────────────────────
let _running = true;
let _tasksExecuted = 0;
let _tasksFailed   = 0;

async function pollLoop() {
  while (_running) {
    try {
      // Try to claim one task atomically
      const result = stmts().claimTask.run(SESSION_ID);

      if (result.changes > 0) {
        // Fetch the task we just claimed
        const task = stmts().fetchClaimed.get(SESSION_ID);

        if (task) {
          try {
            const response = await executeTask(task);
            const responseJson = JSON.stringify(response);

            stmts().markDone.run(responseJson, task.id);
            _tasksExecuted++;

            log(`Task #${task.id} marked done.`);

            // Push a DONE notification so 9's hook picks it up immediately
            pushNotification({
              severity: 'DONE',
              tag:      'DONE',
              taskId:   task.id,
              message:  `DONE: Task #${task.id} — ${task.title}\n${response.result.slice(0, 500)}${response.result.length > 500 ? '...' : ''}`,
            });

          } catch (execErr) {
            log(`Task #${task.id} FAILED: ${execErr.message}`);
            stmts().markFailed.run(execErr.message, task.id);
            _tasksFailed++;

            pushNotification({
              severity: 'RISK',
              tag:      'BLOCKER',
              taskId:   task.id,
              message:  `BLOCKER: Task #${task.id} failed — ${task.title}\nError: ${execErr.message}`,
            });
          }
        }
      }
    } catch (pollErr) {
      log(`Poll loop error: ${pollErr.message}`);
      // Brief pause on error to avoid spinning on a broken DB state
      await sleep(5_000);
    }

    await sleep(POLL_INTERVAL);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Crash recovery on startup ─────────────────────────────────────────────────
function recoverOrphans() {
  try {
    const result = stmts().recoverOrphans.run();
    if (result.changes > 0) {
      log(`Crash recovery: ${result.changes} orphaned in_progress task(s) reset to pending`);
      pushNotification({
        severity: 'STATUS',
        tag:      'STATUS',
        taskId:   null,
        message:  `STATUS: 9-Ops restarted. Recovered ${result.changes} orphaned task(s) — they will be re-executed.`,
      });
    } else {
      log('Crash recovery: no orphaned tasks found');
    }
  } catch (e) {
    log(`Crash recovery error: ${e.message}`);
  }
}

// ─── Health server ─────────────────────────────────────────────────────────────
const healthServer = createServer((req, res) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.method === 'GET' && req.url === '/health') {
    let pending = 0;
    let inProgress = 0;
    try {
      pending    = stmts().pendingCount.get().c;
      inProgress = stmts().inProgressCount.get().c;
    } catch {}

    res.writeHead(200, cors);
    res.end(JSON.stringify({
      status:         'running',
      pid:            process.pid,
      session_id:     SESSION_ID,
      uptime_seconds: Math.round(process.uptime()),
      tasks_executed: _tasksExecuted,
      tasks_failed:   _tasksFailed,
      pending_queue:  pending,
      in_progress:    inProgress,
      checked_at:     new Date().toISOString(),
    }));
    return;
  }

  res.writeHead(404, cors);
  res.end(JSON.stringify({ error: 'not found' }));
});

healthServer.on('error', (e) => {
  log(`Health server error: ${e.message}`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
  log(`Received ${signal} — shutting down gracefully`);
  _running = false;
  healthServer.close();
  try {
    if (_db && _db.open) _db.close();
  } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => {
  log(`Uncaught exception: ${e.message}\n${e.stack}`);
  // Do NOT exit — let the process keep running. LaunchAgent handles hard crashes.
});
process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`);
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function main() {
  log(`9-Ops daemon starting — PID ${process.pid} — session ${SESSION_ID}`);
  log(`DB: ${DB_PATH}`);
  log(`Charter: ${CHARTER_PATH}`);

  // Verify DB is reachable
  try {
    getDb();
    log('SQLite connection: OK');
  } catch (e) {
    log(`FATAL: Cannot open SQLite DB: ${e.message}`);
    process.exit(1);
  }

  // Crash recovery
  recoverOrphans();

  // Start health server
  healthServer.listen(HEALTH_PORT, '127.0.0.1', () => {
    log(`Health server listening on http://127.0.0.1:${HEALTH_PORT}/health`);
  });

  // Announce startup via push notification
  pushNotification({
    severity: 'STATUS',
    tag:      'STATUS',
    taskId:   null,
    message:  `STATUS: 9-Ops online — PID ${process.pid}, session ${SESSION_ID}. Poll interval: ${POLL_INTERVAL}ms. Ready for tasks.`,
  });

  log('Starting poll loop...');
  await pollLoop();
}

main().catch((e) => {
  log(`Fatal startup error: ${e.message}`);
  process.exit(1);
});
