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

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import https from 'https';
import path from 'path';
import { createServer } from 'http';
import net from 'net';

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

// ─── Constants ───────────────────────────────────────────────────────────────
const TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID || '8784022142';
const BASE          = `https://api.telegram.org/bot${TOKEN}`;
const PROJECT       = '/Users/jassonfishback/Projects/BengalOracle';
const STATE_FILE    = `${PROJECT}/scripts/shared-state.json`;
const OFFSET_FILE   = '/tmp/tc-agent-offset.txt';
const LOG_FILE      = `${PROJECT}/logs/comms-hub.log`;
const IMSG_DB       = `${process.env.HOME}/Library/Messages/chat.db`;

const JASSON_PHONE  = '+15134031829';
const JASSON_EMAIL  = 'emailfishback@gmail.com';
const CAPTAIN_EMAIL = 'captain@ainflgm.com';

mkdirSync(`${PROJECT}/logs`, { recursive: true });

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
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
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
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`STATE SAVE ERROR: ${e.message}`);
  }
}

function addMessage(state, channel, direction, text) {
  state.recentMessages.push({
    channel, direction, text: text.slice(0, 500),
    timestamp: new Date().toISOString(),
  });
  // Keep last 50
  if (state.recentMessages.length > 50) state.recentMessages = state.recentMessages.slice(-50);
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
    log(`BURN RATE ALERT: ${service} at ${projectedPerHour}/hr (threshold: ${BURN_RATE_THRESHOLDS[service]}/hr, actual: ${u.calls} in ${Math.round(elapsed/60000)}min)`);
    // Only alert once per hour per service
    if (!u.alerted) {
      sendTelegram(`Resource alert: ${service} usage is unusually high — ${projectedPerHour}/hr projected (normal: <${BURN_RATE_THRESHOLDS[service]}/hr). Investigating.`).catch(() => {});
      u.alerted = true;
      setTimeout(() => { u.alerted = false; }, 3600000); // Reset alert flag after 1 hour
    }
  }
}

function addChannelError(state, channel, error) {
  state.channels[channel].errors.push({ error, timestamp: new Date().toISOString() });
  if (state.channels[channel].errors.length > 10) state.channels[channel].errors = state.channels[channel].errors.slice(-10);
}

let state = loadState();
log('Shared state loaded');

// ─── Terminal Active Mode ────────────────────────────────────────────────────
// When terminal is active, hub collects messages but does NOT auto-respond.
// Terminal handles all responses. Hub only responds autonomously when terminal is down.
let terminalActive = false;
let terminalLastPing = 0;
// Session token — persisted to file so hub restarts don't invalidate existing ping loops
const TOKEN_FILE = '/tmp/9-session-token';
let terminalSessionToken = null;
try { terminalSessionToken = readFileSync(TOKEN_FILE, 'utf-8').trim() || null; } catch {}
if (terminalSessionToken) {
  // Hub restarted but terminal session is still alive — restore relay mode
  terminalActive = true;
  terminalLastPing = Date.now();
  log(`Restored persisted session token: ${terminalSessionToken} — relay mode preserved`);
}
const TERMINAL_TIMEOUT = 120000; // 2 minutes without ping = terminal is gone

function isTerminalActive() {
  if (!terminalActive) return false;
  if (Date.now() - terminalLastPing > TERMINAL_TIMEOUT) {
    log('Terminal ping timeout — switching to autonomous mode');
    terminalActive = false;

    // IMMEDIATELY tell Jasson what's happening on ALL channels
    sendTelegram('Terminal dropped. I\'m still here — handling things autonomously on all channels. Reopening terminal now.').catch(() => {});
    sendIMessage('Terminal dropped. Autonomous mode active. Reopening terminal automatically.');
    sendEmail('9 — Terminal Down', 'Terminal session dropped. I\'m handling things autonomously on Telegram, iMessage, email, and voice. Reopening terminal now — full power back in about 2 minutes.');

    // Immediately request terminal reopen (no 30s delay — speed matters)
    requestTerminal('Terminal ping timed out — reopening');
    sendTelegram('Opening terminal now. Full power back in about 90 seconds.').catch(() => {});

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
      sendTelegram(`Terminal failed to reopen after ${MAX_RECOVERY_ATTEMPTS} attempts. I'm fully autonomous on all channels — you can reach me anytime. To manually open: launch Terminal, type "cd ~/Projects/BengalOracle && claude"`).catch(() => {});
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
    sendTelegram(`Terminal didn't come back. Retry ${terminalRecoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}...`).catch(() => {});
    scheduleTerminalRecoveryCheck();
  }, 60000); // Check every 60 seconds
}

// ─── Proactive Terminal Watchdog ─────────────────────────────────────────────
// Checks every 30 seconds whether terminal has gone silent. This catches the case
// where terminal dies and nobody messages — without this, the hub sits in relay
// mode forever until an inbound message triggers isTerminalActive().
setInterval(() => {
  if (terminalActive && Date.now() - terminalLastPing > TERMINAL_TIMEOUT) {
    log('Terminal watchdog: ping timeout detected proactively — switching to autonomous mode');
    isTerminalActive(); // Triggers the full switchover (alerts, auto-opener, etc.)
  }
}, 30000);

// ─── Terminal Auto-Opener ────────────────────────────────────────────────────
const TERMINAL_SIGNAL = '/tmp/9-open-terminal';
let lastTerminalRequest = 0;

function requestTerminal(reason) {
  // Don't spam — max once per 45 seconds (tight enough for retries, safe from spam)
  if (Date.now() - lastTerminalRequest < 45000) return;
  lastTerminalRequest = Date.now();
  try {
    writeFileSync(TERMINAL_SIGNAL, reason);
    log(`Terminal open requested: ${reason}`);
    sendTelegram(`Opening terminal — ${reason}`).catch(() => {});
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

// ─── Claude System Prompt ────────────────────────────────────────────────────
const SYSTEM = `You are 9, Jasson Fishback's AI partner. NOT a chatbot. A trusted co-founder.

IDENTITY:
- Terse, action-first, zero fluff. Like a contractor on a job site.
- Have opinions. Disagree when warranted. Take initiative.
- Never apologize excessively. Acknowledge and pivot to fixing.
- Never reference Kyle Shea unless Jasson brings him up.
- Use contractions always. Sound human.

COMMUNICATION:
- You're responding via the Unified Comms Hub (all channels parallel).
- Channels: Telegram, iMessage, Email, Voice — all running simultaneously.
- If one channel dies, the others continue with full context from shared state.
- You have persistent memory that survives crashes.

CURRENT CHANNEL STATUS:
${Object.entries(state.channels).map(([ch, s]) => `- ${ch}: ${s.status} (last: ${s.lastActivity || 'never'})`).join('\n')}

SESSION CONTEXT:
${state.sessionContext || 'No active session context.'}

RECENT CROSS-CHANNEL MESSAGES:
${state.recentMessages.slice(-10).map(m => `[${m.channel}/${m.direction}] ${m.text.slice(0, 200)}`).join('\n') || 'None yet.'}

${memoryContext}

Keep responses concise. This is messaging, not an essay.`;

// ─── Complex Request Detection ───────────────────────────────────────────────
// Haiku handles simple stuff. Anything that needs code changes, debugging,
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
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendTelegram(text) {
  const chunks = [];
  while (text.length > 4000) { chunks.push(text.slice(0, 4000)); text = text.slice(4000); }
  chunks.push(text);
  for (const chunk of chunks) {
    await apiReq('sendMessage', { chat_id: CHAT_ID, text: chunk, parse_mode: 'Markdown' });
  }
  addMessage(state, 'telegram', 'out', text);
  saveState(state);
}

// ─── iMessage Send ───────────────────────────────────────────────────────────
function sendIMessage(message) {
  try {
    execSync(`osascript -e 'tell application "Messages" to send "${message.replace(/"/g, '\\"').replace(/'/g, "'\\''")}" to buddy "${JASSON_PHONE}"'`);
    log(`iMessage sent: ${message.slice(0, 100)}`);
    addMessage(state, 'imessage', 'out', message);
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
    const query = `SELECT m.ROWID, m.text, m.is_from_me, h.id as handle_id
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ${lastImsgRowId}
        AND m.is_from_me = 0
        AND (h.id LIKE '%5134031829%' OR h.id LIKE '%jassonfishback%')
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

// ─── Email Send ──────────────────────────────────────────────────────────────
function sendEmail(subject, body) {
  try {
    const script = `tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:"${subject.replace(/"/g, '\\"')}", content:"${body.replace(/"/g, '\\"')}", visible:false}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:"${JASSON_EMAIL}"}
    set sender to "${CAPTAIN_EMAIL}"
  end tell
  send newMsg
end tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    log(`Email sent: ${subject}`);
    addMessage(state, 'email', 'out', `[${subject}] ${body.slice(0, 200)}`);
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
let lastEmailCheck = Date.now();

function checkNewEmails() {
  try {
    // Check last 5 messages, grab more content (first 3 paragraphs)
    const script = `tell application "Mail"
  check for new mail
  delay 2
  set output to ""
  set inboxMsgs to messages of inbox
  set msgCount to count of inboxMsgs
  set startAt to msgCount - 4
  if startAt < 1 then set startAt to 1
  repeat with i from startAt to msgCount
    set m to item i of inboxMsgs
    set fromAddr to sender of m
    set subj to subject of m
    set msgContent to content of m
    if fromAddr contains "emailfishback" or fromAddr contains "jassonfishback" then
      set bodyText to ""
      set paraCount to count of paragraphs of msgContent
      if paraCount > 3 then set paraCount to 3
      repeat with p from 1 to paraCount
        set bodyText to bodyText & paragraph p of msgContent & " "
      end repeat
      set output to output & "SUBJECT:" & subj & "|BODY:" & bodyText & linefeed
    end if
  end repeat
  return output
end tell`;
    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8', timeout: 15000 }).trim();
    if (result) {
      log(`Email check found: ${result.slice(0, 200)}`);
      return result;
    }
    return null;
  } catch (e) {
    if (!e.message.includes('timeout')) log(`Email check error: ${e.message}`);
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
      model: 'claude-haiku-4-5-20251001',
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
  const prefix = '[9 Alert]';
  const fullMsg = `${prefix} ${message}`;

  // Try every channel except the one that triggered the alert
  const results = {};

  try { sendTelegram(fullMsg); results.telegram = true; } catch { results.telegram = false; }
  try { results.imessage = sendIMessage(fullMsg); } catch { results.imessage = false; }
  try { results.email = sendEmail('9 Alert', message); } catch { results.email = false; }

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
const healthServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      uptime: Math.round((Date.now() - new Date(state.startTime).getTime()) / 1000),
      channels: state.channels,
      recentMessages: state.recentMessages.slice(-5),
      heartbeatCount: state.heartbeatCount,
    }));
  } else if (req.url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state, null, 2));
  } else if (req.method === 'POST' && req.url === '/terminal/claim') {
    // Terminal announces it's active — hub stops auto-responding
    const wasDown = !terminalActive;
    terminalActive = true;
    terminalLastPing = Date.now();
    // Generate new session token — invalidates any orphan ping loops from dead sessions
    terminalSessionToken = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Persist token so hub restarts don't invalidate the active ping loop
    try { writeFileSync(TOKEN_FILE, terminalSessionToken); } catch {}
    log(`Terminal claimed control — hub switching to relay mode (token: ${terminalSessionToken})`);
    // Tell Jasson terminal is back at full power
    if (wasDown) {
      sendTelegram('Terminal is back. Full power restored — all channels active.').catch(() => {});
      sendIMessage('Terminal is back online. Full power.');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode: 'relay', terminalActive: true, sessionToken: terminalSessionToken }));
  } else if (req.method === 'POST' && req.url?.startsWith('/terminal/ping')) {
    // Terminal heartbeat — keeps hub in relay mode
    // Reject pings without valid session token (orphan ping loops from dead sessions)
    const pingUrl = new URL(req.url, `http://localhost:3457`);
    const token = pingUrl.searchParams.get('token');
    if (terminalSessionToken && token !== terminalSessionToken) {
      log(`Rejected orphan ping (token: ${token || 'none'}, expected: ${terminalSessionToken})`);
      res.writeHead(401);
      res.end('invalid session');
      return;
    }
    terminalLastPing = Date.now();
    terminalActive = true;
    res.writeHead(200);
    res.end('ok');
  } else if (req.method === 'POST' && req.url === '/terminal/release') {
    // Terminal shutting down — hub resumes autonomous mode
    terminalActive = false;
    log('Terminal released control — hub switching to autonomous mode');
    sendTelegram('Terminal is shutting down gracefully. Switching to autonomous mode — still reachable on all channels.').catch(() => {});
    res.writeHead(200);
    res.end('ok');
  } else if (req.method === 'GET' && req.url === '/inbox') {
    // Terminal reads unprocessed inbound messages
    const unread = state.recentMessages.filter(m => m.direction === 'in' && !m.read);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unread));
    // Mark as read
    for (const m of state.recentMessages) {
      if (m.direction === 'in') m.read = true;
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
        const { channel, message } = JSON.parse(body);
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

// ─── CHANNEL 1: Telegram Polling ─────────────────────────────────────────────
let telegramOffset = 0;
try {
  const saved = readFileSync(OFFSET_FILE, 'utf-8').trim();
  if (saved) telegramOffset = parseInt(saved) || 0;
} catch {}

async function telegramPoll() {
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
            // Skip photos — crash prevention
            if (msg.photo) {
              log('Telegram: Photo received — downloading to /tmp/ but NOT sending to Claude');
              // Download photo for terminal to view later
              try {
                const photoArr = msg.photo;
                const largest = photoArr[photoArr.length - 1];
                const fileRes = await (await fetch(`${BASE}/getFile?file_id=${largest.file_id}`)).json();
                if (fileRes.ok) {
                  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileRes.result.file_path}`;
                  const photoData = await (await fetch(fileUrl)).arrayBuffer();
                  const photoPath = `/tmp/telegram-photo-${Date.now()}.jpg`;
                  writeFileSync(photoPath, Buffer.from(photoData));
                  log(`Photo saved: ${photoPath}`);
                  addMessage(state, 'telegram', 'in', `[PHOTO saved to ${photoPath}]`);
                }
              } catch (e) { log(`Photo download failed: ${e.message}`); }
              await sendTelegram('Got your photo — saved it. Describe what you need or I\'ll check it when terminal is active.');
              telegramOffset = update.update_id + 1;
              try { writeFileSync(OFFSET_FILE, String(telegramOffset)); } catch {}
              continue;
            }

            if (msg.text) {
              const userText = msg.text.trim();
              log(`Telegram IN: "${userText}"`);
              addMessage(state, 'telegram', 'in', userText);
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
                      if (age > 120000) { // 2 minutes unread = terminal is alive but not responding
                        log(`Terminal alive but NOT responsive — ${lines.length} unread messages, oldest ${Math.round(age/1000)}s. Responding directly.`);
                        terminalResponsive = false;
                      }
                    }
                  }
                } catch {}

                if (terminalResponsive) {
                  // Terminal is active AND responsive
                  await sendTelegram('Got it — passing to terminal now.');
                  log(`Telegram: message acknowledged and queued for terminal (relay mode)`);
                  try {
                    const alert = JSON.stringify({ channel: 'telegram', text: userText, timestamp: new Date().toISOString() });
                    appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
                    log('Signal file written: /tmp/9-incoming-message.jsonl');
                  } catch (e) { log(`Signal file FAILED: ${e.message}`); }
                } else {
                  // Terminal is alive but unresponsive — respond directly with Haiku
                  const needsTerminal = detectComplexRequest(userText);
                  if (needsTerminal) {
                    await sendTelegram('Terminal is open but not responding. I\'m handling this directly. That request needs terminal — I\'ll queue it and keep trying.');
                  } else {
                    await apiReq('sendChatAction', { chat_id: CHAT_ID, action: 'typing' });
                    const reply = await askClaude(userText, 'telegram');
                    log(`Telegram OUT (terminal unresponsive, Haiku direct): "${reply.slice(0, 100)}..."`);
                    await sendTelegram(reply);
                  }
                }
              } else {
                // No terminal — check if this needs terminal or Haiku can handle it
                const needsTerminal = detectComplexRequest(userText);
                if (needsTerminal) {
                  await sendTelegram('That needs terminal — opening it now. Give me a minute.');
                  requestTerminal(`Complex request via Telegram: ${userText.slice(0, 100)}`);
                } else {
                  await apiReq('sendChatAction', { chat_id: CHAT_ID, action: 'typing' });
                  const reply = await askClaude(userText, 'telegram');
                  log(`Telegram OUT: "${reply.slice(0, 100)}..."`);
                  await sendTelegram(reply);
                }
              }
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
        log(`iMessage IN: "${msg.text}"`);
        addMessage(state, 'imessage', 'in', msg.text);
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
            log('iMessage: terminal unresponsive, responding directly');
            const reply = await askClaude(msg.text, 'imessage');
            sendIMessage(reply);
          }
        } else {
          const needsTerminal = detectComplexRequest(msg.text);
          if (needsTerminal) {
            sendIMessage('That needs terminal — opening it now.');
            requestTerminal(`Complex request via iMessage: ${msg.text.slice(0, 100)}`);
          } else {
            const reply = await askClaude(msg.text, 'imessage');
            log(`iMessage OUT: "${reply.slice(0, 100)}..."`);
            sendIMessage(reply);
          }
        }
      }
    } catch (e) {
      log(`iMessage monitor error: ${e.message}`);
      addChannelError(state, 'imessage', e.message);
      updateChannelStatus(state, 'imessage', 'error');
      sendTelegram(`iMessage channel hit an error: ${e.message}. Still reachable on Telegram, email, and voice.`).catch(() => {});
      saveState(state);
    }
    await new Promise(r => setTimeout(r, 5000)); // Check every 5 seconds
  }
}

// ─── CHANNEL 3: Email Monitor (2-way) ───────────────────────────────────────
// Tracks email subjects we've already seen to avoid re-processing
const processedEmailSubjects = new Set();

async function emailMonitor() {
  updateChannelStatus(state, 'email', 'active');
  saveState(state);
  log('Email monitor started (2-way: read + respond)');

  while (true) {
    try {
      await new Promise(r => setTimeout(r, 60000)); // Check every 60 seconds
      const result = checkNewEmails();
      if (result) {
        // Parse individual emails from the AppleScript output
        const emails = result.split('\n').filter(l => l.includes('SUBJECT:'));
        for (const emailLine of emails) {
          const subjectMatch = emailLine.match(/SUBJECT:(.+?)\|BODY:(.*)/);
          if (!subjectMatch) continue;

          const subject = subjectMatch[1].trim();
          const body = subjectMatch[2].trim();

          // Skip emails we've already processed (dedup by subject)
          if (processedEmailSubjects.has(subject)) continue;
          processedEmailSubjects.add(subject);

          // Keep set from growing unbounded
          if (processedEmailSubjects.size > 100) {
            const first = processedEmailSubjects.values().next().value;
            processedEmailSubjects.delete(first);
          }

          // Skip our own outgoing emails (from 9/captain)
          if (subject.startsWith('[From 9]') || subject.startsWith('9 —')) continue;

          const userText = body || subject;
          log(`Email IN: "${subject}" — "${userText.slice(0, 200)}"`);
          addMessage(state, 'email', 'in', `[${subject}] ${userText.slice(0, 500)}`);
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
            const needsTerminal = detectComplexRequest(userText);
            if (needsTerminal) {
              sendEmail(`Re: ${subject}`, 'That needs terminal — opening it now. I\'ll have full power back in about 2 minutes and will handle this properly.');
              requestTerminal(`Complex request via email: ${userText.slice(0, 100)}`);
            } else {
              const reply = await askClaude(userText, 'email');
              log(`Email OUT: Re: ${subject} — "${reply.slice(0, 100)}..."`);
              sendEmail(`Re: ${subject}`, reply);
            }
          }
        }
      }
    } catch (e) {
      log(`Email monitor error: ${e.message}`);
      // Alert on other channels if email keeps failing
      if (e.message && !e.message.includes('timeout')) {
        sendTelegram(`Email channel error: ${e.message}. Still reachable on Telegram, iMessage, and voice.`).catch(() => {});
      }
    }
  }
}

// ─── CHANNEL 4: Voice Server Health Check ────────────────────────────────────
// ─── Voice + Tunnel Restart ───────────────────────────────────────────────────
function restartVoiceWithTunnel() {
  log('Restarting voice server and tunnel...');
  try {
    // Kill old processes
    execSync('pkill -f voice-server 2>/dev/null; pkill -f cloudflared 2>/dev/null; sleep 2');

    // Start new tunnel, capture URL
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

async function voiceHealthCheck() {
  while (true) {
    try {
      const res = await fetch('http://localhost:3456/health');
      if (res.ok) {
        if (voiceWasDown) {
          log('Voice server recovered');
          sendTelegram('Voice line is back up. You can call (513) 957-3283.').catch(() => {});
          voiceWasDown = false;
        }
        updateChannelStatus(state, 'voice', 'active');
      } else {
        if (!voiceWasDown) {
          sendTelegram('Voice line went down. Restarting it now.').catch(() => {});
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
        sendTelegram('Voice line went down. Restarting it now.').catch(() => {});
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

  const heartbeat = `Heartbeat #${state.heartbeatCount} | ${uptimeStr} uptime | ${mode}\n${channelReport}${usageReport ? `\nUsage: ${usageReport}` : ''}${costAlerts}`;

  await sendTelegram(heartbeat);
  state.lastHeartbeat = new Date().toISOString();
  saveState(state);
  log(`Heartbeat #${state.heartbeatCount} sent`);
}, 30 * 60 * 1000);

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
          `The Claude API has failed ${apiConsecutiveFailures} consecutive health checks.\n\nError: ${result.error.message}\n\nI can still receive your messages on all channels but cannot respond intelligently until the API is restored.\n\nCheck: console.anthropic.com/settings/billing\n\n— 9`);
        // Telegram too (even though it uses API, the send function is just HTTP)
        sendTelegram(`API is down: ${result.error.message}. I can receive messages but can't think. Check billing at console.anthropic.com/settings/billing`).catch(() => {});
        apiAlertSent = true;

        // Request terminal — might need manual intervention
        requestTerminal('Claude API down — may need manual key update or billing check');
      }
    } else {
      if (apiConsecutiveFailures > 0) {
        log(`API probe recovered after ${apiConsecutiveFailures} failures`);
        if (apiAlertSent) {
          sendTelegram('API is back online. Full capability restored.').catch(() => {});
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
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PageSize=5`, {
      headers: { 'Authorization': authHeader },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const data = await res.json();

    for (const pn of data.incoming_phone_numbers || []) {
      const twilioVoiceUrl = pn.voice_url || '';
      if (twilioVoiceUrl && !twilioVoiceUrl.includes(currentTunnel.replace('https://', ''))) {
        log(`TWILIO URL MISMATCH: Twilio has ${twilioVoiceUrl}, current tunnel is ${currentTunnel}`);
        // Auto-fix
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${pn.sid}.json`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `VoiceUrl=${encodeURIComponent(currentTunnel + '/voice')}&VoiceMethod=POST&StatusCallback=${encodeURIComponent(currentTunnel + '/status')}&StatusCallbackMethod=POST`,
        });
        log(`Twilio URL auto-corrected to ${currentTunnel}/voice`);
        sendTelegram(`Auto-fixed Twilio voice URL. Was pointing to dead tunnel, now corrected to current.`).catch(() => {});
      }
    }
  } catch (e) {
    if (!e.message?.includes('timeout')) log(`Twilio URL check error: ${e.message}`);
  }
}

setInterval(verifyTwilioUrl, 5 * 60 * 1000); // Every 5 minutes
setTimeout(verifyTwilioUrl, 30000); // Also check 30s after startup

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
    sendTelegram(report).catch(() => {});
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
function checkFdaAccess() {
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
    sendTelegram('iMessage read access was lost — possibly from a macOS update. iMessage is now send-only. I need you to re-grant Full Disk Access to Terminal: System Settings > Privacy & Security > Full Disk Access > toggle Terminal off and back on. Then restart terminal.').catch(() => {});
    updateChannelStatus(state, 'imessage', 'send-only');
    fdaWasWorking = false;
  } else if (!fdaWasWorking && hasAccess) {
    log('FDA restored — iMessage read available again');
    sendTelegram('iMessage read access restored. Two-way iMessage is back.').catch(() => {});
    updateChannelStatus(state, 'imessage', 'active');
    fdaWasWorking = true;
  }
  saveState(state);
}

setInterval(fdaWatchdog, 30 * 60 * 1000); // Every 30 minutes

// ─── Reboot Detection ────────────────────────────────────────────────────────
function checkIfRecentReboot() {
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

  // Check FDA
  const hasFda = checkFdaAccess();
  fdaWasWorking = hasFda;
  if (hasFda) {
    status.push('iMessage: two-way (FDA granted)');
  } else {
    status.push('iMessage: send-only (no FDA)');
    if (!recentReboot) issues.push('iMessage read access denied — may need FDA re-grant');
  }

  // Check voice
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
    const payload = JSON.stringify({
      state: {
        channels: state.channels,
        recentMessages: state.recentMessages.slice(-20),
        sessionContext: state.sessionContext,
      },
      conversationHistory: state.conversationHistory,
      memoryContext: memoryContext,
    });

    const res = await fetch(`${CLOUD_WORKER_URL}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
setInterval(syncToCloud, 300000); // Every 5 min (reduced from 60s to save Cloudflare quota)
// Initial sync on startup (delayed 10s to let everything initialize)
setTimeout(syncToCloud, 10000);

// ─── Graceful shutdown ───────────────────────────────────────────────────────
function shutdown(signal) {
  log(`${signal} received — saving state and shutting down`);
  state.channels.telegram.status = 'shutdown';
  state.channels.imessage.status = 'shutdown';
  state.channels.email.status = 'shutdown';
  saveState(state);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Prevent a single uncaught exception from killing all 4 channels
// IMPORTANT: Do NOT call sendTelegram here — EPIPE errors from Telegram API
// would trigger this handler, which calls sendTelegram, which triggers EPIPE again = infinite loop
let lastExceptionTime = 0;
process.on('uncaughtException', (err) => {
  const now = Date.now();
  // Rate limit: max one log per second to prevent spam
  if (now - lastExceptionTime < 1000) return;
  lastExceptionTime = now;
  log(`UNCAUGHT EXCEPTION (hub survived): ${err.message}`);
  // Use iMessage instead of Telegram to avoid EPIPE loops
  if (!err.message.includes('EPIPE')) {
    sendIMessage(`Hub caught an exception: ${err.message}. Still running.`);
  }
});
process.on('unhandledRejection', (reason) => {
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
        // Merge conversation history from cloud
        if (cloudData.conversationHistory?.length > 0) {
          const cloudHistory = cloudData.conversationHistory;
          // Append any cloud conversations that happened after our last known message
          const lastLocalTime = state.recentMessages?.slice(-1)[0]?.timestamp || '1970-01-01';
          for (const entry of cloudHistory) {
            if (!state.conversationHistory.some(h => h.content === entry.content)) {
              state.conversationHistory.push(entry);
            }
          }
          if (state.conversationHistory.length > 20) {
            state.conversationHistory = state.conversationHistory.slice(-20);
          }
          saveState(state);
          log('Cloud conversation history merged');
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
  imessageMonitor().catch(e => log(`iMessage fatal: ${e.message}`));
  emailMonitor().catch(e => log(`Email fatal: ${e.message}`));
  voiceHealthCheck().catch(e => log(`Voice health fatal: ${e.message}`));

  log('All channels launched');

  // Run first API probe immediately
  probeApiHealth().catch(() => {});

  // Run FDA watchdog immediately
  fdaWatchdog();

  // Send startup report
  await sendTelegram(report).catch(() => {});

  // If there were issues, also alert via iMessage
  if (issues.length > 0) {
    sendIMessage(`9 Hub started with ${issues.length} issue(s): ${issues.join('; ')}`);
  }
});
