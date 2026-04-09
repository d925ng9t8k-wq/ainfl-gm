#!/usr/bin/env node
/**
 * your9-daily-briefing.mjs — AI CEO Daily Briefing Engine
 * Your9 by 9 Enterprises
 *
 * Generates a concise, human-sounding morning briefing from the AI CEO
 * to the founder. Uses Opus to write the actual message — it should feel
 * like a real executive partner, not a status report from a robot.
 *
 * The briefing covers:
 *   1. What the team accomplished yesterday
 *   2. What the team is working on today (active + queued tasks)
 *   3. What the CEO needs from the founder (if anything)
 *   4. One key insight or opportunity
 *
 * Usage:
 *   node scripts/your9-daily-briefing.mjs --instance <customer-id>
 *   node scripts/your9-daily-briefing.mjs --instance <customer-id> --once
 *   node scripts/your9-daily-briefing.mjs --instance <customer-id> --hour 9
 *
 * Flags:
 *   --instance    Customer ID (required). Must exist in instances/ directory.
 *   --once        Run immediately once and exit (good for testing or cron).
 *   --hour        Hour to send daily briefing in 24h format (default: 8).
 *                 Uses the system timezone. Ignored when --once is set.
 *   --dry-run     Generate briefing text but do not send via Telegram.
 *
 * Cron setup (runs every day at 8 AM):
 *   0 8 * * * /opt/homebrew/bin/node /path/to/your9-daily-briefing.mjs \
 *     --instance <customer-id> --once >> /path/to/logs/briefing.log 2>&1
 */

import {
  existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let briefingLogPath = null;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] BRIEFING: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  if (briefingLogPath) {
    try { appendFileSync(briefingLogPath, line + '\n'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// .env loader — does not pollute process.env
// ---------------------------------------------------------------------------

function loadEnvFile(envPath) {
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[key] = val;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Raw HTTPS helpers — same pattern as your9-hub.mjs, no SDK dependency
// ---------------------------------------------------------------------------

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); }
          catch (e) { reject(new Error(`JSON parse failed: ${e.message} — body: ${buf.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('HTTPS request timed out')); });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Anthropic API — raw HTTPS, no SDK
// ---------------------------------------------------------------------------

async function callClaude(anthropicKey, model, systemPrompt, userMessage, maxTokens = 2048) {
  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }
  );

  if (result.error) {
    throw new Error(`Anthropic API error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error(`Anthropic returned no content: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return text;
}

// ---------------------------------------------------------------------------
// Telegram — send message with Markdown, fallback to plain
// ---------------------------------------------------------------------------

async function sendTelegramMessage(botToken, chatId, text) {
  const MAX = 4000;
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > MAX) {
    // Split on newlines when possible to avoid breaking Markdown mid-block
    const cutAt = remaining.lastIndexOf('\n', MAX);
    const pos = cutAt > 500 ? cutAt : MAX;
    chunks.push(remaining.slice(0, pos));
    remaining = remaining.slice(pos).trimStart();
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    } catch {
      // Fallback: plain text
      await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, {}, {
        chat_id: chatId,
        text: chunk,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Task reader — reads all JSON task files from instances/{id}/data/tasks/
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'report-delivered']);
const ACTIVE_STATUSES = new Set(['running', 'researching']);
// Anything not terminal and not active is considered queued/pending
const QUEUED_STATUSES = new Set(['queued', 'pending', 'created']);

function readAllTasks(taskDir) {
  if (!existsSync(taskDir)) return [];

  let files;
  try {
    files = readdirSync(taskDir).filter(f => f.endsWith('-task.json')).sort();
  } catch {
    return [];
  }

  const tasks = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(taskDir, f), 'utf-8'));
      // Timestamp is the numeric prefix of the filename: e.g. 1744233942000-task.json
      const tsMatch = f.match(/^(\d+)-task/);
      const fileTs = tsMatch ? parseInt(tsMatch[1], 10) : 0;
      tasks.push({ ...raw, _fileTs: fileTs, _file: f });
    } catch {
      // Skip malformed task files — non-fatal
    }
  }

  return tasks;
}

function classifyTasks(tasks, yesterdayStart, yesterdayEnd, todayStart) {
  const completed = [];   // completed yesterday
  const active = [];      // running right now or completed today
  const queued = [];      // not started yet

  for (const t of tasks) {
    const status = (t.status || '').toLowerCase();
    const completedAt = t.completedAt ? new Date(t.completedAt).getTime() : null;
    const startedAt = t.startedAt ? new Date(t.startedAt).getTime() : null;
    const loggedAt = t.loggedAt ? new Date(t.loggedAt).getTime() : null;
    const taskTime = completedAt || startedAt || loggedAt || t._fileTs;

    if (TERMINAL_STATUSES.has(status)) {
      if (completedAt && completedAt >= yesterdayStart && completedAt < todayStart) {
        completed.push(t);
      } else if (completedAt && completedAt >= todayStart) {
        active.push(t); // Completed today still counts as "today's work"
      }
      // Older completed tasks are ignored for daily briefing
    } else if (ACTIVE_STATUSES.has(status)) {
      active.push(t);
    } else {
      // Queued or unknown status — include if task was logged recently (last 7 days)
      const sevenDaysAgo = todayStart - 7 * 24 * 60 * 60 * 1000;
      if (taskTime >= sevenDaysAgo) {
        queued.push(t);
      }
    }
  }

  return { completed, active, queued };
}

function formatTaskForContext(t) {
  const agent = t.agentId || 'team';
  const task = (t.task || 'unknown task').slice(0, 150);
  const status = t.status || 'unknown';
  const result = t.result ? ` Result: ${t.result.slice(0, 200)}` : '';
  const summary = t.summary ? ` Summary: ${t.summary.slice(0, 200)}` : '';
  return `[${agent}] ${status}: ${task}${result}${summary}`;
}

// ---------------------------------------------------------------------------
// Conversation history reader — surface any founder escalations or flags
// ---------------------------------------------------------------------------

function readRecentConversation(convDir, limit = 20) {
  const histPath = join(convDir, 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Briefing generator — the AI CEO writes the morning message
// ---------------------------------------------------------------------------

const BRIEFING_SYSTEM_PROMPT = `You are an AI CEO writing a morning briefing to the founder of your business.

Your briefing must sound like a real, confident executive partner — not a bot, not a status report, not a robot reciting a template. Write the way a smart, trusted operator talks to the founder they work for.

Rules:
- Be direct. Skip the pleasantries. They wake up to this message.
- Sound human. Use natural contractions. No corporate speak.
- Be honest. If there's nothing major to report, say so cleanly. Don't pad.
- If there's a real blocker or something the founder needs to act on, make it prominent — do not bury it.
- The insight at the end should be sharp and specific to the business — not a generic tip.
- Max length: 300 words. Every word should earn its place.
- No emoji unless personality config explicitly uses them.
- Do not say "Good morning" or "I hope you're well" or anything sycophantic.
- Do not format with bullet headers like "Section 1:" — use natural paragraph breaks.
- The message should feel like it came from someone who was working while the founder slept.`;

async function generateBriefingText(anthropicKey, model, instanceConfig, taskData, conversationSnippet) {
  const { name, industry, personality, personalityConfig, industryContext } = instanceConfig;

  const { completed, active, queued } = taskData;

  const completedContext = completed.length > 0
    ? `Completed yesterday:\n${completed.map(formatTaskForContext).join('\n')}`
    : 'No tasks completed yesterday.';

  const activeContext = (active.length + queued.length) > 0
    ? `Active and queued for today:\n${[...active, ...queued].map(formatTaskForContext).join('\n')}`
    : 'No active or queued tasks. Team is available for new assignments.';

  const convContext = conversationSnippet.length > 0
    ? `Recent founder messages and CEO responses:\n${conversationSnippet
        .map(e => `[${e.role}] ${(e.content || '').slice(0, 200)}`)
        .join('\n')}`
    : 'No recent conversation history.';

  const userMessage = `Write a morning briefing for the founder of ${name}, a ${industryContext?.label || industry} business.

Business context:
- Industry: ${industryContext?.label || industry}
- Key metrics this business tracks: ${(industryContext?.keyMetrics || []).join(', ') || 'standard business metrics'}
- Personality mode: ${personalityConfig?.label || personality} — ${personalityConfig?.voiceStyle || 'professional'}
- Avoid these phrases: ${(personalityConfig?.avoidPhrases || []).join(', ')}

${completedContext}

${activeContext}

${convContext}

Write the morning briefing now. Cover:
1. What the team accomplished yesterday (be specific — mention actual tasks if any exist, do not fabricate specifics if tasks are empty)
2. What's being worked on today
3. What you need from the founder, if anything (be direct — if nothing, skip this or mention it briefly)
4. One key insight or opportunity you've identified based on business context

Remember: you were working while they slept. Write like it.`;

  const text = await callClaude(anthropicKey, model, BRIEFING_SYSTEM_PROMPT, userMessage, 1024);
  return text;
}

// ---------------------------------------------------------------------------
// Instance loader
// ---------------------------------------------------------------------------

function loadInstance(customerId) {
  const instanceDir = join(INSTANCES_DIR, customerId);

  if (!existsSync(instanceDir)) {
    throw new Error(`Instance not found: ${customerId} (looked in ${INSTANCES_DIR})`);
  }

  const configPath = join(instanceDir, 'config', 'customer.json');
  if (!existsSync(configPath)) {
    throw new Error(`Customer config missing: ${configPath}`);
  }
  const instanceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const envPath = join(instanceDir, 'config', '.env');
  const env = loadEnvFile(envPath);

  // API key — prefer instance .env, fall back to process.env
  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey.startsWith('PLACEHOLDER')) {
    throw new Error(`ANTHROPIC_API_KEY not set or is placeholder in ${envPath}`);
  }

  const botToken = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || botToken.startsWith('PLACEHOLDER')) {
    throw new Error(`TELEGRAM_BOT_TOKEN not set or is placeholder in ${envPath}`);
  }

  const ownerChatId = env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!ownerChatId || ownerChatId.startsWith('PLACEHOLDER')) {
    throw new Error(`TELEGRAM_OWNER_CHAT_ID not set or is placeholder in ${envPath}`);
  }

  // Model selection — use tier config's CEO model, Opus override only if set explicitly
  const tierModel = instanceConfig.tierConfig?.ceoModel || 'claude-sonnet-4-5';
  // Briefing uses Opus by default for writing quality — it's a high-value communication
  // Can be overridden by BRIEFING_MODEL env var for cost control
  const briefingModel = env.BRIEFING_MODEL || process.env.BRIEFING_MODEL || 'claude-opus-4-20250514';

  const taskDir = join(instanceDir, 'data', 'tasks');
  const convDir = join(instanceDir, 'data', 'conversation');
  const logsDir = join(instanceDir, 'logs');

  // Ensure directories exist (tasks may not have been created yet)
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
  if (!existsSync(convDir)) mkdirSync(convDir, { recursive: true });
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  return {
    customerId,
    instanceDir,
    instanceConfig,
    anthropicKey,
    botToken,
    ownerChatId,
    briefingModel,
    taskDir,
    convDir,
    logsDir,
  };
}

// ---------------------------------------------------------------------------
// Core briefing runner
// ---------------------------------------------------------------------------

async function runBriefing(instance, opts = {}) {
  const { dryRun = false } = opts;
  const {
    customerId,
    instanceConfig,
    anthropicKey,
    botToken,
    ownerChatId,
    briefingModel,
    taskDir,
    convDir,
  } = instance;

  log(`Starting briefing for ${instanceConfig.name} (${customerId})`);
  log(`Model: ${briefingModel}`);

  // Time windows — yesterday vs today
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const yesterdayEnd = todayStart;

  // Read and classify tasks
  const allTasks = readAllTasks(taskDir);
  log(`Found ${allTasks.length} total task files`);

  const taskData = classifyTasks(allTasks, yesterdayStart, yesterdayEnd, todayStart);
  log(`Tasks — completed yesterday: ${taskData.completed.length}, active today: ${taskData.active.length}, queued: ${taskData.queued.length}`);

  // Pull recent conversation for CEO context (escalations, open threads)
  const recentConversation = readRecentConversation(convDir, 15);

  // Generate briefing via Opus
  log(`Generating briefing text via ${briefingModel}...`);
  let briefingText;
  try {
    briefingText = await generateBriefingText(
      anthropicKey,
      briefingModel,
      instanceConfig,
      taskData,
      recentConversation
    );
  } catch (e) {
    log(`Briefing generation failed: ${e.message}`);
    throw e;
  }

  log(`Briefing generated (${briefingText.length} chars)`);

  if (dryRun) {
    log('DRY RUN — not sending to Telegram');
    console.log('\n=== BRIEFING TEXT (DRY RUN) ===\n');
    console.log(briefingText);
    console.log('\n=== END BRIEFING ===\n');
    return;
  }

  // Send via Telegram
  log(`Sending briefing to Telegram chat ${ownerChatId}...`);
  try {
    await sendTelegramMessage(botToken, ownerChatId, briefingText);
    log(`Briefing delivered successfully`);
  } catch (e) {
    log(`Telegram delivery failed: ${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Scheduler — run once daily at target hour, stays alive as a daemon
// ---------------------------------------------------------------------------

function waitUntilNextRun(targetHour) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, 0, 0, 0);
  if (next <= now) {
    // Already past today's window — schedule for tomorrow
    next.setDate(next.getDate() + 1);
  }
  const msUntil = next.getTime() - now.getTime();
  const hoursUntil = (msUntil / 3600000).toFixed(1);
  log(`Next briefing scheduled for ${next.toLocaleString()} (${hoursUntil}h from now)`);
  return msUntil;
}

async function runScheduler(instance, targetHour, dryRun) {
  log(`Scheduler starting — daily briefing at hour ${targetHour}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const msUntil = waitUntilNextRun(targetHour);
    await new Promise(resolve => setTimeout(resolve, msUntil));

    try {
      await runBriefing(instance, { dryRun });
    } catch (e) {
      // Log the error but keep the scheduler alive — don't crash on a transient API error
      log(`Briefing run failed (will retry tomorrow): ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.instance) {
    console.error('Usage: node scripts/your9-daily-briefing.mjs --instance <customer-id> [--once] [--hour 8] [--dry-run]');
    console.error('');
    console.error('Flags:');
    console.error('  --instance    Customer ID (required)');
    console.error('  --once        Send immediately and exit (for cron / testing)');
    console.error('  --hour        Hour to send in 24h format (default: 8). Ignored with --once.');
    console.error('  --dry-run     Generate but do not send via Telegram');
    process.exit(1);
  }

  // Load instance config and credentials
  let instance;
  try {
    instance = loadInstance(args.instance);
  } catch (e) {
    console.error(`Failed to load instance: ${e.message}`);
    process.exit(1);
  }

  // Set up log file once instance dir is known
  briefingLogPath = join(instance.logsDir, 'daily-briefing.log');
  log(`Log file: ${briefingLogPath}`);

  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';

  if (args.once) {
    // Run once and exit — designed for cron or --once testing
    try {
      await runBriefing(instance, { dryRun });
      log('Briefing complete. Exiting.');
    } catch (e) {
      log(`Fatal: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // Scheduler mode — long-running daemon
  const targetHour = parseInt(args.hour || '8', 10);
  if (isNaN(targetHour) || targetHour < 0 || targetHour > 23) {
    console.error(`Invalid --hour value: "${args.hour}". Must be 0–23.`);
    process.exit(1);
  }

  await runScheduler(instance, targetHour, dryRun);
}

main().catch(err => {
  console.error(`BRIEFING FATAL: ${err.message}`);
  process.exit(1);
});
