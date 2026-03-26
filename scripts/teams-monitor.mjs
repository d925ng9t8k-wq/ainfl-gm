/**
 * teams-monitor.mjs
 * Monitors the Microsoft Teams chat between Jasson and Kyle Shea.
 * Uses Playwright persistent context to maintain session across runs.
 *
 * First run: Teams will redirect to Microsoft login. The script runs
 * with headless: false on first auth so Jasson can complete SSO manually.
 * After that, the persistent profile keeps the session alive.
 *
 * Usage:
 *   node scripts/teams-monitor.mjs          # normal polling mode
 *   node scripts/teams-monitor.mjs --test   # launch test (browser open, then exit)
 *   node scripts/teams-monitor.mjs --auth   # force headed mode for manual re-auth
 */

import { chromium } from 'playwright';
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

// ─── Config ────────────────────────────────────────────────────────────────

const USER_DATA_DIR   = '/tmp/teams-monitor-profile';
const MESSAGES_FILE   = '/tmp/teams-kyle-messages.jsonl';
const STATE_FILE      = '/tmp/teams-monitor-state.json';
const LOG_FILE        = '/tmp/teams-monitor.log';
const COMMS_HUB_URL   = 'http://localhost:3457';
const POLL_INTERVAL   = 60_000; // 60 seconds
const KYLE_NAME       = 'Kyle Shea';
const TEAMS_URL       = 'https://teams.microsoft.com';

// ─── Args ──────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const TEST_MODE  = args.includes('--test');
const AUTH_MODE  = args.includes('--auth');
const HEADLESS   = !TEST_MODE && !AUTH_MODE;

// ─── Logging ───────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function logError(msg, err) {
  const errText = err ? ` — ${err.message || err}` : '';
  log(`ERROR: ${msg}${errText}`);
}

// ─── State (last seen message ID) ─────────────────────────────────────────

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {}
  return { lastSeenId: null, lastSeenTimestamp: null, seenIds: [] };
}

function saveState(state) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logError('Failed to save state', err);
  }
}

// ─── Comms hub notification ────────────────────────────────────────────────

async function notifyHub(message) {
  try {
    const res = await fetch(`${COMMS_HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message }),
    });
    if (res.ok) {
      log(`Hub notified: ${message}`);
    } else {
      log(`Hub notify failed: HTTP ${res.status}`);
    }
  } catch (err) {
    logError('Hub notify error', err);
  }
}

// Also write to the incoming message signal file so 9 sees it on next tool call
function writeSignal(messageText) {
  try {
    const alert = JSON.stringify({
      channel: 'teams',
      text: messageText,
      timestamp: new Date().toISOString(),
    });
    appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
  } catch {}
}

// ─── Message extraction ────────────────────────────────────────────────────

/**
 * Extract messages from the currently open Teams chat page.
 * Teams renders messages in elements with data-tid="chat-pane-message".
 * This selects the message container, then pulls sender and body text.
 * Teams DOM structure varies — we try multiple selectors with fallbacks.
 */
async function extractMessages(page) {
  try {
    const messages = await page.evaluate(() => {
      const results = [];

      // Primary selector: Teams Web uses [data-tid="chat-pane-message"]
      // Each item has a content element and a time element
      const containers = document.querySelectorAll('[data-tid="chat-pane-message"]');

      containers.forEach((el) => {
        try {
          // Message ID (Teams uses data-sequence-id or aria-label on the container)
          const id =
            el.getAttribute('data-sequence-id') ||
            el.getAttribute('id') ||
            el.querySelector('[data-sequence-id]')?.getAttribute('data-sequence-id') ||
            null;

          // Sender name
          const senderEl =
            el.querySelector('[data-tid="message-author-name"]') ||
            el.querySelector('.ui-chat__message__author') ||
            el.querySelector('[class*="authorName"]') ||
            el.querySelector('[class*="author"]');
          const sender = senderEl?.textContent?.trim() || null;

          // Message body
          const bodyEl =
            el.querySelector('[data-tid="chat-pane-item-content"]') ||
            el.querySelector('[class*="itemBodyWrapper"]') ||
            el.querySelector('[class*="messageBody"]') ||
            el.querySelector('p');
          const body = bodyEl?.innerText?.trim() || bodyEl?.textContent?.trim() || null;

          // Timestamp (aria-label on the time element, or title attribute)
          const timeEl =
            el.querySelector('time') ||
            el.querySelector('[data-tid="message-timestamp"]') ||
            el.querySelector('[class*="timestamp"]');
          const timestamp =
            timeEl?.getAttribute('datetime') ||
            timeEl?.getAttribute('title') ||
            timeEl?.textContent?.trim() ||
            new Date().toISOString();

          if (body) {
            results.push({ id, sender, body, timestamp });
          }
        } catch {}
      });

      return results;
    });

    return messages;
  } catch (err) {
    logError('Message extraction failed', err);
    return [];
  }
}

// ─── Teams navigation ─────────────────────────────────────────────────────

/**
 * Navigate to the Kyle Shea chat within Teams.
 * First tries the search bar, then falls back to scanning the chat list.
 */
async function navigateToKyleChat(page) {
  log('Navigating to Kyle Shea chat...');

  try {
    // Teams Web: use the search bar (Ctrl+K or the search input)
    const searchSelectors = [
      '[data-tid="app-bar-search"]',
      'input[placeholder*="Search"]',
      '[aria-label*="Search"]',
      'button[data-tid="chat-search-button"]',
    ];

    let searchOpened = false;
    for (const sel of searchSelectors) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 3000 });
        if (el) {
          await el.click();
          searchOpened = true;
          break;
        }
      } catch {}
    }

    if (searchOpened) {
      // Type Kyle's name into the search
      await page.keyboard.type('Kyle Shea', { delay: 80 });
      await page.waitForTimeout(2000);

      // Click the first matching person result
      const personSelectors = [
        `[data-tid="searchResult"]:has-text("Kyle Shea")`,
        `[aria-label*="Kyle Shea"]`,
        `li:has-text("Kyle Shea")`,
        `[role="option"]:has-text("Kyle Shea")`,
      ];

      for (const sel of personSelectors) {
        try {
          const result = await page.waitForSelector(sel, { timeout: 3000 });
          if (result) {
            await result.click();
            log('Clicked Kyle Shea in search results.');
            await page.waitForTimeout(2000);
            return true;
          }
        } catch {}
      }
    }

    // Fallback: look in the chat list sidebar
    log('Search fallback: scanning chat list for Kyle Shea...');
    const chatListSelectors = [
      `[data-tid="chat-list-item"]:has-text("Kyle Shea")`,
      `[aria-label*="Kyle Shea"]`,
      `[title*="Kyle Shea"]`,
    ];

    for (const sel of chatListSelectors) {
      try {
        const el = await page.waitForSelector(sel, { timeout: 4000 });
        if (el) {
          await el.click();
          log('Found Kyle in chat list and clicked.');
          await page.waitForTimeout(2000);
          return true;
        }
      } catch {}
    }

    logError('Could not navigate to Kyle Shea chat. DOM selectors may have changed.');
    return false;
  } catch (err) {
    logError('navigateToKyleChat failed', err);
    return false;
  }
}

// ─── Auth check ────────────────────────────────────────────────────────────

async function isAuthenticated(page) {
  try {
    // If we see the Teams chat UI, we're in
    const loggedInSelectors = [
      '[data-tid="app-layout-area-main"]',
      '[aria-label="Chat"]',
      'nav[data-tid="app-bar"]',
      '[class*="appShell"]',
    ];
    for (const sel of loggedInSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 4000 });
        return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Health check ─────────────────────────────────────────────────────────

function healthStatus() {
  const state = loadState();
  const logTail = (() => {
    try {
      const lines = readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      return lines.slice(-5).join('\n');
    } catch { return 'no log'; }
  })();
  return {
    status: 'running',
    lastSeenTimestamp: state.lastSeenTimestamp,
    seenCount: (state.seenIds || []).length,
    logTail,
  };
}

// ─── Polling loop ──────────────────────────────────────────────────────────

async function poll(page, state) {
  log('Polling for new messages...');

  const messages = await extractMessages(page);

  if (messages.length === 0) {
    log('No messages extracted — Teams DOM may have shifted, or chat not loaded yet.');
    return state;
  }

  log(`Extracted ${messages.length} messages from DOM.`);

  const seenIds = new Set(state.seenIds || []);
  const newMessages = [];

  for (const msg of messages) {
    // Use ID if available, otherwise fall back to a hash of sender+body+timestamp
    const msgId = msg.id || `${msg.sender}|${msg.timestamp}|${msg.body?.slice(0, 40)}`;
    if (!seenIds.has(msgId)) {
      newMessages.push({ ...msg, _id: msgId });
      seenIds.add(msgId);
    }
  }

  if (newMessages.length > 0) {
    log(`${newMessages.length} new message(s) found.`);

    for (const msg of newMessages) {
      // Append to JSONL output file
      const record = {
        id: msg._id,
        sender: msg.sender,
        body: msg.body,
        timestamp: msg.timestamp,
        capturedAt: new Date().toISOString(),
      };
      try {
        appendFileSync(MESSAGES_FILE, JSON.stringify(record) + '\n');
      } catch (err) {
        logError('Failed to write message to JSONL', err);
      }

      // Only notify for messages from Kyle (not ones Jasson sent)
      if (!msg.sender || msg.sender.toLowerCase().includes('kyle')) {
        const preview = msg.body?.slice(0, 120) || '(no text)';
        const notification = `[Teams] Kyle Shea: ${preview}`;
        await notifyHub(notification);
        writeSignal(notification);
      }
    }

    // Update state
    state.lastSeenId = newMessages[newMessages.length - 1]._id;
    state.lastSeenTimestamp = newMessages[newMessages.length - 1].timestamp;
    state.seenIds = Array.from(seenIds).slice(-500); // keep last 500 to prevent unbounded growth
    saveState(state);
  } else {
    log('No new messages.');
  }

  return state;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  log(`teams-monitor starting. mode=${TEST_MODE ? 'test' : AUTH_MODE ? 'auth' : 'headless'}`);

  // Ensure profile dir exists
  try { mkdirSync(USER_DATA_DIR, { recursive: true }); } catch {}

  const headless = HEADLESS;
  if (!headless) {
    log('Running in headed mode — a browser window will open for authentication.');
    log('Complete the Microsoft SSO login, navigate to Kyle Shea chat, then press Enter in this terminal.');
  }

  let browser;
  try {
    browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless,
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
      // Prevent Teams from detecting automation
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (err) {
    logError('Failed to launch browser', err);
    process.exit(1);
  }

  const page = await browser.newPage();

  // Spoof navigator.webdriver so Teams doesn't block automation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  log(`Navigating to ${TEAMS_URL}...`);
  try {
    await page.goto(TEAMS_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    logError('Initial navigation failed', err);
  }

  // ── TEST MODE ────────────────────────────────────────────────────────────
  if (TEST_MODE) {
    log('TEST MODE: Browser launched and navigated to Teams. Checking page title...');
    const title = await page.title().catch(() => 'unknown');
    log(`Page title: ${title}`);
    const url = page.url();
    log(`Current URL: ${url}`);

    const authenticated = await isAuthenticated(page);
    log(`Auth status: ${authenticated ? 'AUTHENTICATED' : 'NOT authenticated (login required)'}`);

    if (!authenticated) {
      log('');
      log('─────────────────────────────────────────────────────');
      log('FIRST-TIME AUTH REQUIRED');
      log('Run with --auth flag to open browser for manual login:');
      log('  node scripts/teams-monitor.mjs --auth');
      log('After logging in once, headless polling will work.');
      log('─────────────────────────────────────────────────────');
    } else {
      log('Session is active. Ready for headless polling.');
      const navigated = await navigateToKyleChat(page);
      log(`Navigation to Kyle chat: ${navigated ? 'SUCCESS' : 'FAILED'}`);
      if (navigated) {
        const messages = await extractMessages(page);
        log(`Found ${messages.length} messages in chat DOM.`);
        if (messages.length > 0) {
          log(`Sample (last 3):`);
          messages.slice(-3).forEach(m => log(`  [${m.sender}] ${m.body?.slice(0, 60)}`));
        }
      }
    }

    await browser.close();
    log('TEST MODE complete.');
    process.exit(0);
  }

  // ── AUTH MODE ────────────────────────────────────────────────────────────
  if (AUTH_MODE) {
    log('AUTH MODE: Browser window is open. Please:');
    log('  1. Complete Microsoft SSO login');
    log('  2. Navigate to Kyle Shea chat');
    log('  3. Come back here and press Enter to save session and exit');

    // Wait for Enter
    await new Promise(resolve => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });

    log('Session saved to ' + USER_DATA_DIR);
    await browser.close();
    log('Auth complete. Run without --auth to start headless polling.');
    process.exit(0);
  }

  // ── HEADLESS POLLING MODE ─────────────────────────────────────────────────
  log('Checking authentication status...');
  await page.waitForTimeout(3000);

  const authenticated = await isAuthenticated(page);
  if (!authenticated) {
    log('');
    log('─────────────────────────────────────────────────────');
    log('NOT AUTHENTICATED. Manual login required.');
    log('Run: node scripts/teams-monitor.mjs --auth');
    log('Complete SSO login, then restart in headless mode.');
    log('─────────────────────────────────────────────────────');
    await browser.close();
    process.exit(1);
  }

  log('Authenticated. Navigating to Kyle Shea chat...');
  const navigated = await navigateToKyleChat(page);
  if (!navigated) {
    log('Could not find Kyle Shea chat. Will retry on next poll cycle.');
  }

  let state = loadState();
  log('Starting poll loop. Interval: 60s');

  // Graceful shutdown
  async function shutdown(sig) {
    log(`Received ${sig}. Shutting down.`);
    try { await browser.close(); } catch {}
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Initial poll
  state = await poll(page, state);

  // Polling loop
  setInterval(async () => {
    try {
      // Refresh navigation every 5 minutes to handle Teams SPA state changes
      const now = Date.now();
      if (!main._lastNavRefresh || now - main._lastNavRefresh > 5 * 60_000) {
        log('Refreshing chat navigation...');
        await navigateToKyleChat(page);
        main._lastNavRefresh = now;
      }
      state = await poll(page, state);
    } catch (err) {
      logError('Poll loop error', err);
    }
  }, POLL_INTERVAL);

  log('teams-monitor running. PID: ' + process.pid);
  log('Output: ' + MESSAGES_FILE);
  log('Log:    ' + LOG_FILE);
  log('Health: call healthStatus() or check STATE_FILE=' + STATE_FILE);
}

main._lastNavRefresh = null;
main();
