/**
 * monitor-canary.mjs
 * WATCH — Monitor-of-monitor watchdog.
 *
 * Checks that health-monitor is writing to SQLite at expected cadence.
 * If health_events hasn't been updated in 5+ minutes, alerts via hub directly.
 * Runs as its own LaunchAgent (com.9.monitor-canary) — independent of health-monitor.
 *
 * Author: WATCH, Observability Lead, 9 Enterprises
 * Date: 2026-04-05
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const _require = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3-multiple-ciphers');
} catch {
  Database = _require('better-sqlite3');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(PROJECT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      if (k && !k.startsWith('#')) process.env[k] = v;
    }
  }
}

const DB_PATH        = path.join(PROJECT, 'data/9-memory.db');
const LOG_FILE       = path.join(PROJECT, 'logs/monitor-canary.log');
const HUB_URL        = 'http://localhost:3457';
const MONITOR_URL    = 'http://localhost:3458';
const CHECK_INTERVAL = 60_000;   // check every 60s
const STALE_THRESH   = 300_000;  // alert if no health_events write in 5 min
const ALERT_COOLDOWN = 15 * 60_000; // re-alert at most every 15 min

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] [CANARY] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

let lastAlertAt = 0;
let db = null;

function getDb() {
  if (db) return db;
  db = new Database(DB_PATH);
  const key = process.env.SQLITE_ENCRYPTION_KEY || null;
  if (key) {
    db.pragma(`key = '${key}'`);
    db.pragma('cipher = sqlcipher');
  }
  db.pragma('journal_mode = WAL');
  return db;
}

async function alertHub(msg) {
  try {
    await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message: msg }),
      signal: AbortSignal.timeout(10_000),
    });
    log(`Alert sent: ${msg}`);
  } catch (e) {
    log(`Alert FAILED (hub unreachable): ${e.message}`);
  }
}

async function check() {
  const now = Date.now();

  // 1. Is health-monitor HTTP endpoint alive?
  let monitorAlive = false;
  try {
    const res = await fetch(`${MONITOR_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    monitorAlive = res.ok;
  } catch {}

  if (!monitorAlive) {
    log('health-monitor HTTP endpoint unreachable on port 3458');
    if (now - lastAlertAt > ALERT_COOLDOWN) {
      lastAlertAt = now;
      await alertHub('[WATCH CANARY] CRITICAL: health-monitor is DOWN — HTTP unreachable on port 3458. Alert system is blind. LaunchAgent should restart it within 10s — if this repeats, investigate immediately.');
    }
    return;
  }

  // 2. Is health-monitor writing to SQLite at expected cadence?
  try {
    const d = getDb();
    const row = d.prepare(
      `SELECT MAX(last_seen) AS latest FROM health_events`
    ).get();

    if (!row || !row.latest) {
      log('health_events table is empty — no events ever written');
      if (now - lastAlertAt > ALERT_COOLDOWN) {
        lastAlertAt = now;
        await alertHub('[WATCH CANARY] WARNING: health_events table is empty. health-monitor process is up but writing nothing to SQLite. Check health-monitor logs.');
      }
      return;
    }

    const latestMs  = new Date(row.latest).getTime();
    const staleSecs = Math.round((now - latestMs) / 1000);

    if (now - latestMs > STALE_THRESH) {
      log(`health_events STALE: last write was ${staleSecs}s ago (threshold: ${STALE_THRESH / 1000}s)`);
      if (now - lastAlertAt > ALERT_COOLDOWN) {
        lastAlertAt = now;
        await alertHub(`[WATCH CANARY] WARNING: health-monitor is running (port 3458 OK) but SQLite health_events is STALE — last write ${staleSecs}s ago. Monitor may be stuck in a loop. Check logs/health-monitor.log.`);
      }
    } else {
      log(`OK — health_events last write ${staleSecs}s ago (threshold: ${STALE_THRESH / 1000}s)`);
    }
  } catch (e) {
    log(`SQLite check error: ${e.message}`);
    if (now - lastAlertAt > ALERT_COOLDOWN) {
      lastAlertAt = now;
      await alertHub(`[WATCH CANARY] ERROR: Cannot read health_events from SQLite: ${e.message}`);
    }
  }
}

log('=== Monitor Canary starting ===');
log(`Check interval: ${CHECK_INTERVAL / 1000}s | Stale threshold: ${STALE_THRESH / 1000}s | Alert cooldown: ${ALERT_COOLDOWN / 60000}m`);

// Run immediately then on interval
check().catch(e => log(`Initial check error: ${e.message}`));
setInterval(() => {
  check().catch(e => log(`Check error: ${e.message}`));
}, CHECK_INTERVAL);
