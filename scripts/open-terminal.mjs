/**
 * 9 — Auto Terminal Opener (Hardened)
 *
 * Watches for a signal file. When the comms hub creates it,
 * this script opens Terminal with Claude Code running.
 * Runs as a LaunchAgent — always watching.
 *
 * Hardened: retry on failure, verification, timeout handling.
 */

import { existsSync, unlinkSync, readFileSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';

const SIGNAL_FILE = '/tmp/9-open-terminal';
const LOG_FILE = '/tmp/9-terminal-opener.log';
const CHECK_INTERVAL = 5000;
const MAX_RETRIES = 3;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

function openTerminal() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log(`Opening Terminal + Claude (attempt ${attempt}/${MAX_RETRIES})`);

      execSync(`osascript -e '
        tell application "Terminal"
          activate
          do script "cd ~/Projects/BengalOracle && claude --dangerously-skip-permissions \\"Run the startup protocol from CLAUDE.md. Claim terminal. Check inbox. Message Jasson on Telegram that you are alive and operational. Then start polling Telegram continuously.\\""
        end tell
      '`, { timeout: 15000 });

      log('Terminal opened with Claude Code');
      return true;
    } catch (e) {
      log(`Attempt ${attempt} failed: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        log(`Waiting 5 seconds before retry...`);
        try { execSync('sleep 5'); } catch {}
      }
    }
  }
  log(`All ${MAX_RETRIES} attempts failed to open Terminal`);
  return false;
}

function checkSignal() {
  try {
    if (existsSync(SIGNAL_FILE)) {
      const reason = readFileSync(SIGNAL_FILE, 'utf-8').trim() || 'Hub requested terminal';
      log(`Signal detected: ${reason}`);
      unlinkSync(SIGNAL_FILE);

      const success = openTerminal();
      if (!success) {
        log('CRITICAL: Could not open Terminal after all retries');
      }
    }
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}

setInterval(checkSignal, CHECK_INTERVAL);
log('Terminal opener watching for signal file (hardened: retry + timeout)');
