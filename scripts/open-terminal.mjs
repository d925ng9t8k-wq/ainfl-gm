/**
 * 9 — Auto Terminal Opener (Hardened + Self-Healing)
 *
 * Watches for a signal file. When the comms hub creates it,
 * this script opens Terminal with Claude Code running.
 * Runs as a LaunchAgent — always watching.
 *
 * Hardened: retry on failure, verification, timeout handling.
 * Self-healing: if API is down, keeps retrying every 2 minutes
 * until the API is reachable, THEN launches Claude Code.
 * This means Jasson never has to type "claude" manually after an outage.
 */

import { existsSync, unlinkSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import https from 'https';

const SIGNAL_FILE = '/tmp/9-open-terminal';
const HEAL_FILE = '/tmp/9-healing';
const LOG_FILE = '/tmp/9-terminal-opener.log';
const CHECK_INTERVAL = 5000;
const HEAL_INTERVAL = 120000; // 2 minutes between API recovery checks
const MAX_RETRIES = 3;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

function checkApiHealth() {
  return new Promise((resolve) => {
    try {
      const result = execSync(
        'curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://api.anthropic.com/v1/messages -H "x-api-key: test" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" -d \'{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"x"}]}\'',
        { timeout: 15000 }
      ).toString().trim();
      // Any HTTP response (even 401 auth error) means API is reachable
      const code = parseInt(result);
      resolve(code > 0 && code < 600);
    } catch {
      resolve(false);
    }
  });
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

let healingInterval = null;

async function startHealing(reason) {
  if (healingInterval) {
    log('Already in healing mode — skipping duplicate');
    return;
  }

  log(`SELF-HEAL ACTIVATED: ${reason}`);
  log('Will check API health every 2 minutes and auto-launch Claude when ready');

  // Write heal file so hub knows we're in recovery mode
  try { writeFileSync(HEAL_FILE, reason); } catch {}

  healingInterval = setInterval(async () => {
    log('Self-heal: checking API health...');
    const healthy = await checkApiHealth();

    if (healthy) {
      log('API IS BACK. Launching Claude Code now.');
      clearInterval(healingInterval);
      healingInterval = null;
      try { unlinkSync(HEAL_FILE); } catch {}

      const success = openTerminal();
      if (success) {
        log('Self-heal COMPLETE. Claude Code launched automatically.');
      } else {
        log('Self-heal: Terminal open failed even with healthy API. Re-entering healing mode.');
        startHealing('Terminal open failed after API recovery');
      }
    } else {
      log('Self-heal: API still unreachable. Will retry in 2 minutes.');
    }
  }, HEAL_INTERVAL);

  // Also do an immediate first check
  const healthy = await checkApiHealth();
  if (healthy) {
    log('API is already healthy on first check. Launching now.');
    clearInterval(healingInterval);
    healingInterval = null;
    try { unlinkSync(HEAL_FILE); } catch {}
    openTerminal();
  }
}

function checkSignal() {
  try {
    if (existsSync(SIGNAL_FILE)) {
      const reason = readFileSync(SIGNAL_FILE, 'utf-8').trim() || 'Hub requested terminal';
      log(`Signal detected: ${reason}`);
      unlinkSync(SIGNAL_FILE);

      // Check if this is an API outage recovery signal
      const isApiOutage = reason.toLowerCase().includes('api') ||
                          reason.toLowerCase().includes('unreachable') ||
                          reason.toLowerCase().includes('frozen');

      if (isApiOutage) {
        // Don't just blindly open terminal — enter self-heal mode
        startHealing(reason);
      } else {
        const success = openTerminal();
        if (!success) {
          log('CRITICAL: Could not open Terminal after all retries');
          // Fall back to healing mode
          startHealing('Terminal open failed: ' + reason);
        }
      }
    }
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}

setInterval(checkSignal, CHECK_INTERVAL);
log('Terminal opener watching for signal file (hardened + self-healing)');
