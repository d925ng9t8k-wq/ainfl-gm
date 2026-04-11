#!/usr/bin/env node
/**
 * Session Handoff — Crash-Proof State Persistence
 *
 * Runs as a background daemon. Every 60 seconds, writes a structured
 * machine-readable handoff file that any new Claude Code session can
 * ingest to reconstruct the FULL picture of what was happening.
 *
 * This is NOT a summary. It is a state dump — processes, tasks, files,
 * priorities, Owner directives, team status. A new 9 reads this file
 * FIRST and knows exactly what was happening before the crash.
 *
 * Born from the April 5 incident where a session crash caused the next
 * session to rebuild work that already existed.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// Phase 3 wave 2 — route episodic checkpoints through local SQLite first
// (authoritative) instead of raw-POST'ing directly to Supabase. The comms-hub
// post-write hook on db.saveMemory will then push the row to Supabase. This
// kills the bypass path that was widening the drift gap over time.
// Import is wrapped in try/catch so a bad DB state never blocks handoff writes.
let db = null;
try {
  const memoryDb = await import('./memory-db.mjs');
  db = memoryDb.db;
} catch (e) {
  console.error('[session-handoff] memory-db import failed (non-fatal):', e.message);
}

// ─── Ironclad Layer 1+3: Write episodic checkpoints to Supabase ────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HANDOFF_FILE = join(ROOT, 'memory', 'SESSION_HANDOFF.md');
const HANDOFF_JSON = join(ROOT, 'memory', 'session-handoff.json');
const LOG_FILE = join(ROOT, 'logs', 'session-handoff.log');
const INTERVAL = 60 * 1000; // every 60 seconds

function log(msg) {
  const line = `[${new Date().toISOString()}] handoff: ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function shell(cmd, timeout = 8000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, cwd: ROOT }).trim();
  } catch {
    return '';
  }
}

async function buildHandoff() {
  const now = new Date();
  const nowET = shell("TZ='America/New_York' date '+%Y-%m-%d %H:%M ET'");

  // 1. Running processes
  const processes = shell("ps aux | grep -E 'node.*scripts/' | grep -v grep | awk '{print $2, $NF}' | sort -k2");

  // 2. Team agent health
  const teamPorts = { wendy: 3480, fort: 3481, tee: 3483, scout: 3484 };
  const teamStatus = {};
  for (const [name, port] of Object.entries(teamPorts)) {
    try {
      const health = shell(`curl -s --max-time 2 http://localhost:${port}/health 2>/dev/null`);
      if (health) teamStatus[name] = JSON.parse(health);
    } catch {}
  }

  // 3. Files modified in last 24h in key directories
  const recentDocs = shell("find docs/ -mtime -1 -name '*.md' 2>/dev/null | sort");
  const recentMemory = shell("find ~/.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory/ -mtime -1 -name '*.md' 2>/dev/null | sort");
  const recentLogs = shell("ls -t logs/*-task-*.md 2>/dev/null | head -30");

  // 4. Last 5 git commits
  const gitLog = shell("git log --oneline -5 2>/dev/null");

  // 5. Hub state
  const hubHealth = shell("curl -s --max-time 3 http://localhost:3457/health 2>/dev/null | head -c 500");

  // 6. Recent Telegram context (last 10 messages)
  const recentTelegram = shell("grep 'Telegram IN:\\|Telegram OUT:' logs/comms-hub.log 2>/dev/null | tail -10");

  // 7. Wendy's plans if they exist
  const wendy90day = existsSync(join(ROOT, '..', '.claude', 'projects', '-Users-jassonfishback-Projects-BengalOracle', 'memory', 'wendy_90day_plan_v1.md')) ? 'EXISTS' : 'MISSING';
  const wendyTeam = existsSync(join(ROOT, '..', '.claude', 'projects', '-Users-jassonfishback-Projects-BengalOracle', 'memory', 'wendy_team_structure_v1.md')) ? 'EXISTS' : 'MISSING';

  // 8. Pepper status
  const pepperPID = shell("ps aux | grep jules-telegram | grep -v grep | awk '{print $2}'");

  // Explicit list of squad names that had live health endpoints at this checkpoint.
  // A new session reads this to know which squads to resurrect if ports are down.
  const teamAgentsWereRunning = Object.keys(teamStatus);

  // Completed-work manifest: recent completed tasks from SQLite + recent docs created
  const recentCompletedTasks = shell(`/usr/bin/sqlite3 data/9-memory.db "SELECT title || ' | ' || assigned_to FROM tasks WHERE status='completed' ORDER BY updated_at DESC LIMIT 10;" 2>/dev/null`);
  // Files modified in docs/ or logs/ in the last hour — explicit "do not redo" list
  const filesModifiedLastHour = shell("find docs/ logs/ -mmin -60 -name '*.md' 2>/dev/null | sort");
  // Detailed git log with timestamps for cross-referencing completed deliverables
  const gitLogDetailed = shell("git log --format='%h|%ci|%s' -10 2>/dev/null");

  // Build structured JSON
  const handoffData = {
    generated: now.toISOString(),
    generatedET: nowET,
    message: 'READ THIS ENTIRE FILE BEFORE DOING ANYTHING. This is the state of the universe at the time of the last session.',
    runningProcesses: processes.split('\n').filter(Boolean),
    teamAgents: teamStatus,
    // NEW: explicit was-running list — used by Step 15 resurrection protocol
    teamAgentsWereRunning,
    recentDocsModifiedToday: recentDocs.split('\n').filter(Boolean),
    recentMemoryModifiedToday: recentMemory.split('\n').filter(Boolean),
    auditReportsGenerated: recentLogs.split('\n').filter(Boolean),
    gitLog: gitLog.split('\n').filter(Boolean),
    // NEW: completed-work manifest — new session reads this to avoid duplicate work
    completedTaskManifest: {
      recentCompletedTasks: recentCompletedTasks.split('\n').filter(Boolean),
      filesModifiedLastHour: filesModifiedLastHour.split('\n').filter(Boolean),
      gitLogDetailed: gitLogDetailed.split('\n').filter(Boolean)
    },
    wendyPlan: wendy90day,
    wendyTeamStructure: wendyTeam,
    pepperPID: pepperPID || 'NOT RUNNING',
    hubHealthy: hubHealth.includes('"status":"running"')
  };

  // Build human-readable markdown
  const markdown = `# SESSION HANDOFF — READ BEFORE DOING ANYTHING
**Generated:** ${nowET} (auto-updated every 60s)
**Purpose:** If you are a new Claude Code session, READ THIS FIRST. Do not rebuild what already exists.

## CRITICAL: Files Modified Today
These were produced by prior sessions today. READ THEM before taking any action.

### docs/ (deliverables)
${recentDocs || 'none'}

### memory/ (context)
${recentMemory || 'none'}

### Audit Reports (logs/)
${recentLogs || 'none'}

## Key Plans (READ THESE)
- Wendy 90-day plan: ${wendy90day} → memory/wendy_90day_plan_v1.md
- Wendy team structure: ${wendyTeam} → memory/wendy_team_structure_v1.md
- Pepper product spec: memory/project_pepper_product_spec.md

## Running Processes
\`\`\`
${processes}
\`\`\`

## Team Agent Status
${Object.entries(teamStatus).map(([name, h]) =>
  `- ${h.displayName || name}: ${h.completedTasks}/${h.totalTasks} tasks | ${h.currentTask || 'idle'} | Errors: ${h.errors}`
).join('\n') || 'No team agents responding'}

## Pepper
PID: ${pepperPID || 'NOT RUNNING'}

## Hub
${hubHealth ? 'Healthy' : 'DOWN or unreachable'}

## Recent Telegram (last 10 messages)
\`\`\`
${recentTelegram}
\`\`\`

## Git (last 5 commits)
\`\`\`
${gitLog}
\`\`\`

## COMPLETED THIS SESSION — do NOT redo these
${recentCompletedTasks || 'Check git log and audit logs above'}

## Files Modified in Last Hour — do NOT recreate these
${filesModifiedLastHour || 'none'}

## Squads That Were Running — restart these if ports show DOWN
${teamAgentsWereRunning.length > 0 ? teamAgentsWereRunning.join(', ') : 'none — no squads to resurrect'}

## RULES FOR NEW SESSION
1. Do NOT rebuild agents that are already running (check team agent status above)
2. Do NOT rewrite plans that already exist (check Wendy's plans above)
3. Do NOT propose new architectures before reading docs/ files modified today
4. READ wendy_90day_plan_v1.md and wendy_team_structure_v1.md BEFORE spawning any agents
5. The Owner (Jasson) has been burned multiple times by sessions that rebuilt instead of resuming. DO NOT BE THAT SESSION.
6. If "Squads That Were Running" above is non-empty AND ports show DOWN — spawn them immediately (Step 15).
`;

  writeFileSync(HANDOFF_FILE, markdown);
  writeFileSync(HANDOFF_JSON, JSON.stringify(handoffData, null, 2));

  // ─── Ironclad: Write episodic checkpoint ─────────────────────────────────
  // Phase 3 wave 2 fix: local SQLite is authoritative. Previously this block
  // raw-POST'd straight to Supabase, bypassing SQLite — which is why the
  // memory table accumulated rows in Supabase that were never in local.
  // Now: write to SQLite first via db.saveMemory (SQLCipher handle), THEN push
  // to Supabase. Both writes are attempted; neither is allowed to crash the
  // handoff daemon (local file writes above are the ultimate safety net).
  try {
    const checkpointDescription = `Checkpoint ${nowET} — ${handoffData.runningProcesses.length} processes, ${handoffData.auditReportsGenerated.length} reports`;
    const checkpointContent = JSON.stringify({
      timestamp: now.toISOString(),
      processes: handoffData.runningProcesses.length,
      teamAgents: Object.keys(handoffData.teamAgents),
      recentDocs: handoffData.recentDocsModifiedToday.length,
      reports: handoffData.auditReportsGenerated.length,
      pepperPID: handoffData.pepperPID,
      hubHealthy: handoffData.hubHealthy
    });

    // Step 1: write to local SQLite (authoritative)
    if (db) {
      try {
        db.saveMemory('ironclad_session_checkpoint', 'episodic', checkpointDescription, checkpointContent);
      } catch (e) {
        log(`SQLite checkpoint write failed (non-fatal): ${e.message}`);
      }
    }

    // Step 2: push to Supabase. NB — session-handoff is a separate daemon from
    // comms-hub, so the post-write hook installed by comms-hub is NOT attached
    // to this process's db instance. We still have to push explicitly. This is
    // additive, not a bypass: SQLite above remains the source of truth.
    const envFile = readFileSync(join(ROOT, '.env'), 'utf8');
    const envVars = Object.fromEntries(
      envFile.split('\n').filter(l => l && !l.startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
    );
    const supabaseUrl = (envVars.SUPABASE_URL || '').replace(/\/$/, '');
    const supabaseKey = envVars.SUPABASE_SERVICE_KEY;

    if (supabaseUrl && supabaseKey) {
      // Upsert via PATCH-or-POST pattern: delete existing, insert new
      await fetch(`${supabaseUrl}/rest/v1/memory?name=eq.ironclad_session_checkpoint`, {
        method: 'DELETE',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      }).catch(() => {});

      await fetch(`${supabaseUrl}/rest/v1/memory`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'ironclad_session_checkpoint',
          type: 'episodic',
          description: checkpointDescription,
          content: checkpointContent
        })
      }).catch(() => {});
      // Log every 10th write to avoid spam
      if (Math.random() < 0.1) log('Episodic checkpoint written to SQLite + Supabase');
    }
  } catch (e) {
    // Silent fail — local files are the primary, SQLite + Supabase are backup
  }

  return handoffData;
}

// Main loop
log('Session handoff daemon starting');
log(`Writing to: ${HANDOFF_FILE}`);
log(`JSON to: ${HANDOFF_JSON}`);

// Write immediately on start
try {
  const data = await buildHandoff();
  log(`Initial handoff written. ${data.runningProcesses.length} processes, ${data.recentDocsModifiedToday.length} docs today, ${data.auditReportsGenerated.length} reports. Squads running: ${data.teamAgentsWereRunning.join(', ') || 'none'}`);
} catch (e) {
  log(`Error: ${e.message}`);
}

// Then loop
setInterval(async () => {
  try {
    await buildHandoff();
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}, INTERVAL);

// Crash-moment snapshot: detect when hub switches relay→autonomous (terminal just died)
// Write a fresh handoff immediately at that moment — before the 60s interval fires.
// This captures the most accurate squad state right at crash time.
let lastKnownTerminalState = null;
setInterval(async () => {
  try {
    const health = shell('curl -s --max-time 2 http://localhost:3457/health 2>/dev/null');
    if (health) {
      const h = JSON.parse(health);
      const currentState = h.terminalState;
      if (lastKnownTerminalState === 'relay' && currentState === 'autonomous') {
        log('Terminal state changed relay→autonomous — writing crash-moment snapshot immediately');
        await buildHandoff();
        log('Crash-moment snapshot written');
      }
      lastKnownTerminalState = currentState;
    }
  } catch {}
}, 10000); // Check every 10 seconds
