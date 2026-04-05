/**
 * health-monitor.mjs
 * Real-time health monitoring for the 9 universe.
 *
 * - Polls every component on a continuous loop (30s fast, 5m slow)
 * - Logs every event to SQLite health_events table
 * - Alerts Owner via Telegram immediately on severity >= warning
 * - Deduplicates same signature within 5 min (update count, no spam)
 * - Different signature = new row + new alert (pattern capture for recursive learning)
 * - Exposes /health-monitor/status for hub self-test
 *
 * Managed by LaunchAgent com.9.health-monitor — restarts within seconds if it dies.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { createServer } from 'http';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = path.join(PROJECT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      if (key && !key.startsWith('#')) process.env[key] = val;
    }
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────
const HUB_URL      = 'http://localhost:3457';
const DB_PATH      = path.join(PROJECT, 'data/9-memory.db');
const LOG_FILE     = path.join(PROJECT, 'logs/health-monitor.log');
const MONITOR_PORT = 3458;

const FAST_INTERVAL_MS = 30_000;  // 30s — ports, processes, disk
const SLOW_INTERVAL_MS = 300_000; // 5m  — ainflgm.com, supabase drift, DB integrity, API key

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 min — same signature = increment, don't re-alert

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── SQLite ──────────────────────────────────────────────────────────────────
let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  // Ensure health_events table exists (idempotent — also in memory-db.mjs schema)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS health_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     TEXT    NOT NULL,
      component     TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      metric_name   TEXT    NOT NULL,
      metric_value  TEXT,
      severity      TEXT    NOT NULL DEFAULT 'info',
      message       TEXT,
      signature     TEXT    NOT NULL,
      event_count   INTEGER NOT NULL DEFAULT 1,
      last_seen     TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_health_events_timestamp ON health_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_health_events_component ON health_events(component);
    CREATE INDEX IF NOT EXISTS idx_health_events_severity  ON health_events(severity);
    CREATE INDEX IF NOT EXISTS idx_health_events_signature ON health_events(signature);
    CREATE INDEX IF NOT EXISTS idx_health_events_last_seen ON health_events(last_seen);
  `);
  return _db;
}

// ─── Signature & Dedup ───────────────────────────────────────────────────────
// Signature = hash of (component + status + metric_name + bucketed metric_value).
// Bucketing groups similar numeric values so small fluctuations don't break dedup,
// while any real state change (different status, different component) = new signature.
function makeSignature(component, status, metricName, metricValue) {
  // Bucket numeric values to nearest 5 to absorb minor drift
  let bucket = String(metricValue ?? '');
  const num = parseFloat(bucket);
  if (!isNaN(num) && isFinite(num)) {
    bucket = String(Math.round(num / 5) * 5);
  }
  return createHash('sha256')
    .update(`${component}|${status}|${metricName}|${bucket}`)
    .digest('hex')
    .slice(0, 16);
}

// ─── Event Recording ─────────────────────────────────────────────────────────
function recordEvent({ component, status, metricName, metricValue, severity, message }) {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const sig = makeSignature(component, status, metricName, metricValue);

    // Check for existing row with same signature within dedup window
    const existing = db.prepare(`
      SELECT id, event_count
      FROM health_events
      WHERE signature = ?
        AND last_seen >= datetime('now', ?)
      ORDER BY last_seen DESC
      LIMIT 1
    `).get(sig, `-${DEDUP_WINDOW_MS / 1000} seconds`);

    if (existing) {
      // Same signature within window — just bump the counter and timestamp
      db.prepare(`
        UPDATE health_events SET event_count = event_count + 1, last_seen = ? WHERE id = ?
      `).run(now, existing.id);
      // No Telegram alert for pure dedup — just update
      return existing.id;
    }

    // New or different signature — insert fresh row
    const result = db.prepare(`
      INSERT INTO health_events
        (timestamp, component, status, metric_name, metric_value, severity, message, signature, event_count, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(now, component, status, String(metricName), String(metricValue ?? ''), severity, message || '', sig, now);

    return result.lastInsertRowid;
  } catch (e) {
    log(`recordEvent error: ${e.message}`);
    return null;
  }
}

// ─── Telegram Alert ──────────────────────────────────────────────────────────
// Fire-and-forget. Never blocks the monitor loop.
async function alertTelegram(message) {
  try {
    const body = JSON.stringify({ channel: 'telegram', message });
    const res = await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`Alert Telegram failed: ${res.status}`);
  } catch (e) {
    log(`Alert Telegram error: ${e.message}`);
  }
}

// ─── In-memory current-status cache ──────────────────────────────────────────
// Updated by check() on every poll. Returned by /status endpoint.
const currentStatus = {};

// ─── Individual Checks ───────────────────────────────────────────────────────

async function checkHttpEndpoint(name, url, timeoutMs = 8000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const ok = res.ok;
    return {
      status:      ok ? 'healthy' : 'degraded',
      metricValue: res.status,
      severity:    ok ? 'info' : 'critical',
      message:     ok ? `${name} responding (HTTP ${res.status})` : `${name} returned HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      status:      'down',
      metricValue: 0,
      severity:    'critical',
      message:     `${name} unreachable: ${e.message}`,
    };
  }
}

async function checkProcess(name, grepPattern) {
  try {
    const out = execSync(`pgrep -f "${grepPattern}" 2>/dev/null || true`, { encoding: 'utf-8', timeout: 5000 }).trim();
    const pids = out.split('\n').filter(Boolean);
    if (pids.length > 0) {
      return {
        status:      'running',
        metricValue: pids[0],
        severity:    'info',
        message:     `${name} running (PID ${pids[0]})`,
      };
    }
    return {
      status:      'down',
      metricValue: 0,
      severity:    'critical',
      message:     `${name} process not found`,
    };
  } catch (e) {
    return {
      status:      'error',
      metricValue: null,
      severity:    'critical',
      message:     `${name} process check failed: ${e.message}`,
    };
  }
}

async function checkDisk() {
  try {
    const out = execSync('df -k / | tail -1', { encoding: 'utf-8', timeout: 5000 });
    const parts = out.trim().split(/\s+/);
    // df -k columns: Filesystem, 1K-blocks, Used, Available, Capacity%, Mounted
    const usedPct = parseInt(parts[4]); // "72%" → 72
    let severity = 'info';
    if (usedPct >= 95) severity = 'critical';
    else if (usedPct >= 85) severity = 'warning';
    return {
      status:      severity === 'info' ? 'healthy' : (severity === 'critical' ? 'critical' : 'warning'),
      metricValue: usedPct,
      severity,
      message:     `Disk / at ${usedPct}% capacity`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'warning', message: `Disk check failed: ${e.message}` };
  }
}

async function checkClaudeMemory() {
  try {
    const logFile = path.join(PROJECT, 'logs/claude-memory.log');
    if (!existsSync(logFile)) {
      return { status: 'unknown', metricValue: null, severity: 'info', message: 'claude-memory.log not found' };
    }
    const lines = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    if (lines.length === 0) {
      return { status: 'unknown', metricValue: null, severity: 'info', message: 'claude-memory.log empty' };
    }
    const last = lines[lines.length - 1];
    // Format: [2026-04-05T11:22:25] PID=59177 RSS=240320KB
    const match = last.match(/RSS=(\d+)KB/);
    if (!match) {
      return { status: 'unknown', metricValue: null, severity: 'info', message: 'claude-memory.log unreadable' };
    }
    const rssMb = Math.round(parseInt(match[1]) / 1024);
    let severity = 'info';
    if (rssMb >= 2000) severity = 'critical';
    else if (rssMb >= 1200) severity = 'warning';
    return {
      status:      severity === 'info' ? 'healthy' : (severity === 'critical' ? 'critical' : 'warning'),
      metricValue: rssMb,
      severity,
      message:     `Claude Code RSS ${rssMb} MB`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'info', message: `Claude memory check error: ${e.message}` };
  }
}

async function checkWatchdogRestarts() {
  try {
    const logFile = path.join(PROJECT, 'logs/claude-watchdog.log');
    if (!existsSync(logFile)) {
      return { status: 'unknown', metricValue: 0, severity: 'info', message: 'claude-watchdog.log not found' };
    }
    const content = readFileSync(logFile, 'utf-8');
    // Count restart lines in the last hour
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const restarts = content.split('\n').filter(l =>
      l.includes('Starting claude') && l > oneHourAgo
    ).length;
    let severity = 'info';
    if (restarts >= 5) severity = 'critical';
    else if (restarts >= 2) severity = 'warning';
    return {
      status:      restarts === 0 ? 'stable' : (severity === 'critical' ? 'crash_loop' : 'restarting'),
      metricValue: restarts,
      severity,
      message:     `Claude watchdog: ${restarts} restart(s) in last hour`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'info', message: `Watchdog check error: ${e.message}` };
  }
}

async function checkDbIntegrity() {
  try {
    const result = execSync(
      `/usr/bin/sqlite3 "${DB_PATH}" "PRAGMA integrity_check;" 2>&1`,
      { encoding: 'utf-8', timeout: 30_000 }
    ).trim();
    const ok = result === 'ok';
    return {
      status:      ok ? 'healthy' : 'corrupt',
      metricValue: ok ? 1 : 0,
      severity:    ok ? 'info' : 'critical',
      message:     ok ? 'SQLite integrity: ok' : `SQLite integrity check failed: ${result.slice(0, 200)}`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'critical', message: `DB integrity check error: ${e.message}` };
  }
}

async function checkSupabaseDrift() {
  try {
    const res = await fetch(`${HUB_URL}/supabase-health`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { status: 'error', metricValue: null, severity: 'warning', message: `Supabase health endpoint returned ${res.status}` };
    }
    const data = await res.json();
    const drift = data.max_drift ?? 0;
    const status = data.status || 'unknown';
    let severity = 'info';
    if (status === 'drifting' || drift > 50) severity = 'critical';
    else if (drift > 10) severity = 'warning';
    return {
      status,
      metricValue: drift,
      severity,
      message:     `Supabase drift: max_drift=${drift}, status=${status}`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'warning', message: `Supabase drift check failed: ${e.message}` };
  }
}

// API key liveness — cached, probed at most once per 15 minutes
let lastApiKeyCheck = 0;
let apiKeyStatus = { status: 'unknown', metricValue: null, severity: 'info', message: 'Not yet checked' };
const API_KEY_CACHE_MS = 15 * 60 * 1000;

async function checkApiKey() {
  if (Date.now() - lastApiKeyCheck < API_KEY_CACHE_MS) {
    return apiKeyStatus; // Return cached result
  }
  try {
    const key = process.env.ANTHROPIC_API_KEY_TC || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      apiKeyStatus = { status: 'missing', metricValue: 0, severity: 'critical', message: 'No Anthropic API key in environment' };
      lastApiKeyCheck = Date.now();
      return apiKeyStatus;
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ok' }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const ok = res.status === 200 || res.status === 529; // 529 = overloaded but key is valid
    apiKeyStatus = {
      status:      ok ? 'valid' : 'invalid',
      metricValue: res.status,
      severity:    ok ? 'info' : 'critical',
      message:     ok ? `API key valid (HTTP ${res.status})` : `API key check failed: HTTP ${res.status}`,
    };
  } catch (e) {
    apiKeyStatus = { status: 'error', metricValue: null, severity: 'warning', message: `API key probe error: ${e.message}` };
  }
  lastApiKeyCheck = Date.now();
  return apiKeyStatus;
}

// ─── FAST LOOP (every 30s) ───────────────────────────────────────────────────
// Ports, processes, disk, memory
async function runFastChecks() {
  log('--- fast checks ---');

  await check({ component: 'comms-hub',     metricName: 'http_status',   getValue: () => checkHttpEndpoint('comms-hub',     `${HUB_URL}/health`) });
  await check({ component: 'voice-server',  metricName: 'http_status',   getValue: () => checkHttpEndpoint('voice-server',  'http://localhost:3456/health') });
  await check({ component: 'trader9-bot',   metricName: 'process_alive', getValue: () => checkProcess('trader9-bot',   'scripts/trader9-bot.mjs') });
  await check({ component: 'trinity-agent', metricName: 'process_alive', getValue: () => checkProcess('trinity-agent', 'scripts/trinity-agent.mjs') });
  await check({ component: 'jules-telegram',metricName: 'process_alive', getValue: () => checkProcess('jules-telegram','scripts/jules-telegram.mjs') });
  await check({ component: 'pilot-server',  metricName: 'process_alive', getValue: () => checkProcess('pilot-server',  'scripts/pilot-server.mjs') });
  await check({ component: 'disk',          metricName: 'used_pct',      getValue: () => checkDisk() });
  await check({ component: 'claude-code',   metricName: 'rss_mb',        getValue: () => checkClaudeMemory() });
  await check({ component: 'claude-watchdog',metricName:'restart_count', getValue: () => checkWatchdogRestarts() });
}

// ─── SLOW LOOP (every 5m) ────────────────────────────────────────────────────
// External services, DB integrity
async function runSlowChecks() {
  log('--- slow checks ---');

  await check({ component: 'ainflgm.com',   metricName: 'http_status',   getValue: () => checkHttpEndpoint('ainflgm.com', 'https://ainflgm.com', 10_000) });
  await check({ component: 'supabase-sync', metricName: 'max_drift',     getValue: () => checkSupabaseDrift() });
  await check({ component: 'sqlite-db',     metricName: 'integrity',     getValue: () => checkDbIntegrity() });
  await check({ component: 'anthropic-api', metricName: 'api_key_valid', getValue: () => checkApiKey() });
}

// ─── Check + Record Helper ───────────────────────────────────────────────────
// Runs a check, records the event, updates currentStatus, and fires an alert
// if severity >= warning. Returns the recorded event id.
async function check({ component, metricName, getValue }) {
  let result;
  try {
    result = await getValue();
  } catch (e) {
    result = { status: 'error', metricValue: null, severity: 'critical', message: e.message };
  }

  // Update in-memory current status
  currentStatus[component] = {
    component,
    metricName,
    status:      result.status,
    metricValue: result.metricValue,
    severity:    result.severity,
    message:     result.message,
    checkedAt:   new Date().toISOString(),
  };

  const eventId = recordEvent({
    component,
    status:      result.status,
    metricName,
    metricValue: result.metricValue,
    severity:    result.severity,
    message:     result.message,
  });

  if (result.severity === 'warning' || result.severity === 'critical') {
    const label = result.severity === 'critical' ? 'CRITICAL' : 'WARNING';
    const alert = `[health] ${label}: ${component} — ${result.message}`;
    log(alert);
    await alertTelegram(alert);
  }

  return eventId;
}

// ─── Status API ──────────────────────────────────────────────────────────────
const statusServer = createServer((req, res) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.url === '/health') {
    res.writeHead(200, cors);
    res.end(JSON.stringify({ status: 'running', pid: process.pid, uptime: Math.round(process.uptime()), checked_at: new Date().toISOString() }));
    return;
  }

  if (req.url === '/status') {
    try {
      const db = getDb();
      const recentEvents = db.prepare(`
        SELECT * FROM health_events ORDER BY last_seen DESC LIMIT 50
      `).all();
      res.writeHead(200, cors);
      res.end(JSON.stringify({
        monitor: { pid: process.pid, uptime: Math.round(process.uptime()), checked_at: new Date().toISOString() },
        current: Object.values(currentStatus),
        recent_events: recentEvents,
      }, null, 2));
    } catch (e) {
      res.writeHead(500, cors);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

statusServer.listen(MONITOR_PORT, () => {
  log(`Health monitor status API on port ${MONITOR_PORT}`);
});

statusServer.on('error', (e) => {
  log(`Status server error: ${e.message}`);
});

// ─── Main Loops ──────────────────────────────────────────────────────────────
async function fastLoop() {
  try {
    await runFastChecks();
  } catch (e) {
    log(`Fast loop error: ${e.message}`);
  }
  setTimeout(fastLoop, FAST_INTERVAL_MS);
}

async function slowLoop() {
  try {
    await runSlowChecks();
  } catch (e) {
    log(`Slow loop error: ${e.message}`);
  }
  setTimeout(slowLoop, SLOW_INTERVAL_MS);
}

// ─── Startup ─────────────────────────────────────────────────────────────────
log('=== 9 Health Monitor starting ===');
log(`Fast checks: every ${FAST_INTERVAL_MS / 1000}s | Slow checks: every ${SLOW_INTERVAL_MS / 1000}s`);
log(`SQLite: ${DB_PATH}`);
log(`Status API: http://localhost:${MONITOR_PORT}/status`);

// Run immediately, then kick off interval loops
(async () => {
  await runFastChecks();
  await runSlowChecks();
  log('Initial sweep complete — starting loops');
  setTimeout(fastLoop, FAST_INTERVAL_MS);
  setTimeout(slowLoop, SLOW_INTERVAL_MS);
})();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
  log(`${signal} — shutting down health monitor`);
  try { if (_db) _db.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => log(`Uncaught: ${e.message}`));
process.on('unhandledRejection', (r) => log(`Unhandled rejection: ${r}`));
