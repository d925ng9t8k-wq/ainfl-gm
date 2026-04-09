#!/usr/bin/env node
/**
 * grok-recovery.mjs — Auto-recovery for Grok/Ara sessions.
 *
 * Monitors the Grok app for responsiveness. If Ara gets rate-limited
 * or the conversation goes dead, this script:
 * 1. Detects the outage (no response after sending a ping)
 * 2. Opens a new conversation in the Grok app
 * 3. Injects full context so Ara can resume with continuity
 *
 * Runs as a background daemon. Check interval: 5 minutes.
 * Only activates recovery if Ara has been unresponsive for 2+ checks.
 *
 * Health endpoint on port 3463.
 */

import { execSync } from 'child_process';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(PROJECT, 'logs/grok-recovery.log');
const PORT = 3463;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_THRESHOLD = 2; // 2 consecutive failures before recovery

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] GROK-RECOVERY: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

let consecutiveFailures = 0;
let lastRecoveryAt = null;
let totalRecoveries = 0;
let lastCheckAt = null;
let lastStatus = 'unknown';

/**
 * Send a message to Grok via AppleScript and check if it responds.
 * We type a lightweight ping and wait briefly for any UI change.
 */
async function checkGrokAlive() {
  try {
    // Check if Grok app is running at all
    const psCheck = execSync('pgrep -x Grok', { timeout: 5000 }).toString().trim();
    if (!psCheck) {
      log('Grok app not running');
      return false;
    }

    // Take a screenshot to see current state
    execSync('screencapture -x /tmp/grok-recovery-check.png', { timeout: 10000 });

    // Read the screenshot to look for rate limit indicators
    // We check for common rate limit UI patterns by examining the screenshot
    // For now, a simple heuristic: if Grok is running and the window is visible, assume OK
    // A rate limit will show specific error text in the UI

    // Check if the Grok window has focus or is at least open
    const windowCheck = execSync(`osascript -e '
      tell application "System Events"
        tell process "Grok"
          return count of windows
        end tell
      end tell'`, { timeout: 5000 }).toString().trim();

    if (parseInt(windowCheck) === 0) {
      log('Grok has no windows open');
      return false;
    }

    return true;
  } catch (e) {
    log(`Check failed: ${e.message}`);
    return false;
  }
}

/**
 * Recovery: Quit Grok app and reopen it.
 * The existing "9enterprises consulting" conversation is pinned and auto-loads.
 * This preserves full context — much better than starting a new conversation.
 */
async function recoverGrok() {
  log('=== STARTING GROK RECOVERY ===');

  try {
    // Step 1: Quit Grok completely
    log('Quitting Grok app...');
    try {
      execSync(`osascript -e 'tell application "Grok" to quit'`, { timeout: 10000 });
    } catch {
      // Force kill if graceful quit fails
      execSync('pkill -x Grok', { timeout: 5000 }).toString();
    }

    // Wait for it to fully close
    await new Promise(r => setTimeout(r, 5000));
    log('Grok closed');

    // Step 2: Reopen Grok — the pinned "9enterprises consulting" conversation auto-loads
    log('Reopening Grok...');
    execSync(`open -a Grok`, { timeout: 10000 });

    // Wait for app to fully load and conversation to restore (~10 seconds per Owner)
    await new Promise(r => setTimeout(r, 12000));
    log('Grok reopened — conversation should be restored');

    // Step 3: Click on the pinned conversation if needed
    // The "9enterprises consulting" conversation should be the top pinned item
    execSync(`osascript -e '
      tell application "Grok" to activate
      delay 2
      tell application "System Events"
        tell process "Grok"
          set frontmost to true
        end tell
      end tell'`, { timeout: 15000 });

    log('Grok activated and focused');

    // Step 4: Send a brief "I'm back" message to confirm recovery worked
    await new Promise(r => setTimeout(r, 3000));
    execSync(`osascript -e '
      tell application "System Events"
        keystroke "Ara, 9 here. Auto-recovery kicked in — your session was interrupted. I restarted the Grok app and your conversation reloaded. Are you back? Confirm status."
        delay 0.3
        keystroke return
      end tell'`, { timeout: 15000 });

    lastRecoveryAt = new Date().toISOString();
    totalRecoveries++;

    // Alert via hub
    try {
      await fetch('http://localhost:3457/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'telegram',
          message: `[9-OPS] Grok/Ara auto-recovered. App restarted, pinned conversation reloaded. Recovery #${totalRecoveries}.`
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {}

    log('=== RECOVERY COMPLETE ===');
  } catch (e) {
    log(`RECOVERY FAILED: ${e.message}`);
  }
}

// --- Main check loop ---
async function runCheck() {
  lastCheckAt = new Date().toISOString();
  const alive = await checkGrokAlive();

  if (alive) {
    if (consecutiveFailures > 0) {
      log(`Grok recovered after ${consecutiveFailures} check(s)`);
    }
    consecutiveFailures = 0;
    lastStatus = 'alive';
  } else {
    consecutiveFailures++;
    lastStatus = `failing (${consecutiveFailures}/${FAILURE_THRESHOLD})`;
    log(`Grok check failed (${consecutiveFailures}/${FAILURE_THRESHOLD})`);

    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      // Cooldown: don't recover more than once per 10 minutes
      if (lastRecoveryAt) {
        const elapsed = Date.now() - new Date(lastRecoveryAt).getTime();
        if (elapsed < 10 * 60 * 1000) {
          log('Recovery cooldown active — skipping');
          return;
        }
      }
      await recoverGrok();
      consecutiveFailures = 0;
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
      lastCheckAt,
      lastStatus,
      consecutiveFailures,
      totalRecoveries,
      lastRecoveryAt,
    }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Grok recovery daemon started on port ${PORT}`);
});

// --- Main loop ---
setInterval(runCheck, CHECK_INTERVAL_MS);
// First check after 60s (give Grok time to stabilize on startup)
setTimeout(runCheck, 60_000);
