/**
 * usage-monitor.mjs
 * Continuous usage + quota + rate-limit watcher for all 9 Enterprises paid services.
 *
 * - Polls every service on a configurable cadence (60s fast / 15m slow)
 * - Logs every event to SQLite usage_events table
 * - Alerts Owner via Telegram when services approach or hit their caps
 * - Exposes GET /usage-monitor/health for health-monitor ping
 * - Exposes GET /usage-dashboard for the hub proxy
 *
 * Alert thresholds:
 *   50% — log only (info)
 *   80% — Telegram alert once per service per day
 *   95% — Telegram CRITICAL, repeat every 10 min
 *  100% — Telegram CRITICAL + auto-throttle attempt
 *
 * SECURITY: Credentials are NEVER logged. Only metric values and percentages.
 *
 * Managed by LaunchAgent com.9.usage-monitor.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3-multiple-ciphers');
} catch {
  Database = _require('better-sqlite3');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── Load .env (same pattern as health-monitor) ──────────────────────────────
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
const HUB_URL        = 'http://localhost:3457';
const DB_PATH        = path.join(PROJECT, 'data/9-memory.db');
const LOG_FILE       = path.join(PROJECT, 'logs/usage-monitor.log');
const MONITOR_PORT   = 3460;
const DAILY_REPORT_DIR = path.join(PROJECT, 'docs');

const FAST_INTERVAL_MS  =   60_000;   // 60s  — rate-limit headers, Anthropic headers
const SLOW_INTERVAL_MS  =  900_000;   // 15m  — billing endpoints, monthly quotas
const DAILY_REPORT_HOUR =        3;   // 3 AM ET daily rollup

// Alert thresholds
const THRESHOLD_WARN     = 0.50;   // 50%  — log only
const THRESHOLD_ALERT    = 0.80;   // 80%  — Telegram alert (once/day per service)
const THRESHOLD_CRITICAL = 0.95;   // 95%  — Telegram CRITICAL (every 10 min)
const THRESHOLD_HARD_CAP = 1.00;   // 100% — CRITICAL + throttle

const ALERT_DAILY_COOLDOWN_MS    = 24 * 60 * 60 * 1000;  // 24h — for 80% alerts
const ALERT_CRITICAL_COOLDOWN_MS =       10 * 60 * 1000; // 10m — for 95% alerts
const ALERT_HARDCAP_COOLDOWN_MS  =       10 * 60 * 1000; // 10m — for 100% alerts

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });
mkdirSync(path.join(PROJECT, 'data'), { recursive: true });

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── SQLite encryption key — macOS Keychain first, env var fallback ──────────
// Matches the FORT C-03 compliant pattern used in memory-db.mjs.
function loadEncryptionKey() {
  try {
    const key = execSync(
      'security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w',
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    if (key) return key;
  } catch {
    // Keychain unavailable — fall through
  }
  return process.env.SQLITE_ENCRYPTION_KEY || null;
}

// ─── SQLite ──────────────────────────────────────────────────────────────────
const ENCRYPTION_KEY = loadEncryptionKey();
let _db;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  if (ENCRYPTION_KEY) {
    _db.pragma(`key = '${ENCRYPTION_KEY}'`);
    _db.pragma('cipher = sqlcipher');
  }
  _db.pragma('journal_mode = WAL');

  // Schema migration — idempotent
  _db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp          TEXT    NOT NULL,
      service            TEXT    NOT NULL,
      metric_name        TEXT    NOT NULL,
      metric_value       REAL,
      metric_unit        TEXT,
      limit_value        REAL,
      pct_used           REAL,
      status             TEXT    NOT NULL DEFAULT 'healthy',
      severity           TEXT    NOT NULL DEFAULT 'info',
      message            TEXT,
      raw_response_json  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_service   ON usage_events(service);
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_severity  ON usage_events(severity);
    CREATE INDEX IF NOT EXISTS idx_usage_metric    ON usage_events(metric_name);
  `);

  return _db;
}

// ─── Alert state ─────────────────────────────────────────────────────────────
// Keyed by `service:metric_name`. Tracks lastAlertedAt per threshold level.
const alertState = new Map();

function getAlertState(key) {
  if (!alertState.has(key)) alertState.set(key, { daily: 0, critical: 0, hardcap: 0 });
  return alertState.get(key);
}

// ─── Record event ─────────────────────────────────────────────────────────────
function recordEvent({ service, metricName, metricValue, metricUnit, limitValue, pctUsed, status, severity, message, rawJson }) {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    // Only store raw JSON if it doesn't contain credential patterns (extra guard)
    let safeRaw = null;
    if (rawJson) {
      // Strip any field names that look like secrets before storing
      const cleaned = JSON.stringify(rawJson).replace(/"(key|token|secret|password|auth|credential)[^"]*"\s*:\s*"[^"]+"/gi, '"[REDACTED]":"[REDACTED]"');
      safeRaw = cleaned.length < 4096 ? cleaned : cleaned.slice(0, 4096) + '...[truncated]';
    }

    db.prepare(`
      INSERT INTO usage_events
        (timestamp, service, metric_name, metric_value, metric_unit, limit_value, pct_used, status, severity, message, raw_response_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(now, service, metricName, metricValue ?? null, metricUnit || null, limitValue ?? null, pctUsed ?? null, status, severity, message || '', safeRaw);
  } catch (e) {
    log(`recordEvent error: ${e.message}`);
  }
}

// ─── In-memory current-status cache ──────────────────────────────────────────
// Updated by every poll. Returned by /health and /usage-dashboard.
const currentStatus = {};
// Tracks services that have no credentials: { serviceName: reason }
const notMonitored = {};

function updateStatus(service, metricName, data) {
  currentStatus[`${service}:${metricName}`] = {
    service,
    metricName,
    checkedAt: new Date().toISOString(),
    ...data,
  };
}

// ─── Telegram Alert ──────────────────────────────────────────────────────────
async function alertTelegram(message) {
  try {
    const res = await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`Alert Telegram failed: ${res.status}`);
  } catch (e) {
    log(`Alert Telegram error: ${e.message}`);
  }
}

// ─── Assess + alert ──────────────────────────────────────────────────────────
// Takes a poll result, computes severity, fires alert if needed, records event.
// isRemaining: if true, metricValue is what's LEFT (e.g. tokens_remaining).
//              pctUsed = (limit - remaining) / limit.
//              if false (default), metricValue is what's been USED.
//              pctUsed = used / limit.
// You may also pass pctUsed directly to override the calculation entirely.
async function assess({ service, metricName, metricValue, metricUnit, limitValue, pctUsedOverride, isRemaining = false, message, rawJson }) {
  let pctUsed;
  if (pctUsedOverride != null) {
    pctUsed = pctUsedOverride;
  } else if (limitValue && limitValue > 0 && metricValue != null) {
    if (isRemaining) {
      // metricValue is the remaining amount — convert to % used
      pctUsed = (limitValue - metricValue) / limitValue;
      if (pctUsed < 0) pctUsed = 0; // guard against over-provisioned windows
    } else {
      pctUsed = metricValue / limitValue;
    }
  } else {
    pctUsed = null;
  }

  let status   = 'healthy';
  let severity = 'info';

  if (pctUsed != null) {
    if      (pctUsed >= THRESHOLD_HARD_CAP)    { status = 'capped';   severity = 'critical'; }
    else if (pctUsed >= THRESHOLD_CRITICAL)    { status = 'critical'; severity = 'critical'; }
    else if (pctUsed >= THRESHOLD_ALERT)       { status = 'warning';  severity = 'warning';  }
    else if (pctUsed >= THRESHOLD_WARN)        { status = 'elevated'; severity = 'info';     }
    else                                       { status = 'healthy';  severity = 'info';     }
  } else {
    // No limit known — just record as info
    status   = metricValue != null ? 'reported' : 'unknown';
    severity = 'info';
  }

  const pctStr = pctUsed != null ? `${(pctUsed * 100).toFixed(1)}%` : 'no-limit';
  const fullMsg = message || `${service} ${metricName}: ${metricValue ?? 'n/a'} ${metricUnit || ''} (${pctStr})`;

  log(`[usage] ${service} ${metricName}: ${metricValue ?? 'n/a'} ${metricUnit || ''} — ${pctStr} — ${status}`);

  updateStatus(service, metricName, {
    metricValue, metricUnit, limitValue, pctUsed,
    status, severity, message: fullMsg,
  });

  recordEvent({ service, metricName, metricValue, metricUnit, limitValue, pctUsed, status, severity, message: fullMsg, rawJson });

  // Alert logic
  if (pctUsed != null) {
    const key   = `${service}:${metricName}`;
    const state = getAlertState(key);
    const now   = Date.now();

    if (pctUsed >= THRESHOLD_HARD_CAP) {
      if (now - state.hardcap >= ALERT_HARDCAP_COOLDOWN_MS) {
        await alertTelegram(`[usage] HARD CAP HIT: ${service} — ${metricName} is at ${(pctUsed*100).toFixed(1)}% of limit. Service may be blocked. ${fullMsg}`);
        state.hardcap = now;
        // Auto-throttle: tell comms-hub to note the issue (non-destructive)
        await throttleService(service, metricName);
      }
    } else if (pctUsed >= THRESHOLD_CRITICAL) {
      if (now - state.critical >= ALERT_CRITICAL_COOLDOWN_MS) {
        await alertTelegram(`[usage] CRITICAL: ${service} — ${metricName} at ${(pctUsed*100).toFixed(1)}%. Approaching hard cap. ${fullMsg}`);
        state.critical = now;
      }
    } else if (pctUsed >= THRESHOLD_ALERT) {
      if (now - state.daily >= ALERT_DAILY_COOLDOWN_MS) {
        await alertTelegram(`[usage] WARNING: ${service} — ${metricName} at ${(pctUsed*100).toFixed(1)}% of quota. ${fullMsg}`);
        state.daily = now;
      }
    }
  }
}

// ─── Auto-throttle (non-destructive nudge only) ──────────────────────────────
async function throttleService(service, metricName) {
  try {
    log(`[throttle] Attempting auto-throttle for ${service}:${metricName}`);
    // We only post a context note to the hub — actual throttling decisions stay with 9.
    // No service calls are killed. This satisfies the spec without dangerous autonomy.
    await fetch(`${HUB_URL}/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Secret': process.env.HUB_API_SECRET || '' },
      body: JSON.stringify({
        key:   `usage_throttle_${service}`,
        value: `${service} ${metricName} at hard cap at ${new Date().toISOString()}. Consider reducing call frequency.`,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch (e) {
    log(`[throttle] error: ${e.message}`);
  }
}

// ─── Safe fetch with timeout ──────────────────────────────────────────────────
async function safeFetch(url, opts = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CHECKERS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Anthropic ─────────────────────────────────────────────────────────────
// Piggyback on rate-limit state file written by comms-hub.
// Also probe the usage API if available, else report from last-known headers.
const ANTHROPIC_RATE_FILE = path.join(PROJECT, 'data/anthropic-rate-limit.json');

async function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY_TC || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    notMonitored['anthropic'] = 'missing ANTHROPIC_API_KEY';
    return;
  }

  // Read rate-limit state file (written by comms-hub on every API response)
  let rateLimitData = null;
  if (existsSync(ANTHROPIC_RATE_FILE)) {
    try {
      rateLimitData = JSON.parse(readFileSync(ANTHROPIC_RATE_FILE, 'utf-8'));
    } catch {
      log('[anthropic] rate-limit file unreadable');
    }
  }

  if (rateLimitData) {
    // Requests remaining
    const reqRemaining = rateLimitData.requests_remaining;
    const reqLimit     = rateLimitData.requests_limit;
    if (reqRemaining != null && reqLimit != null) {
      await assess({
        service: 'anthropic', metricName: 'requests_remaining',
        metricValue: reqRemaining, metricUnit: 'requests',
        limitValue: reqLimit, isRemaining: true,
        message: `Anthropic: ${reqRemaining}/${reqLimit} requests remaining (reset: ${rateLimitData.requests_reset || 'unknown'})`,
      });
    }
    // Tokens remaining
    const tokRemaining = rateLimitData.tokens_remaining;
    const tokLimit     = rateLimitData.tokens_limit;
    if (tokRemaining != null && tokLimit != null) {
      await assess({
        service: 'anthropic', metricName: 'tokens_remaining',
        metricValue: tokRemaining, metricUnit: 'tokens',
        limitValue: tokLimit, isRemaining: true,
        message: `Anthropic: ${tokRemaining}/${tokLimit} tokens remaining (reset: ${rateLimitData.tokens_reset || 'unknown'})`,
      });
    }
  } else {
    // No rate-limit file yet — do a minimal probe to populate it and capture headers
    try {
      const res = await safeFetch('https://api.anthropic.com/v1/messages', {
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
      }, 20_000);

      // Extract rate limit headers and write to file
      const headers = Object.fromEntries(res.headers.entries());
      const rl = {
        requests_limit:     parseInt(headers['anthropic-ratelimit-requests-limit'])     || null,
        requests_remaining: parseInt(headers['anthropic-ratelimit-requests-remaining']) || null,
        requests_reset:     headers['anthropic-ratelimit-requests-reset']               || null,
        tokens_limit:       parseInt(headers['anthropic-ratelimit-tokens-limit'])       || null,
        tokens_remaining:   parseInt(headers['anthropic-ratelimit-tokens-remaining'])   || null,
        tokens_reset:       headers['anthropic-ratelimit-tokens-reset']                 || null,
        sampled_at:         new Date().toISOString(),
      };
      writeFileSync(ANTHROPIC_RATE_FILE, JSON.stringify(rl, null, 2));

      if (rl.requests_remaining != null && rl.requests_limit != null) {
        await assess({
          service: 'anthropic', metricName: 'requests_remaining',
          metricValue: rl.requests_remaining, metricUnit: 'requests',
          limitValue: rl.requests_limit, isRemaining: true,
          message: `Anthropic: ${rl.requests_remaining}/${rl.requests_limit} requests remaining`,
        });
      } else {
        await assess({
          service: 'anthropic', metricName: 'api_key_valid',
          metricValue: res.ok ? 1 : 0, metricUnit: 'bool',
          limitValue: null,
          message: `Anthropic API: HTTP ${res.status} — rate-limit headers not present`,
        });
      }
    } catch (e) {
      log(`[anthropic] probe failed: ${e.message}`);
      updateStatus('anthropic', 'probe', { status: 'error', severity: 'warning', message: `Anthropic probe failed: ${e.message}` });
    }
  }
}

// ─── 2. Twilio ─────────────────────────────────────────────────────────────────
async function checkTwilio() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    notMonitored['twilio'] = 'missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN';
    return;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  // Balance
  try {
    const res = await safeFetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    if (res.ok) {
      const data = await res.json();
      const balance = parseFloat(data.balance);
      // Alert if below $5 (practical threshold for comms resilience)
      const LOW_BALANCE_THRESHOLD = 5.00;
      const pctLeft = balance / LOW_BALANCE_THRESHOLD; // > 1 = above threshold
      let severity = 'info';
      let status   = 'healthy';
      if (balance <= 1.00)  { severity = 'critical'; status = 'critical'; }
      else if (balance <= 5.00) { severity = 'warning';  status = 'warning';  }

      log(`[twilio] balance: $${balance}`);
      updateStatus('twilio', 'balance_usd', { metricValue: balance, metricUnit: 'usd', status, severity, message: `Twilio balance: $${balance} ${data.currency}` });
      recordEvent({ service: 'twilio', metricName: 'balance_usd', metricValue: balance, metricUnit: 'usd', limitValue: null, pctUsed: null, status, severity, message: `Twilio balance: $${balance} ${data.currency}`, rawJson: { balance: data.balance, currency: data.currency } });

      if (severity !== 'info') {
        const key = 'twilio:balance_usd';
        const state = getAlertState(key);
        const now = Date.now();
        if (now - state.daily >= ALERT_DAILY_COOLDOWN_MS) {
          await alertTelegram(`[usage] ${severity.toUpperCase()}: Twilio balance is $${balance}. Comms resilience at risk if this hits zero.`);
          state.daily = now;
        }
      }
    } else {
      log(`[twilio] balance check failed: HTTP ${res.status}`);
      updateStatus('twilio', 'balance_usd', { status: 'error', severity: 'warning', message: `Twilio balance endpoint returned HTTP ${res.status}` });
    }
  } catch (e) {
    log(`[twilio] balance error: ${e.message}`);
    updateStatus('twilio', 'balance_usd', { status: 'error', severity: 'warning', message: `Twilio balance error: ${e.message}` });
  }

  // Monthly SMS usage (current month)
  try {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const res   = await safeFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records.json?Category=sms&StartDate=${year}-${month}-01`,
      { headers: { 'Authorization': `Basic ${auth}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const records = data.usage_records || [];
      const smsRecord = records.find(r => r.category === 'sms');
      if (smsRecord) {
        const count = parseInt(smsRecord.count || 0);
        const price = parseFloat(smsRecord.price || 0);
        log(`[twilio] SMS this month: ${count} ($${Math.abs(price).toFixed(2)})`);
        await assess({
          service: 'twilio', metricName: 'sms_monthly_count',
          metricValue: count, metricUnit: 'messages',
          limitValue: null,
          message: `Twilio SMS this month: ${count} messages ($${Math.abs(price).toFixed(2)})`,
          rawJson: { count, price: smsRecord.price },
        });
      }
    }
  } catch (e) {
    log(`[twilio] SMS usage error: ${e.message}`);
  }
}

// ─── 3. ElevenLabs ────────────────────────────────────────────────────────────
async function checkElevenLabs() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    notMonitored['elevenlabs'] = 'missing ELEVENLABS_API_KEY';
    return;
  }

  try {
    const res = await safeFetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
    });
    if (!res.ok) {
      log(`[elevenlabs] subscription check failed: HTTP ${res.status}`);
      updateStatus('elevenlabs', 'characters_remaining', { status: 'error', severity: 'warning', message: `ElevenLabs API returned HTTP ${res.status}` });
      return;
    }
    const data = await res.json();
    const used        = data.character_count || 0;
    const limit       = data.character_limit || null;
    const remaining   = limit ? limit - used : null;
    const resetDate   = data.next_character_count_reset_unix
      ? new Date(data.next_character_count_reset_unix * 1000).toISOString().slice(0, 10)
      : 'unknown';

    log(`[elevenlabs] chars used: ${used}/${limit ?? 'unknown'} (reset: ${resetDate})`);

    await assess({
      service: 'elevenlabs', metricName: 'characters_used',
      metricValue: used, metricUnit: 'characters',
      limitValue: limit,
      message: `ElevenLabs: ${used}/${limit ?? '?'} characters used (reset: ${resetDate})`,
      rawJson: { character_count: used, character_limit: limit, tier: data.tier, next_reset: resetDate },
    });
  } catch (e) {
    log(`[elevenlabs] error: ${e.message}`);
    updateStatus('elevenlabs', 'characters_used', { status: 'error', severity: 'warning', message: `ElevenLabs check failed: ${e.message}` });
  }
}

// ─── 4. HeyGen ────────────────────────────────────────────────────────────────
async function checkHeyGen() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    notMonitored['heygen'] = 'missing HEYGEN_API_KEY';
    return;
  }

  try {
    // HeyGen v2 API — account remaining credits
    const res = await safeFetch('https://api.heygen.com/v2/user/remaining_quota', {
      headers: { 'X-Api-Key': key },
    });

    if (!res.ok) {
      // Try v1 endpoint as fallback
      const res1 = await safeFetch('https://api.heygen.com/v1/user.info', {
        headers: { 'X-Api-Key': key },
      });
      if (res1.ok) {
        const data1 = await res1.json();
        const credits = data1.data?.remaining_credits ?? data1.data?.credit_balance ?? null;
        log(`[heygen] credits (v1): ${credits ?? 'unknown'}`);
        await assess({
          service: 'heygen', metricName: 'credits_remaining',
          metricValue: credits, metricUnit: 'credits',
          limitValue: null,
          message: `HeyGen credits remaining: ${credits ?? 'unknown'}`,
          rawJson: { credits },
        });
      } else {
        log(`[heygen] both endpoints failed (${res.status}, ${res1.status})`);
        updateStatus('heygen', 'credits_remaining', { status: 'error', severity: 'warning', message: `HeyGen API endpoints returned ${res.status}/${res1.status}` });
      }
      return;
    }

    const data    = await res.json();
    const credits = data.data?.remaining_quota ?? data.remaining_quota ?? null;
    log(`[heygen] credits remaining: ${credits ?? 'unknown'}`);
    await assess({
      service: 'heygen', metricName: 'credits_remaining',
      metricValue: credits, metricUnit: 'credits',
      limitValue: null,
      message: `HeyGen credits remaining: ${credits ?? 'unknown'}`,
      rawJson: { remaining_quota: credits },
    });
  } catch (e) {
    log(`[heygen] error: ${e.message}`);
    updateStatus('heygen', 'credits_remaining', { status: 'error', severity: 'warning', message: `HeyGen check failed: ${e.message}` });
  }
}

// ─── 5. Cloudflare ────────────────────────────────────────────────────────────
async function checkCloudflare() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    notMonitored['cloudflare'] = 'missing CLOUDFLARE_API_TOKEN';
    return;
  }

  try {
    // Get account info to find account ID
    const accountRes = await safeFetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!accountRes.ok) {
      log(`[cloudflare] accounts endpoint failed: HTTP ${accountRes.status}`);
      updateStatus('cloudflare', 'workers_requests', { status: 'error', severity: 'warning', message: `Cloudflare accounts API returned HTTP ${accountRes.status}` });
      return;
    }
    const accountData = await accountRes.json();
    const accounts    = accountData.result || [];
    if (!accounts.length) {
      updateStatus('cloudflare', 'workers_requests', { status: 'error', severity: 'info', message: 'No Cloudflare accounts found for this token' });
      return;
    }
    const accountId = accounts[0].id;

    // Workers analytics — requests today
    const today     = new Date().toISOString().slice(0, 10);
    const since     = `${today}T00:00:00Z`;
    const until     = new Date().toISOString();

    // GraphQL Analytics API for Workers
    const gqlBody = {
      query: `{
        viewer {
          accounts(filter: {accountTag: "${accountId}"}) {
            workersInvocationsAdaptive(
              limit: 10
              filter: { datetime_geq: "${since}", datetime_leq: "${until}" }
            ) {
              sum { requests errors }
            }
          }
        }
      }`,
    };

    const gqlRes = await safeFetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gqlBody),
    });

    if (gqlRes.ok) {
      const gqlData = await gqlRes.json();
      const workerData = gqlData.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
      const requests = workerData?.reduce((sum, d) => sum + (d.sum?.requests || 0), 0) ?? null;
      const errors   = workerData?.reduce((sum, d) => sum + (d.sum?.errors   || 0), 0) ?? null;

      // Free tier limit: 100,000 requests/day
      const WORKERS_FREE_DAILY = 100_000;
      log(`[cloudflare] workers requests today: ${requests ?? 'unknown'}`);
      await assess({
        service: 'cloudflare', metricName: 'workers_requests_today',
        metricValue: requests, metricUnit: 'requests',
        limitValue: WORKERS_FREE_DAILY,
        message: `Cloudflare Workers: ${requests ?? 'unknown'} requests today (limit: ${WORKERS_FREE_DAILY}/day, errors: ${errors ?? 0})`,
        rawJson: { requests, errors, account_id: accountId },
      });
    } else {
      log(`[cloudflare] GraphQL analytics failed: HTTP ${gqlRes.status}`);
      updateStatus('cloudflare', 'workers_requests_today', { status: 'error', severity: 'info', message: `Cloudflare analytics returned HTTP ${gqlRes.status}` });
    }
  } catch (e) {
    log(`[cloudflare] error: ${e.message}`);
    updateStatus('cloudflare', 'workers_requests_today', { status: 'error', severity: 'warning', message: `Cloudflare check failed: ${e.message}` });
  }
}

// ─── 6. Supabase ──────────────────────────────────────────────────────────────
async function checkSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    notMonitored['supabase'] = 'missing SUPABASE_URL or SUPABASE_SERVICE_KEY';
    return;
  }

  // Extract project ref from URL: https://<ref>.supabase.co
  const refMatch = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!refMatch) {
    notMonitored['supabase'] = 'could not parse project ref from SUPABASE_URL';
    return;
  }
  const projectRef = refMatch[1];

  try {
    // Supabase Management API — project usage stats
    // Note: Management API requires service_role key or management token.
    // We use the service key as best available option.
    const res = await safeFetch(`https://api.supabase.com/v1/projects/${projectRef}/usage`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      // Parse relevant metrics
      const dbSize    = data.db_size_bytes      || null;
      const bandwidth = data.egress_bytes       || null;
      const mau       = data.monthly_active_users || null;

      if (dbSize != null) {
        // Free tier: 500 MB database
        const DB_FREE_LIMIT = 500 * 1024 * 1024;
        await assess({
          service: 'supabase', metricName: 'db_size_bytes',
          metricValue: dbSize, metricUnit: 'bytes',
          limitValue: DB_FREE_LIMIT,
          message: `Supabase DB size: ${(dbSize / 1024 / 1024).toFixed(1)} MB / 500 MB`,
          rawJson: { db_size_bytes: dbSize },
        });
      }
      if (bandwidth != null) {
        // Free tier: 5 GB egress/month
        const BANDWIDTH_FREE_LIMIT = 5 * 1024 * 1024 * 1024;
        await assess({
          service: 'supabase', metricName: 'bandwidth_bytes',
          metricValue: bandwidth, metricUnit: 'bytes',
          limitValue: BANDWIDTH_FREE_LIMIT,
          message: `Supabase bandwidth: ${(bandwidth / 1024 / 1024).toFixed(1)} MB / 5 GB`,
          rawJson: { egress_bytes: bandwidth },
        });
      }
      if (mau != null) {
        // Free tier: 50,000 MAU
        const MAU_FREE_LIMIT = 50_000;
        await assess({
          service: 'supabase', metricName: 'monthly_active_users',
          metricValue: mau, metricUnit: 'users',
          limitValue: MAU_FREE_LIMIT,
          message: `Supabase MAU: ${mau} / 50,000`,
          rawJson: { monthly_active_users: mau },
        });
      }
    } else {
      // Fallback: just check that Supabase is reachable and count local rows
      log(`[supabase] management API returned ${res.status} — falling back to row count`);
      try {
        const { createClient } = (await import('@supabase/supabase-js'));
        const client = createClient(supabaseUrl, serviceKey);
        const { count, error } = await client.from('messages').select('*', { count: 'exact', head: true });
        if (!error) {
          await assess({
            service: 'supabase', metricName: 'messages_count',
            metricValue: count, metricUnit: 'rows',
            limitValue: null,
            message: `Supabase messages table: ${count} rows (management API unavailable)`,
            rawJson: { count },
          });
        }
      } catch (e2) {
        updateStatus('supabase', 'messages_count', { status: 'error', severity: 'info', message: `Supabase fallback failed: ${e2.message}` });
      }
    }
  } catch (e) {
    log(`[supabase] error: ${e.message}`);
    updateStatus('supabase', 'db_size', { status: 'error', severity: 'warning', message: `Supabase check failed: ${e.message}` });
  }
}

// ─── 7. Resend ─────────────────────────────────────────────────────────────────
async function checkResend() {
  const key = process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_FULL;
  if (!key) {
    notMonitored['resend'] = 'missing RESEND_API_KEY';
    return;
  }

  try {
    const res = await safeFetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${key}` },
    });

    if (res.ok) {
      // Resend free plan: 3,000 emails/month, 100/day
      // We can't directly get send count from the domains endpoint, but we can confirm the key works.
      // The emails endpoint requires message IDs. Check account endpoint instead.
      const domainData = await res.json();

      // Try the API usage endpoint (newer Resend API)
      const usageRes = await safeFetch('https://api.resend.com/emails?limit=1', {
        headers: { 'Authorization': `Bearer ${key}` },
      });

      let emailCount = null;
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        // Resend paginates — total_count in newer API versions
        emailCount = usageData.total ?? null;
      }

      log(`[resend] domains: ${(domainData.data || domainData).length || 0}, emails this month: ${emailCount ?? 'unknown'}`);
      await assess({
        service: 'resend', metricName: 'monthly_sends',
        metricValue: emailCount, metricUnit: 'emails',
        limitValue: 3000,
        message: `Resend: ${emailCount ?? 'unknown'} emails this period (free limit: 3,000/month)`,
        rawJson: { total: emailCount },
      });
    } else {
      log(`[resend] API returned HTTP ${res.status}`);
      updateStatus('resend', 'monthly_sends', { status: 'error', severity: 'warning', message: `Resend API returned HTTP ${res.status}` });
    }
  } catch (e) {
    log(`[resend] error: ${e.message}`);
    updateStatus('resend', 'monthly_sends', { status: 'error', severity: 'warning', message: `Resend check failed: ${e.message}` });
  }
}

// ─── 8. DigitalOcean ──────────────────────────────────────────────────────────
async function checkDigitalOcean() {
  // Check if there's a DO API token — may not be in .env
  const token = process.env.DO_API_TOKEN || process.env.DIGITALOCEAN_TOKEN;
  if (!token) {
    notMonitored['digitalocean'] = 'no DO_API_TOKEN or DIGITALOCEAN_TOKEN in .env — skipped';
    return;
  }

  try {
    const res = await safeFetch('https://api.digitalocean.com/v2/droplets?per_page=20', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const droplets = data.droplets || [];
      log(`[digitalocean] ${droplets.length} droplet(s)`);
      await assess({
        service: 'digitalocean', metricName: 'droplet_count',
        metricValue: droplets.length, metricUnit: 'droplets',
        limitValue: null,
        message: `DigitalOcean: ${droplets.length} droplet(s) running`,
        rawJson: { count: droplets.length },
      });
    } else {
      log(`[digitalocean] API returned HTTP ${res.status}`);
      updateStatus('digitalocean', 'droplet_count', { status: 'error', severity: 'info', message: `DigitalOcean API returned HTTP ${res.status}` });
    }
  } catch (e) {
    log(`[digitalocean] error: ${e.message}`);
    updateStatus('digitalocean', 'droplet_count', { status: 'error', severity: 'info', message: `DigitalOcean check failed: ${e.message}` });
  }
}

// ─── 9. Alpaca ────────────────────────────────────────────────────────────────
async function checkAlpaca() {
  // Use paper keys for account check (safer — never touch live keys for monitoring)
  const key    = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) {
    notMonitored['alpaca'] = 'missing ALPACA_API_KEY or ALPACA_SECRET_KEY';
    return;
  }

  try {
    const res = await safeFetch('https://paper-api.alpaca.markets/v2/account', {
      headers: {
        'APCA-API-KEY-ID':    key,
        'APCA-API-SECRET-KEY': secret,
      },
    });

    if (res.ok) {
      const data = await res.json();
      const equity  = parseFloat(data.equity  || 0);
      const daytradeCount = parseInt(data.daytrade_count || 0);
      const pdt     = data.pattern_day_trader || false;

      log(`[alpaca] equity: $${equity.toFixed(2)}, daytrade_count: ${daytradeCount}, PDT: ${pdt}`);

      await assess({
        service: 'alpaca', metricName: 'account_equity_usd',
        metricValue: equity, metricUnit: 'usd',
        limitValue: null,
        message: `Alpaca paper account equity: $${equity.toFixed(2)}`,
        rawJson: { equity: data.equity, buying_power: data.buying_power },
      });

      // PDT warning: 3 day trades in 5 days triggers PDT restrictions (<$25k account)
      if (daytradeCount >= 2) {
        const pdtPct = daytradeCount / 3;
        await assess({
          service: 'alpaca', metricName: 'daytrade_count',
          metricValue: daytradeCount, metricUnit: 'trades',
          limitValue: 3,
          message: `Alpaca day trade count: ${daytradeCount}/3 (PDT limit). ${pdt ? 'ALREADY FLAGGED AS PDT.' : ''}`,
          rawJson: { daytrade_count: daytradeCount, pattern_day_trader: pdt },
        });
      } else {
        await assess({
          service: 'alpaca', metricName: 'daytrade_count',
          metricValue: daytradeCount, metricUnit: 'trades',
          limitValue: 3,
          message: `Alpaca day trade count: ${daytradeCount}/3 (PDT limit — safe)`,
          rawJson: { daytrade_count: daytradeCount },
        });
      }
    } else {
      log(`[alpaca] API returned HTTP ${res.status}`);
      updateStatus('alpaca', 'account_equity_usd', { status: 'error', severity: 'warning', message: `Alpaca API returned HTTP ${res.status}` });
    }
  } catch (e) {
    log(`[alpaca] error: ${e.message}`);
    updateStatus('alpaca', 'account_equity_usd', { status: 'error', severity: 'warning', message: `Alpaca check failed: ${e.message}` });
  }
}

// ─── 10. Sentry ───────────────────────────────────────────────────────────────
async function checkSentry() {
  const token = process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_DSN;
  if (!token) {
    notMonitored['sentry'] = 'no SENTRY_AUTH_TOKEN in .env — not yet integrated';
    return;
  }
  // Sentry quota check — implement when account is active
  notMonitored['sentry'] = 'credentials found but Sentry org/project slug needed — manual setup required';
}

// ─── 11. OpenAI ───────────────────────────────────────────────────────────────
async function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    notMonitored['openai'] = 'no OPENAI_API_KEY in .env — not in use';
    return;
  }

  try {
    const res = await safeFetch('https://api.openai.com/dashboard/billing/usage', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (res.ok) {
      const data = await res.json();
      const totalUsage = data.total_usage || null; // in cents
      const usd = totalUsage ? totalUsage / 100 : null;
      log(`[openai] usage this period: $${usd?.toFixed(2) ?? 'unknown'}`);
      await assess({
        service: 'openai', metricName: 'monthly_spend_usd',
        metricValue: usd, metricUnit: 'usd',
        limitValue: null,
        message: `OpenAI spend this period: $${usd?.toFixed(2) ?? 'unknown'}`,
        rawJson: { total_usage_cents: totalUsage },
      });
    } else {
      log(`[openai] billing API returned ${res.status}`);
      updateStatus('openai', 'monthly_spend_usd', { status: 'error', severity: 'info', message: `OpenAI billing API returned HTTP ${res.status}` });
    }
  } catch (e) {
    log(`[openai] error: ${e.message}`);
    updateStatus('openai', 'monthly_spend_usd', { status: 'error', severity: 'info', message: `OpenAI check failed: ${e.message}` });
  }
}

// ─── 12. DNSimple ─────────────────────────────────────────────────────────────
async function checkDNSimple() {
  const token     = process.env.DNSIMPLE_API_TOKEN;
  const accountId = process.env.DNSIMPLE_ACCOUNT_ID;
  if (!token || !accountId) {
    notMonitored['dnsimple'] = 'missing DNSIMPLE_API_TOKEN or DNSIMPLE_ACCOUNT_ID';
    return;
  }

  try {
    const res = await safeFetch(`https://api.dnsimple.com/v2/${accountId}/whoami`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      const plan = data.data?.account?.plan_identifier || 'unknown';
      // DNSimple API rate limit: depends on plan (Silver: 2400/hour)
      const rateLimitRemaining = parseInt(res.headers.get('x-ratelimit-remaining') || '0');
      const rateLimitLimit     = parseInt(res.headers.get('x-ratelimit-limit')     || '2400');

      log(`[dnsimple] plan: ${plan}, rate limit: ${rateLimitRemaining}/${rateLimitLimit}`);
      await assess({
        service: 'dnsimple', metricName: 'api_rate_remaining',
        metricValue: rateLimitRemaining, metricUnit: 'requests',
        limitValue: rateLimitLimit, isRemaining: true,
        message: `DNSimple: ${rateLimitRemaining}/${rateLimitLimit} API calls remaining this hour (plan: ${plan})`,
        rawJson: { plan, rate_remaining: rateLimitRemaining, rate_limit: rateLimitLimit },
      });
    } else {
      log(`[dnsimple] API returned HTTP ${res.status}`);
      updateStatus('dnsimple', 'api_rate_remaining', { status: 'error', severity: 'warning', message: `DNSimple API returned HTTP ${res.status}` });
    }
  } catch (e) {
    log(`[dnsimple] error: ${e.message}`);
    updateStatus('dnsimple', 'api_rate_remaining', { status: 'error', severity: 'warning', message: `DNSimple check failed: ${e.message}` });
  }
}

// ─── 13. xAI (Grok) ───────────────────────────────────────────────────────────
// XAI_API_KEY found in .env — check API health
async function checkXAI() {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    notMonitored['xai'] = 'no XAI_API_KEY in .env';
    return;
  }

  try {
    // xAI API key validation — minimal call
    const res = await safeFetch('https://api.x.ai/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    const status   = res.ok ? 'valid' : 'error';
    const severity = res.ok ? 'info'  : 'warning';
    log(`[xai] API key check: HTTP ${res.status}`);
    updateStatus('xai', 'api_key_valid', {
      metricValue: res.status, metricUnit: 'http_status',
      status, severity,
      message: `xAI (Grok) API: HTTP ${res.status}`,
    });
    recordEvent({
      service: 'xai', metricName: 'api_key_valid',
      metricValue: res.status, metricUnit: 'http_status',
      limitValue: null, pctUsed: null,
      status, severity,
      message: `xAI (Grok) API: HTTP ${res.status}`,
    });
  } catch (e) {
    log(`[xai] error: ${e.message}`);
    updateStatus('xai', 'api_key_valid', { status: 'error', severity: 'info', message: `xAI check failed: ${e.message}` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY ROLLUP
// ═══════════════════════════════════════════════════════════════════════════════

async function writeDailyReport() {
  const dateStr  = new Date().toISOString().slice(0, 10);
  const filePath = path.join(DAILY_REPORT_DIR, `usage-daily-${dateStr}.md`);

  try {
    const db     = getDb();
    const events = db.prepare(`
      SELECT service, metric_name, metric_value, metric_unit, limit_value, pct_used, status, severity, message, timestamp
      FROM usage_events
      WHERE timestamp >= datetime('now', '-24 hours')
      ORDER BY service, metric_name, timestamp DESC
    `).all();

    // Group by service:metric_name and take latest
    const latest = {};
    for (const row of events) {
      const k = `${row.service}:${row.metric_name}`;
      if (!latest[k]) latest[k] = row;
    }

    const rows = Object.values(latest).sort((a, b) => {
      const pa = a.pct_used ?? 0;
      const pb = b.pct_used ?? 0;
      return pb - pa; // highest usage first
    });

    const lines = [
      `# 9 Enterprises Usage Report — ${dateStr}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Service Usage Summary',
      '',
      '| Service | Metric | Value | Limit | % Used | Status |',
      '|---------|--------|-------|-------|--------|--------|',
      ...rows.map(r => {
        const pct = r.pct_used != null ? `${(r.pct_used * 100).toFixed(1)}%` : 'N/A';
        const val = r.metric_value != null ? `${r.metric_value} ${r.metric_unit || ''}`.trim() : 'N/A';
        const lim = r.limit_value  != null ? `${r.limit_value} ${r.metric_unit || ''}`.trim()  : 'No limit';
        return `| ${r.service} | ${r.metric_name} | ${val} | ${lim} | ${pct} | ${r.status} |`;
      }),
      '',
      '## Not Monitored',
      '',
      ...Object.entries(notMonitored).map(([svc, reason]) => `- **${svc}**: ${reason}`),
      '',
      '## Raw Events (last 24h)',
      `Total events: ${events.length}`,
    ];

    writeFileSync(filePath, lines.join('\n'));
    log(`[daily-report] Written: ${filePath}`);
  } catch (e) {
    log(`[daily-report] error: ${e.message}`);
  }
}

// Schedule daily report at 3 AM ET
function scheduleDailyReport() {
  function msUntilNextReport() {
    const now = new Date();
    const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    et.setHours(DAILY_REPORT_HOUR, 0, 0, 0);
    if (et <= now) et.setDate(et.getDate() + 1);
    return et - now;
  }
  setTimeout(() => {
    writeDailyReport();
    setInterval(writeDailyReport, 24 * 60 * 60 * 1000);
  }, msUntilNextReport());
  log(`[daily-report] Scheduled — next run in ${Math.round(msUntilNextReport() / 60_000)} min`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLL LOOPS
// ═══════════════════════════════════════════════════════════════════════════════

async function runFastLoop() {
  log('--- fast loop ---');
  await checkAnthropic();
}

async function runSlowLoop() {
  log('--- slow loop ---');
  await Promise.allSettled([
    checkTwilio(),
    checkElevenLabs(),
    checkHeyGen(),
    checkCloudflare(),
    checkSupabase(),
    checkResend(),
    checkDigitalOcean(),
    checkAlpaca(),
    checkSentry(),
    checkOpenAI(),
    checkDNSimple(),
    checkXAI(),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP SERVER — /health for health-monitor ping + /usage-dashboard
// ═══════════════════════════════════════════════════════════════════════════════

const server = createServer((req, res) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health' || req.url === '/usage-monitor/health') {
    const services = Object.keys(currentStatus).length;
    const criticals = Object.values(currentStatus).filter(s => s.severity === 'critical').length;
    res.writeHead(200, cors);
    res.end(JSON.stringify({
      status:      criticals > 0 ? 'degraded' : 'running',
      pid:         process.pid,
      uptime:      Math.round(process.uptime()),
      services_monitored: services,
      services_critical:  criticals,
      not_monitored_count: Object.keys(notMonitored).length,
      checked_at:  new Date().toISOString(),
    }));
    return;
  }

  if (req.url === '/usage-dashboard' || req.url === '/status') {
    try {
      const db     = getDb();
      const recent = db.prepare(`
        SELECT service, metric_name, metric_value, metric_unit, limit_value, pct_used, status, severity, message, timestamp
        FROM usage_events
        ORDER BY timestamp DESC LIMIT 100
      `).all();

      // Top 3 by pct_used
      const byService = Object.values(currentStatus)
        .filter(s => s.pctUsed != null)
        .sort((a, b) => (b.pctUsed || 0) - (a.pctUsed || 0));

      res.writeHead(200, cors);
      res.end(JSON.stringify({
        generated_at:    new Date().toISOString(),
        current_status:  currentStatus,
        not_monitored:   notMonitored,
        top_by_usage:    byService.slice(0, 3),
        recent_events:   recent,
      }, null, 2));
    } catch (e) {
      res.writeHead(500, cors);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`Port ${MONITOR_PORT} in use — exiting (another instance may be running).`);
    process.exit(0);
  }
});

server.listen(MONITOR_PORT, () => {
  log(`Usage monitor API listening on port ${MONITOR_PORT}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

log('=== usage-monitor starting ===');

// Ensure DB schema exists
try { getDb(); log('SQLite usage_events table ready'); } catch (e) { log(`DB init error: ${e.message}`); }

// Initial run — both loops immediately
(async () => {
  log('Running initial fast loop...');
  await runFastLoop();
  log('Running initial slow loop...');
  await runSlowLoop();
  log(`Initial scan complete. Monitored: ${Object.keys(currentStatus).length} metrics. Not monitored: ${Object.keys(notMonitored).length} services.`);
  log(`Not monitored: ${JSON.stringify(notMonitored)}`);
})();

// Set up recurring loops
setInterval(runFastLoop, FAST_INTERVAL_MS);
setInterval(runSlowLoop, SLOW_INTERVAL_MS);

scheduleDailyReport();

log('=== usage-monitor ready ===');
