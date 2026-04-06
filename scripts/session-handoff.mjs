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

function buildHandoff() {
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

  // Build structured JSON
  const handoffData = {
    generated: now.toISOString(),
    generatedET: nowET,
    message: 'READ THIS ENTIRE FILE BEFORE DOING ANYTHING. This is the state of the universe at the time of the last session.',
    runningProcesses: processes.split('\n').filter(Boolean),
    teamAgents: teamStatus,
    recentDocsModifiedToday: recentDocs.split('\n').filter(Boolean),
    recentMemoryModifiedToday: recentMemory.split('\n').filter(Boolean),
    auditReportsGenerated: recentLogs.split('\n').filter(Boolean),
    gitLog: gitLog.split('\n').filter(Boolean),
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

## RULES FOR NEW SESSION
1. Do NOT rebuild agents that are already running (check team agent status above)
2. Do NOT rewrite plans that already exist (check Wendy's plans above)
3. Do NOT propose new architectures before reading docs/ files modified today
4. READ wendy_90day_plan_v1.md and wendy_team_structure_v1.md BEFORE spawning any agents
5. The Owner (Jasson) has been burned multiple times by sessions that rebuilt instead of resuming. DO NOT BE THAT SESSION.
`;

  writeFileSync(HANDOFF_FILE, markdown);
  writeFileSync(HANDOFF_JSON, JSON.stringify(handoffData, null, 2));
  return handoffData;
}

// Main loop
log('Session handoff daemon starting');
log(`Writing to: ${HANDOFF_FILE}`);
log(`JSON to: ${HANDOFF_JSON}`);

// Write immediately on start
try {
  const data = buildHandoff();
  log(`Initial handoff written. ${data.runningProcesses.length} processes, ${data.recentDocsModifiedToday.length} docs today, ${data.auditReportsGenerated.length} reports.`);
} catch (e) {
  log(`Error: ${e.message}`);
}

// Then loop
setInterval(() => {
  try {
    buildHandoff();
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}, INTERVAL);
