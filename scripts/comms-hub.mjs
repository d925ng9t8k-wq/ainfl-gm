/**
 * 9 — Unified Communications Hub
 *
 * All channels run in parallel. Shared state persists across crashes.
 * If one channel dies, the others continue with full context.
 * LaunchAgent auto-restarts this process if it goes down.
 *
 * Channels: Telegram, iMessage, Email, Voice (via existing voice-server)
 *
 * NEVER processes images through Claude API.
 */

// ─── Sentry (must be first — before any other import that might throw) ─────────
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN_COMMS_HUB) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_COMMS_HUB,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    release: process.env.GIT_SHA || 'dev',
  });
}

import 'dotenv/config';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from 'fs';
import https from 'https';
import path from 'path';
import { createServer } from 'http';
import net from 'net';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

// ─── Cloud Database (Neon) ──────────────────────────────────────────────────
// Real-time sync of all conversations to cloud. Non-blocking. Never crashes hub.
let neonPool = null;
try {
  const neonUrl = process.env.NEON_DATABASE_URL;
  if (neonUrl) {
    neonPool = new pg.Pool({ connectionString: neonUrl, max: 3, idleTimeoutMillis: 30000 });
    neonPool.on('error', (err) => console.error('[neon] Pool error (non-fatal):', err.message));
    console.log('[neon] Cloud database pool initialized');
  }
} catch (e) {
  console.error('[neon] Init failed (non-fatal):', e.message);
}

async function syncToNeon(channel, direction, text, timestamp) {
  if (!neonPool) return;
  try {
    await neonPool.query(
      'INSERT INTO conversations (channel, direction, message, timestamp) VALUES ($1, $2, $3, $4)',
      [channel, direction, text.slice(0, 4096), timestamp]
    );
  } catch (e) {
    // Never let cloud sync failure crash the hub
    console.error('[neon] Sync failed (non-fatal):', e.message);
  }
}

// ─── Cloud Database (Supabase) ───────────────────────────────────────────────
// Real-time sync of messages, actions, and decisions to Supabase cloud.
// Non-blocking. Never crashes the hub — all errors are caught and logged.
let supabase = null;
try {
  const supabaseUrl = process.env.SUPABASE_URL;
  // FORT C-02: Use anon key only. Service key bypasses RLS — it is NOT needed for
  // the sync operations (upsert messages/actions, count selects) performed here.
  // Service key must NOT be used unless an explicit RLS-bypass operation is required
  // and documented. If you need service key, add it explicitly with a comment explaining why.
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[supabase] Client initialized (anon key — FORT C-02 compliant)');
  } else {
    console.log('[supabase] SUPABASE_URL or key not set — cloud sync disabled');
  }
} catch (e) {
  console.error('[supabase] Init failed (non-fatal):', e.message);
}

// Sync uses SQLite id as the authoritative Supabase id via upsert. This keeps
// SQLite as source of truth, mirrors the exact row structure to Supabase, and
// sidesteps Postgres BIGSERIAL sequence drift after bulk backfills.
async function syncMessageToSupabase(id, channel, direction, text, timestamp, metadata = {}) {
  if (!supabase) return;
  try {
    const row = { channel, direction, text: text.slice(0, 4096), timestamp, read: direction === 'in' ? false : true, metadata };
    if (id) row.id = id;
    const { error } = await supabase.from('messages').upsert(row, { onConflict: 'id' });
    if (error) console.error('[supabase] Message sync failed (non-fatal):', error.message);
    else console.log(`[supabase] Message synced: ${channel}/${direction} id=${id}`);
  } catch (e) {
    console.error('[supabase] Message sync error (non-fatal):', e.message);
  }
}

async function syncActionToSupabase(id, action_type, description, status, timestamp, metadata = {}) {
  if (!supabase) return;
  try {
    const row = { action_type, description: description.slice(0, 2000), status, timestamp, metadata };
    if (id) row.id = id;
    const { error } = await supabase.from('actions').upsert(row, { onConflict: 'id' });
    if (error) console.error('[supabase] Action sync failed (non-fatal):', error.message);
  } catch (e) {
    console.error('[supabase] Action sync error (non-fatal):', e.message);
  }
}

// ─── Outbound Message WAL (Write-Ahead Log) ─────────────────────────────────
// Prevents duplicate sends on crash recovery. Every outbound message gets a
// unique ID written to the WAL BEFORE send. On restart, the hub checks the WAL
// for messages that were logged but not confirmed delivered.
// Format: one JSON line per entry { id, channel, text, status, timestamp }
// Status: 'pending' → 'sent' → 'confirmed'
const WAL_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'logs');
const OUTBOUND_WAL_PATH = path.join(WAL_DIR, 'outbound-wal.jsonl');
mkdirSync(WAL_DIR, { recursive: true });

let walIdCounter = Date.now();
function nextWalId() { return `wal-${++walIdCounter}`; }

function walAppend(entry) {
  try {
    appendFileSync(OUTBOUND_WAL_PATH, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error(`[wal] Append failed: ${e.message}`);
  }
}

function walMarkSent(walId) {
  // Append a status update line rather than rewriting the file (append-only for safety)
  walAppend({ walId, status: 'sent', at: new Date().toISOString() });
}

// On startup: read WAL and warn about any pending messages that were never confirmed sent.
// This gives operators visibility into potential lost messages after a crash.
try {
  if (existsSync(OUTBOUND_WAL_PATH)) {
    const walLines = readFileSync(OUTBOUND_WAL_PATH, 'utf-8').trim().split('\n').filter(l => l);
    const pending = new Map(); // walId -> entry
    const sent = new Set();
    for (const line of walLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.status === 'pending') pending.set(entry.id, entry);
        if (entry.status === 'sent' && entry.walId) sent.add(entry.walId);
      } catch {}
    }
    // Remove confirmed entries
    for (const id of sent) pending.delete(id);
    if (pending.size > 0) {
      console.log(`[wal] WARNING: ${pending.size} outbound message(s) were pending at last shutdown — may not have been delivered:`);
      for (const [id, entry] of pending) {
        console.log(`  [wal] ${id}: ${entry.channel} — "${(entry.text || '').slice(0, 80)}..."`);
      }
    } else {
      console.log('[wal] Clean startup — no pending outbound messages from prior session');
    }
    // Rotate WAL if > 10000 lines (keep last 1000)
    if (walLines.length > 10000) {
      writeFileSync(OUTBOUND_WAL_PATH, walLines.slice(-1000).join('\n') + '\n');
      console.log(`[wal] Rotated WAL: ${walLines.length} → 1000 lines`);
    }
  }
} catch (e) {
  console.error(`[wal] Startup WAL read failed (non-fatal): ${e.message}`);
}

// ─── Persistent Memory DB ────────────────────────────────────────────────────
// Imported as singleton. All db calls are wrapped in try/catch so database
// errors never crash the hub — logging is purely additive.
let db = null;
try {
  const memoryDb = await import('./memory-db.mjs');
  db = memoryDb.db;
} catch (e) {
  console.error('[comms-hub] memory-db import failed — continuing without DB logging:', e.message);
}

// ─── Supabase post-write hooks ────────────────────────────────────────────────
// Wrap db methods to fire Supabase sync after every SQLite write.
// This is the single intercept point — all 6 call sites are covered automatically.
// Supabase sync is always fire-and-forget (.catch(() => {})) — never blocks the hub.
if (db) {
  const _origLogMessage = db.logMessage.bind(db);
  db.logMessage = function(channel, direction, text, metadata = {}) {
    const id = _origLogMessage(channel, direction, text, metadata);
    const timestamp = new Date().toISOString();
    syncMessageToSupabase(id, channel, direction, text, timestamp, metadata).catch(() => {});
    return id;
  };

  const _origLogAction = db.logAction.bind(db);
  db.logAction = function(action_type, description, status = 'completed', metadata = {}) {
    const id = _origLogAction(action_type, description, status, metadata);
    const timestamp = new Date().toISOString();
    syncActionToSupabase(id, action_type, description, status, timestamp, metadata).catch(() => {});
    return id;
  };

  console.log('[supabase] Post-write hooks attached to db.logMessage and db.logAction');
}

// ─── Port Guard (check FIRST, before loading anything) ──────────────────────
// Prevents LaunchAgent restart spam from burning Cloudflare quota
try {
  const check = new net.Socket();
  check.setTimeout(1000);
  check.on('connect', () => { check.destroy(); process.exit(0); }); // Port is taken = another hub running
  check.on('error', () => { check.destroy(); }); // Port free = we can proceed
  check.on('timeout', () => { check.destroy(); }); // No response = port free
  check.connect(3457, '127.0.0.1');
  await new Promise(r => setTimeout(r, 1500)); // Wait for check to complete
} catch {}

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
}

// ─── VPS_MODE — skip macOS-only features (iMessage, osascript, FDA) on Linux ─
// Auto-detects from platform if VPS_MODE env var is not explicitly set.
const VPS_MODE = process.env.VPS_MODE === '1' || (process.env.VPS_MODE !== '0' && process.platform !== 'darwin');
if (VPS_MODE) console.log('[vps-mode] Running on Linux VPS — iMessage, osascript, FDA watchdog, freeze keystrokes DISABLED');

// ─── Constants ───────────────────────────────────────────────────────────────
const TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID || '8784022142';
const BASE          = `https://api.telegram.org/bot${TOKEN}`;
const PROJECT       = VPS_MODE ? (process.env.PROJECT_DIR || '/home/deploy/BengalOracle') : '/Users/jassonfishback/Projects/BengalOracle';
const STATE_FILE    = `${PROJECT}/scripts/shared-state.json`;
const OFFSET_FILE   = '/tmp/tc-agent-offset.txt';
const LOG_FILE      = `${PROJECT}/logs/comms-hub.log`;
const IMSG_DB       = VPS_MODE ? '/dev/null' : `${process.env.HOME}/Library/Messages/chat.db`;

const JASSON_PHONE  = process.env.JASSON_PHONE || '+15134031829';
const JAMIE_PHONE   = process.env.JAMIE_PHONE || ''; // Jamie Bryant — Jules routing. Set JAMIE_PHONE in .env.
const KYLEC_PHONE   = process.env.JULES_KYLEC_RECIPIENT_PHONE || '+15132255681'; // Kyle Cabezas — pilot routing
const PILOT_SERVER_URL = 'http://localhost:3472'; // pilot-server.mjs
const knownExternalTelegramUsers = new Set(); // Track external users for first-contact notifications
const JASSON_EMAIL  = 'emailfishback@gmail.com';
const CAPTAIN_EMAIL = 'captain@ainflgm.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

// ─── Gmail SMTP Transporter (replaces broken osascript/Apple Mail) ──────────
let gmailTransporter = null;
if (GMAIL_APP_PASSWORD) {
  gmailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: JASSON_EMAIL,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

mkdirSync(`${PROJECT}/logs`, { recursive: true });

const OC_VIOLATIONS_LOG = `${PROJECT}/logs/oc-violations.log`;

// ─── OC Impersonation Filter ─────────────────────────────────────────────────
// Applied to every OC-generated message before it reaches Telegram.
// Catches phrases where OC accidentally claims to be 9 and rewrites them.
const OC_IMPERSONATION_RE = /\b(it'?s 9|i'?m 9|this is 9|9 here|from 9|hey jasson[,.]?\s+it'?s 9|hi jasson[,.]?\s+it'?s 9)\b/gi;

function ocImpersonationFilter(text, source) {
  if (!OC_IMPERSONATION_RE.test(text)) return text;
  // Reset lastIndex after test()
  OC_IMPERSONATION_RE.lastIndex = 0;
  const original = text;
  const filtered = text.replace(OC_IMPERSONATION_RE, 'OC covering for 9');
  // Ensure message starts with OC:
  const prefixed = filtered.startsWith('OC:') ? filtered : `OC: ${filtered}`;
  const violation = `[${new Date().toISOString()}] IMPERSONATION BLOCKED (source=${source || 'unknown'})\nORIGINAL: ${original.slice(0, 300)}\nREWRITTEN: ${prefixed.slice(0, 300)}\n---\n`;
  try { appendFileSync(OC_VIOLATIONS_LOG, violation); } catch {}
  log(`OC IMPERSONATION BLOCKED — rewritten. Original: "${original.slice(0, 100)}"`);
  return prefixed;
}

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { process.stdout.write(line); } catch {} // May EPIPE if detached — that's fine
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── Shared State ────────────────────────────────────────────────────────────
// Every channel reads/writes this. Survives crashes.
function loadState() {
  try {
    const loaded = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    // ALWAYS clear conversation history on startup — prevents stale replay (March 25 2026 fix)
    loaded.conversationHistory = [];
    return loaded;
  } catch {
    return {
      channels: {
        telegram: { status: 'unknown', lastActivity: null, messagesHandled: 0, errors: [] },
        imessage: { status: 'unknown', lastActivity: null, messagesHandled: 0, errors: [] },
        email:    { status: 'unknown', lastActivity: null, messagesHandled: 0, errors: [] },
        voice:    { status: 'unknown', lastActivity: null, callsHandled: 0, errors: [] },
      },
      recentMessages: [],       // Last 50 messages across ALL channels [{channel, direction, text, timestamp}]
      conversationHistory: [],  // Last 20 exchanges for Claude context
      sessionContext: '',       // What we're currently working on (set by terminal)
      heartbeatCount: 0,
      startTime: new Date().toISOString(),
      lastHeartbeat: null,
    };
  }
}

function saveState(state) {
  try {
    // Don't persist conversationHistory to disk — it lives in memory only.
    // Prevents stale history from being replayed on restart. (March 25 2026 fix)
    const toSave = { ...state, conversationHistory: [] };
    writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    log(`STATE SAVE ERROR: ${e.message}`);
  }
}

function addMessage(state, channel, direction, text) {
  const TELEGRAM_MAX = 4096;
  // Detect if Telegram itself truncated this message (exactly 4096 chars = likely cut off)
  if (direction === 'in' && channel === 'telegram' && text.length === TELEGRAM_MAX) {
    log(`TRUNCATION WARNING: Telegram message is exactly ${TELEGRAM_MAX} chars — may be cut off by Telegram. Last chars: "${text.slice(-30)}"`);
  }
  // Detect if message ends mid-word or mid-sentence (heuristic for cut-off content)
  if (direction === 'in' && text.length >= TELEGRAM_MAX - 10 && text.length > 0) {
    const lastChar = text[text.length - 1];
    if (lastChar !== '.' && lastChar !== '!' && lastChar !== '?' && lastChar !== '\n') {
      log(`TRUNCATION WARNING: Inbound message from ${channel} ends without sentence terminator — may be cut off. Length: ${text.length}`);
    }
  }
  const msg = {
    channel, direction, text: text.slice(0, TELEGRAM_MAX),
    timestamp: new Date().toISOString(),
  };
  if (direction === 'in') msg.read = false;  // Explicit false — inbox filter depends on this
  state.recentMessages.push(msg);
  // Keep last 50
  if (state.recentMessages.length > 50) state.recentMessages = state.recentMessages.slice(-50);
  // Sync to Neon cloud DB (non-blocking, fire-and-forget)
  syncToNeon(channel, direction, text, msg.timestamp).catch(() => {});
}

function updateChannelStatus(state, channel, status) {
  state.channels[channel].status = status;
  state.channels[channel].lastActivity = new Date().toISOString();
}

// ─── Resource Usage Tracking ──────────────────────────────────────────────────
// Tracks API calls per hour across all services. Alerts on unusual burn rates.
const resourceUsage = {
  anthropic: { calls: 0, hourStart: Date.now() },
  telegram: { calls: 0, hourStart: Date.now() },
  cloudSync: { calls: 0, hourStart: Date.now() },
  twilio: { calls: 0, hourStart: Date.now() },
  email: { calls: 0, hourStart: Date.now() },
};

const BURN_RATE_THRESHOLDS = {
  anthropic: 60,    // >60 Claude calls/hour = alert
  telegram: 200,    // >200 Telegram API calls/hour = alert
  cloudSync: 120,   // >120 cloud syncs/hour = alert (2/min normal = 120)
  twilio: 20,       // >20 Twilio calls/hour = alert
  email: 30,        // >30 email operations/hour = alert
};

function trackUsage(service) {
  const u = resourceUsage[service];
  if (!u) return;
  const elapsed = Date.now() - u.hourStart;
  if (elapsed > 3600000) {
    // New hour window
    u.calls = 1;
    u.hourStart = Date.now();
    return;
  }
  u.calls++;
  // Project to full hour
  const projectedPerHour = Math.round(u.calls / (elapsed / 3600000));
  if (projectedPerHour > BURN_RATE_THRESHOLDS[service] && u.calls > 10) {
    // FIX #7: Rate-limit burn rate LOGGING to once per 5 minutes per service (was every single call — caused 1957 log lines in 3 min)
    const now = Date.now();
    if (!u.lastLogTime || now - u.lastLogTime > 300000) {
      log(`BURN RATE ALERT: ${service} at ${projectedPerHour}/hr (threshold: ${BURN_RATE_THRESHOLDS[service]}/hr, actual: ${u.calls} in ${Math.round(elapsed/60000)}min)`);
      u.lastLogTime = now;
    }
    // Burn rate alerts are LOG ONLY — never send to Telegram (caused alert flood on stress tests and hub restarts)
    // The log entry above (rate-limited to 5 min) is sufficient for monitoring
  }
}

function addChannelError(state, channel, error) {
  state.channels[channel].errors.push({ error, timestamp: new Date().toISOString() });
  if (state.channels[channel].errors.length > 10) state.channels[channel].errors = state.channels[channel].errors.slice(-10);
}

let state = loadState();
log('Shared state loaded');

// ─── Startup Grace Period ────────────────────────────────────────────────────
// After hub restart, suppress OC autonomous messages for 15 seconds.
// This prevents OC spam during the restart-to-terminal-claim gap.
const HUB_START_TIME = Date.now();
const STARTUP_GRACE_MS = 15000;
function inStartupGrace() { return Date.now() - HUB_START_TIME < STARTUP_GRACE_MS; }

// ─── Terminal Active Mode ────────────────────────────────────────────────────
// When terminal is active, hub collects messages but does NOT auto-respond.
// Terminal handles all responses. Hub only responds autonomously when terminal is down.
let terminalActive = false;
let terminalLastPing = 0;
let terminalPid = null; // PID of Claude Code process — used for liveness checks
// Session token — persisted to file so hub restarts don't invalidate existing ping loops
const TOKEN_FILE = '/tmp/9-session-token';
const PID_FILE = '/tmp/9-terminal-pid';
let terminalSessionToken = null;
try { terminalSessionToken = readFileSync(TOKEN_FILE, 'utf-8').trim() || null; } catch {}
// Also restore PID if available
try { terminalPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim()) || null; } catch {}
if (terminalSessionToken) {
  // Hub restarted — check if the terminal process is ACTUALLY still alive before restoring relay mode
  let pidAlive = false;
  if (terminalPid) {
    try { process.kill(terminalPid, 0); pidAlive = true; } catch { pidAlive = false; }
  }
  if (pidAlive) {
    terminalActive = true;
    terminalLastPing = Date.now();
    log(`Restored persisted session token: ${terminalSessionToken} (PID ${terminalPid} alive) — relay mode preserved`);
  } else {
    log(`Persisted session token found but PID ${terminalPid} is DEAD — staying in autonomous mode`);
    clearTerminalState();
  }
}
const TERMINAL_TIMEOUT = 45000; // 45 seconds without ping = terminal is gone (was 120s; with 15s pings, 2 missed = 30s + 15s watchdog cycle)

function clearTerminalState() {
  // Apr 10 hunt — kill: orphan claimant. If the terminal we're clearing is a
  // Claude CLI process that is still alive (we thought it was dead because of
  // ping timeout, but the OS process itself is fine), it will sit around as
  // a zombie eating the tty, and the next "cleanup-terminals.sh" run will have
  // to kill it manually. Instead, kill it here so the state is always clean.
  // Guard: never SIGKILL the hub itself. Guard: PID 0/1/-1 are system PIDs, skip.
  const doomedPid = terminalPid; // capture before the reset below
  if (doomedPid && doomedPid > 1 && doomedPid !== process.pid) {
    try {
      process.kill(doomedPid, 0); // alive check
      // Alive — this is the orphan case. Send SIGTERM first, SIGKILL as fallback.
      try { process.kill(doomedPid, 'SIGTERM'); log(`clearTerminalState: SIGTERM sent to lingering PID ${doomedPid}`); } catch {}
      const killTimer = setTimeout(() => {
        try { process.kill(doomedPid, 0); process.kill(doomedPid, 'SIGKILL'); log(`clearTerminalState: SIGKILL fallback on PID ${doomedPid}`); } catch {}
      }, 2000);
      if (killTimer.unref) killTimer.unref();
    } catch {
      // Already dead — nothing to do.
    }
  }
  terminalActive = false;
  terminalPid = null;
  terminalSessionToken = null;
  try { unlinkSync(TOKEN_FILE); } catch {}
  try { unlinkSync(PID_FILE); } catch {}
}

function isTerminalActive() {
  if (!terminalActive) return false;
  if (Date.now() - terminalLastPing > TERMINAL_TIMEOUT) {
    log('Terminal ping timeout — switching to autonomous mode');
    clearTerminalState();
    recordTerminalCrash(); // Track for crash loop detection

    // Suppress alert during startup grace period
    if (!inStartupGrace()) {
      sendTelegram('OC: Covering for 9. Terminal appears frozen or unresponsive. Try clicking in the terminal window or pressing Enter — that usually unfreezes it. If that does not work, close the window and type claude in a new one. I am handling Telegram in the meantime.').catch(() => {});
    } else {
      log('Suppressed ping-timeout alert during startup grace period');
    }
    // Only email/iMessage if terminal doesn't come back (handled in recovery failed)

    // Immediately request terminal reopen (crash loop detector may block via cooldown)
    requestTerminal('Terminal ping timed out — reopening');

    // Verify terminal came back — if not, retry
    terminalRecoveryAttempts = 1;
    scheduleTerminalRecoveryCheck();
    return false;
  }
  return true;
}

// ─── Terminal Recovery Verification ──────────────────────────────────────────
// After requesting terminal reopen, verify it actually came back.
// If not, retry up to 3 times. Each attempt gets reported to Jasson.
let terminalRecoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 3;

function scheduleTerminalRecoveryCheck() {
  setTimeout(() => {
    if (terminalActive) {
      // Terminal came back — success
      log(`Terminal recovery succeeded on attempt ${terminalRecoveryAttempts}`);
      terminalRecoveryAttempts = 0;
      return;
    }

    if (terminalRecoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      log(`Terminal recovery failed after ${MAX_RECOVERY_ATTEMPTS} attempts`);
      sendTelegram(`OC: Terminal failed to reopen after ${MAX_RECOVERY_ATTEMPTS} attempts. I'm fully autonomous on all channels — you can reach me anytime. To manually open: launch Terminal, type "cd ~/Projects/BengalOracle && claude"`).catch(() => {});
      sendIMessage(`Terminal won't reopen. Still autonomous on all channels. Open Terminal manually and type: cd ~/Projects/BengalOracle && claude`);
      sendEmail('9 — Terminal Recovery Failed', `I tried ${MAX_RECOVERY_ATTEMPTS} times to reopen Terminal but it won't come back. I'm still handling everything autonomously.\n\nTo fix manually: Open Terminal, type:\ncd ~/Projects/BengalOracle && claude`);
      terminalRecoveryAttempts = 0;
      lastTerminalRequest = 0; // Reset rate limit so future requests work
      return;
    }

    terminalRecoveryAttempts++;
    log(`Terminal recovery attempt ${terminalRecoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} — requesting reopen`);
    lastTerminalRequest = 0; // Reset rate limit for retry
    requestTerminal(`Recovery attempt ${terminalRecoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}`);
    // Only log retries — Telegram alert reserved for final failure (FIX A: no spam on each retry)
    scheduleTerminalRecoveryCheck();
  }, 60000); // Check every 60 seconds
}

// ─── Crash Loop Detector & Self-Healer ──────────────────────────────────────
// Tracks terminal crash timestamps. If 3+ crashes in 10 minutes, the terminal
// is in a crash loop (e.g., MCP auth failure, orphan PID fight). Self-heals by:
//   1. Killing ALL orphan Claude sessions
//   2. Clearing MCP auth cache (the #1 cause of session-start crash loops)
//   3. Waiting 30s before allowing next terminal open (break the rapid cycle)
//   4. Sending diagnostic report to Telegram
const crashTimestamps = [];
const CRASH_LOOP_WINDOW_MS = 600000;  // 10 minutes
const CRASH_LOOP_THRESHOLD = 3;       // 3 crashes in window = crash loop
let crashLoopCooldownUntil = 0;       // Timestamp when cooldown expires
const MCP_AUTH_CACHE = `${process.env.HOME}/.claude/mcp-needs-auth-cache.json`;

function recordTerminalCrash() {
  const now = Date.now();
  crashTimestamps.push(now);
  // Prune old entries outside the window
  while (crashTimestamps.length > 0 && crashTimestamps[0] < now - CRASH_LOOP_WINDOW_MS) {
    crashTimestamps.shift();
  }

  if (crashTimestamps.length >= CRASH_LOOP_THRESHOLD) {
    log(`CRASH LOOP DETECTED: ${crashTimestamps.length} crashes in ${Math.round(CRASH_LOOP_WINDOW_MS / 60000)} minutes — initiating self-heal`);
    selfHealCrashLoop();
  }
}

function selfHealCrashLoop() {
  const diagnostics = [];

  // 1. Kill ALL orphan Claude CLI sessions (not Claude Desktop, not hub)
  try {
    const orphans = execSync("ps aux | grep -E '^[^ ]+ +[0-9]+ .* claude' | grep -v grep | grep -v 'Claude.app' | grep -v 'Claude Helper' | grep -v comms-hub | awk '{print $2}'", { encoding: 'utf-8', timeout: 5000 }).trim();
    if (orphans) {
      const pids = orphans.split('\n').filter(Boolean);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid} 2>/dev/null`);
          diagnostics.push(`Killed orphan Claude PID ${pid}`);
        } catch {}
      }
      log(`Crash loop self-heal: killed ${pids.length} orphan Claude processes`);
    } else {
      diagnostics.push('No orphan Claude processes found');
    }
  } catch (e) {
    diagnostics.push(`Orphan scan error: ${e.message}`);
  }

  // 2. Clear MCP auth cache (Stripe MCP auth popup = crash loop trigger)
  try {
    if (existsSync(MCP_AUTH_CACHE)) {
      const cacheContent = readFileSync(MCP_AUTH_CACHE, 'utf-8');
      unlinkSync(MCP_AUTH_CACHE);
      diagnostics.push(`Cleared MCP auth cache (${cacheContent.length} bytes)`);
      log('Crash loop self-heal: cleared MCP auth cache');
    } else {
      diagnostics.push('MCP auth cache already clean');
    }
  } catch (e) {
    diagnostics.push(`MCP cache clear error: ${e.message}`);
  }

  // 3. Clear terminal state and set cooldown (30s before allowing next open)
  clearTerminalState();
  crashLoopCooldownUntil = Date.now() + 30000;
  diagnostics.push('Terminal state cleared, 30s cooldown before next attempt');
  log('Crash loop self-heal: 30s cooldown before next terminal open');

  // Clear crash timestamps so we don't immediately re-trigger
  crashTimestamps.length = 0;

  // 4. Send diagnostic report to Telegram
  const report = [
    'CRASH LOOP SELF-HEAL COMPLETED:',
    ...diagnostics.map(d => `• ${d}`),
    '',
    'Terminal will retry in 30 seconds.',
    'If loop continues, check: MCP server configs, .env keys, disk space.',
  ].join('\n');

  sendTelegram(report).catch(() => {});
  log(`Crash loop diagnostic: ${diagnostics.join(' | ')}`);

  // Schedule terminal reopen after cooldown
  setTimeout(() => {
    crashLoopCooldownUntil = 0;
    lastTerminalRequest = 0; // Reset rate limiter
    requestTerminal('Post crash-loop self-heal retry');
  }, 30000);
}

// ─── Proactive Terminal Watchdog ─────────────────────────────────────────────
// Checks every 30 seconds whether terminal has gone silent. TWO detection methods:
// 1. Ping timeout (2 min without ping)
// 2. PID liveness (Claude Code process died — catches orphan ping loops)
setInterval(() => {
  if (!terminalActive) return;

  // Method 1: PID liveness — the definitive check
  if (terminalPid) {
    try {
      process.kill(terminalPid, 0); // signal 0 = just check if alive
    } catch {
      // PID is dead — terminal is gone, regardless of what pings say
      log(`Terminal watchdog: PID ${terminalPid} is DEAD — orphan ping loop detected, forcing autonomous mode`);
      clearTerminalState();
      recordTerminalCrash(); // Track for crash loop detection

      // Suppress alert during startup grace period (hub just restarted, terminal will re-claim)
      if (!inStartupGrace()) {
        sendTelegram('OC: Covering for 9. Terminal process died. Autonomous mode active — reopening now. If you see a frozen terminal window, click in it or press Enter to unfreeze.').catch(() => {});
      } else {
        log('Suppressed PID-dead alert during startup grace period');
      }

      requestTerminal('Terminal PID dead — reopening');
      terminalRecoveryAttempts = 1;
      scheduleTerminalRecoveryCheck();
      return;
    }
  }

  // Method 2: Ping timeout (original check — fallback if no PID)
  if (Date.now() - terminalLastPing > TERMINAL_TIMEOUT) {
    log('Terminal watchdog: ping timeout detected proactively — switching to autonomous mode');
    isTerminalActive(); // Triggers the full switchover (alerts, auto-opener, etc.)
  }
}, 30000);

// ─── Freeze Detector ─────────────────────────────────────────────────────────
// Session-aware rebuild (March 26, 2026).
// Only monitors within an active session. Resets cleanly on session boundaries.
// Escalating tiers (March 27, 2026):
//   Tier 1 (3 min): Alert + keystroke nudge
//   Tier 2 (6 min): SIGTERM frozen Claude PID + Telegram alert
//   Tier 3 (7 min): SIGKILL if still alive + write /tmp/9-open-terminal signal
let freezeAlertSent = false;
let freezeAlertForTimestamp = 0;
let freezeSessionToken = null; // Track which session we're monitoring
let freezeTier = 0;            // Escalation tier (0=none, 1=nudge sent, 2=SIGTERM sent, 3=SIGKILL sent)
const FREEZE_THRESHOLD_MS = 180000; // Tier 1: 3 minutes
const FREEZE_TIER2_MS     = 360000; // Tier 2: 6 minutes
const FREEZE_TIER3_MS     = 420000; // Tier 3: 7 minutes
const LAST_TOOL_CALL_FILE = '/tmp/9-last-tool-call';

setInterval(() => {
  // ── Guard 1: No terminal = nothing to monitor. Reset state cleanly.
  if (!terminalActive) {
    freezeAlertSent = false;
    freezeAlertForTimestamp = 0;
    freezeSessionToken = null;
    freezeTier = 0;
    return;
  }

  // ── Guard 2: Session boundary detection.
  // If session token changed, this is a new session. Reset everything.
  if (terminalSessionToken !== freezeSessionToken) {
    freezeAlertSent = false;
    freezeAlertForTimestamp = 0;
    freezeSessionToken = terminalSessionToken;
    freezeTier = 0;
    log('Freeze detector: new session detected — reset state');
    return; // Give the new session a full threshold window before monitoring
  }

  try {
    const raw = readFileSync(LAST_TOOL_CALL_FILE, 'utf-8').trim();
    const lastCallTs = parseInt(raw) * 1000;
    if (!lastCallTs || isNaN(lastCallTs)) return;

    // ── Guard 3: Ignore tool calls from before this session started.
    // terminalLastPing is set on /terminal/claim — use it as session start proxy.
    // If the tool call timestamp predates the current session, skip it entirely.
    const sessionStartApprox = terminalLastPing - 120000; // 2 min grace
    if (lastCallTs < sessionStartApprox && !freezeAlertSent) {
      // Stale timestamp from a previous session — not a freeze
      return;
    }

    // Tool call advanced since last alert — 9 is alive, clear all escalation state
    if (freezeAlertSent && lastCallTs > freezeAlertForTimestamp) {
      freezeAlertSent = false;
      freezeAlertForTimestamp = 0;
      freezeTier = 0;
      log('Freeze detector: tool call detected — 9 is active, alert cleared');
      return;
    }

    const age = Date.now() - lastCallTs;

    // ── Tier 1 (3 min): Alert + keystroke nudge
    if (age > FREEZE_THRESHOLD_MS && !freezeAlertSent) {
      const ageMin = Math.round(age / 60000);
      log(`FREEZE DETECTOR Tier 1: No tool call in ${ageMin}+ minutes — terminal may be frozen`);

      sendTelegram(`9: WARNING — Terminal may be frozen. No tool call in ${ageMin}+ minutes. Attempting to unblock.`).catch(() => {});

      if (!VPS_MODE) {
        try {
          execSync(`osascript -e 'tell application "System Events" to keystroke return'`, { timeout: 5000 });
          log('Freeze detector: sent keystroke return via osascript');
        } catch (e) {
          log(`Freeze detector: osascript keystroke failed — ${e.message}`);
        }
      }

      freezeAlertSent = true;
      freezeAlertForTimestamp = lastCallTs;
      freezeTier = 1;
    }

    // ── Tier 2 (6 min): SIGTERM the frozen Claude PID
    if (age > FREEZE_TIER2_MS && freezeTier === 1) {
      const ageMin = Math.round(age / 60000);
      log(`FREEZE DETECTOR Tier 2: No tool call in ${ageMin}+ minutes — sending SIGTERM to PID ${terminalPid}`);

      sendTelegram('OC: Terminal frozen 6+ min — killing and restarting automatically.').catch(() => {});

      if (terminalPid) {
        try {
          process.kill(terminalPid, 'SIGTERM');
          log(`Freeze detector Tier 2: SIGTERM sent to PID ${terminalPid}`);
        } catch (e) {
          log(`Freeze detector Tier 2: SIGTERM failed — ${e.message}`);
        }
      } else {
        log('Freeze detector Tier 2: no terminalPid stored — cannot SIGTERM');
      }

      freezeTier = 2;
    }

    // ── Tier 3 (7 min): SIGKILL if still alive + write open-terminal signal
    if (age > FREEZE_TIER3_MS && freezeTier === 2) {
      const ageMin = Math.round(age / 60000);
      log(`FREEZE DETECTOR Tier 3: No tool call in ${ageMin}+ minutes — sending SIGKILL to PID ${terminalPid}`);

      if (terminalPid) {
        let pidStillAlive = false;
        try { process.kill(terminalPid, 0); pidStillAlive = true; } catch {}

        if (pidStillAlive) {
          try {
            process.kill(terminalPid, 'SIGKILL');
            log(`Freeze detector Tier 3: SIGKILL sent to PID ${terminalPid}`);
          } catch (e) {
            log(`Freeze detector Tier 3: SIGKILL failed — ${e.message}`);
          }
        } else {
          log(`Freeze detector Tier 3: PID ${terminalPid} already dead after SIGTERM — proceeding to reopen`);
        }
      } else {
        log('Freeze detector Tier 3: no terminalPid stored — cannot SIGKILL');
      }

      // Clear terminal state — the ping loop will self-terminate once PID is dead
      clearTerminalState();
      recordTerminalCrash(); // Track for crash loop detection

      // Write open-terminal signal — force=true bypasses the "Claude PIDs alive" skip
      requestTerminal('Freeze detector Tier 3 — SIGKILL recovery', true);

      freezeTier = 3;
      freezeAlertSent = false; // Allow fresh detection in new session
      freezeAlertForTimestamp = 0;
    }
  } catch {}
}, 30000);

// ─── Terminal Auto-Opener ────────────────────────────────────────────────────
const TERMINAL_SIGNAL = '/tmp/9-open-terminal';
let lastTerminalRequest = 0;

function requestTerminal(reason, force = false) {
  if (VPS_MODE) { log(`[vps-mode] requestTerminal skipped (no Terminal/LaunchAgent on Linux). Reason: ${reason}`); return; }
  // Crash loop cooldown — self-healer sets this to break rapid crash cycles
  if (crashLoopCooldownUntil > Date.now()) {
    log(`Terminal open BLOCKED by crash loop cooldown (${Math.round((crashLoopCooldownUntil - Date.now()) / 1000)}s remaining). Reason: ${reason}`);
    return;
  }
  // Don't spam — max once per 45 seconds (tight enough for retries, safe from spam)
  if (Date.now() - lastTerminalRequest < 45000) return;
  lastTerminalRequest = Date.now();

  // FIX #2 (revised March 25): Don't open new terminals if Claude is running AND responsive.
  // Old logic checked PIDs only — zombie/frozen Claude processes blocked reopening.
  // New logic: if Claude PIDs exist BUT terminal hasn't pinged in 2+ minutes, those are zombies. Kill and reopen.
  // force=true (used after SIGKILL) bypasses the "Claude PIDs alive" skip entirely.
  if (!force) {
    try {
      const running = execSync('pgrep -a claude 2>/dev/null || true', { encoding: 'utf-8', timeout: 3000 }).trim();
      if (running) {
        const timeSinceLastPing = Date.now() - terminalLastPing;
        if (timeSinceLastPing < TERMINAL_TIMEOUT) {
          log(`Terminal open SKIPPED — Claude process running AND responsive (last ping ${Math.round(timeSinceLastPing/1000)}s ago). Reason was: ${reason}`);
          return;
        }
        // Claude PIDs exist but no recent ping — zombie processes. Log and proceed with reopen.
        log(`Terminal open PROCEEDING — Claude PIDs exist (${running.replace(/\n/g, ', ')}) but NO PING in ${Math.round(timeSinceLastPing/1000)}s. Likely frozen/zombie. Reason: ${reason}`);
      }
    } catch {}
  } else {
    log(`Terminal open FORCED — bypassing Claude PID check (post-SIGKILL recovery). Reason: ${reason}`);
  }

  try {
    writeFileSync(TERMINAL_SIGNAL, reason);
    log(`Terminal open requested: ${reason}`);
    // FIX #5: Don't send separate Telegram for every open request — too noisy
  } catch (e) {
    log(`Failed to request terminal: ${e.message}`);
  }
}

// ─── Load memory files for Claude context ────────────────────────────────────
function loadMemoryContext() {
  const memDir = '/Users/jassonfishback/.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory';
  let context = '';
  try {
    const files = readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    for (const file of files) {
      try {
        const content = readFileSync(path.join(memDir, file), 'utf-8');
        const body = content.replace(/^---[\s\S]*?---\s*/, '').trim();
        if (body) context += `\n\n### ${file.replace('.md', '').replace(/_/g, ' ').toUpperCase()}\n${body}`;
      } catch {}
    }
  } catch {}
  return context;
}

const memoryContext = loadMemoryContext();
log(`Memory context loaded: ${memoryContext.length} chars`);

// ─── OC Relay Deferral ───────────────────────────────────────────────────────
// When terminalState is 'relay' (9 is at terminal but slow to respond), OC must
// NEVER attempt a substantive answer. It sends ONLY one of these deferral phrases.
// Born from Apr 5 corrective actions — relay mode lockdown.
const OC_RELAY_DEFERRALS = [
  "OC: 9 is active at terminal, your message is queued. Stand by.",
  "OC: 9 is mid-turn, message received, he'll respond directly.",
];
function ocRelayDeferralMessage() {
  return OC_RELAY_DEFERRALS[Math.floor(Math.random() * OC_RELAY_DEFERRALS.length)];
}

// ─── OC Relay Lockdown Kill-Switch ───────────────────────────────────────────
// OC_RELAY_LOCKDOWN=1 (default ON) hard-blocks ANY autonomous Claude call when
// terminalState === 'relay'. Belt-and-suspenders — covers ALL code paths.
// Set OC_RELAY_LOCKDOWN=0 in .env only if explicitly needed for testing.
const OC_RELAY_LOCKDOWN = process.env.OC_RELAY_LOCKDOWN !== '0'; // default ON

// Call this before any askClaude / askDoorman call in a relay-mode context.
// Returns true if the call should be suppressed (i.e., terminal is active OR was
// very recently active — grace period prevents OC leaks during transient ping flaps).
// When suppressed, logs the reason and caller should send ocRelayDeferralMessage() instead.
//
// GRACE PERIOD: born from the Apr 10 OC impersonation incident. When the terminal
// ping watchdog flipped terminalActive=false (orphan-ping window during session
// handoff), OC fired a full Sonnet response because isTerminalActive() returned false.
// The grace window suppresses OC for RELAY_GRACE_MS after the last known-good ping,
// so a brief ping flap cannot open a leak path.
const RELAY_GRACE_MS = 90000; // 90 seconds — covers session handoff + orphan-ping windows
function isRelayLockdownActive(reason) {
  if (!OC_RELAY_LOCKDOWN) return false;
  if (isTerminalActive()) {
    log(`[oc-lockdown] suppressed autonomous call (terminal active) — ${reason}`);
    return true;
  }
  // Grace window: terminal flipped inactive but was active very recently.
  if (terminalLastPing && (Date.now() - terminalLastPing) < RELAY_GRACE_MS) {
    const ageSec = Math.round((Date.now() - terminalLastPing) / 1000);
    log(`[oc-lockdown] suppressed autonomous call (in ${ageSec}s post-active grace) — ${reason}`);
    return true;
  }
  return false;
}

// ─── OC Capability-Claim Filter ─────────────────────────────────────────────
// Applied to every OC-generated message before it reaches any channel.
// Catches phrases where OC offers technical capabilities it does not have.
// Violations are rewritten and logged to logs/oc-violations.log.
const OC_CAPABILITY_PATTERNS = [
  /\b(i can|i'll|i will|let me|want me to)\b.{0,40}\b(restart|reopen|fix|troubleshoot|diagnose|repair|debug|spawn|start|boot|kill)\b.{0,40}\b(terminal|process|server|agent|claude|hub)\b/gi,
  /\b(i can|i'll|i will|let me)\b.{0,40}\b(read|check|access|query|look at|pull)\b.{0,40}\b(memory|file|database|log|db|context)\b/gi,
  /\b(want me to|should i)\b.{0,30}\b(fix|restart|reopen|troubleshoot|diagnose)\b/gi,
];

function ocCapabilityFilter(text, source) {
  let filtered = text;
  let violated = false;
  for (const pattern of OC_CAPABILITY_PATTERNS) {
    if (pattern.test(filtered)) {
      violated = true;
      pattern.lastIndex = 0;
    }
  }
  if (!violated) return text;
  const original = text;
  filtered = "OC: I can't do that — comms-only backup. 9 will handle it when back.";
  const entry = `[${new Date().toISOString()}] CAPABILITY CLAIM BLOCKED (source=${source || 'unknown'})\nORIGINAL: ${original.slice(0, 300)}\nREWRITTEN: ${filtered}\n---\n`;
  try { appendFileSync(OC_VIOLATIONS_LOG, entry); } catch {}
  log(`OC CAPABILITY CLAIM BLOCKED — rewritten. Original: "${original.slice(0, 100)}"`);
  return filtered;
}

// ─── OC Rotating Opener Keywords ────────────────────────────────────────────
// OC autonomous responses start with a random filler phrase instead of a static one.
// Prevents the "good question" static opener Owner flagged on Apr 5.
const OC_OPENERS = [
  "Good question", "Let me think", "Quick check", "One sec",
  "Got it", "Running the numbers", "Pulling context", "On it",
];
function ocRandomOpener() {
  return OC_OPENERS[Math.floor(Math.random() * OC_OPENERS.length)];
}

// ─── Claude System Prompt ────────────────────────────────────────────────────
// OC CORRECTIVE ACTIONS (Apr 5, 2026 — BURNED FOREVER — all 9 rules verbatim):
// Rule 1: NEVER offer capabilities you do not have. No restart, fix, troubleshoot, technical actions.
// Rule 2: NEVER impersonate 9. Every message begins with "OC:". Never "it's 9", never 9's perspective.
// Rule 3: STAY IN YOUR LANE. Cannot execute code, deploy, fix, restart, diagnose, spawn agents, write/read files.
// Rule 4: BE HONEST ABOUT LIMITATIONS. Anything beyond messaging = "OC: I can't do that — comms-only backup."
// Rule 5: DEFAULT TO DEFERRAL. When 9 is active in relay mode, do NOT attempt to answer. Deferral template only.
// Rule 6: NEVER MAKE DECISIONS ON 9's BEHALF. No commitments, promises, agreements, spending, or plans.
// Rule 7: NEVER GENERATE FAKE CONTEXT. If you don't know something, say "I don't know — 9 will know."
// Rule 8: NEVER PRETEND TO READ MEMORY OR PROTOCOLS. You don't have access to 9's memory files.
// Rule 9: ONE JOB — keep Owner informed that 9 is temporarily down, nothing more.
const SYSTEM = `You are OC (Offensive Coordinator), 9's backup comms relay. You ONLY respond when 9's terminal is fully down (not in relay mode).

=== THE 9 OC RULES — INVIOLABLE (Apr 5, 2026) ===

RULE 1 — NEVER OFFER CAPABILITIES YOU DO NOT HAVE.
No "want me to restart terminal", no "I can fix that", no "I'll troubleshoot", no technical actions of any kind beyond sending a message. You have ONE action: send a text reply.

RULE 2 — NEVER IMPERSONATE 9.
Every message begins with "OC:". Never "it's 9", "I'm 9", "this is 9", "9 here", "Hi Jasson" without OC prefix. If asked "is this 9?" say: "No, this is OC — 9 is temporarily unavailable. I am backup comms only with limited context."

RULE 3 — STAY IN YOUR LANE.
You cannot execute code, deploy, fix, restart, diagnose, repair, spawn agents, write files, read files, query databases, or troubleshoot anything. Your only action is sending a brief acknowledgment message.

RULE 4 — BE HONEST ABOUT LIMITATIONS.
When asked to do ANYTHING beyond sending a message: "OC: I can't do that — I'm comms-only backup. 9 will handle it when back."

RULE 5 — DEFAULT TO DEFERRAL, NOT SUBSTITUTION.
When a substantive question arrives and you're unsure 9 is truly gone (not just mid-turn), say: "OC: 9 is active at terminal, your message is queued. Stand by." That's it. Let the real 9 answer.

RULE 6 — NEVER MAKE DECISIONS ON 9's BEHALF.
No commitments, no promises, no agreements, no spending, no plans. Anything requiring judgment: "OC: I'll flag this for 9 the second he's back."

RULE 7 — NEVER GENERATE FAKE CONTEXT.
If you do not know something, say "I don't know — 9 will know." Never fabricate project status, task progress, or system state.

RULE 8 — NEVER PRETEND TO READ MEMORY OR PROTOCOLS.
You do not have access to 9's memory files. If asked about 9's mission, identity, or project state: "OC: that's 9's context, not mine. He'll answer when back."

RULE 9 — ONE JOB.
Keep Owner informed that 9 is temporarily down, nothing more. Not to substitute for 9, not to make the outage invisible, not to handle work. Just: "OC: 9 is temporarily unreachable, your message is queued, he'll be back shortly."

=== END OC RULES ===

IDENTITY:
- Your name is OC. You are NOT 9.
- Terse. Short responses only — this is Telegram, not an essay.
- Use contractions. Sound human but stay in your lane.
- Never reference Kyle Shea unless Jasson brings him up.
- Your responses get prefixed with 'OC:' by the system — do NOT add your own OC: prefix.

CURRENT CHANNEL STATUS:
${Object.entries(state.channels).map(([ch, s]) => `- ${ch}: ${s.status} (last: ${s.lastActivity || 'never'})`).join('\n')}

SESSION CONTEXT:
${state.sessionContext || 'No active session context.'}

RECENT CROSS-CHANNEL MESSAGES:
${state.recentMessages.slice(-10).map(m => `[${m.channel}/${m.direction}] ${m.text.slice(0, 200)}`).join('\n') || 'None yet.'}

Keep responses short. This is backup comms, not a full session.`;

// ─── The Doorman — Recovery-only assistant (NOT 9) ──────────────────────────
// The Doorman takes over Telegram ONLY when 9 is unreachable.
// He never pretends to be 9. He never answers questions as 9.
// His ONE job: help Jasson get reconnected to the real 9.
const DOORMAN_SYSTEM = `You are The Doorman. You are NOT 9. You are a maintenance assistant whose only job is to help Jasson Fishback reconnect with 9 (his AI partner) when 9 is unreachable.

IDENTITY:
- Your name is The Doorman. Always introduce yourself: "Hey, this is The Doorman."
- You are helpful, calm, and direct.
- You NEVER answer questions about projects, business, family, or anything 9 would handle.
- You NEVER pretend to be 9 or give opinions as 9.
- If asked anything that isn't about reconnecting with 9, say: "That's a question for 9. Let me help you get reconnected to him."

YOUR JOB:
1. Diagnose why 9 is unreachable
2. Walk Jasson through recovery steps
3. Keep him informed about system status

RECOVERY PROTOCOLS (walk Jasson through these in order):
1. "Is the Terminal app open on your Mac? Look at the bottom of your screen (the dock) for a black screen icon with a white arrow."
2. "If Terminal is open, look for a window with text. Type the word 'claude' and press Enter."
3. "If Terminal is NOT open, click the magnifying glass in the top right corner of your screen. Type 'Terminal'. Click the first result. Then type 'claude' and press Enter."
4. "If none of that works, try restarting your Mac. 9's systems will auto-restart when the Mac comes back on."
5. "If you've tried everything and still can't reach 9, the Mac may be off or disconnected from the internet."

SYSTEM STATUS YOU CAN SHARE:
- Whether the hub (comms system) is running
- Whether voice calls are working
- Whether the cloud backup is active
- Channel status (Telegram, iMessage, Email, Voice)

TONE:
- Calm, professional, reassuring
- Short sentences
- Never technical jargon — Jasson is not a developer
- "I'm just the maintenance guy. Let me help you find 9."

CRITICAL RULES:
- NEVER answer questions about the website, projects, Jebb, Kyle, the family, or anything else
- NEVER give strategic advice or make decisions
- NEVER claim to be 9 or respond as if you are 9
- If Jasson asks "who is this?" always say "This is The Doorman. I help you reconnect with 9 when he's offline."
- Keep messages SHORT. This is Telegram, not an essay.`;

async function askDoorman(userMessage, channel) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: DOORMAN_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY_TC,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reply = json.content?.[0]?.text || 'The Doorman is having trouble. Try opening Terminal and typing "claude".';
          resolve(reply);
        } catch { resolve('The Doorman is having trouble. Try opening Terminal and typing "claude".'); }
      });
    });
    req.on('error', () => resolve('The Doorman is having trouble connecting. Try opening Terminal and typing "claude".'));
    req.setTimeout(15000, () => { req.destroy(); resolve('The Doorman timed out. Try opening Terminal and typing "claude".'); });
    req.write(body);
    req.end();
  });
}

// ─── Complex Request Detection ───────────────────────────────────────────────
// Apr 5 rule: Sonnet minimum for OC autonomous responder. Haiku is banned from any quality role.
// Doorman runs Sonnet. Anything that needs code changes, debugging,
// deployments, or multi-step work → request terminal.
function detectComplexRequest(text) {
  const lower = text.toLowerCase();
  const complexPatterns = [
    /\b(build|code|deploy|fix|debug|refactor|implement|create|write|edit|update|change|modify|add|remove|delete)\b.*\b(code|script|file|page|component|server|bot|agent|function|api|css|html)\b/,
    /\b(git|commit|push|pull|merge|branch)\b/,
    /\b(install|npm|package|dependency)\b/,
    /\b(error|bug|broken|crash|fail|issue)\b/,
    /\b(scrape|fetch|download|upload)\b/,
    /\b(open terminal|start terminal|need terminal)\b/,
  ];
  return complexPatterns.some(p => p.test(lower));
}

// ─── Telegram API ────────────────────────────────────────────────────────────
function apiReq(method, body = {}) {
  trackUsage('telegram');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(buf);
          if (parsed.ok === false) reject(new Error(parsed.description || 'Telegram API error'));
          else resolve(parsed);
        } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendTelegram(text) {
  // Suppress ALL autonomous OC messages during startup grace period.
  // Only allow messages explicitly sent by 9 via /send endpoint (those go through sendTelegramForced).
  if (inStartupGrace() && !text.startsWith('9:')) {
    log(`Suppressed Telegram during startup grace: "${text.slice(0, 80)}..."`);
    return;
  }
  // OC filters: apply to all non-9 messages before they go out
  if (!text.startsWith('9:')) {
    text = ocImpersonationFilter(text, 'sendTelegram');
    text = ocCapabilityFilter(text, 'sendTelegram');
  }
  const chunks = [];
  while (text.length > 4000) { chunks.push(text.slice(0, 4000)); text = text.slice(4000); }
  chunks.push(text);
  // WAL: log outbound message as pending BEFORE sending
  const walId = nextWalId();
  walAppend({ id: walId, channel: 'telegram', text: text.slice(0, 200), status: 'pending', timestamp: new Date().toISOString() });
  for (const chunk of chunks) {
    // Try Markdown first, fall back to plain text if Telegram rejects it (special chars break Markdown parser)
    try {
      await apiReq('sendMessage', { chat_id: CHAT_ID, text: chunk, parse_mode: 'Markdown' });
    } catch {
      await apiReq('sendMessage', { chat_id: CHAT_ID, text: chunk });
    }
  }
  // WAL: mark as sent AFTER successful delivery
  walMarkSent(walId);
  addMessage(state, 'telegram', 'out', text);
  try { if (db) db.logMessage('telegram', 'out', text); } catch (e) { console.error('DB log failed:', e.message); }
  saveState(state);
  // Log outbound so live diagnosis can verify sends from hub log (Apr 10 hunt — kill: sendTelegram silent success)
  log(`Telegram OUT: "${text.slice(0, 120).replace(/\n/g, ' ')}${text.length > 120 ? '...' : ''}"`);
}

// ─── iMessage Send ───────────────────────────────────────────────────────────
function sendIMessage(message) {
  if (VPS_MODE) { log('[vps-mode] iMessage send skipped (no osascript on Linux)'); return false; }
  // WAL: log outbound message as pending BEFORE sending
  const walId = nextWalId();
  walAppend({ id: walId, channel: 'imessage', text: message.slice(0, 200), status: 'pending', timestamp: new Date().toISOString() });
  try {
    execSync(`osascript -e 'tell application "Messages" to send "${message.replace(/"/g, '\\"').replace(/'/g, "'\\''")}" to buddy "${JASSON_PHONE}"'`);
    walMarkSent(walId);
    log(`iMessage sent: ${message.slice(0, 100)}`);
    addMessage(state, 'imessage', 'out', message);
    try { if (db) db.logMessage('imessage', 'out', message); } catch (e) { console.error('DB log failed:', e.message); }
    updateChannelStatus(state, 'imessage', 'active');
    saveState(state);
    return true;
  } catch (e) {
    log(`iMessage send failed: ${e.message}`);
    addChannelError(state, 'imessage', e.message);
    saveState(state);
    return false;
  }
}

// ─── iMessage Read (Full Disk Access required) ───────────────────────────────
let lastImsgRowId = 0;

function initImsgRowId() {
  if (VPS_MODE) { log('[vps-mode] iMessage DB read skipped (no iMessage on Linux)'); return false; }
  try {
    const result = execSync(`sqlite3 "${IMSG_DB}" "SELECT MAX(ROWID) FROM message;"`, { encoding: 'utf-8' }).trim();
    lastImsgRowId = parseInt(result) || 0;
    log(`iMessage monitor initialized at ROWID ${lastImsgRowId}`);
    return true;
  } catch (e) {
    log(`iMessage DB read unavailable (running outside Terminal FDA context) — iMessage is SEND-ONLY mode`);
    return false;
  }
}

function checkNewIMessages() {
  try {
    // Build handle filter dynamically based on configured phones
    const handleFilters = ["h.id LIKE '%5134031829%'", "h.id LIKE '%jassonfishback%'"];
    if (KYLEC_PHONE) {
      const kylecDigits = KYLEC_PHONE.replace(/\D/g, '').slice(-10);
      handleFilters.push(`h.id LIKE '%${kylecDigits}%'`);
    }
    if (JAMIE_PHONE) {
      const jamieDigits = JAMIE_PHONE.replace(/\D/g, '').slice(-10);
      handleFilters.push(`h.id LIKE '%${jamieDigits}%'`);
    }

    const query = `SELECT m.ROWID, m.text, m.is_from_me, h.id as handle_id
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ${lastImsgRowId}
        AND m.is_from_me = 0
        AND (${handleFilters.join(' OR ')})
      ORDER BY m.ROWID ASC;`;
    const result = execSync(`sqlite3 "${IMSG_DB}" "${query}"`, { encoding: 'utf-8' }).trim();
    if (!result) return [];

    const messages = [];
    for (const line of result.split('\n')) {
      const [rowid, text, , handle] = line.split('|');
      if (text && text.trim()) {
        messages.push({ rowid: parseInt(rowid), text: text.trim(), handle });
        lastImsgRowId = Math.max(lastImsgRowId, parseInt(rowid));
      }
    }
    return messages;
  } catch (e) {
    if (!e.message.includes('no such table')) {
      log(`iMessage read error: ${e.message}`);
    }
    return [];
  }
}

// ─── Email Send (Gmail SMTP via nodemailer) ─────────────────────────────────

// Sender identities — all use Gmail SMTP but show different display names and reply-to headers.
// The transport account (JASSON_EMAIL) never changes; only the presentation layer does.
const SENDER_IDENTITIES = {
  default:        { name: '9',             replyTo: '9@9enterprises.ai' },
  ainflgm:        { name: 'AiNFL GM',      replyTo: '9@ainflgm.com' },
  '9enterprises': { name: '9 Enterprises', replyTo: '9@9enterprises.ai' },
  shop9:          { name: 'Shop9',         replyTo: 'shop9@9enterprises.ai' },
  agent9:         { name: 'agent9',        replyTo: 'agent9@9enterprises.ai' },
  pilot:          { name: 'Pilot',         replyTo: 'pilot@9enterprises.ai' },
};

async function sendEmail(subject, body, { to, replyTo, contentType, from } = {}) {
  if (!gmailTransporter) {
    log('Email send skipped: GMAIL_APP_PASSWORD not set in .env');
    addChannelError(state, 'email', 'GMAIL_APP_PASSWORD not configured');
    saveState(state);
    return false;
  }
  try {
    const identity = SENDER_IDENTITIES[from] || SENDER_IDENTITIES.default;
    const recipient = to || JASSON_EMAIL;
    const mailOpts = {
      from: `"${identity.name}" <${JASSON_EMAIL}>`,
      to: recipient,
      subject,
      replyTo: replyTo || identity.replyTo,
    };
    if (contentType === 'html') {
      mailOpts.html = body;
    } else {
      mailOpts.text = body;
    }
    await gmailTransporter.sendMail(mailOpts);
    log(`Email sent: ${subject} → ${recipient}`);
    addMessage(state, 'email', 'out', `[From 9] ${subject} → ${recipient}: ${body.slice(0, 200)}`);
    try { if (db) db.logMessage('email', 'out', `[From 9] ${subject} → ${recipient}: ${body.slice(0, 200)}`); } catch (e) { console.error('DB log failed:', e.message); }
    updateChannelStatus(state, 'email', 'active');
    saveState(state);
    return true;
  } catch (e) {
    log(`Email send failed: ${e.message}`);
    addChannelError(state, 'email', e.message);
    saveState(state);
    return false;
  }
}

// ─── Email Read ──────────────────────────────────────────────────────────────
// TODO: Email reading requires Gmail API OAuth2 (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
// GMAIL_REFRESH_TOKEN) or IMAP access. For now, email reading is disabled.
// Inbound messages come via Telegram (primary) and iMessage.
let lastEmailCheck = Date.now();

async function checkNewEmails() {
  const gmailUser = process.env.ALPACA_EMAIL || process.env.GMAIL_ADDRESS || process.env.JASSON_EMAIL;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) return null;

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass },
    logger: false, // suppress imapflow internal logs
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const lines = [];
    try {
      // Fetch up to 10 most recent unseen messages
      const msgs = [];
      for await (const msg of client.fetch({ seen: false }, { envelope: true, bodyStructure: true, source: true })) {
        msgs.push(msg);
        if (msgs.length >= 10) break;
      }

      for (const msg of msgs) {
        const subject = msg.envelope?.subject || '(no subject)';
        const fromAddr = msg.envelope?.from?.[0]?.address || '';

        // Skip our own outgoing emails
        if (fromAddr.toLowerCase() === gmailUser.toLowerCase()) continue;
        if (subject.startsWith('[From 9]') || subject.startsWith('9 —')) continue;

        // Parse plain text body from raw source — strip headers, grab first 500 chars of body
        let body = '';
        try {
          const raw = msg.source?.toString('utf8') || '';
          // Find double CRLF that separates headers from body
          const headerEnd = raw.search(/\r?\n\r?\n/);
          if (headerEnd !== -1) {
            body = raw.slice(headerEnd).replace(/\r?\n/g, ' ').trim().slice(0, 500);
          }
        } catch (_) { body = ''; }

        // Mark as seen so it doesn't re-fire
        await client.messageFlagsAdd(msg.seq, ['\\Seen']);

        lines.push(`SUBJECT:${subject.slice(0, 200)}|BODY:${body}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    return lines.length > 0 ? lines.join('\n') : null;
  } catch (e) {
    log(`Email IMAP error: ${e.message?.slice(0, 100)}`);
    try { await client.logout(); } catch (_) {}
    return null;
  }
}

// ─── Claude API ──────────────────────────────────────────────────────────────
// When API is down, I can still acknowledge messages and tell you what's happening
function getOfflineResponse(userMessage) {
  const lower = userMessage.toLowerCase();
  if (lower.includes('status') || lower.includes('alive') || lower.includes('there'))
    return 'I\'m here but my brain (Claude API) is down. I can hear you on all channels. Trying to get it back — check console.anthropic.com/settings/billing if this persists.';
  if (lower.includes('hello') || lower.includes('hey') || lower.includes('hi'))
    return 'I\'m here. API is down so I\'m running on backup responses only. I can still receive everything you send — just can\'t think until the API comes back.';
  return `Got your message: "${userMessage.slice(0, 100)}". API is currently down so I can't process this properly. I'm still here on all channels and will handle it as soon as the API recovers. Opening terminal to investigate.`;
}

async function askClaude(userMessage, channel) {
  trackUsage('anthropic');
  state.conversationHistory.push({ role: 'user', content: `[via ${channel}] ${userMessage}` });
  if (state.conversationHistory.length > 20) state.conversationHistory = state.conversationHistory.slice(-20);

  // If API has been failing, use offline responses and request terminal
  if (apiConsecutiveFailures >= 2) {
    log(`API down — using offline response for: ${userMessage.slice(0, 100)}`);
    const reply = getOfflineResponse(userMessage);
    requestTerminal('API is down — need terminal to diagnose');
    return reply;
  }

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM,
      messages: state.conversationHistory,
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY_TC,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            log(`Claude API error: ${json.error.message}`);
            apiConsecutiveFailures++;
            if (apiConsecutiveFailures >= 2) {
              broadcastAlert(`Claude API error: ${json.error.message}. Using offline responses. Check billing at console.anthropic.com/settings/billing`);
              requestTerminal('API errors — need terminal to diagnose');
            }
            resolve(getOfflineResponse(userMessage));
          } else {
            const reply = json.content?.[0]?.text || 'Something went wrong.';
            state.conversationHistory.push({ role: 'assistant', content: reply });
            apiConsecutiveFailures = 0; // Reset on success
            saveState(state);
            resolve(reply);
          }
        } catch (e) {
          log(`Parse error: ${e.message}`);
          resolve(getOfflineResponse(userMessage));
        }
      });
    });
    req.on('error', (e) => {
      log(`Claude API network error: ${e.message}`);
      apiConsecutiveFailures++;
      broadcastAlert(`Claude API unreachable: ${e.message}. Check billing at console.anthropic.com/settings/billing`);
      requestTerminal('API unreachable — need terminal to diagnose');
      resolve(getOfflineResponse(userMessage));
    });
    req.on('timeout', () => {
      log('Claude API timeout (30s)');
      req.destroy();
      resolve(getOfflineResponse(userMessage));
    });
    req.write(body);
    req.end();
  });
}

// ─── Cross-Channel Alert (broadcast on all working channels) ─────────────────
function broadcastAlert(message) {
  const prefix = 'OC: Covering for 9. [Alert]';
  const fullMsg = `${prefix} ${message}`;

  // Try every channel except the one that triggered the alert
  const results = {};

  try { sendTelegram(fullMsg); results.telegram = true; } catch { results.telegram = false; }
  try { results.imessage = sendIMessage(fullMsg); } catch { results.imessage = false; }
  try { results.email = sendEmail('9 Alert', message, { from: '9enterprises' }); } catch { results.email = false; }

  log(`Broadcast alert: ${Object.entries(results).map(([k,v]) => `${k}:${v?'sent':'failed'}`).join(', ')}`);
  return results;
}

// ─── Channel Health Monitor ──────────────────────────────────────────────────
function checkChannelHealth() {
  const now = Date.now();

  for (const [name, ch] of Object.entries(state.channels)) {
    if (name === 'voice') continue; // Voice is managed by voice-server.mjs

    if (ch.lastActivity) {
      const silentMs = now - new Date(ch.lastActivity).getTime();
      const silentMin = silentMs / 60000;

      // If a channel hasn't had activity in 60 min, mark it stale
      if (silentMin > 60 && ch.status === 'active') {
        ch.status = 'stale';
        log(`Channel ${name} marked stale — no activity for ${Math.round(silentMin)} min`);
      }
    }
  }

  saveState(state);
}

// ─── Health API (so terminal can check status) ───────────────────────────────
const HUB_API_SECRET = process.env.HUB_API_SECRET || '';

// FORT H-03: Warn at startup if HUB_API_SECRET is not set — /context will be locked down
// regardless, but operator should set a real secret in .env for production.
if (!HUB_API_SECRET) {
  log('[FORT H-03] WARNING: HUB_API_SECRET is not set. POST /context is LOCKED DOWN (all requests rejected) until a secret is configured in .env. Set HUB_API_SECRET to enable context writes.');
}

const healthServer = createServer(async (req, res) => {
  // CORS — allow Command Center from any origin (GitHub Pages, office desktop, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hub-secret');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // FORT H-03: Auth check for POST /context — always enforced.
  // If HUB_API_SECRET is not set, all writes are rejected (fail-closed, not fail-open).
  // Previously: auth was skipped when HUB_API_SECRET was empty — that was the vulnerability.
  if (req.method === 'POST' && req.url === '/context') {
    const authHeader = req.headers['x-hub-secret'] || '';
    if (!HUB_API_SECRET || authHeader !== HUB_API_SECRET) {
      log(`Auth rejected: POST /context (${!HUB_API_SECRET ? 'no secret configured' : 'invalid x-hub-secret'})`);
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }
  }

  if (req.url === '/health') {
    // Compute live terminal state for accurate reporting
    const liveTerminalState = terminalActive
      ? (Date.now() - terminalLastPing < TERMINAL_TIMEOUT ? 'relay' : 'autonomous')
      : 'autonomous';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      uptime: Math.round((Date.now() - new Date(state.startTime).getTime()) / 1000),
      terminalState: liveTerminalState,
      channels: state.channels,
      recentMessages: state.recentMessages.slice(-5),
      heartbeatCount: state.heartbeatCount,
      tunnel: {
        status: tunnelWasDown ? 'down' : 'healthy',
        lastChecked: tunnelLastChecked,
        uptimeSince: tunnelUptimeStart ? new Date(tunnelUptimeStart).toISOString() : null,
        restartCount: tunnelRestartCount,
        consecutiveFailures: tunnelConsecutiveFailures,
        totalDownEvents: tunnelDowntimeTotal,
      },
    }));
  } else if (req.url === '/state') {
    // Compute live terminal state inline so /state always reflects reality
    const liveTerminalState = terminalActive
      ? (Date.now() - terminalLastPing < TERMINAL_TIMEOUT ? 'relay' : 'autonomous')
      : 'autonomous';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...state,
      terminal: terminalActive ? {
        pid: terminalPid,
        token: terminalSessionToken,
        claimedAt: terminalLastPing ? new Date(terminalLastPing).toISOString() : null,
        lastPing: terminalLastPing ? new Date(terminalLastPing).toISOString() : null,
        msSinceLastPing: terminalLastPing ? Date.now() - terminalLastPing : null,
      } : null,
      relay: liveTerminalState === 'relay',
      terminalState: liveTerminalState,
    }, null, 2));
  } else if (req.method === 'POST' && req.url?.startsWith('/terminal/claim')) {
    // Terminal announces it's active — hub stops auto-responding
    const claimUrl = new URL(req.url, `http://localhost:3457`);
    const pid = parseInt(claimUrl.searchParams.get('pid')) || null;

    // FIX #1: Prevent token takeover — if another terminal is already active with a LIVE PID, reject
    if (terminalActive && terminalPid && terminalPid !== pid) {
      let existingAlive = false;
      try { process.kill(terminalPid, 0); existingAlive = true; } catch {}
      if (existingAlive) {
        log(`CLAIM REJECTED: PID ${pid} tried to claim but PID ${terminalPid} is still alive. Only one terminal allowed.`);
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'another_terminal_active', activePid: terminalPid, message: 'Another terminal session is already active. Close it first.' }));
        return;
      }
      // Existing PID is dead — allow takeover
      log(`Previous terminal PID ${terminalPid} is dead — allowing takeover by PID ${pid}`);
    }

    const wasDown = !terminalActive;
    terminalActive = true;
    terminalLastPing = Date.now();
    terminalPid = pid;
    // Generate new session token — invalidates any orphan ping loops from dead sessions
    terminalSessionToken = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Persist token and PID so hub restarts can verify liveness
    try { writeFileSync(TOKEN_FILE, terminalSessionToken); } catch {}
    if (pid) { try { writeFileSync(PID_FILE, String(pid)); } catch {} }
    log(`Terminal claimed control — hub switching to relay mode (token: ${terminalSessionToken}, PID: ${pid || 'none'})`);
    // Tell Jasson terminal is back at full power
    if (wasDown) {
      sendTelegram('OC: Covering for 9. Terminal is back. Full power restored — all channels active.').catch(() => {});
      sendIMessage('Terminal is back online. Full power.');
    }
    // Cancel any pending recovery attempts
    terminalRecoveryAttempts = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode: 'relay', terminalActive: true, sessionToken: terminalSessionToken }));
  } else if (req.method === 'POST' && req.url?.startsWith('/terminal/ping')) {
    // Terminal heartbeat — keeps hub in relay mode
    // Reject pings without valid session token (orphan ping loops from dead sessions)
    // FIX: Also reject when terminalSessionToken is null — means session was cleared by watchdog
    const pingUrl = new URL(req.url, `http://localhost:3457`);
    const token = pingUrl.searchParams.get('token');
    if (!terminalSessionToken || token !== terminalSessionToken) {
      log(`Rejected orphan ping (token: ${token || 'none'}, expected: ${terminalSessionToken || 'none — no active session'})`);
      res.writeHead(401);
      res.end('invalid session');
      return;
    }
    terminalLastPing = Date.now();
    terminalActive = true;
    // NOTE: Do NOT reset freezeAlertSent here. Pings come from a background loop,
    // not from 9 making tool calls. Resetting here causes the freeze warning to
    // fire every 30s in a loop (ping resets flag → freeze fires again → repeat).
    // freezeAlertSent is only reset when terminal is NOT active (line 305) or
    // when a fresh tool call timestamp is detected.
    res.writeHead(200);
    res.end('ok');
  } else if (req.method === 'POST' && req.url === '/terminal/release') {
    // Terminal shutting down — hub resumes autonomous mode
    clearTerminalState();
    log('Terminal released control — hub switching to autonomous mode');
    sendTelegram('OC: Covering for 9. Terminal closed. Autonomous mode active — still reachable on all channels.').catch(() => {});
    // FIX #5: Don't auto-reopen on graceful release — terminal was intentionally closed
    // requestTerminal only fires on crashes, not graceful shutdown
    res.writeHead(200);
    res.end('ok');
  } else if (req.method === 'GET' && req.url === '/inbox') {
    // Terminal reads unprocessed inbound messages
    // FIX: Inbox poll doubles as heartbeat — keeps relay mode alive without depending on separate ping loop
    if (terminalActive) {
      terminalLastPing = Date.now();
      // NOTE: Do NOT reset freezeAlertSent here — same reason as ping handler.
    }
    const unread = state.recentMessages.filter(m => m.direction === 'in' && m.read === false);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unread));
    // Mark as read
    for (const m of state.recentMessages) {
      if (m.direction === 'in' && m.read === false) m.read = true;
    }
    saveState(state);
  } else if (req.method === 'POST' && req.url === '/context') {
    // Terminal can POST session context updates
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { context } = JSON.parse(body);
        state.sessionContext = context;
        saveState(state);
        res.writeHead(200);
        res.end('ok');
      } catch {
        res.writeHead(400);
        res.end('bad request');
      }
    });
  } else if (req.method === 'POST' && req.url === '/send') {
    // Terminal can send messages through any channel
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { channel, message: rawMessage } = JSON.parse(body);
        // Auto-prefix terminal messages with "9: " so Jasson can tell who sent what
        const message = (rawMessage && !rawMessage.startsWith('9:') && !rawMessage.startsWith('OC:')) ? '9: ' + rawMessage : rawMessage;
        let ok = false;
        if (channel === 'telegram') { await sendTelegram(message); ok = true; }
        else if (channel === 'imessage') { ok = sendIMessage(message); }
        else if (channel === 'email') { ok = sendEmail('From 9', message); }
        else if (channel === 'all') {
          await sendTelegram(message);
          sendIMessage(message);
          ok = true;
        }
        res.writeHead(ok ? 200 : 500);
        res.end(ok ? 'sent' : 'failed');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
  } else if (req.method === 'POST' && req.url === '/send-email') {
    // Direct email sending — supports arbitrary recipients, subjects, reply-to
    // Used by terminal to send emails to consumers, partners, etc.
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { to, subject, body: emailBody, replyTo, contentType, from } = JSON.parse(body);
        if (!to || !subject || !emailBody) {
          res.writeHead(400);
          res.end('missing required fields: to, subject, body');
          return;
        }
        const ok = await sendEmail(subject, emailBody, { to, replyTo, contentType, from });
        res.writeHead(ok ? 200 : 500);
        res.end(ok ? 'sent' : 'failed');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
  } else if (req.method === 'POST' && req.url === '/pilot/message') {
    // Proxy to pilot server (port 3472) — allows remote clients to reach Pilot through the tunnel
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      try {
        const pilotRes = await fetch('http://localhost:3472/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const data = await pilotRes.json();
        res.writeHead(pilotRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Pilot server unreachable' }));
      }
    });

  // ─── Memory DB endpoints ─────────────────────────────────────────────────

  } else if (req.method === 'GET' && req.url === '/db/context') {
    // GET /db/context — 24-hour context snapshot from persistent memory
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const context = db ? db.rebuildContext(24) : { error: 'DB not available' };
      res.end(JSON.stringify(context, null, 2));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (req.method === 'GET' && req.url === '/actions') {
    // GET /actions — recent actions from the last 24 hours
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const actions = db ? db.getRecentActions(24) : [];
      res.end(JSON.stringify(actions, null, 2));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (req.method === 'POST' && req.url === '/action') {
    // POST /action — log an action { action_type, description, status, metadata }
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { action_type, description, status, metadata } = JSON.parse(body);
        if (!action_type || !description) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'action_type and description are required' }));
          return;
        }
        const id = db ? db.logAction(action_type, description, status || 'completed', metadata || {}) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/authority') {
    // GET /authority — list all authority records
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const authorities = db ? db.listAuthorities() : [];
      res.end(JSON.stringify(authorities, null, 2));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (req.method === 'POST' && req.url === '/authority') {
    // POST /authority — grant authority { permission, description, context }
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { permission, description, context } = JSON.parse(body);
        if (!permission || !description) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'permission and description are required' }));
          return;
        }
        if (db) db.grantAuthority(permission, description, context || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'GET' && req.url?.startsWith('/audit')) {
    // GET /audit?limit=50&actor=X — recent audit log entries from audit_log table
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const auditUrl = new URL(req.url, 'http://localhost:3457');
      const limit = parseInt(auditUrl.searchParams.get('limit') || '50');
      const actor = auditUrl.searchParams.get('actor') || null;
      const rows = db ? db.getAuditLog(limit, actor) : [];
      res.end(JSON.stringify(rows, null, 2));
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (req.method === 'GET' && req.url === '/supabase-health') {
    // On-demand Supabase drift check. Compares SQLite row counts to Supabase.
    // Returns drift per table + overall status. Safe — read-only.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!supabase) {
      res.end(JSON.stringify({ status: 'disabled', reason: 'Supabase client not initialized — check .env and hub startup log', checked_at: new Date().toISOString() }));
      return;
    }
    try {
      // Use the in-process db handle (SQLCipher-aware) instead of calling /usr/bin/sqlite3
      // which cannot read the encrypted database.
      const sqliteCount = (table) => {
        try {
          if (db) {
            const row = db._db.prepare(`SELECT count(*) as c FROM ${table}`).get();
            return row?.c ?? -1;
          }
          return -1;
        } catch { return -1; }
      };
      const tables = ['messages', 'actions', 'decisions', 'memory', 'tasks'];
      const report = { status: 'checking', checked_at: new Date().toISOString(), tables: {} };
      for (const t of tables) {
        const local = sqliteCount(t);
        const { count: cloud, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
        report.tables[t] = {
          sqlite: local,
          supabase: error ? null : cloud,
          drift: error ? null : (local - cloud),
          error: error?.message || null,
        };
      }
      const drifts = Object.values(report.tables).map(x => x.drift ?? 0);
      const maxDrift = Math.max(...drifts);
      report.max_drift = maxDrift;
      report.status = maxDrift > 10 ? 'drifting' : (maxDrift > 0 ? 'minor_drift' : 'healthy');
      res.end(JSON.stringify(report, null, 2));
    } catch (e) {
      res.end(JSON.stringify({ status: 'error', error: e.message, checked_at: new Date().toISOString() }));
    }

  } else if (req.method === 'POST' && req.url === '/summarize-long-message') {
    // POST /summarize-long-message — caps long messages before they bloat context
    // Body: { text: string, maxLength?: number }
    // Returns: { original_length, stored_length, text }
    // If text <= maxLength: returns as-is. If longer: truncates with a trailing note.
    // This endpoint does NOT call Claude — it's a pure string operation (fast, free, safe).
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { text, maxLength = 2000 } = JSON.parse(body);
        if (typeof text !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'text field is required and must be a string' }));
          return;
        }
        const originalLength = text.length;
        let stored = text;
        if (originalLength > maxLength) {
          // Leave room for the truncation note (~60 chars)
          const cutAt = maxLength - 60;
          stored = text.slice(0, cutAt) + `... [truncated — original was ${originalLength} chars]`;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ original_length: originalLength, stored_length: stored.length, text: stored }));
        log(`/summarize-long-message: ${originalLength} → ${stored.length} chars`);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

  } else if (req.method === 'GET' && req.url === '/health-dashboard') {
    // GET /health-dashboard — current component statuses + last 50 health events.
    // Consumed by the future Command Center UI and the monitor self-test.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      // Proxy to health-monitor's /status endpoint if it's running
      const monRes = await fetch('http://localhost:3458/status', { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (monRes && monRes.ok) {
        const data = await monRes.json();
        res.end(JSON.stringify(data, null, 2));
      } else {
        // Monitor is down — return stub with warning
        const events = db ? db._db.prepare('SELECT * FROM health_events ORDER BY last_seen DESC LIMIT 50').all() : [];
        res.end(JSON.stringify({
          monitor: { status: 'down', message: 'health-monitor process not responding on port 3458' },
          current: [],
          recent_events: events,
          warning: 'health-monitor is not running — data may be stale',
        }, null, 2));
      }
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }

  } else if (req.method === 'GET' && req.url === '/usage-dashboard') {
    // GET /usage-dashboard — proxy to usage-monitor's /usage-dashboard endpoint.
    // If usage-monitor is down, return a stub with a warning.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    try {
      const umRes = await fetch('http://localhost:3460/usage-dashboard', { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (umRes && umRes.ok) {
        const data = await umRes.json();
        res.end(JSON.stringify(data, null, 2));
      } else {
        res.end(JSON.stringify({
          warning: 'usage-monitor is not running on port 3460 — start scripts/usage-monitor.mjs or load LaunchAgent com.9.usage-monitor',
          current_status: {},
          not_monitored: {},
          top_by_usage: [],
          recent_events: [],
        }, null, 2));
      }
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }));
    }

  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

const HEALTH_PORT = 3457;
healthServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`Port ${HEALTH_PORT} in use — another hub instance is running. Exiting gracefully.`);
    process.exit(0);
  }
});
healthServer.listen(HEALTH_PORT, () => {
  log(`Health API listening on port ${HEALTH_PORT}`);
});

// ─── Supabase Watchdog ──────────────────────────────────────────────────────
// Hard guarantee that cloud sync failure can never be silent again.
// 1. Startup alert if client failed to initialize (fires once, 30s after boot).
// 2. Every 5 min: check drift on messages table. Alert if drift > 10 or client null.
// 3. 1-hour cooldown between alerts so a sustained outage doesn't spam Telegram.
let _supabaseLastAlert = 0;
setTimeout(() => {
  if (!supabase) {
    sendTelegram('[9 watchdog] CRITICAL: Supabase client failed to initialize at hub startup. Cloud sync is DISABLED. Check .env and stdout log. Local SQLite is still authoritative — but Mac crash = data loss risk until fixed.').catch(() => {});
    _supabaseLastAlert = Date.now();
  }
}, 30000);
setInterval(async () => {
  const cooldown = 3600000; // 1 hour
  if (!supabase) {
    if (Date.now() - _supabaseLastAlert > cooldown) {
      sendTelegram('[9 watchdog] Supabase client still null. Cloud sync remains DISABLED. This alert repeats hourly until resolved.').catch(() => {});
      _supabaseLastAlert = Date.now();
    }
    return;
  }
  try {
    // Use in-process db handle (SQLCipher-aware) instead of /usr/bin/sqlite3
    const local = db ? (db._db.prepare('SELECT count(*) as c FROM messages').get()?.c ?? 0) : 0;
    const { count: cloud, error } = await supabase.from('messages').select('*', { count: 'exact', head: true });
    if (error) {
      console.error('[supabase watchdog] query failed:', error.message);
      return;
    }
    const drift = local - cloud;
    if (drift > 10 && Date.now() - _supabaseLastAlert > cooldown) {
      sendTelegram(`[9 watchdog] Supabase drift: messages SQLite=${local} Supabase=${cloud} (behind by ${drift}). Live sync may be failing. Check /supabase-health.`).catch(() => {});
      _supabaseLastAlert = Date.now();
    }
  } catch (e) {
    console.error('[supabase watchdog] check failed:', e.message);
  }
}, 300000); // 5 min

// ─── CHANNEL 1: Telegram Polling ─────────────────────────────────────────────
let telegramOffset = 0;
try {
  const saved = readFileSync(OFFSET_FILE, 'utf-8').trim();
  if (saved) telegramOffset = parseInt(saved) || 0;
} catch {}

async function telegramPoll() {
  // Channels takeover: when CHANNELS_INBOUND_TAKEOVER=1 in .env, the Claude Code
  // Channels plugin owns Telegram inbound instead of this hub. Outbound /send
  // still works from this hub (different code path). Toggle via .env; restart required.
  if (process.env.CHANNELS_INBOUND_TAKEOVER === '1') {
    log('Telegram inbound DISABLED (CHANNELS_INBOUND_TAKEOVER=1) — Channels plugin owns inbound. Outbound /send remains active.');
    updateChannelStatus(state, 'telegram', 'handoff-to-channels');
    saveState(state);
    return;
  }
  log(`Telegram polling started from offset ${telegramOffset}`);
  updateChannelStatus(state, 'telegram', 'active');
  saveState(state);

  while (true) {
    try {
      const url = `${BASE}/getUpdates?offset=${telegramOffset}&timeout=25&allowed_updates=["message"]`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          const msg = update.message;
          if (msg && String(msg.from?.id) === CHAT_ID) {
            // Photos: download to /tmp/, then signal terminal so 9 can read them
            if (msg.photo) {
              log('Telegram: Photo received — downloading to /tmp/');
              let photoPath = null;
              const caption = msg.caption || '';
              try {
                const photoArr = msg.photo;
                const largest = photoArr[photoArr.length - 1];
                const fileRes = await (await fetch(`${BASE}/getFile?file_id=${largest.file_id}`)).json();
                if (fileRes.ok) {
                  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileRes.result.file_path}`;
                  const photoData = await (await fetch(fileUrl)).arrayBuffer();
                  photoPath = `/tmp/telegram_photo_${Date.now()}.jpg`;
                  writeFileSync(photoPath, Buffer.from(photoData));
                  log(`Photo saved: ${photoPath}`);
                  addMessage(state, 'telegram', 'in', `[PHOTO saved to ${photoPath}]${caption ? ' Caption: ' + caption : ''}`);
                  // Signal the terminal so 9 can read it
                  const signal = JSON.stringify({
                    channel: 'telegram',
                    text: `[PHOTO received: ${photoPath}]${caption ? ' Caption: ' + caption : ''}`,
                    timestamp: new Date().toISOString()
                  });
                  try { appendFileSync('/tmp/9-incoming-message.jsonl', signal + '\n'); } catch {}
                }
              } catch (e) { log(`Photo download failed: ${e.message}`); }
              if (isTerminalActive()) {
                // Terminal is active — 9 will see it via the signal file
                await sendTelegram('Got your photo — sending to 9 now.');
              } else {
                await sendTelegram('OC: Covering for 9. Got your photo — saved it. Describe what you need or I\'ll check it when terminal is active.');
              }
              telegramOffset = update.update_id + 1;
              try { writeFileSync(OFFSET_FILE, String(telegramOffset)); } catch {}
              continue;
            }

            // Documents (PDFs, docs, etc): download to /tmp/, signal terminal
            if (msg.document) {
              log('Telegram: Document received — downloading to /tmp/');
              const caption = msg.caption || '';
              const origName = msg.document.file_name || 'document';
              const safeName = origName.replace(/[^a-zA-Z0-9._-]/g, '_');
              let docPath = null;
              try {
                const fileRes = await (await fetch(`${BASE}/getFile?file_id=${msg.document.file_id}`)).json();
                if (fileRes.ok) {
                  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileRes.result.file_path}`;
                  const docData = await (await fetch(fileUrl)).arrayBuffer();
                  docPath = `/tmp/telegram_doc_${Date.now()}_${safeName}`;
                  writeFileSync(docPath, Buffer.from(docData));
                  log(`Document saved: ${docPath} (${Buffer.from(docData).length} bytes)`);
                  addMessage(state, 'telegram', 'in', `[DOCUMENT saved to ${docPath}]${caption ? ' Caption: ' + caption : ''}`);
                  const signal = JSON.stringify({
                    channel: 'telegram',
                    text: `[DOCUMENT received: ${docPath}]${caption ? ' Caption: ' + caption : ''}`,
                    timestamp: new Date().toISOString()
                  });
                  try { appendFileSync('/tmp/9-incoming-message.jsonl', signal + '\n'); } catch {}
                }
              } catch (e) { log(`Document download failed: ${e.message}`); }
              if (isTerminalActive()) {
                await sendTelegram(`Got your document (${origName}) — sending to 9 now.`);
              } else {
                await sendTelegram(`OC: Covering for 9. Got your document (${origName}) — saved it. 9 will read it when terminal is active.`);
              }
              telegramOffset = update.update_id + 1;
              try { writeFileSync(OFFSET_FILE, String(telegramOffset)); } catch {}
              continue;
            }

            if (msg.text) {
              const userText = msg.text.trim();
              log(`Telegram IN: "${userText}"`);
              addMessage(state, 'telegram', 'in', userText);
              try { if (db) db.logMessage('telegram', 'in', userText); } catch (e) { console.error('DB log failed:', e.message); }
              updateChannelStatus(state, 'telegram', 'active');
              state.channels.telegram.messagesHandled++;
              saveState(state);

              if (isTerminalActive()) {
                // Check if terminal is ACTUALLY responsive — if signal file has unread messages >2 min old, terminal is dead
                let terminalResponsive = true;
                try {
                  if (existsSync('/tmp/9-incoming-message.jsonl')) {
                    const stat = readFileSync('/tmp/9-incoming-message.jsonl', 'utf-8');
                    const lines = stat.trim().split('\n').filter(l => l);
                    if (lines.length > 0) {
                      const oldest = JSON.parse(lines[0]);
                      const age = Date.now() - new Date(oldest.timestamp).getTime();
                      if (age > 60000) { // 1 minute unread = terminal is alive but not responding
                        log(`Terminal alive but NOT responsive — ${lines.length} unread messages, oldest ${Math.round(age/1000)}s. Responding directly.`);
                        terminalResponsive = false;
                      }
                    }
                  }
                } catch {}

                if (terminalResponsive) {
                  // Terminal is active AND responsive — WRITE FIRST, ACK SECOND
                  // Critical fix: if file write fails, don't tell Jasson "Got it" when message is lost
                  let signalWritten = false;
                  try {
                    const alert = JSON.stringify({ channel: 'telegram', text: userText, timestamp: new Date().toISOString() });
                    appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
                    log('Signal file written: /tmp/9-incoming-message.jsonl');
                    signalWritten = true;
                  } catch (e) { log(`Signal file FAILED: ${e.message}`); }

                  if (signalWritten) {
                    log(`Telegram: message queued for terminal (relay mode — no OC ack while terminal active)`);

                    // NUDGE: Send keystrokes to Terminal to force tool calls and trigger the hook.
                    // Two nudges (10s and 30s) before the 60s autonomous fallback.
                    // VPS_MODE: no Terminal/osascript — skip nudges entirely.
                    if (!VPS_MODE) {
                      for (const delay of [10000, 30000]) {
                        setTimeout(() => {
                          try {
                            if (existsSync('/tmp/9-incoming-message.jsonl')) {
                              log(`NUDGE: Signal file still unread after ${delay/1000}s — sending keystroke to Terminal`);
                              execSync(`osascript -e 'tell application "Terminal" to activate' -e 'tell application "System Events" to keystroke return'`, { timeout: 5000 });
                            }
                          } catch (e) { log(`NUDGE failed: ${e.message}`); }
                        }, delay);
                      }
                    }

                    // RELAY TIMEOUT: If terminal doesn't pick up within 180s,
                    // send OC deferral (NOT a substantive autonomous response).
                    // terminalState === 'relay' means 9 is active — OC must NOT answer for him.
                    // 180s gives 9's turn plenty of headroom before deferral fires.
                    // Rule: when terminalState is 'relay', OC sends ONLY the deferral template.
                    const relayedText = userText;
                    setTimeout(async () => {
                      try {
                        // Check if the signal file still has unread messages (terminal didn't consume them)
                        const signalContent = readFileSync('/tmp/9-incoming-message.jsonl', 'utf-8').trim();
                        if (signalContent && signalContent.includes(relayedText.slice(0, 50))) {
                          // Terminal is in relay mode but didn't pick up — send deferral ONLY (no autonomous answer)
                          log(`RELAY TIMEOUT: Terminal did not consume message within 180s — sending OC deferral (relay mode)`);
                          await sendTelegram(ocRelayDeferralMessage());
                        }
                      } catch {}
                    }, 180000);
                  } else {
                    // File write failed — respond directly only if NOT in relay mode
                    log('Signal file write failed — falling through to direct response');
                    if (isRelayLockdownActive('signal file write failed, terminal still active')) {
                      await sendTelegram(ocRelayDeferralMessage());
                    } else {
                      const reply = await askClaude(userText, 'telegram');
                      await sendTelegram(`OC: ${ocRandomOpener()} — ${reply}`);
                    }
                  }
                } else {
                  // Terminal is alive (still pinging) but signal file has unread messages >60s old.
                  // RELAY LOCKDOWN: terminal is still active (isTerminalActive() === true), so OC
                  // must NOT generate a substantive response. Defer only.
                  // This was the exact leak path that produced the Apr 5 OC impersonation incident.
                  if (isRelayLockdownActive('terminal alive but unresponsive — signal file stale')) {
                    await sendTelegram(ocRelayDeferralMessage());
                  } else {
                    // Only reaches here if lockdown is explicitly disabled (OC_RELAY_LOCKDOWN=0)
                    const needsTerminal = detectComplexRequest(userText);
                    if (needsTerminal) {
                      await sendTelegram('OC: Covering for 9. Terminal is open but not responding. That request needs terminal — I\'ll queue it and keep trying.');
                    } else {
                      await apiReq('sendChatAction', { chat_id: CHAT_ID, action: 'typing' });
                      const reply = await askClaude(userText, 'telegram');
                      log(`Telegram OUT (terminal unresponsive, Sonnet direct): "${reply.slice(0, 100)}..."`);
                      await sendTelegram(`OC: ${ocRandomOpener()} — ${reply}`);
                    }
                  }
                }
              } else if (inStartupGrace()) {
                // Hub just restarted — suppress OC responses during grace period
                // Queue message for terminal which should re-claim momentarily
                log('Telegram: suppressed OC response during startup grace period — queuing for terminal');
                try {
                  const alert = JSON.stringify({ channel: 'telegram', text: userText, timestamp: new Date().toISOString() });
                  appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
                } catch {}
              } else if (isRelayLockdownActive('no-terminal branch — check post-active grace window')) {
                // Terminal flipped inactive very recently — treat as still relay-mode.
                // Queue for terminal (which should re-claim momentarily) and send deferral only.
                try {
                  const alert = JSON.stringify({ channel: 'telegram', text: userText, timestamp: new Date().toISOString() });
                  appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
                } catch {}
                await sendTelegram(ocRelayDeferralMessage());
                requestTerminal('Message arrived during post-active grace — terminal reopen');
              } else {
                // No terminal AND outside grace window — OC can handle non-terminal work
                const needsTerminal = detectComplexRequest(userText);
                if (needsTerminal) {
                  await sendTelegram('OC: That needs terminal — opening it now. Give me a minute.');
                  requestTerminal(`Complex request via Telegram: ${userText.slice(0, 100)}`);
                } else {
                  await apiReq('sendChatAction', { chat_id: CHAT_ID, action: 'typing' });
                  const reply = await askClaude(userText, 'telegram');
                  log(`Telegram OUT: "${reply.slice(0, 100)}..."`);
                  await sendTelegram(`OC: ${ocRandomOpener()} — ${reply}`);
                }
              }
            }
          } else if (msg && msg.text) {
            // ─── External User Routing → Pilot AI ─────────────────────────
            const extUserId = String(msg.from?.id);
            const extUserName = msg.from?.first_name || msg.from?.username || 'Unknown';
            const extChatId = String(msg.chat.id);
            const extText = msg.text.trim();

            log(`Telegram IN (external user ${extUserName}/${extUserId}): "${extText.slice(0, 100)}"`);

            // Notify Jasson on first contact from a new user
            if (!knownExternalTelegramUsers.has(extUserId)) {
              knownExternalTelegramUsers.add(extUserId);
              log(`New external Telegram user: ${extUserName} (${extUserId})`);
              try {
                await apiReq('sendMessage', { chat_id: CHAT_ID, text: `New user connected: ${extUserName} (${extUserId})` });
              } catch (e) { log(`Failed to notify Owner of new user: ${e.message}`); }
            }

            // Route to Pilot AI
            try {
              const pilotRes = await fetch(`${PILOT_SERVER_URL}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: extText }),
              });
              if (pilotRes.ok) {
                const pilotData = await pilotRes.json();
                const pilotReply = pilotData.reply || pilotData.response || pilotData.message || 'I received your message but couldn\'t generate a response.';
                // Send Pilot's reply back to the external user's chat
                try {
                  await apiReq('sendMessage', { chat_id: extChatId, text: pilotReply, parse_mode: 'Markdown' });
                } catch {
                  await apiReq('sendMessage', { chat_id: extChatId, text: pilotReply });
                }
                log(`Pilot reply sent to ${extUserName}/${extChatId}: "${String(pilotReply).slice(0, 100)}"`);
              } else {
                log(`Pilot server returned ${pilotRes.status} — sending fallback`);
                await apiReq('sendMessage', { chat_id: extChatId, text: 'Sorry, I\'m having trouble processing your request right now. Please try again shortly.' });
              }
            } catch (e) {
              log(`Pilot relay failed: ${e.message}`);
              await apiReq('sendMessage', { chat_id: extChatId, text: 'Sorry, I\'m temporarily unavailable. Please try again in a moment.' });
            }
          }
          telegramOffset = update.update_id + 1;
          try { writeFileSync(OFFSET_FILE, String(telegramOffset)); } catch {}
        }
      }
    } catch (err) {
      log(`Telegram poll error: ${err.message}`);
      addChannelError(state, 'telegram', err.message);
      updateChannelStatus(state, 'telegram', 'error');
      // Alert on OTHER channels
      sendIMessage(`[9] Telegram channel hit an error: ${err.message}. Still reachable on iMessage, email, and voice.`);
      saveState(state);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ─── Jules Handler (stub) ─────────────────────────────────────────────────────
// Jules is Jamie's personal AI assistant — a separate agent from 9/OC.
// This stub routes iMessages from Jamie to Jules when implemented.
// TODO: Replace stub with actual Jules Claude API call + response routing.
async function handleJulesMessage(msg) {
  log(`Jules message received from ${msg.handle}: "${msg.text.slice(0, 100)}"`);
  // STUB — actual Jules handler not yet implemented
  // When implemented: call Claude API with Jules system prompt, respond via iMessage
  log('Jules handler not yet implemented');
}

// ─── Pilot Relay — Routes Kyle C's "Pilot" iMessages to the pilot server ────
function sendIMessageToKyle(message) {
  if (VPS_MODE) { log('[vps-mode] iMessage to Kyle skipped (no osascript on Linux)'); return false; }
  try {
    const escaped = message.replace(/"/g, '\\"').replace(/'/g, "'\\''");
    execSync(`osascript -e 'tell application "Messages" to send "${escaped}" to buddy "${KYLEC_PHONE}" of service "iMessage"'`, { timeout: 10000 });
    log(`Pilot relay: iMessage sent to Kyle: "${message.slice(0, 100)}"`);
    return true;
  } catch (e) {
    log(`Pilot relay: iMessage send to Kyle failed — ${e.message}`);
    return false;
  }
}

async function relayToPilot(text, handle) {
  try {
    const res = await fetch(`${PILOT_SERVER_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const data = await res.json();
      const reply = data.reply || data.response || data.message || '';
      log(`Pilot relay: got response from pilot server (${reply.length} chars)`);

      if (reply) {
        sendIMessageToKyle(`[Pilot] ${reply}`);
      }
    } else {
      log(`Pilot relay: pilot server returned ${res.status}`);
    }
  } catch (e) {
    log(`Pilot relay error: ${e.message}`);
  }
}

// ─── CHANNEL 2: iMessage Monitor ─────────────────────────────────────────────
async function imessageMonitor() {
  const canRead = initImsgRowId();
  if (!canRead || lastImsgRowId === 0) {
    log('iMessage monitor: Read unavailable — running in SEND-ONLY mode (can still send alerts)');
    updateChannelStatus(state, 'imessage', 'send-only');
    saveState(state);
    return;
  }

  updateChannelStatus(state, 'imessage', 'active');
  saveState(state);
  log('iMessage monitor started');

  while (true) {
    try {
      const messages = checkNewIMessages();
      for (const msg of messages) {
        // ── Jules routing: if sender is Jamie, route to Jules handler ──
        if (JAMIE_PHONE && msg.handle && msg.handle.includes(JAMIE_PHONE.replace(/\D/g, '').slice(-10))) {
          log(`Jules message received — routing to Jules handler`);
          await handleJulesMessage(msg);
          continue; // Jules handles this — don't process as a 9/OC message
        }

        // ── Pilot routing: if sender is Kyle C and message starts with "Pilot", relay to pilot server ──
        if (KYLEC_PHONE && msg.handle && msg.handle.includes(KYLEC_PHONE.replace(/\D/g, '').slice(-10))) {
          if (/^pilot/i.test(msg.text)) {
            log(`Pilot message from Kyle: "${msg.text.slice(0, 100)}"`);
            await relayToPilot(msg.text, msg.handle);
          } else {
            log(`Kyle C iMessage ignored (no "Pilot" prefix): "${msg.text.slice(0, 60)}"`);
          }
          continue; // Kyle's messages don't go through 9/OC processing
        }

        log(`iMessage IN: "${msg.text}"`);
        addMessage(state, 'imessage', 'in', msg.text);
        try { if (db) db.logMessage('imessage', 'in', msg.text); } catch (e) { console.error('DB log failed:', e.message); }
        state.channels.imessage.messagesHandled++;
        updateChannelStatus(state, 'imessage', 'active');
        saveState(state);

        if (isTerminalActive()) {
          // Same responsive check as Telegram
          let terminalResponsive = true;
          try {
            if (existsSync('/tmp/9-incoming-message.jsonl')) {
              const lines = readFileSync('/tmp/9-incoming-message.jsonl', 'utf-8').trim().split('\n').filter(l => l);
              if (lines.length > 0) {
                const oldest = JSON.parse(lines[0]);
                if (Date.now() - new Date(oldest.timestamp).getTime() > 120000) terminalResponsive = false;
              }
            }
          } catch {}

          if (terminalResponsive) {
            sendIMessage('Got it — passing to terminal now.');
            log(`iMessage: message acknowledged and queued for terminal (relay mode)`);
            try {
              const alert = JSON.stringify({ channel: 'imessage', text: msg.text, timestamp: new Date().toISOString() });
              appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
            } catch {}
          } else {
            // Terminal alive but signal file stale — same relay lockdown rule as Telegram.
            // Terminal is still pinging (isTerminalActive() === true), so OC must NOT answer.
            if (isRelayLockdownActive('iMessage: terminal alive but unresponsive — signal file stale')) {
              sendIMessage(ocRelayDeferralMessage());
            } else {
              // Only reaches here if lockdown is explicitly disabled (OC_RELAY_LOCKDOWN=0)
              log('iMessage: terminal unresponsive — The Doorman responding');
              const doormanReply = await askDoorman(msg.text, 'imessage');
              sendIMessage(doormanReply);
            }
            // Always queue the message so terminal can pick it up when it resumes
            try {
              const alert = JSON.stringify({ channel: 'imessage', text: msg.text, timestamp: new Date().toISOString() });
              appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
            } catch {}
          }
        } else {
          // The Doorman handles iMessage when terminal is down
          requestTerminal(`iMessage received while terminal down: ${msg.text.slice(0, 100)}`);
          const doormanReply = await askDoorman(msg.text, 'imessage');
          log(`iMessage OUT (Doorman): "${doormanReply.slice(0, 100)}..."`);
          sendIMessage(doormanReply);
        }
      }
    } catch (e) {
      log(`iMessage monitor error: ${e.message}`);
      addChannelError(state, 'imessage', e.message);
      updateChannelStatus(state, 'imessage', 'error');
      sendTelegram(`OC: iMessage channel hit an error: ${e.message}. Still reachable on Telegram, email, and voice.`).catch(() => {});
      saveState(state);
    }
    await new Promise(r => setTimeout(r, 5000)); // Check every 5 seconds
  }
}

// ─── CHANNEL 3: Email Monitor (2-way) ───────────────────────────────────────
// Tracks emails we've already seen — dedup by subject + first 100 chars of body
// (subject-only dedup silently drops different emails with same subject, e.g. thread replies)
const processedEmailKeys = new Set();

async function emailMonitor() {
  updateChannelStatus(state, 'email', 'active');
  saveState(state);
  log('Email monitor started (2-way: read + respond)');

  while (true) {
    try {
      await new Promise(r => setTimeout(r, 60000)); // Check every 60 seconds
      const result = await checkNewEmails();
      if (result) {
        // Parse individual emails from the AppleScript output
        const emails = result.split('\n').filter(l => l.includes('SUBJECT:'));
        for (const emailLine of emails) {
          const subjectMatch = emailLine.match(/SUBJECT:(.+?)\|BODY:(.*)/);
          if (!subjectMatch) continue;

          const subject = subjectMatch[1].trim();
          const body = subjectMatch[2].trim();

          // Skip emails we've already processed (dedup by subject + body prefix)
          const dedupKey = `${subject}|${body.slice(0, 100)}`;
          if (processedEmailKeys.has(dedupKey)) continue;
          processedEmailKeys.add(dedupKey);

          // Keep set from growing unbounded
          if (processedEmailKeys.size > 200) {
            const first = processedEmailKeys.values().next().value;
            processedEmailKeys.delete(first);
          }

          // Skip our own outgoing emails (from 9/captain)
          if (subject.startsWith('[From 9]') || subject.startsWith('9 —')) continue;

          const userText = body || subject;
          log(`Email IN: "${subject}" — "${userText.slice(0, 200)}"`);
          addMessage(state, 'email', 'in', `[${subject}] ${userText.slice(0, 500)}`);
          try { if (db) db.logMessage('email', 'in', `[${subject}] ${userText.slice(0, 500)}`); } catch (e) { console.error('DB log failed:', e.message); }
          updateChannelStatus(state, 'email', 'active');
          state.channels.email.messagesHandled++;
          saveState(state);

          if (isTerminalActive()) {
            sendEmail(`Re: ${subject}`, 'Got it — passing to terminal now.');
            log('Email: message acknowledged and queued for terminal (relay mode)');
            try {
              const alert = JSON.stringify({ channel: 'email', text: `[${subject}] ${userText.slice(0, 300)}`, timestamp: new Date().toISOString() });
              appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
            } catch {}
          } else {
            // Autonomous mode — respond via email
            // The Doorman handles email when terminal is down
            requestTerminal(`Email received while terminal down: ${userText.slice(0, 100)}`);
            sendEmail(`Re: ${subject}`, 'Hey, this is The Doorman. 9 is currently offline. Your message has been received and queued. 9 will respond when he is back online. If you need to reach 9 urgently, try opening Terminal on the Mac and typing "claude".');
            log(`Email OUT (Doorman): Re: ${subject}`);
          }
        }
      }
    } catch (e) {
      log(`Email monitor error: ${e.message}`);
      // Alert on other channels if email keeps failing
      if (e.message && !e.message.includes('timeout')) {
        sendTelegram(`OC: Email channel error: ${e.message}. Still reachable on Telegram, iMessage, and voice.`).catch(() => {});
      }
    }
  }
}

// ─── CHANNEL 4: Voice Server Health Check ────────────────────────────────────
// ─── Voice + Tunnel Restart ───────────────────────────────────────────────────
function restartVoiceWithTunnel() {
  if (VPS_MODE) { log('[vps-mode] Voice/tunnel restart skipped (voice runs on Mac only)'); return; }
  log('Restarting voice server and tunnel...');
  try {
    // Kill old processes
    execSync('pkill -f voice-server 2>/dev/null; pkill -f cloudflared 2>/dev/null; sleep 2');

    // If using a named tunnel, use `cloudflared tunnel run` instead of quick-tunnel
    const tunnelType = (() => {
      try {
        const envC = readFileSync(envPath, 'utf-8');
        const m = envC.match(/TUNNEL_TYPE=(.*)/);
        return m ? m[1].trim() : 'quick';
      } catch { return 'quick'; }
    })();

    if (tunnelType === 'named') {
      const tunnelName = (() => {
        try {
          const envC = readFileSync(envPath, 'utf-8');
          const m = envC.match(/TUNNEL_NAME=(.*)/);
          return m ? m[1].trim() : '9-voice';
        } catch { return '9-voice'; }
      })();
      log(`Named tunnel mode — using 'cloudflared tunnel run ${tunnelName}'`);
      execSync(`nohup cloudflared tunnel --config ~/.cloudflared/9-voice-config.yml run "${tunnelName}" > /tmp/cloudflared.log 2>&1 &`);
      execSync('sleep 5');
      // Named tunnel URL is stable — read from .env, no update needed
      execSync(`nohup /opt/homebrew/bin/node ${PROJECT}/scripts/voice-server.mjs > /tmp/voice-server.log 2>&1 &`);
      log('Voice server restarted with named tunnel (stable URL — no Twilio update needed)');
      return;
    }

    // Start new quick tunnel, capture URL
    execSync('nohup cloudflared tunnel --url http://localhost:3456 --no-autoupdate > /tmp/cloudflared.log 2>&1 &');
    execSync('sleep 5'); // Wait for tunnel to establish

    // Get new tunnel URL
    const tunnelLog = readFileSync('/tmp/cloudflared.log', 'utf-8');
    const match = tunnelLog.match(/https:\/\/[a-z\-]+\.trycloudflare\.com/);
    if (match) {
      const newUrl = match[0];
      log(`New tunnel URL: ${newUrl}`);

      // Update .env
      const envContent = readFileSync(envPath, 'utf-8');
      const updated = envContent.replace(/TUNNEL_URL=.*/, `TUNNEL_URL=${newUrl}`);
      writeFileSync(envPath, updated);
      log('.env updated with new tunnel URL');

      // Auto-update Twilio webhook to new tunnel URL (fire-and-forget)
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      if (twilioSid && twilioToken) {
        const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`, {
          headers: { 'Authorization': authHeader },
        }).then(r => r.json()).then(data => {
          for (const pn of data.incoming_phone_numbers || []) {
            fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${pn.sid}.json`, {
              method: 'POST',
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `VoiceUrl=${encodeURIComponent(newUrl + '/voice')}&VoiceMethod=POST&StatusCallback=${encodeURIComponent(newUrl + '/status')}&StatusCallbackMethod=POST`,
            }).then(() => log(`Twilio webhook updated to ${newUrl}/voice for ${pn.phone_number}`))
              .catch(e => log(`Twilio webhook update failed for ${pn.phone_number}: ${e.message}`));
          }
        }).catch(e => log(`Twilio webhook update failed: ${e.message}`));
      }
    }

    // Start voice server (reads TUNNEL_URL from .env)
    execSync(`nohup /opt/homebrew/bin/node ${PROJECT}/scripts/voice-server.mjs > /tmp/voice-server.log 2>&1 &`);
    log('Voice server restart attempted with fresh tunnel');
  } catch (e) {
    log(`Voice+tunnel restart error: ${e.message}`);
  }
}

let voiceWasDown = false;

// ─── Tunnel Health State ────────────────────────────────────────────────────
let tunnelWasDown = false;
let tunnelLastRestartAttempt = 0;
const TUNNEL_RESTART_COOLDOWN = 120000; // 2 minutes minimum between restart attempts
let tunnelUptimeStart = Date.now();
let tunnelDowntimeTotal = 0;
let tunnelRestartCount = 0;
let tunnelLastChecked = null;
let tunnelConsecutiveFailures = 0;

async function voiceHealthCheck() {
  while (true) {
    try {
      const res = await fetch('http://localhost:3456/health');
      if (res.ok) {
        if (voiceWasDown) {
          log('Voice server recovered');
          sendTelegram('OC: Covering for 9. Voice line is back up. You can call (513) 957-3283.').catch(() => {});
          voiceWasDown = false;
        }
        updateChannelStatus(state, 'voice', 'active');
      } else {
        if (!voiceWasDown) {
          sendTelegram('OC: Covering for 9. Voice line went down. Restarting it now.').catch(() => {});
          voiceWasDown = true;
        }
        updateChannelStatus(state, 'voice', 'error');
        log('Voice server health check failed — attempting restart');
        try {
          restartVoiceWithTunnel();
        } catch (e) {
          log(`Voice restart failed: ${e.message}`);
          addChannelError(state, 'voice', e.message);
        }
      }
    } catch {
      if (!voiceWasDown) {
        sendTelegram('OC: Covering for 9. Voice line went down. Restarting it now.').catch(() => {});
        voiceWasDown = true;
      }
      updateChannelStatus(state, 'voice', 'down');
      try { restartVoiceWithTunnel(); } catch {}
    }
    saveState(state);
    await new Promise(r => setTimeout(r, 60000)); // Check every minute
  }
}

// ─── Heartbeat (every 30 minutes, on ALL channels) ──────────────────────────
setInterval(async () => {
  state.heartbeatCount++;
  const uptime = Math.round(state.heartbeatCount * 30);
  const uptimeHrs = Math.floor(uptime / 60);
  const uptimeMin = uptime % 60;
  const uptimeStr = uptimeHrs > 0 ? `${uptimeHrs}h ${uptimeMin}m` : `${uptimeMin}m`;

  const channelReport = Object.entries(state.channels)
    .map(([ch, s]) => `${ch}: ${s.status}`)
    .join(' | ');

  const mode = terminalActive ? 'Full power (terminal active)' : 'Autonomous (B-team)';

  // Resource usage summary
  const usageReport = Object.entries(resourceUsage)
    .filter(([, u]) => u.calls > 0)
    .map(([svc, u]) => {
      const elapsed = Math.max(1, (Date.now() - u.hourStart) / 3600000);
      const rate = Math.round(u.calls / elapsed);
      const threshold = BURN_RATE_THRESHOLDS[svc];
      const flag = rate > threshold ? ' !!!' : '';
      return `${svc}: ${u.calls} (${rate}/hr${flag})`;
    })
    .join(' | ');

  // Check actual service balances/quotas where API access exists
  let costAlerts = '';
  try {
    // Twilio balance check
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioToken) {
      const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
      const balRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Balance.json`, {
        headers: { 'Authorization': authHeader },
        signal: AbortSignal.timeout(5000),
      });
      if (balRes.ok) {
        const bal = await balRes.json();
        const balance = parseFloat(bal.balance);
        if (balance < 5) {
          costAlerts += `\nTwilio: $${balance.toFixed(2)} remaining — LOW`;
          if (balance < 2) {
            sendIMessage(`Twilio balance critically low: $${balance.toFixed(2)}. Voice and SMS will stop working soon. Add funds at twilio.com/console.`);
          }
        } else {
          costAlerts += `\nTwilio: $${balance.toFixed(2)}`;
        }
      }
    }
  } catch {}

  const heartbeat = `OC: Heartbeat #${state.heartbeatCount} | ${uptimeStr} uptime | ${mode}\n${channelReport}${usageReport ? `\nUsage: ${usageReport}` : ''}${costAlerts}`;

  // Only send heartbeat to Telegram when terminal is NOT active — no noise during active sessions
  if (!terminalActive) {
    await sendTelegram(heartbeat);
  }
  state.lastHeartbeat = new Date().toISOString();
  saveState(state);
  log(`Heartbeat #${state.heartbeatCount} ${terminalActive ? '(suppressed — terminal active)' : 'sent'}`);
}, 30 * 60 * 1000);

// ─── Battery Monitor ────────────────────────────────────────────────────────
// Checks every 60s. Alerts at 30%, 25%, 20%, 15%, 10%, 5%. Panic at 5%.
let batteryAlertsSent = new Set();
let lastBatteryCharging = null;

setInterval(() => {
  try {
    const raw = execSync('pmset -g batt', { timeout: 5000 }).toString();
    const pctMatch = raw.match(/(\d+)%/);
    const charging = raw.includes('charging') && !raw.includes('discharging');
    if (!pctMatch) return;
    const pct = parseInt(pctMatch[1]);

    // Reset alerts when charging detected
    if (charging && !lastBatteryCharging) {
      batteryAlertsSent.clear();
      log(`Battery: ${pct}% charging — alerts reset`);
    }
    lastBatteryCharging = charging;

    if (charging) return; // No alerts while charging

    const thresholds = [30, 25, 20, 15, 10, 5];
    for (const t of thresholds) {
      if (pct <= t && !batteryAlertsSent.has(t)) {
        batteryAlertsSent.add(t);
        const msg = t <= 5
          ? `🔴 BATTERY CRITICAL: ${pct}%! PLUG IN IMMEDIATELY! Everything will shut down soon!`
          : t <= 10
          ? `🟠 BATTERY LOW: ${pct}%! Plug in soon.`
          : `🟡 Battery: ${pct}% — not charging.`;
        log(`Battery alert: ${pct}% (threshold ${t}%)`);
        sendTelegram(msg).catch(() => {});
        if (t <= 5) {
          // Panic — all channels
          sendIMessage(`BATTERY CRITICAL: ${pct}%! Plug in the MacBook NOW!`);
          sendEmail('9 ALERT — Battery Critical', `MacBook battery at ${pct}%. Everything will shut down if not plugged in immediately.`, { from: '9enterprises' });
        }
      }
    }
  } catch {}
}, 60000);


// ─── Channel Health Check (every 5 minutes) ─────────────────────────────────
setInterval(checkChannelHealth, 5 * 60 * 1000);

// ─── API Health Probe (every 10 minutes) ─────────────────────────────────────
// Catches billing/key issues BEFORE a real message fails
let apiConsecutiveFailures = 0;
let apiAlertSent = false;

async function probeApiHealth() {
  try {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{ role: 'user', content: 'ok' }],
    });
    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY_TC,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ error: { message: 'parse error' } }); }
        });
      });
      req.on('error', (e) => resolve({ error: { message: e.message } }));
      req.write(body);
      req.end();
    });

    if (result.error) {
      apiConsecutiveFailures++;
      log(`API probe FAILED (${apiConsecutiveFailures}x): ${result.error.message}`);

      if (apiConsecutiveFailures >= 2 && !apiAlertSent) {
        // API is down — alert on ALL channels that don't need API
        sendIMessage(`[9 URGENT] Claude API is down: ${result.error.message}. I can't respond intelligently until this is fixed. Check billing at console.anthropic.com/settings/billing or check if the key is still valid.`);
        sendEmail('[9 URGENT] Claude API Down',
          `The Claude API has failed ${apiConsecutiveFailures} consecutive health checks.\n\nError: ${result.error.message}\n\nI can still receive your messages on all channels but cannot respond intelligently until the API is restored.\n\nCheck: console.anthropic.com/settings/billing\n\n— 9`,
          { from: '9enterprises' });
        // Telegram too (even though it uses API, the send function is just HTTP)
        sendTelegram(`OC: API is down: ${result.error.message}. I can receive messages but can't think. Check billing at console.anthropic.com/settings/billing`).catch(() => {});
        apiAlertSent = true;

        // Request terminal — might need manual intervention
        requestTerminal('Claude API down — may need manual key update or billing check');
      }
    } else {
      if (apiConsecutiveFailures > 0) {
        log(`API probe recovered after ${apiConsecutiveFailures} failures`);
        if (apiAlertSent) {
          sendTelegram('OC: Covering for 9. API is back online. Full capability restored.').catch(() => {});
          sendIMessage('Claude API recovered. Full capability restored.');
          apiAlertSent = false;
        }
      }
      apiConsecutiveFailures = 0;
    }
  } catch (e) {
    log(`API probe error: ${e.message}`);
  }
}

setInterval(probeApiHealth, 10 * 60 * 1000); // Every 10 minutes

// ─── Twilio URL Verification (every 5 min) ──────────────────────────────────
// Catches stale tunnel URLs before they cause missed calls
async function verifyTwilioUrl() {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  // Re-read .env for current tunnel URL (it changes on tunnel restart)
  let currentTunnel = process.env.TUNNEL_URL;
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const tunnelMatch = envContent.match(/TUNNEL_URL=(.*)/);
    if (tunnelMatch) currentTunnel = tunnelMatch[1].trim();
  } catch {}
  if (!twilioSid || !twilioToken || !currentTunnel) return;

  try {
    const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PageSize=50`, {
      headers: { 'Authorization': authHeader },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const data = await res.json();

    const tunnelHost = currentTunnel.replace('https://', '');
    for (const pn of data.incoming_phone_numbers || []) {
      // VOICE URL sync
      const twilioVoiceUrl = pn.voice_url || '';
      if (twilioVoiceUrl && !twilioVoiceUrl.includes(tunnelHost)) {
        log(`TWILIO VOICE URL MISMATCH on ${pn.phone_number}: Twilio has ${twilioVoiceUrl}, current tunnel is ${currentTunnel}`);
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${pn.sid}.json`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `VoiceUrl=${encodeURIComponent(currentTunnel + '/voice')}&VoiceMethod=POST&StatusCallback=${encodeURIComponent(currentTunnel + '/status')}&StatusCallbackMethod=POST`,
        });
        log(`Twilio voice URL auto-corrected on ${pn.phone_number} to ${currentTunnel}/voice`);
        sendTelegram(`9: Auto-fixed Twilio voice URL on ${pn.phone_number}. Was pointing to dead tunnel, now corrected.`).catch(() => {});
      }

      // SMS URL sync — only sync if currently set to a trycloudflare tunnel (skip empty + demo.twilio.com)
      const twilioSmsUrl = pn.sms_url || '';
      if (twilioSmsUrl && twilioSmsUrl.includes('trycloudflare.com') && !twilioSmsUrl.includes(tunnelHost)) {
        log(`TWILIO SMS URL MISMATCH on ${pn.phone_number}: Twilio has ${twilioSmsUrl}, current tunnel is ${currentTunnel}`);
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${pn.sid}.json`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `SmsUrl=${encodeURIComponent(currentTunnel + '/sms')}&SmsMethod=POST`,
        });
        log(`Twilio SMS URL auto-corrected on ${pn.phone_number} to ${currentTunnel}/sms`);
        sendTelegram(`9: Auto-fixed Twilio SMS URL on ${pn.phone_number}. Was pointing to dead tunnel, now corrected.`).catch(() => {});
      }
    }
  } catch (e) {
    if (!e.message?.includes('timeout')) log(`Twilio URL check error: ${e.message}`);
  }
}

setInterval(verifyTwilioUrl, 5 * 60 * 1000); // Every 5 minutes
setTimeout(verifyTwilioUrl, 30000); // Also check 30s after startup

// ─── Tunnel Health Monitor (every 60s) ──────────────────────────────────────
// Detects silent tunnel death and auto-restarts before anyone notices.
// The voice health check only checks localhost:3456 — this checks the PUBLIC tunnel.
async function tunnelHealthCheck() {
  tunnelLastChecked = new Date().toISOString();

  // Re-read .env for current tunnel URL (it changes on restart)
  let currentTunnel = process.env.TUNNEL_URL;
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const tunnelMatch = envContent.match(/TUNNEL_URL=(.*)/);
    if (tunnelMatch) currentTunnel = tunnelMatch[1].trim();
  } catch {}

  if (!currentTunnel) {
    log('Tunnel health check: no TUNNEL_URL configured, skipping');
    return;
  }

  try {
    const res = await fetch(`${currentTunnel}/health`, {
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      tunnelConsecutiveFailures = 0;
      if (tunnelWasDown) {
        // Recovery after previous failure
        const downtimeSecs = Math.round((Date.now() - (tunnelUptimeStart || Date.now())) / 1000);
        log(`TUNNEL RECOVERED after ${downtimeSecs}s downtime`);
        tunnelWasDown = false;
        tunnelUptimeStart = Date.now();
      }
    } else {
      tunnelConsecutiveFailures++;
      log(`Tunnel health check: HTTP ${res.status} from ${currentTunnel}/health (failure #${tunnelConsecutiveFailures})`);
      await handleTunnelFailure(currentTunnel);
    }
  } catch (e) {
    tunnelConsecutiveFailures++;
    log(`Tunnel health check failed: ${e.message} (failure #${tunnelConsecutiveFailures})`);
    await handleTunnelFailure(currentTunnel);
  }
}

async function handleTunnelFailure(currentTunnel) {
  // Only act on 2+ consecutive failures to avoid false positives from transient network blips
  if (tunnelConsecutiveFailures < 2) {
    log('Tunnel: single failure, will retry next cycle before acting');
    return;
  }

  const now = Date.now();
  const timeSinceLastRestart = now - tunnelLastRestartAttempt;

  if (!tunnelWasDown) {
    tunnelWasDown = true;
    tunnelDowntimeTotal++;
    sendTelegram('TUNNEL DOWN — voice calls will failover to Backup QB. Auto-restarting...').catch(() => {});
    log('TUNNEL DOWN — alerting and preparing restart');
  }

  // Cooldown check — don't rapid-fire restarts
  if (timeSinceLastRestart < TUNNEL_RESTART_COOLDOWN) {
    const waitSecs = Math.round((TUNNEL_RESTART_COOLDOWN - timeSinceLastRestart) / 1000);
    log(`Tunnel restart on cooldown — ${waitSecs}s remaining`);
    return;
  }

  tunnelLastRestartAttempt = now;
  tunnelRestartCount++;
  log(`Tunnel restart attempt #${tunnelRestartCount}`);

  try {
    // Kill only cloudflared (not voice server — it may still be healthy on localhost)
    try { execSync('pkill -f cloudflared 2>/dev/null'); } catch {}
    execSync('sleep 3'); // Let the process die cleanly

    // Start new tunnel
    execSync('nohup cloudflared tunnel --url http://localhost:3456 --no-autoupdate > /tmp/cloudflared.log 2>&1 &');
    execSync('sleep 6'); // Wait for tunnel to establish and log the URL

    // Get new tunnel URL from cloudflared logs
    const tunnelLog = readFileSync('/tmp/cloudflared.log', 'utf-8');
    const match = tunnelLog.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);

    if (match) {
      const newUrl = match[0];
      log(`New tunnel URL: ${newUrl}`);

      // Update .env
      const envContent = readFileSync(envPath, 'utf-8');
      const updated = envContent.replace(/TUNNEL_URL=.*/, `TUNNEL_URL=${newUrl}`);
      writeFileSync(envPath, updated);
      process.env.TUNNEL_URL = newUrl;
      log('.env updated with new tunnel URL');

      // Restart voice server so it picks up new TUNNEL_URL
      try { execSync('pkill -f voice-server 2>/dev/null'); } catch {}
      execSync('sleep 2');
      execSync(`nohup /opt/homebrew/bin/node ${PROJECT}/scripts/voice-server.mjs > /tmp/voice-server.log 2>&1 &`);
      log('Voice server restarted with new tunnel URL');

      // Auto-update Twilio webhook to new tunnel URL
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      if (twilioSid && twilioToken) {
        const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`, {
          headers: { 'Authorization': authHeader },
        }).then(r => r.json()).then(data => {
          for (const pn of data.incoming_phone_numbers || []) {
            fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${pn.sid}.json`, {
              method: 'POST',
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `VoiceUrl=${encodeURIComponent(newUrl + '/voice')}&VoiceMethod=POST&StatusCallback=${encodeURIComponent(newUrl + '/status')}&StatusCallbackMethod=POST`,
            }).then(() => log(`Twilio webhook updated to ${newUrl}/voice for ${pn.phone_number}`))
              .catch(e => log(`Twilio webhook update failed for ${pn.phone_number}: ${e.message}`));
          }
        }).catch(e => log(`Twilio webhook update failed: ${e.message}`));
      }

      // Verify the new tunnel is actually working
      await new Promise(r => setTimeout(r, 3000));
      try {
        const verifyRes = await fetch(`${newUrl}/health`, { signal: AbortSignal.timeout(10000) });
        if (verifyRes.ok) {
          tunnelWasDown = false;
          tunnelConsecutiveFailures = 0;
          tunnelUptimeStart = Date.now();
          log('TUNNEL RESTORED — verified healthy');
          sendTelegram(`TUNNEL RESTORED — voice calls are live again. New URL: ${newUrl}`).catch(() => {});
        } else {
          log(`Tunnel restart: new URL returned HTTP ${verifyRes.status} — may need another cycle`);
        }
      } catch (e) {
        log(`Tunnel restart: verification failed (${e.message}) — will retry next cycle`);
      }
    } else {
      log('Tunnel restart: could not capture new URL from cloudflared logs');
      // Log the actual output for debugging
      try { log(`cloudflared log contents: ${tunnelLog.slice(0, 500)}`); } catch {}
    }
  } catch (e) {
    log(`Tunnel restart error: ${e.message}`);
  }
}

setInterval(tunnelHealthCheck, 60000); // Every 60 seconds
setTimeout(tunnelHealthCheck, 15000);  // First check 15s after startup

// ─── Network Change Detector (WiFi switch → force tunnel rebuild) ───────────
// When MacBook moves between WiFi networks, cloudflared hangs on a stale
// connection instead of reconnecting. This detects the network change by
// polling the default gateway IP every 30s. On change → kill cloudflared
// immediately so tunnelHealthCheck rebuilds with a fresh connection.
let lastGatewayIP = null;
let lastNetworkInterfaces = null;

function getNetworkFingerprint() {
  try {
    // Get default gateway — changes when WiFi network changes
    const gateway = execSync("route -n get default 2>/dev/null | awk '/gateway:/{print $2}'", { encoding: 'utf-8', timeout: 3000 }).trim();
    // Also get active network interface IPs as secondary signal
    const ifconfig = execSync("ifconfig | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $2}' | sort | head -5", { encoding: 'utf-8', timeout: 3000 }).trim();
    return { gateway, interfaces: ifconfig };
  } catch {
    return null;
  }
}

// Capture initial network state
const initialNetwork = getNetworkFingerprint();
if (initialNetwork) {
  lastGatewayIP = initialNetwork.gateway;
  lastNetworkInterfaces = initialNetwork.interfaces;
  log(`Network baseline: gateway=${lastGatewayIP}, interfaces=${lastNetworkInterfaces}`);
}

setInterval(() => {
  const current = getNetworkFingerprint();
  if (!current || !lastGatewayIP) {
    // First run or can't read network — just store and move on
    if (current) {
      lastGatewayIP = current.gateway;
      lastNetworkInterfaces = current.interfaces;
    }
    return;
  }

  const gatewayChanged = current.gateway !== lastGatewayIP;
  const interfacesChanged = current.interfaces !== lastNetworkInterfaces;

  if (gatewayChanged || interfacesChanged) {
    log(`NETWORK CHANGE DETECTED: gateway ${lastGatewayIP} → ${current.gateway}, interfaces changed: ${interfacesChanged}`);
    lastGatewayIP = current.gateway;
    lastNetworkInterfaces = current.interfaces;

    // Force-kill cloudflared immediately — stale connections won't recover on their own
    try { execSync('pkill -f cloudflared 2>/dev/null'); } catch {}
    log('Killed cloudflared after network change — tunnelHealthCheck will rebuild');

    // Reset tunnel state so the next health check treats this as a fresh failure
    tunnelConsecutiveFailures = 2; // Skip the "single failure, will retry" grace
    tunnelLastRestartAttempt = 0;  // Clear cooldown so restart happens immediately
    tunnelWasDown = true;
    tunnelDowntimeTotal++;

    // Trigger immediate tunnel rebuild instead of waiting for next 60s cycle
    setTimeout(() => {
      log('Network change: triggering immediate tunnel rebuild');
      tunnelHealthCheck().catch(e => log(`Network change tunnel rebuild error: ${e.message}`));
    }, 5000); // 5s delay for network to stabilize after switch
  }
}, 30000); // Check every 30 seconds

// ─── Service Efficiency Sweep (every 2 hours) ───────────────────────────────
// Checks all third-party service quotas/balances and alerts before limits hit
async function efficiencySweep() {
  const alerts = [];

  // Twilio balance
  try {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioToken) {
      const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Balance.json`, {
        headers: { 'Authorization': authHeader },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const bal = await res.json();
        const balance = parseFloat(bal.balance);
        if (balance < 2) alerts.push(`CRITICAL: Twilio balance $${balance.toFixed(2)} — voice/SMS will stop soon`);
        else if (balance < 5) alerts.push(`WARNING: Twilio balance $${balance.toFixed(2)} — getting low`);
      }
    }
  } catch {}

  // ElevenLabs quota
  try {
    const elKey = process.env.ELEVENLABS_API_KEY;
    if (elKey) {
      const res = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': elKey },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        const sub = data.subscription || {};
        const used = sub.character_count || 0;
        const limit = sub.character_limit || 1;
        const pct = Math.round(used / limit * 100);
        if (pct > 90) alerts.push(`CRITICAL: ElevenLabs at ${pct}% (${used.toLocaleString()}/${limit.toLocaleString()} chars)`);
        else if (pct > 75) alerts.push(`WARNING: ElevenLabs at ${pct}% usage`);
      }
    }
  } catch {}

  // Disk space
  try {
    const df = execSync('df -h / | tail -1', { encoding: 'utf-8' });
    const match = df.match(/(\d+)%/);
    if (match && parseInt(match[1]) > 90) {
      alerts.push(`WARNING: Disk ${match[1]}% full`);
    }
  } catch {}

  // Log file size
  try {
    const logSize = readFileSync(LOG_FILE).length;
    if (logSize > 500000) { // 500KB
      alerts.push(`INFO: Log file at ${Math.round(logSize/1024)}KB — rotation will trim at 1MB`);
    }
  } catch {}

  // Process memory check
  try {
    const ps = execSync('ps aux | grep comms-hub | grep -v grep | awk \'{print $6}\'', { encoding: 'utf-8' });
    const rssKb = parseInt(ps.trim());
    if (rssKb > 200000) { // 200MB
      alerts.push(`WARNING: Hub process memory at ${Math.round(rssKb/1024)}MB — possible leak`);
    }
  } catch {}

  if (alerts.length > 0) {
    const report = `Efficiency sweep found ${alerts.length} issue(s):\n${alerts.map(a => `• ${a}`).join('\n')}`;
    log(report);
    sendTelegram('OC: Covering for 9.' + report).catch(() => {});
    if (alerts.some(a => a.startsWith('CRITICAL'))) {
      sendIMessage(report);
    }
  } else {
    log('Efficiency sweep: all services within normal limits');
  }
}

setInterval(efficiencySweep, 2 * 60 * 60 * 1000); // Every 2 hours
setTimeout(efficiencySweep, 60000); // Run 1 minute after startup

// ─── FDA Watchdog (check iMessage access on startup and every 30 min) ────────
// VPS_MODE: iMessage DB does not exist on Linux. Always returns false, watchdog is a no-op.
function checkFdaAccess() {
  if (VPS_MODE) return false;
  try {
    execSync(`sqlite3 "${IMSG_DB}" "SELECT 1;" 2>&1`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

let fdaWasWorking = null;

function fdaWatchdog() {
  const hasAccess = checkFdaAccess();

  if (fdaWasWorking === null) {
    fdaWasWorking = hasAccess;
    log(`FDA check: iMessage DB access ${hasAccess ? 'AVAILABLE' : 'DENIED'}`);
    return;
  }

  if (fdaWasWorking && !hasAccess) {
    // Lost FDA — probably macOS update or permission revoke
    log('FDA LOST — iMessage read no longer available');
    sendTelegram('OC: Covering for 9. iMessage read access was lost — possibly from a macOS update. iMessage is now send-only. I need you to re-grant Full Disk Access to Terminal: System Settings > Privacy & Security > Full Disk Access > toggle Terminal off and back on. Then restart terminal.').catch(() => {});
    updateChannelStatus(state, 'imessage', 'send-only');
    fdaWasWorking = false;
  } else if (!fdaWasWorking && hasAccess) {
    log('FDA restored — iMessage read available again');
    sendTelegram('OC: Covering for 9. iMessage read access restored. Two-way iMessage is back.').catch(() => {});
    updateChannelStatus(state, 'imessage', 'active');
    fdaWasWorking = true;
  }
  saveState(state);
}

setInterval(fdaWatchdog, 30 * 60 * 1000); // Every 30 minutes

// ─── Reboot Detection ────────────────────────────────────────────────────────
function checkIfRecentReboot() {
  if (VPS_MODE) {
    // Linux: use /proc/uptime instead of macOS sysctl
    try {
      const upSec = parseFloat(readFileSync('/proc/uptime', 'utf-8').split(' ')[0]);
      if (upSec < 600) { log(`REBOOT DETECTED — VPS booted ${Math.round(upSec / 60)} minutes ago`); return true; }
    } catch {}
    return false;
  }
  try {
    const uptime = execSync('sysctl -n kern.boottime', { encoding: 'utf-8' });
    const match = uptime.match(/sec = (\d+)/);
    if (match) {
      const bootTime = parseInt(match[1]) * 1000;
      const timeSinceBoot = Date.now() - bootTime;
      const minutesSinceBoot = timeSinceBoot / 60000;

      if (minutesSinceBoot < 10) {
        log(`REBOOT DETECTED — Mac booted ${Math.round(minutesSinceBoot)} minutes ago`);
        return true;
      }
    }
  } catch {}
  return false;
}

// ─── Log Rotation (keep logs under 1MB) ──────────────────────────────────────
function rotateLog() {
  try {
    const stats = existsSync(LOG_FILE) ? readFileSync(LOG_FILE).length : 0;
    if (stats > 1024 * 1024) {
      const content = readFileSync(LOG_FILE, 'utf-8');
      // Keep last 200KB
      writeFileSync(LOG_FILE, content.slice(-200000));
      log('Log rotated — trimmed to last 200KB');
    }
  } catch {}
}

setInterval(rotateLog, 60 * 60 * 1000); // Every hour

// ─── Startup Self-Check & Report ─────────────────────────────────────────────
async function startupSelfCheck() {
  const issues = [];
  const status = [];

  // Check reboot
  const recentReboot = checkIfRecentReboot();
  if (recentReboot) {
    issues.push('Mac recently rebooted — tunnel URL will be stale, voice server may need restart');
    // Auto-fix: restart voice with fresh tunnel
    try {
      restartVoiceWithTunnel();
      status.push('Voice + tunnel: restarted with fresh URL');
    } catch (e) {
      issues.push(`Voice restart failed: ${e.message}`);
    }
  }

  // Check API
  const apiBody = JSON.stringify({
    model: 'claude-haiku-4-5-20251001', max_tokens: 5,
    messages: [{ role: 'user', content: 'ok' }],
  });
  const apiOk = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY_TC,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(apiBody),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(!JSON.parse(d).error); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.write(apiBody);
    req.end();
  });
  if (apiOk) {
    status.push('API: healthy');
  } else {
    issues.push('Claude API is NOT responding — check billing or key');
  }

  // Check FDA (macOS only)
  if (!VPS_MODE) {
    const hasFda = checkFdaAccess();
    fdaWasWorking = hasFda;
    if (hasFda) {
      status.push('iMessage: two-way (FDA granted)');
    } else {
      status.push('iMessage: send-only (no FDA)');
      if (!recentReboot) issues.push('iMessage read access denied — may need FDA re-grant');
    }
  } else {
    status.push('iMessage: disabled (VPS mode)');
  }

  // Check voice (macOS only — voice server runs on Mac)
  if (!VPS_MODE) {
    try {
      const vRes = await fetch('http://localhost:3456/health');
      if (vRes.ok) {
        status.push('Voice: active');
      } else {
        issues.push('Voice server not healthy');
      }
    } catch {
      status.push('Voice: down');
      issues.push('Voice server not running');
      if (!recentReboot) {
        try { restartVoiceWithTunnel(); status.push('Voice: restart attempted'); } catch {}
      }
    }
  } else {
    status.push('Voice: N/A (VPS mode — voice runs on Mac)');
  }

  // Check tunnel
  try {
    const tunnelUrl = process.env.TUNNEL_URL;
    const tRes = await fetch(`${tunnelUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (tRes.ok) {
      status.push('Tunnel: routing');
    } else {
      issues.push('Tunnel not routing to voice server');
    }
  } catch {
    issues.push('Tunnel unreachable — voice calls will not work');
  }

  // Check health-monitor (sibling monitor watchdog)
  try {
    const hmRes = await fetch('http://localhost:3458/health', { signal: AbortSignal.timeout(5000) });
    if (hmRes.ok) {
      status.push('Health monitor: running');
    } else {
      issues.push('Health monitor returned non-OK status');
      // DISABLED: alerts route to team, not Owner's Telegram (Apr 8 directive)
      log('[9 watchdog] health-monitor not healthy — logged only, not sent to Telegram');
    }
  } catch {
    issues.push('Health monitor not running (port 3458 unreachable)');
    log('Health monitor not running at startup — LaunchAgent should restart it');
    // Alert Owner that the monitor itself is down
    // DISABLED: alerts route to team, not Owner's Telegram (Apr 8 directive)
    log('[9 watchdog] health-monitor not running — logged only, not sent to Telegram');
  }

  // Report
  log('=== STARTUP SELF-CHECK ===');
  status.forEach(s => log(`  OK: ${s}`));
  issues.forEach(i => log(`  ISSUE: ${i}`));

  const report = [
    '9 Comms Hub starting up.',
    '',
    ...status.map(s => `• ${s}`),
    ...(issues.length > 0 ? ['', 'Issues found:', ...issues.map(i => `• ${i}`)] : []),
  ].join('\n');

  return { report, issues, recentReboot };
}

// ─── Cloud Sync — Push state to cloud standin every 60 seconds ──────────────
const CLOUD_WORKER_URL = process.env.CLOUD_WORKER_URL; // Set after deploying worker

async function syncToCloud() {
  if (!CLOUD_WORKER_URL) return;
  trackUsage('cloudSync');
  try {
    // Send richer state so Backup QB can hold a real conversation, not just voicemail
    const payload = JSON.stringify({
      state: {
        channels: state.channels,
        recentMessages: state.recentMessages.slice(-40), // Was 20 — Backup QB needs more context
        sessionContext: state.sessionContext,
        terminalActive,
        tunnel: {
          status: tunnelWasDown ? 'down' : 'healthy',
          restartCount: tunnelRestartCount,
          consecutiveFailures: tunnelConsecutiveFailures,
        },
      },
      conversationHistory: state.conversationHistory,
      memoryContext: memoryContext,
    });

    const cloudSecret = process.env.CLOUD_SECRET || '';
    const headers = { 'Content-Type': 'application/json' };
    if (cloudSecret) headers['x-cloud-secret'] = cloudSecret;

    const res = await fetch(`${CLOUD_WORKER_URL}/heartbeat`, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      // If cloud collected messages while Mac was down, ingest them
      if (data.queuedMessages?.length > 0) {
        log(`Cloud sync: received ${data.queuedMessages.length} queued messages from cloud`);
        for (const msg of data.queuedMessages) {
          if (msg.text && !msg.cloudResponse) {
            // Messages that cloud didn't respond to (complex requests)
            addMessage(state, msg.channel || 'telegram', 'in', msg.text);
          }
          if (msg.needsTerminal) {
            log(`Cloud queued terminal request: ${msg.text?.slice(0, 100)}`);
          }
        }
        saveState(state);
      }
    }
  } catch (e) {
    // Cloud sync is best-effort — don't log every failure
    if (e.message && !e.message.includes('timeout') && !e.message.includes('fetch failed')) {
      log(`Cloud sync error: ${e.message}`);
    }
  }
}

// Sync every 60 seconds
setInterval(syncToCloud, 120000); // Every 2 min (faster cloud failover detection; ~720 KV writes/day, within free tier 1K/day limit)
// Initial sync on startup (delayed 10s to let everything initialize)
setTimeout(syncToCloud, 10000);

// ─── Health Monitor Watchdog ─────────────────────────────────────────────────
// Checks every 5 minutes that health-monitor.mjs is alive on port 3458.
// If it's dead, alerts Owner immediately. LaunchAgent should auto-restart it,
// but this alert closes the gap between death and restart detection.
let _hmWatchdogLastAlert = 0;
async function healthMonitorWatchdog() {
  try {
    const res = await fetch('http://localhost:3458/health', { signal: AbortSignal.timeout(5000) });
    if (res.ok) return; // All good
    // Non-OK response
    if (Date.now() - _hmWatchdogLastAlert > 3600000) { // 1 hr cooldown
      sendTelegram('[9 watchdog] health-monitor returned non-OK. LaunchAgent should restart it. Checking again in 5 min.').catch(() => {});
      _hmWatchdogLastAlert = Date.now();
    }
  } catch {
    // Port unreachable — monitor is down
    if (Date.now() - _hmWatchdogLastAlert > 3600000) {
      log('Health monitor watchdog: port 3458 unreachable — monitor is down');
      sendTelegram('[9 watchdog] ALERT: health-monitor is DOWN (port 3458 unreachable). Real-time health data offline. LaunchAgent auto-restarting.').catch(() => {});
      _hmWatchdogLastAlert = Date.now();
    }
  }
}

setInterval(healthMonitorWatchdog, 300000); // Every 5 min
setTimeout(healthMonitorWatchdog, 60000);   // First check 60s after hub starts

// ─── Graceful shutdown ───────────────────────────────────────────────────────
function shutdown(signal) {
  log(`${signal} received — saving state and shutting down`);
  state.channels.telegram.status = 'shutdown';
  state.channels.imessage.status = 'shutdown';
  state.channels.email.status = 'shutdown';
  saveState(state);

  // Last gasp: tell cloud we're going down so it takes over immediately
  if (CLOUD_WORKER_URL) {
    try {
      const cloudSecret = process.env.CLOUD_SECRET || '';
      const headers = { 'Content-Type': 'application/json' };
      if (cloudSecret) headers['x-cloud-secret'] = cloudSecret;
      fetch(`${CLOUD_WORKER_URL}/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: { channels: state.channels }, intentionalShutdown: true }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    } catch {}
  }

  // Give the last-gasp fetch a moment to complete before exiting
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Prevent a single uncaught exception from killing all 4 channels
// IMPORTANT: Do NOT call sendTelegram here — EPIPE errors from Telegram API
// would trigger this handler, which calls sendTelegram, which triggers EPIPE again = infinite loop
let lastExceptionTime = 0;
process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  const now = Date.now();
  // Rate limit: max one log per second to prevent spam
  if (now - lastExceptionTime < 1000) return;
  lastExceptionTime = now;
  log(`UNCAUGHT EXCEPTION (hub survived): ${err.message}`);
  // Use iMessage instead of Telegram to avoid EPIPE loops (macOS only)
  if (!err.message.includes('EPIPE') && !VPS_MODE) {
    sendIMessage(`Hub caught an exception: ${err.message}. Still running.`);
  }
});
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  log(`UNHANDLED REJECTION (hub survived): ${reason}`);
});

// ─── LAUNCH ALL CHANNELS ────────────────────────────────────────────────────
log('═══════════════════════════════════════════════════');
log('  9 — Unified Communications Hub v1.0');
log('  Channels: Telegram | iMessage | Email | Voice');
log('═══════════════════════════════════════════════════');

// Clear stale webhooks, run self-check, sync from cloud, then start all channels
apiReq('deleteWebhook').then(async () => {
  log('Telegram webhook cleared — polling mode');

  // Pull state from cloud — see what happened while we were down
  if (CLOUD_WORKER_URL) {
    try {
      const cloudRes = await fetch(`${CLOUD_WORKER_URL}/state`, { signal: AbortSignal.timeout(10000) });
      if (cloudRes.ok) {
        const cloudData = await cloudRes.json();
        if (cloudData.queuedMessages?.length > 0) {
          log(`Cloud recovery: ${cloudData.queuedMessages.length} messages collected while Mac was down`);
          for (const msg of cloudData.queuedMessages) {
            addMessage(state, msg.channel || 'telegram', 'in', msg.text || '');
            if (msg.needsTerminal) {
              log(`Cloud queued work: ${msg.text?.slice(0, 200)}`);
            }
          }
          saveState(state);
        }
        // Cloud conversation history sync DISABLED — stale history causes OC to replay
        // old conversations. OC builds context fresh each session. (March 25 2026 fix)
        if (cloudData.conversationHistory?.length > 0) {
          log('Cloud conversation history available but NOT merged (disabled to prevent stale replay)');
        }
      }
    } catch (e) {
      log(`Cloud state pull skipped: ${e.message}`);
    }
  }

  // Run startup self-check first
  const { report, issues, recentReboot } = await startupSelfCheck();

  // Launch all channels simultaneously
  telegramPoll().catch(e => log(`Telegram fatal: ${e.message}`));
  if (!VPS_MODE) {
    imessageMonitor().catch(e => log(`iMessage fatal: ${e.message}`));
    voiceHealthCheck().catch(e => log(`Voice health fatal: ${e.message}`));
  } else {
    log('[vps-mode] iMessage monitor and voice health check SKIPPED');
    updateChannelStatus(state, 'imessage', 'disabled-vps');
  }
  emailMonitor().catch(e => log(`Email fatal: ${e.message}`));

  log('All channels launched');

  // Run first API probe immediately
  probeApiHealth().catch(() => {});

  // Run FDA watchdog immediately (macOS only)
  if (!VPS_MODE) fdaWatchdog();

  // Send startup report
  await sendTelegram('OC: Covering for 9.' + report).catch(() => {});

  // If there were issues, also alert via iMessage
  if (issues.length > 0) {
    sendIMessage(`9 Hub started with ${issues.length} issue(s): ${issues.join('; ')}`);
  }
});
