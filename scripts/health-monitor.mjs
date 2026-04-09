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
import { readFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Use SQLCipher variant when available (matches rest of stack)
const _require = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3-multiple-ciphers');
} catch {
  Database = _require('better-sqlite3');
}

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

const DEDUP_WINDOW_MS   = 5 * 60 * 1000;  // 5 min — same signature = increment, don't re-alert
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min — same signature cannot re-alert within this window
const COLD_START_GRACE_MS = 90_000; // 90s — suppress ALL Telegram alerts after startup to avoid spam

// ─── Alert state map ──────────────────────────────────────────────────────────
// Keyed by signature. Tracks lastAlertedAt to enforce ALERT_COOLDOWN_MS.
// Populated at startup from recent SQLite events to survive restarts cleanly.
const alertState = new Map(); // sig -> { lastAlertedAt: number }
const startupTime = Date.now();

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── SQLite ──────────────────────────────────────────────────────────────────
// Primary: macOS Keychain. Fallback: env var. Matches memory-db.mjs / 9-ops-daemon.mjs pattern.
function getEncryptionKey() {
  try {
    return execSync(
      'security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
  } catch {
    // Keychain unavailable (e.g. LaunchAgent without GUI session)
  }
  return process.env.SQLITE_ENCRYPTION_KEY || null;
}
const ENCRYPTION_KEY = getEncryptionKey();
let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  // Apply SQLCipher key if set (matches memory-db.mjs pattern)
  if (ENCRYPTION_KEY) {
    _db.pragma(`key = '${ENCRYPTION_KEY}'`);
    _db.pragma('cipher = sqlcipher');
  }
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
      // Return object with isNew=false so check() knows not to bypass alert cooldown
      return { id: existing.id, isNew: false, sig };
    }

    // New or different signature — insert fresh row
    const result = db.prepare(`
      INSERT INTO health_events
        (timestamp, component, status, metric_name, metric_value, severity, message, signature, event_count, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(now, component, status, String(metricName), String(metricValue ?? ''), severity, message || '', sig, now);

    return { id: result.lastInsertRowid, isNew: true, sig };
  } catch (e) {
    log(`recordEvent error: ${e.message}`);
    return { id: null, isNew: true, sig: null };
  }
}

// ─── Telegram Alert ──────────────────────────────────────────────────────────
// Fire-and-forget. Never blocks the monitor loop.
// Alert routing: only CRITICAL severity reaches Owner's Telegram.
// Warnings are log-only (9/Wendy channel — ops team monitors logs).
async function alertTelegram(message, severity = 'critical') {
  // Always log the alert regardless of severity
  log(`[alert:${severity}] ${message}`);
  // Only send to Owner's Telegram for critical alerts
  if (severity !== 'critical') return;
  try {
    const body = JSON.stringify({ channel: 'telegram', message: `[9-OPS] ${message}` });
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
    // Use better-sqlite3-multiple-ciphers via getDb() — handles SQLCipher encryption.
    // The sqlite3 CLI cannot open encrypted databases.
    const db = getDb();
    const rows = db.prepare('PRAGMA integrity_check;').all();
    const result = rows.map(r => Object.values(r)[0]).join('\n').trim();
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

// ─── RAM check ───────────────────────────────────────────────────────────────
// macOS uses all available RAM as file cache — raw used% is always high and is
// normal (not an alarm signal). Use memory_pressure command instead, which reports
// actual system pressure: normal / warning / critical.
async function checkRam() {
  try {
    const totalBytes = parseInt(
      execSync('sysctl -n hw.memsize', { encoding: 'utf-8', timeout: 2000 }).trim()
    );
    const totalMb = Math.round(totalBytes / (1024 * 1024));

    // memory_pressure is the authoritative macOS memory health indicator
    let pressureLevel = 'normal';
    try {
      const pressureOut = execSync('memory_pressure 2>/dev/null | head -1', { encoding: 'utf-8', timeout: 5000 });
      if (pressureOut.toLowerCase().includes('critical')) pressureLevel = 'critical';
      else if (pressureOut.toLowerCase().includes('warning')) pressureLevel = 'warning';
    } catch {
      // memory_pressure may not be available on all macOS versions
    }

    // Also compute wired + active pages (true "in-use" memory, not cache)
    const vmOut = execSync('vm_stat', { encoding: 'utf-8', timeout: 5000 });
    const pageSize = parseInt(
      execSync('sysctl -n hw.pagesize', { encoding: 'utf-8', timeout: 2000 }).trim()
    );
    const pages = {};
    for (const line of vmOut.split('\n')) {
      const m = line.match(/Pages\s+(.+?):\s+(\d+)/);
      if (m) pages[m[1].toLowerCase().trim()] = parseInt(m[2]);
    }
    const wiredMb  = Math.round(((pages['wired down'] || 0)) * pageSize / (1024 * 1024));
    const activeMb = Math.round((pages.active || 0) * pageSize / (1024 * 1024));
    const inUseMb  = wiredMb + activeMb;
    const inUsePct = Math.round((inUseMb / totalMb) * 100);

    const severity = pressureLevel === 'critical' ? 'critical'
                   : pressureLevel === 'warning'  ? 'warning'
                   : 'info';

    return {
      status:      severity === 'info' ? 'healthy' : pressureLevel,
      metricValue: inUsePct,
      severity,
      message:     `RAM pressure: ${pressureLevel} | active+wired: ${inUseMb}MB / ${totalMb}MB (${inUsePct}%)`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'warning', message: `RAM check failed: ${e.message}` };
  }
}

// ─── CPU check ───────────────────────────────────────────────────────────────
// Cached — top -l takes 3s each call. Only samples every 60s.
let lastCpuCheck = 0;
let cpuCached = { status: 'unknown', metricValue: null, severity: 'info', message: 'Not yet checked' };
const CPU_CACHE_MS = 60_000;

async function checkCpu() {
  if (Date.now() - lastCpuCheck < CPU_CACHE_MS) return cpuCached;
  try {
    const out = execSync('top -l 2 -n 0 | grep "CPU usage" | tail -1', {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    const idleMatch = out.match(/([\d.]+)%\s+idle/);
    if (!idleMatch) throw new Error('Could not parse CPU usage');
    const idle = parseFloat(idleMatch[1]);
    const usedPct = Math.round(100 - idle);
    let severity = 'info';
    if (usedPct >= 95) severity = 'critical';
    else if (usedPct >= 80) severity = 'warning';
    cpuCached = {
      status:      severity === 'info' ? 'healthy' : (severity === 'critical' ? 'critical' : 'warning'),
      metricValue: usedPct,
      severity,
      message:     `CPU: ${usedPct}% used (${(100 - usedPct).toFixed(1)}% idle)`,
    };
  } catch (e) {
    cpuCached = { status: 'error', metricValue: null, severity: 'warning', message: `CPU check failed: ${e.message}` };
  }
  lastCpuCheck = Date.now();
  return cpuCached;
}

// ─── Network latency check ────────────────────────────────────────────────────
async function checkNetwork() {
  try {
    const start = Date.now();
    await fetch('https://1.1.1.1', {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    let severity = 'info';
    if (latencyMs >= 3000) severity = 'critical';
    else if (latencyMs >= 1000) severity = 'warning';
    return {
      status:      severity === 'info' ? 'healthy' : (latencyMs >= 3000 ? 'degraded' : 'slow'),
      metricValue: latencyMs,
      severity,
      message:     `Network latency to 1.1.1.1: ${latencyMs}ms`,
    };
  } catch (e) {
    return { status: 'down', metricValue: null, severity: 'critical', message: `Network unreachable: ${e.message}` };
  }
}

// ─── DNS resolution check ─────────────────────────────────────────────────────
async function checkDns() {
  const hosts = ['api.anthropic.com', 'api.telegram.org'];
  const results = [];
  for (const host of hosts) {
    try {
      const start = Date.now();
      execSync(`host ${host} 8.8.8.8`, { encoding: 'utf-8', timeout: 5000 });
      results.push({ host, ok: true, ms: Date.now() - start });
    } catch {
      results.push({ host, ok: false });
    }
  }
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    return {
      status: 'degraded', metricValue: failed.length, severity: 'critical',
      message: `DNS failed for: ${failed.map(r => r.host).join(', ')}`,
    };
  }
  const maxMs = Math.max(...results.map(r => r.ms));
  return {
    status: 'healthy', metricValue: maxMs, severity: 'info',
    message: `DNS OK: ${results.map(r => `${r.host} ${r.ms}ms`).join(', ')}`,
  };
}

// ─── TLS certificate expiry check ────────────────────────────────────────────
let lastCertCheck = 0;
let certCached = { status: 'unknown', metricValue: null, severity: 'info', message: 'Not yet checked' };
const CERT_CACHE_MS  = 6 * 60 * 60 * 1000; // Every 6 hours
const CERT_WARN_DAYS = 14;

async function checkCertExpiry() {
  if (Date.now() - lastCertCheck < CERT_CACHE_MS) return certCached;

  const domains = ['ainflgm.com'];
  const results = [];
  for (const domain of domains) {
    try {
      const out = execSync(
        `echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`,
        { encoding: 'utf-8', timeout: 12_000 }
      ).trim();
      const match = out.match(/notAfter=(.+)/);
      if (!match) { results.push({ domain, ok: false, reason: 'Could not parse cert date' }); continue; }
      const expiry   = new Date(match[1].trim());
      const daysLeft = Math.round((expiry - Date.now()) / (1000 * 60 * 60 * 24));
      results.push({ domain, ok: true, daysLeft, expiry: expiry.toISOString().slice(0, 10) });
    } catch (e) {
      results.push({ domain, ok: false, reason: e.message.slice(0, 100) });
    }
  }

  const failed   = results.filter(r => !r.ok);
  const expiring = results.filter(r => r.ok && r.daysLeft < CERT_WARN_DAYS);
  const minDays  = results.filter(r => r.ok).length > 0
    ? Math.min(...results.filter(r => r.ok).map(r => r.daysLeft))
    : 0;

  if (failed.length > 0) {
    certCached = { status: 'error', metricValue: 0, severity: 'warning',
      message: `Cert check failed: ${failed.map(r => `${r.domain} (${r.reason})`).join(', ')}` };
  } else if (expiring.length > 0) {
    certCached = { status: 'expiring', metricValue: minDays, severity: minDays < 7 ? 'critical' : 'warning',
      message: `TLS certs expiring: ${expiring.map(r => `${r.domain} in ${r.daysLeft}d`).join(', ')}` };
  } else {
    certCached = { status: 'healthy', metricValue: minDays, severity: 'info',
      message: `TLS certs OK: ${results.filter(r => r.ok).map(r => `${r.domain} (${r.daysLeft}d)`).join(', ')}` };
  }
  lastCertCheck = Date.now();
  return certCached;
}

// ─── Cloud worker liveness check ─────────────────────────────────────────────
let lastCloudCheck = 0;
let cloudCached = { status: 'unknown', metricValue: null, severity: 'info', message: 'Not yet checked' };
const CLOUD_CACHE_MS = 60_000;

async function checkCloudWorker() {
  if (Date.now() - lastCloudCheck < CLOUD_CACHE_MS) return cloudCached;

  let workerUrl = process.env.CLOUD_WORKER_URL;
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const m = envContent.match(/CLOUD_WORKER_URL=(.*)/);
    if (m) workerUrl = m[1].trim();
  } catch {}

  if (!workerUrl) {
    cloudCached = { status: 'unknown', metricValue: null, severity: 'info', message: 'CLOUD_WORKER_URL not set' };
    lastCloudCheck = Date.now();
    return cloudCached;
  }

  try {
    const start = Date.now();
    const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - start;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const mode  = data.mode || 'unknown';
    const macHb = data.macLastHeartbeat;
    const hbAgeMin = macHb ? Math.round((Date.now() - new Date(macHb)) / 60_000) : null;
    cloudCached = {
      status: 'healthy', metricValue: latencyMs, severity: 'info',
      message: `Cloud worker OK (${latencyMs}ms, mode: ${mode}, mac hb: ${hbAgeMin !== null ? hbAgeMin + 'min ago' : 'none'})`,
    };
  } catch (e) {
    cloudCached = {
      status: 'down', metricValue: null, severity: 'critical',
      message: `Cloud worker unreachable: ${e.message}`,
    };
  }
  lastCloudCheck = Date.now();
  return cloudCached;
}

// ─── Backup freshness check ───────────────────────────────────────────────────
async function checkBackupFreshness() {
  const backupDir = path.join(PROJECT, 'data/backups');
  try {
    if (!existsSync(backupDir)) {
      return { status: 'missing', metricValue: null, severity: 'warning', message: 'Backup directory not found' };
    }
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('9-memory-') && f.endsWith('.sql.gz'))
      .map(f => ({ name: f, mtime: statSync(path.join(backupDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return { status: 'missing', metricValue: null, severity: 'warning', message: 'No backups found in data/backups/' };
    }
    const ageHours = Math.round((Date.now() - files[0].mtime) / (1000 * 60 * 60));
    let severity = 'info';
    if (ageHours > 48) severity = 'critical';
    else if (ageHours > 26) severity = 'warning';
    return {
      status: severity === 'info' ? 'fresh' : 'stale',
      metricValue: ageHours,
      severity,
      message: `Latest backup: ${files[0].name} (${ageHours}h ago)`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'warning', message: `Backup freshness check failed: ${e.message}` };
  }
}

// ─── Sentry wiring check ─────────────────────────────────────────────────────
// Verifies DSNs are present in .env and @sentry/node module is loadable.
// Does NOT make network calls — lightweight, safe to run every 30s.
async function checkSentry() {
  try {
    // Count SENTRY_DSN_* vars present in env
    const dsnKeys = ['SENTRY_DSN_COMMS_HUB', 'SENTRY_DSN_VOICE_SERVER', 'SENTRY_DSN_TRADER9_BOT'];
    const configured = dsnKeys.filter(k => process.env[k] && process.env[k].startsWith('https://')).length;
    // Verify the module is loadable (it's already loaded in nodes that use it, but verifiable here)
    const { createRequire } = await import('module');
    const req = createRequire(import.meta.url);
    let moduleOk = false;
    try { req.resolve('@sentry/node'); moduleOk = true; } catch {}
    if (configured === 0) {
      return { status: 'unconfigured', metricValue: 0, severity: 'warning', message: 'No SENTRY_DSN_* vars found in environment' };
    }
    if (!moduleOk) {
      return { status: 'module_missing', metricValue: configured, severity: 'critical', message: `@sentry/node module not found — ${configured} DSN(s) configured but SDK not installed` };
    }
    return {
      status: 'ok',
      metricValue: configured,
      severity: 'info',
      message: `Sentry wired: ${configured}/${dsnKeys.length} DSNs configured, @sentry/node module present`,
    };
  } catch (e) {
    return { status: 'error', metricValue: null, severity: 'warning', message: `Sentry check error: ${e.message}` };
  }
}

// ─── FAST LOOP (every 30s) ───────────────────────────────────────────────────
// Ports, processes, disk, memory, network
async function runFastChecks() {
  log('--- fast checks ---');

  await check({ component: 'comms-hub',      metricName: 'http_status',   getValue: () => checkHttpEndpoint('comms-hub',     `${HUB_URL}/health`) });
  await check({ component: 'voice-server',   metricName: 'http_status',   getValue: () => checkHttpEndpoint('voice-server',  'http://localhost:3456/health') });
  await check({ component: 'trader9-bot',    metricName: 'process_alive', getValue: () => checkProcess('trader9-bot',   'scripts/trader9-bot.mjs') });
  await check({ component: 'trinity-agent',  metricName: 'process_alive', getValue: () => checkProcess('trinity-agent', 'scripts/trinity-agent.mjs') });
  await check({ component: 'jules-telegram', metricName: 'process_alive', getValue: () => checkProcess('jules-telegram','scripts/jules-telegram.mjs') });
  await check({ component: 'pilot-server',   metricName: 'process_alive', getValue: () => checkProcess('pilot-server',  'scripts/pilot-server.mjs') });
  await check({ component: 'disk',           metricName: 'used_pct',      getValue: () => checkDisk() });
  await check({ component: 'ram',            metricName: 'used_pct',      getValue: () => checkRam() });
  await check({ component: 'cpu',            metricName: 'used_pct',      getValue: () => checkCpu() });
  await check({ component: 'network',        metricName: 'latency_ms',    getValue: () => checkNetwork() });
  await check({ component: 'cloud-worker',   metricName: 'latency_ms',    getValue: () => checkCloudWorker() });
  await check({ component: 'claude-code',    metricName: 'rss_mb',        getValue: () => checkClaudeMemory() });
  await check({ component: 'claude-watchdog',metricName: 'restart_count', getValue: () => checkWatchdogRestarts() });
  await check({ component: 'ram-watch-agent',metricName: 'http_status',   getValue: () => checkHttpEndpoint('ram-watch-agent', 'http://localhost:3459/health') });
  await check({ component: 'usage-monitor',  metricName: 'http_status',   getValue: () => checkHttpEndpoint('usage-monitor',   'http://localhost:3460/health') });
  await check({ component: '9-ops-daemon',   metricName: 'http_status',   getValue: () => checkHttpEndpoint('9-ops-daemon',    'http://localhost:3461/health') });
  await check({ component: 'sentry',         metricName: 'dsn_count',     getValue: () => checkSentry() });
}

// ─── SLOW LOOP (every 5m) ────────────────────────────────────────────────────
// External services, DB integrity, certs, DNS, backup freshness
async function runSlowChecks() {
  log('--- slow checks ---');

  await check({ component: 'ainflgm.com',    metricName: 'http_status',   getValue: () => checkHttpEndpoint('ainflgm.com', 'https://ainflgm.com', 10_000) });
  await check({ component: 'supabase-sync',  metricName: 'max_drift',     getValue: () => checkSupabaseDrift() });
  await check({ component: 'sqlite-db',      metricName: 'integrity',     getValue: () => checkDbIntegrity() });
  await check({ component: 'anthropic-api',  metricName: 'api_key_valid', getValue: () => checkApiKey() });
  await check({ component: 'dns',            metricName: 'resolution_ms', getValue: () => checkDns() });
  await check({ component: 'tls-certs',      metricName: 'days_until_expiry', getValue: () => checkCertExpiry() });
  await check({ component: 'backup',         metricName: 'age_hours',     getValue: () => checkBackupFreshness() });
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

  const { id: eventId, sig } = recordEvent({
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

    const now = Date.now();

    // Cold start grace period — log but don't send Telegram alerts for 90s after startup.
    // This prevents a burst of alerts for services that are expected to be down (trader9,
    // trinity-agent, etc.) every time the monitor restarts.
    if (now - startupTime < COLD_START_GRACE_MS) {
      log(`[cold-start] alert suppressed for ${component} — grace period active (${Math.ceil((COLD_START_GRACE_MS - (now - startupTime)) / 1000)}s remaining)`);
    } else {
      // Enforce 15-minute per-signature alert cooldown
      const state = sig ? alertState.get(sig) : null;
      const lastAlerted = state?.lastAlertedAt ?? 0;
      const msSinceLast = now - lastAlerted;

      if (msSinceLast >= ALERT_COOLDOWN_MS) {
        await alertTelegram(alert, result.severity);
        if (sig) alertState.set(sig, { lastAlertedAt: now });
      } else {
        const remainMin = Math.ceil((ALERT_COOLDOWN_MS - msSinceLast) / 60_000);
        log(`[dedup] alert suppressed for ${component} (sig ${sig}) — cooldown active, ${remainMin}m remaining`);
      }
    }
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

      // ── RAM Watch rolling stats (Task 4 — WATCH Day 1) ──────────────────────
      // Pull 1m/5m/1hr averages and trends from ram_samples table.
      // getRamWatchStats() is a lightweight read — no blocking ops.
      let ramWatchStats = null;
      try {
        const now = new Date();
        function avgRss(minutesBack) {
          const since = new Date(now - minutesBack * 60_000).toISOString();
          const r = db.prepare(
            `SELECT AVG(rss_mb) AS a FROM ram_samples WHERE process_name='__system__' AND timestamp >= ?`
          ).get(since);
          return r?.a != null ? Math.round(r.a) : null;
        }
        function slope(minutesBack) {
          const since = new Date(now - minutesBack * 60_000).toISOString();
          const rows = db.prepare(
            `SELECT rss_mb, timestamp FROM ram_samples WHERE process_name='__system__' AND timestamp >= ? ORDER BY timestamp ASC`
          ).all(since);
          if (rows.length < 2) return null;
          const dtMin = (new Date(rows[rows.length-1].timestamp) - new Date(rows[0].timestamp)) / 60_000;
          if (dtMin < 0.1) return null;
          return Math.round(((rows[rows.length-1].rss_mb - rows[0].rss_mb) / dtMin) * 100) / 100;
        }
        const sysLatest = db.prepare(
          `SELECT rss_mb, percent_mem, notes, timestamp FROM ram_samples WHERE process_name='__system__' ORDER BY timestamp DESC LIMIT 1`
        ).get();
        const sampleCount = db.prepare(`SELECT count(*) as c FROM ram_samples`).get()?.c ?? 0;
        const orphanCount = db.prepare(`SELECT count(*) as c FROM ram_samples WHERE process_name='__orphan__'`).get()?.c ?? 0;
        const leakSuspects = db.prepare(
          `SELECT DISTINCT process_name FROM ram_samples WHERE notes LIKE '%LEAK%' AND timestamp >= datetime('now','-1 hour')`
        ).all().map(r => r.process_name);
        ramWatchStats = {
          status: 'running',
          port: 3459,
          samples_total: sampleCount,
          system_latest: sysLatest ?? null,
          rolling: {
            avg_1m_mb:    avgRss(1),
            avg_5m_mb:    avgRss(5),
            avg_1hr_mb:   avgRss(60),
            trend_1m_mb_per_min:  slope(1),
            trend_5m_mb_per_min:  slope(5),
            trend_1hr_mb_per_min: slope(60),
          },
          orphan_count: orphanCount,
          leak_suspects_1hr: leakSuspects,
          checked_at: now.toISOString(),
        };
      } catch (re) {
        ramWatchStats = { status: 'error', error: re.message };
      }

      res.writeHead(200, cors);
      res.end(JSON.stringify({
        monitor: { pid: process.pid, uptime: Math.round(process.uptime()), checked_at: new Date().toISOString() },
        current: Object.values(currentStatus),
        recent_events: recentEvents,
        ram_watch: ramWatchStats,
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

// ─── Pre-populate alertState from recent SQLite events ───────────────────────
// On restart, any alert fired in the last 15 minutes should be pre-suppressed
// so the first poll cycle does not re-flood Owner with known ongoing conditions.
function preloadAlertState() {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString();
    const recentCritical = db.prepare(`
      SELECT signature, MAX(last_seen) AS last_seen
      FROM health_events
      WHERE severity IN ('warning', 'critical')
        AND last_seen >= ?
      GROUP BY signature
    `).all(cutoff);
    for (const row of recentCritical) {
      const lastAlertedAt = new Date(row.last_seen).getTime();
      alertState.set(row.signature, { lastAlertedAt });
    }
    if (recentCritical.length > 0) {
      log(`[dedup] pre-loaded ${recentCritical.length} alert signature(s) from recent events — cooldown active for up to 15m`);
    }
  } catch (e) {
    log(`preloadAlertState error: ${e.message}`);
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────
log('=== 9 Health Monitor starting ===');
log(`Fast checks: every ${FAST_INTERVAL_MS / 1000}s | Slow checks: every ${SLOW_INTERVAL_MS / 1000}s`);
log(`SQLite: ${DB_PATH}`);
log(`Status API: http://localhost:${MONITOR_PORT}/status`);

// Run immediately, then kick off interval loops
(async () => {
  preloadAlertState();
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
