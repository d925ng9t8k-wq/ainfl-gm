#!/usr/bin/env node
/**
 * agent-watchdog.mjs
 * Lightweight process watchdog for 9 Enterprises critical services.
 *
 * Monitors a set of services by checking their health endpoints or process presence.
 * If a service is down, waits for a grace period, then restarts it.
 * Alerts via Telegram on every restart and on repeated failures.
 *
 * Managed by LaunchAgent com.9.agent-watchdog — restarts within seconds if it dies.
 *
 * Design principles:
 * - Simple. Under 150 lines of logic.
 * - No Claude API calls. No database writes. Pure process management.
 * - Logs to logs/agent-watchdog.log
 * - Health endpoint on port 3462 for the health-monitor to verify it's alive.
 */

import { execSync, spawn } from 'child_process';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(PROJECT, 'logs/agent-watchdog.log');
const HUB_URL = 'http://localhost:3457';
const PORT = 3462;
const CHECK_INTERVAL_MS = 30_000; // 30s
const GRACE_FAILURES = 2; // Must fail this many consecutive checks before restart

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] WATCHDOG: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// Alert levels:
// - 'log' (default): write to log only. Used for routine restarts.
// - 'critical': also send to Owner's Telegram. Used for repeated failures only.
const CRITICAL_RESTART_THRESHOLD = 3; // Alert Owner only after this many restarts of same service

async function alertTelegram(message, level = 'log') {
  // Always log
  log(`[alert:${level}] ${message}`);
  // Only send to Telegram on critical alerts
  if (level !== 'critical') return;
  try {
    await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message: `[9-OPS] ${message}` }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    log(`Alert send failed: ${e.message}`);
  }
}

// --- Helper: HTTP health check ---
function httpCheck(url) {
  return async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  };
}

// --- Helper: process presence check (for services without health endpoints) ---
function processCheck(scriptName) {
  return async () => {
    try {
      const out = execSync(`pgrep -f "${scriptName}"`, { timeout: 5000 }).toString().trim();
      return out.length > 0;
    } catch {
      return false;
    }
  };
}

// --- Helper: spawn a node script detached ---
function nodeRestart(scriptPath) {
  return () => {
    spawn('/opt/homebrew/bin/node', [path.join(PROJECT, scriptPath)], {
      cwd: PROJECT, detached: true, stdio: 'ignore',
      env: { ...process.env, NODE_ENV: 'production' },
    }).unref();
  };
}

// --- Service definitions ---
// Tier 1: Critical infrastructure (has health endpoints)
// Tier 2: Important agents (process presence check)
const services = [
  // === TIER 1: Critical — health endpoint checks ===
  {
    name: 'comms-hub',
    check: httpCheck(`${HUB_URL}/health`),
    restart: nodeRestart('scripts/comms-hub.mjs'),
  },
  {
    name: 'voice-server',
    check: httpCheck('http://localhost:3456/health'),
    restart: nodeRestart('scripts/voice-server.mjs'),
  },
  {
    name: 'pilot-server',
    check: httpCheck('http://localhost:3460/health'),
    restart: nodeRestart('scripts/pilot-server.mjs'),
  },
  // === TIER 2: Important agents — process presence checks ===
  {
    name: 'jules-telegram',
    check: processCheck('jules-telegram.mjs'),
    restart: nodeRestart('scripts/jules-telegram.mjs'),
  },
  {
    name: 'trader9-bot',
    check: processCheck('trader9-bot.mjs'),
    restart: nodeRestart('scripts/trader9-bot.mjs'),
  },
  {
    name: 'trinity-agent',
    check: processCheck('trinity-agent.mjs'),
    restart: nodeRestart('scripts/trinity-agent.mjs'),
  },
  // === TIER 2: Squad agents (ports 3480-3484) ===
  {
    name: 'wendy-agent',
    check: httpCheck('http://localhost:3480/health'),
    restart: nodeRestart('scripts/wendy-agent.mjs'),
  },
  {
    name: 'fort-agent',
    check: httpCheck('http://localhost:3481/health'),
    restart: nodeRestart('scripts/fort-agent.mjs'),
  },
  {
    name: 'tee-agent',
    check: httpCheck('http://localhost:3483/health'),
    restart: nodeRestart('scripts/tee-agent.mjs'),
  },
  {
    name: 'scout-agent',
    check: httpCheck('http://localhost:3484/health'),
    restart: nodeRestart('scripts/scout-agent.mjs'),
  },
];

// --- Failure tracking ---
const failureCounts = {};
const restartCounts = {};
const startedAt = new Date().toISOString();
let totalChecks = 0;

for (const s of services) {
  failureCounts[s.name] = 0;
  restartCounts[s.name] = 0;
}

// --- Check loop ---
async function runChecks() {
  totalChecks++;
  for (const service of services) {
    let alive = false;
    try {
      alive = await service.check();
    } catch {
      alive = false;
    }

    if (alive) {
      if (failureCounts[service.name] > 0) {
        log(`${service.name} recovered after ${failureCounts[service.name]} failure(s)`);
      }
      failureCounts[service.name] = 0;
      continue;
    }

    failureCounts[service.name]++;
    log(`${service.name} check failed (${failureCounts[service.name]}/${GRACE_FAILURES})`);

    if (failureCounts[service.name] >= GRACE_FAILURES) {
      log(`RESTARTING ${service.name} after ${failureCounts[service.name]} consecutive failures`);
      try {
        service.restart();
        restartCounts[service.name]++;
        const count = restartCounts[service.name];
        const msg = `[watchdog] Restarted ${service.name} (restart #${count})`;
        log(msg);
        // Only escalate to Owner's Telegram after repeated failures
        const level = count >= CRITICAL_RESTART_THRESHOLD ? 'critical' : 'log';
        await alertTelegram(msg, level);
      } catch (e) {
        const errMsg = `[watchdog] FAILED to restart ${service.name}: ${e.message}`;
        log(errMsg);
        // Failed restarts always escalate
        await alertTelegram(errMsg, 'critical');
      }
      failureCounts[service.name] = 0; // Reset after restart attempt
    }
  }
}

// --- Health endpoint ---
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      startedAt,
      totalChecks,
      restartCounts,
      failureCounts,
      services: services.map(s => s.name),
    }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Agent watchdog started on port ${PORT} — monitoring ${services.length} services`);
});

// --- Main loop ---
setInterval(runChecks, CHECK_INTERVAL_MS);
runChecks(); // Run immediately on start
