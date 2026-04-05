/**
 * 9 Enterprises — Cloud Telegram Relay
 *
 * Runs on a cloud VPS ($4/mo DigitalOcean droplet).
 * Polls Telegram 24/7 independently of the Mac.
 * Forwards messages to Mac via tunnel webhook.
 * Falls back to Sonnet (OC) responses when Mac is unreachable.
 *
 * This replaces the Mac-based Telegram polling in comms-hub.mjs.
 * The Mac hub no longer polls Telegram directly — this relay is the
 * single source of truth for Telegram message handling.
 *
 * Deploy: PM2 on cloud VPS
 * Config: .env with TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, MAC_TUNNEL_URL
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createServer } from 'http';

// Apr 5 rule: Sonnet minimum for OC (named agent, quality-sensitive).
// Keep in sync with scripts/model-constants.mjs → CLAUDE_QUALITY_MODEL.
// Cannot import model-constants.mjs here — this runs on cloud VPS.
const OC_MODEL = 'claude-sonnet-4-5';

// ─── Config ──────────────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MAC_URL = process.env.MAC_TUNNEL_URL || 'https://your-tunnel.trycloudflare.com';
const PORT = process.env.PORT || 3460;
const OFFSET_FILE = '/tmp/telegram-relay-offset';

if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN required'); process.exit(1); }

let telegramOffset = 0;
try { telegramOffset = parseInt(readFileSync(OFFSET_FILE, 'utf-8').trim()) || 0; } catch {}

// ─── Telegram API ────────────────────────────────────────────────────────────
const TG_BASE = `https://api.telegram.org/bot${TOKEN}`;

async function tgApi(method, body = {}) {
  const res = await fetch(`${TG_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sendTelegram(text) {
  const chunks = [];
  while (text.length > 4000) { chunks.push(text.slice(0, 4000)); text = text.slice(4000); }
  chunks.push(text);
  for (const chunk of chunks) {
    try {
      await tgApi('sendMessage', { chat_id: CHAT_ID, text: chunk, parse_mode: 'Markdown' });
    } catch {
      await tgApi('sendMessage', { chat_id: CHAT_ID, text: chunk });
    }
  }
}

// ─── Mac Health Check ────────────────────────────────────────────────────────
let macHealthy = false;
let lastMacCheck = 0;

async function checkMacHealth() {
  try {
    const res = await fetch(`${MAC_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    macHealthy = data.status === 'running';
    lastMacCheck = Date.now();
    return macHealthy;
  } catch {
    macHealthy = false;
    lastMacCheck = Date.now();
    return false;
  }
}

// ─── OC Fallback (Sonnet — Apr 5 rule: named agent, quality-sensitive) ───────
async function askOC(text) {
  if (!ANTHROPIC_KEY) return "Got your message. 9 is offline right now — I'll pass this along as soon as the terminal is back.";

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: OC_MODEL,
        max_tokens: 300,
        system: "You are OC, the Offensive Coordinator for 9 Enterprises. 9 (the AI partner) is currently offline. You're covering Telegram. Be brief, helpful, and honest that you're the backup. Prefix responses with 'OC:'.",
        messages: [{ role: 'user', content: text }]
      })
    });
    const data = await res.json();
    return data.content?.[0]?.text || "Got your message. Passing it to 9.";
  } catch {
    return "Got your message. 9 is offline — I'll queue this for when the terminal is back.";
  }
}

// ─── Forward to Mac ──────────────────────────────────────────────────────────
async function forwardToMac(message) {
  try {
    const res = await fetch(`${MAC_URL}/relay-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Message Queue (for when Mac is down) ────────────────────────────────────
const messageQueue = [];

function queueMessage(msg) {
  messageQueue.push({ ...msg, queuedAt: new Date().toISOString() });
  // Keep queue manageable
  if (messageQueue.length > 100) messageQueue.shift();
}

async function flushQueue() {
  if (messageQueue.length === 0) return;
  if (!macHealthy) return;

  console.log(`Flushing ${messageQueue.length} queued messages to Mac`);
  const toFlush = [...messageQueue];
  messageQueue.length = 0;

  for (const msg of toFlush) {
    const sent = await forwardToMac(msg);
    if (!sent) {
      // Re-queue if Mac went down mid-flush
      messageQueue.unshift(msg);
      break;
    }
  }
}

// ─── Telegram Polling Loop ───────────────────────────────────────────────────
async function pollTelegram() {
  while (true) {
    try {
      const result = await tgApi('getUpdates', {
        offset: telegramOffset,
        timeout: 25,
        allowed_updates: ['message']
      });

      if (!result.ok || !result.result?.length) continue;

      for (const update of result.result) {
        telegramOffset = update.update_id + 1;
        try { writeFileSync(OFFSET_FILE, String(telegramOffset)); } catch {}

        const msg = update.message;
        if (!msg?.text || String(msg.chat?.id) !== String(CHAT_ID)) continue;

        const userText = msg.text.trim();
        console.log(`[${new Date().toISOString()}] Telegram IN: "${userText}"`);

        // Check Mac health (cache for 30s)
        if (Date.now() - lastMacCheck > 30000) {
          await checkMacHealth();
        }

        const message = {
          channel: 'telegram',
          text: userText,
          timestamp: new Date().toISOString(),
          messageId: msg.message_id
        };

        if (macHealthy) {
          // Forward to Mac — 9 handles the response
          const sent = await forwardToMac(message);
          if (sent) {
            console.log(`Forwarded to Mac (relay mode)`);
            // Don't respond — 9 will respond via /send endpoint
          } else {
            // Mac went down between health check and forward
            macHealthy = false;
            queueMessage(message);
            const reply = await askOC(userText);
            await sendTelegram(reply);
            console.log(`Mac unreachable — OC (Sonnet) responded, message queued`);
          }
        } else {
          // Mac is down — respond with Sonnet (OC), queue for later
          queueMessage(message);
          const reply = await askOC(userText);
          await sendTelegram(reply);
          console.log(`Mac offline — OC (Sonnet) responded, message queued`);
        }
      }
    } catch (e) {
      console.error(`Poll error: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000)); // Wait 5s on error
    }
  }
}

// ─── Health Check Server ─────────────────────────────────────────────────────
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      macHealthy,
      lastMacCheck: new Date(lastMacCheck).toISOString(),
      queuedMessages: messageQueue.length,
      telegramOffset
    }));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`Telegram relay running on port ${PORT}`);
});

// ─── Mac Recovery Check (every 60s) ─────────────────────────────────────────
setInterval(async () => {
  const wasDown = !macHealthy;
  await checkMacHealth();

  if (wasDown && macHealthy) {
    console.log('Mac recovered — flushing message queue');
    await flushQueue();
  }
}, 60000);

// ─── Start ───────────────────────────────────────────────────────────────────
console.log(`[${new Date().toISOString()}] Telegram relay starting`);
console.log(`Mac tunnel: ${MAC_URL}`);
checkMacHealth().then(() => {
  console.log(`Mac status: ${macHealthy ? 'HEALTHY' : 'UNREACHABLE'}`);
  pollTelegram();
});
