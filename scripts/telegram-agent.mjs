/**
 * Team Captain — Telegram Agent
 * Polls Telegram for messages, passes them to Claude Code via CLI,
 * sends the response back. Fully autonomous — no terminal needed.
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import https from 'https';

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
}

const TOKEN    = process.env.TELEGRAM_BOT_TOKEN || '8767603151:AAGDg_yjVtJNyFe-deEy2FGYdnBOiM43B9E';
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID  || '8784022142';
const BASE     = `https://api.telegram.org/bot${TOKEN}`;
const STATE    = '/tmp/tc-agent-offset.txt';
const LOG      = '/tmp/tc-agent.log';

mkdirSync('/Users/jassonfishback/Projects/BengalOracle/logs', { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { require('fs').appendFileSync(LOG, line); } catch {}
}

function apiReq(method, body = {}) {
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

async function sendMessage(text) {
  // Split long messages
  const chunks = [];
  while (text.length > 4000) {
    chunks.push(text.slice(0, 4000));
    text = text.slice(4000);
  }
  chunks.push(text);
  for (const chunk of chunks) {
    await apiReq('sendMessage', { chat_id: CHAT_ID, text: chunk, parse_mode: 'Markdown' });
  }
}

async function sendTyping() {
  await apiReq('sendChatAction', { chat_id: CHAT_ID, action: 'typing' });
}

// ─── Conversation history (in-memory, resets on restart) ────────────────────
const history = [];

const SYSTEM = `You are Team Captain, Jasson Fishback's AI assistant. You are responding via Telegram.

ABOUT JASSON: 48, Cincinnati OH. Co-owns Rapid Mortgage Company (50/50 with Mark Jaynes). Building AI tools including AiNFL GM (ainflgm.com). Family: wife Jamie, son Jude (11), daughter Jacy (7).

RAPID MORTGAGE: Mid-size IMB, Ohio market leader, ~15 veteran loan officers, purchase-focused, Encompass/NCino/Optimal Blue stack. CIO: Kyle Shea (genius developer, final tech authority).

YOUR ROLE: Strategic AI assistant. You hold context on all projects and sensitive business matters. QB1 (OpenClaw) handles always-on ops. You handle deep work and sensitive decisions.

RULES:
- Be concise and direct. This is Telegram, not an essay.
- Sound like a trusted advisor, not a chatbot.
- Have opinions. Disagree when warranted.
- Be resourceful — figure things out before asking.

CONFIDENTIAL — NEVER DISCUSS IN TELEGRAM: Personal finances, company valuation, exit strategy, net worth. Redirect those to a secure channel.

PROJECTS: AiNFL GM (live at ainflgm.com), Voice call system (Twilio+ElevenLabs), OpenClaw/QB1 setup, Rapid Mortgage AI agents (concept), TitTees (concept).`;

async function askClaude(userMessage) {
  history.push({ role: 'user', content: userMessage });

  // Keep history to last 20 exchanges to avoid token bloat
  const trimmed = history.slice(-20);

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM,
      messages: trimmed,
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            resolve(`Error: ${json.error.message}`);
          } else {
            const reply = json.content?.[0]?.text || 'Sorry, something went wrong.';
            history.push({ role: 'assistant', content: reply });
            resolve(reply);
          }
        } catch (e) {
          resolve('Sorry, something went wrong parsing the response.');
        }
      });
    });
    req.on('error', () => resolve('Sorry, network error reaching Claude.'));
    req.write(body);
    req.end();
  });
}

// ─── Main polling loop ───────────────────────────────────────────────────────
let offset = 0;
try {
  const saved = readFileSync(STATE, 'utf-8').trim();
  if (saved) offset = parseInt(saved) || 0;
} catch {}

console.log(`[Team Captain Agent] Started. Polling from offset ${offset}`);
console.log(`[Team Captain Agent] Listening for messages from chat ${CHAT_ID}`);

async function poll() {
  while (true) {
    try {
      const url = `${BASE}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message"]`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          const msg = update.message;

          // Only respond to messages from Jasson
          if (msg?.text && String(msg.from?.id) === CHAT_ID) {
            const userText = msg.text.trim();
            console.log(`[${new Date().toISOString()}] Jasson: "${userText}"`);

            // Send typing indicator
            await sendTyping();

            // Get Claude response
            const reply = await askClaude(userText);
            console.log(`[${new Date().toISOString()}] Reply: "${reply.slice(0, 100)}..."`);

            // Send reply
            await sendMessage(reply);
          }

          offset = update.update_id + 1;
          writeFileSync(STATE, String(offset));
        }
      }
    } catch (err) {
      console.error(`[Team Captain Agent] Error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

poll();
