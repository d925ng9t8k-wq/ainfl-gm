#!/usr/bin/env node
/**
 * tick-engine.mjs
 * KAIROS-clone idle-wake engine for Claude Code.
 *
 * Problem: The PostToolUse hook only fires on tool calls. When Claude is idle
 * (composing a reply, waiting for input), no hook fires, inbound messages pile
 * up in the signal file unread. Owner experiences this as the AI ignoring them.
 *
 * Solution: This daemon monitors Claude Code liveness every 15s. If Claude is
 * alive but has not made a tool call in >30s AND the signal file has unread
 * messages, it sends a keystroke to Terminal to force a wake.
 *
 * Health endpoint: GET http://127.0.0.1:3496/health
 * Logs: logs/tick-engine.log
 */

import { existsSync, readFileSync, appendFileSync, statSync, mkdirSync, openSync, readSync, closeSync } from 'fs';
import { execSync } from 'child_process';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');

// --- Config ---
// Tuned Apr 10 late night for Phase 1 gold-standard floor: sub-10s delivery during text generation.
// Prior defaults (30s idle / 20s backoff / 5min cap) produced 30-60s worst-case delays.
// New targets: 8s idle threshold, 4s backoff start, 30s backoff cap, 3s check interval.
const CHECK_INTERVAL_MS     = 3_000;   // Check every 3s (was 15s)
const IDLE_THRESHOLD_MS     = 8_000;   // >8s without tool call = idle (was 30s)
const QUIET_THRESHOLD_MS    = 600_000; // >10min idle + empty signal = back off
const QUIET_INTERVAL_MS     = 60_000;  // Back-off poll interval
const NUDGE_BACKOFF_START   = 4_000;   // First nudge at 4s (was 20s)
const NUDGE_BACKOFF_MAX     = 30_000;  // Cap at 30s (was 5min)
const HUB_LOG_RECENCY_MS    = 10_000;  // If hub nudged in last 10s, skip (was 15s)
const PORT                  = 3496;

// --- Paths ---
const LOG_FILE          = path.join(PROJECT, 'logs/tick-engine.log');
const SIGNAL_FILE       = '/tmp/9-incoming-message.jsonl';
const LAST_TOOL_CALL    = '/tmp/9-last-tool-call';
const TERMINAL_PING_PID = '/tmp/terminal-ping.pid';
const HUB_LOG           = path.join(PROJECT, 'logs/comms-hub.log');

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// --- State ---
let nudgeBackoffMs      = NUDGE_BACKOFF_START;
let lastNudgeAt         = 0;
let nudgeCount          = 0;
let wakeCount           = 0;
let lastCheckAt         = null;
let idleStatus          = false;
let quietMode           = false;
let consecutiveIdleCycles = 0;
let startedAt           = new Date().toISOString();

// --- Logging ---
function log(msg) {
  const line = `[${new Date().toISOString()}] TICK: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// --- Read a file safely, return null on error ---
function safeRead(filePath) {
  try { return readFileSync(filePath, 'utf8').trim(); } catch { return null; }
}

// --- Is Claude Code PID alive? ---
function getClaudePid() {
  const pidStr = safeRead(TERMINAL_PING_PID);
  if (!pidStr) return null;
  // The file may contain just a PID or multiple lines — grab first numeric token
  const pid = parseInt(pidStr.split('\n')[0].trim(), 10);
  return isNaN(pid) ? null : pid;
}

function isPidAlive(pid) {
  try { execSync(`kill -0 ${pid}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// --- How long since last tool call? (seconds written by check-messages.sh) ---
function msSinceLastToolCall() {
  const epochStr = safeRead(LAST_TOOL_CALL);
  if (!epochStr) return Infinity;
  const epoch = parseInt(epochStr, 10);
  if (isNaN(epoch)) return Infinity;
  return Date.now() - epoch * 1000;
}

// --- Does the signal file have unread messages? ---
function signalFileHasMessages() {
  try {
    if (!existsSync(SIGNAL_FILE)) return false;
    const stat = statSync(SIGNAL_FILE);
    return stat.size > 0;
  } catch { return false; }
}

// --- Did comms-hub already nudge recently? Check last lines of hub log. ---
function hubNudgedRecently() {
  try {
    if (!existsSync(HUB_LOG)) return false;
    // Read last 4KB of hub log — enough for recent entries without loading the whole file
    const stat = statSync(HUB_LOG);
    const size = stat.size;
    const readSize = Math.min(4096, size);
    const buf = Buffer.alloc(readSize);
    const fd = openSync(HUB_LOG, 'r');
    readSync(fd, buf, 0, readSize, size - readSize);
    closeSync(fd);
    const tail = buf.toString('utf8');
    // Look for a NUDGE entry within the last HUB_LOG_RECENCY_MS
    const nudgeRe = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\]]*)\].*NUDGE/g;
    let match;
    const now = Date.now();
    while ((match = nudgeRe.exec(tail)) !== null) {
      const ts = new Date(match[1]).getTime();
      if (!isNaN(ts) && now - ts < HUB_LOG_RECENCY_MS) return true;
    }
    return false;
  } catch { return false; }
}

// --- Send wake keystroke to Terminal via AppleScript ---
// FIX (Apr 10 late night): target `tell process "Terminal"` directly without activate.
// Prior version used `tell application "Terminal" to activate` which requires macOS to let
// Terminal steal focus. Under focus-stealing restrictions (when Grok or another app has been
// foreground recently), activate silently fails and keystrokes land in the wrong app.
// Targeting the process via System Events should work regardless of focus state.
function sendWakeKeystroke() {
  try {
    execSync(
      `osascript -e 'tell application "System Events" to tell process "Terminal" to keystroke return'`,
      { timeout: 5000, stdio: 'ignore' }
    );
    return true;
  } catch (e) {
    log(`Wake keystroke (primary tell-process) failed: ${e.message}`);
    // Fallback: try the old activate+keystroke pattern in case tell-process requires permissions we don't have
    try {
      execSync(
        `osascript -e 'tell application "Terminal" to activate' -e 'tell application "System Events" to keystroke return'`,
        { timeout: 5000, stdio: 'ignore' }
      );
      log('Fallback wake keystroke (activate+keystroke) succeeded');
      return true;
    } catch (e2) {
      log(`Fallback keystroke also failed: ${e2.message}`);
      return false;
    }
  }
}

// --- Main check cycle ---
async function runCheck() {
  lastCheckAt = new Date().toISOString();

  // 1. Get Claude PID from ping file
  const claudePid = getClaudePid();

  if (!claudePid) {
    if (idleStatus) {
      log('Claude PID file missing — Claude may not be running. Standby.');
      idleStatus = false;
    }
    // Not idle — nothing to wake. Stay quiet.
    return;
  }

  // 2. Verify PID is alive
  if (!isPidAlive(claudePid)) {
    log(`Claude PID ${claudePid} is DEAD — stopping nudges.`);
    idleStatus = false;
    return;
  }

  // 3. Check time since last tool call
  const msSinceTool = msSinceLastToolCall();
  const hasMessages  = signalFileHasMessages();

  // 4. Quiet-mode: Claude alive, no messages, idle >10min → back off
  if (msSinceTool > QUIET_THRESHOLD_MS && !hasMessages) {
    if (!quietMode) {
      log(`Quiet mode: Claude idle ${Math.round(msSinceTool/1000)}s, signal file empty. Backing off to ${QUIET_INTERVAL_MS/1000}s checks.`);
      quietMode = true;
    }
    idleStatus = false;
    return;
  }

  // If we were in quiet mode but now have messages or recent activity, exit it
  if (quietMode) {
    log('Exiting quiet mode — messages detected or recent activity.');
    quietMode = false;
  }

  // 5. Determine idle state: alive + no tool call in >30s + messages waiting
  const isIdle = msSinceTool > IDLE_THRESHOLD_MS && hasMessages;
  idleStatus = isIdle;

  if (!isIdle) {
    // Claude is active or no messages pending
    if (nudgeBackoffMs !== NUDGE_BACKOFF_START && msSinceTool < IDLE_THRESHOLD_MS) {
      log(`Claude active (last tool call ${Math.round(msSinceTool/1000)}s ago) — resetting nudge backoff.`);
      nudgeBackoffMs = NUDGE_BACKOFF_START;
      consecutiveIdleCycles = 0;
    }
    return;
  }

  consecutiveIdleCycles++;

  // 6. Respect nudge backoff — don't nudge too fast
  const msSinceLastNudge = Date.now() - lastNudgeAt;
  if (lastNudgeAt > 0 && msSinceLastNudge < nudgeBackoffMs) {
    log(`Idle detected (${Math.round(msSinceTool/1000)}s, ${consecutiveIdleCycles} cycles) — backoff ${Math.round((nudgeBackoffMs - msSinceLastNudge)/1000)}s remaining. Waiting.`);
    return;
  }

  // 7. Check if hub already nudged recently — stand down if so
  if (hubNudgedRecently()) {
    log(`Idle detected — hub already nudged recently. Standing down this cycle.`);
    return;
  }

  // 8. Send the wake
  log(`WAKE: Claude idle ${Math.round(msSinceTool/1000)}s, signal file has messages. Sending keystroke (nudge #${nudgeCount + 1}, backoff ${nudgeBackoffMs/1000}s).`);
  const success = sendWakeKeystroke();

  if (success) {
    nudgeCount++;
    wakeCount++;
    lastNudgeAt = Date.now();

    // Exponential backoff: double up to cap
    nudgeBackoffMs = Math.min(nudgeBackoffMs * 2, NUDGE_BACKOFF_MAX);
    log(`Wake sent. Next nudge backoff: ${nudgeBackoffMs/1000}s. Total wakes: ${wakeCount}.`);
  }
}

// --- Dynamic interval: quiet mode uses longer interval ---
let checkTimer = null;

function scheduleNext() {
  const interval = quietMode ? QUIET_INTERVAL_MS : CHECK_INTERVAL_MS;
  checkTimer = setTimeout(async () => {
    try { await runCheck(); } catch (e) { log(`Check error: ${e.message}`); }
    scheduleNext();
  }, interval);
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
      lastCheckAt,
      idleStatus,
      quietMode,
      nudgeCount,
      wakeCount,
      nudgeBackoffMs,
      consecutiveIdleCycles,
      claudePidFile: safeRead(TERMINAL_PING_PID),
      msSinceLastToolCall: msSinceLastToolCall(),
      signalFileHasMessages: signalFileHasMessages(),
    }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Tick engine started on port ${PORT}`);
});

// --- Graceful shutdown ---
process.on('SIGTERM', () => {
  log('SIGTERM received — shutting down cleanly.');
  if (checkTimer) clearTimeout(checkTimer);
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  log('SIGINT received — shutting down cleanly.');
  if (checkTimer) clearTimeout(checkTimer);
  server.close(() => process.exit(0));
});

// --- Start ---
log(`Tick engine initializing. Idle threshold: ${IDLE_THRESHOLD_MS/1000}s, check interval: ${CHECK_INTERVAL_MS/1000}s, nudge backoff start: ${NUDGE_BACKOFF_START/1000}s`);
runCheck().catch(e => log(`Initial check error: ${e.message}`));
scheduleNext();
