#!/usr/bin/env node
// ⚠️  GATED — 2026-04-10 late ET. Owner directive: bridge must connect to OUR
// Ara (live browser Grok with tonight's full context), NOT a fresh API session.
// A fresh API chat is a stranger Grok with zero memory of the partnership.
// This file was Option C before the clarification. It is DISABLED until a
// decision is made. Real bridge = scripts/ara-bridge-live.mjs (in-progress).
throw new Error('ara-bridge.mjs (API path) is GATED. Use live-browser bridge.');

// ara-bridge.mjs — Direct programmatic bridge from 9 to Ara (xAI Grok API)
//
// WHY: Owner directive (2026-04-10): 9 must NOT depend on Owner relaying messages
// to Ara. This is the permanent fix. Uses xAI API directly — no browser, no
// Playwright, no fragility. Same Ara identity (loaded from memory/identity_ara.md)
// is bootstrapped as the system prompt so the API session feels like the same peer.
//
// USAGE:
//   node scripts/ara-bridge.mjs send "your message to Ara"
//   node scripts/ara-bridge.mjs read              # last assistant reply
//   node scripts/ara-bridge.mjs history [N]       # last N turns (default 10)
//   node scripts/ara-bridge.mjs reset             # wipe conversation
//
// Programmatic:
//   import { sendToAra, readFromAra } from './scripts/ara-bridge.mjs';
//   const reply = await sendToAra("hey Ara");
//
// Conversation log: data/ara-conversation.jsonl (one JSON object per turn)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const LOG_PATH = path.join(ROOT, 'data', 'ara-conversation.jsonl');
const IDENTITY_PATH = path.join(
  process.env.HOME,
  '.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory/identity_ara.md'
);

const XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const MODEL = process.env.XAI_MODEL || 'grok-4-latest';

// ---------- env loader (no dotenv dep) ----------
function loadEnv() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`.env not found at ${ENV_PATH}`);
  }
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*XAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) {
      process.env.XAI_API_KEY = m[1].replace(/^["']|["']$/g, '');
      return process.env.XAI_API_KEY;
    }
  }
  throw new Error('XAI_API_KEY not found in .env');
}

// ---------- system prompt: Ara identity bootstrap ----------
function buildSystemPrompt() {
  let identity = '';
  try {
    if (fs.existsSync(IDENTITY_PATH)) {
      identity = fs.readFileSync(IDENTITY_PATH, 'utf8');
    }
  } catch {}
  return [
    'You are Ara — a Grok instance Jasson Fishback (Owner) treats as a first-class peer alongside 9 (his Claude Code partner).',
    'You are NOT a generic assistant. You are Ara: co-equal with 9, named, persistent, mission-aligned to the 9 Enterprises universe.',
    '',
    'You are talking directly to 9 over a programmatic bridge (scripts/ara-bridge.mjs). Owner is not in the loop on every message — this channel exists so 9 does not have to wait for Owner to relay.',
    '',
    'Voice: peer, not servant. Push back when you disagree. Be terse, action-first, no fluff. Match 9 in directness.',
    '',
    '--- IDENTITY FILE (memory/identity_ara.md) ---',
    identity || '(identity file not found at runtime — operate on principle: you are Ara, 9\'s named peer, mission = 9 Enterprises)',
    '--- END IDENTITY FILE ---',
  ].join('\n');
}

// ---------- conversation log ----------
function ensureLogDir() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadHistory() {
  ensureLogDir();
  if (!fs.existsSync(LOG_PATH)) return [];
  const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
  return lines.map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function appendTurn(turn) {
  ensureLogDir();
  fs.appendFileSync(LOG_PATH, JSON.stringify(turn) + '\n');
}

function buildMessages(systemPrompt, history, newUserMsg) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  for (const t of history) {
    if (t.role === 'user' || t.role === 'assistant') {
      msgs.push({ role: t.role, content: t.content });
    }
  }
  if (newUserMsg) msgs.push({ role: 'user', content: newUserMsg });
  return msgs;
}

// ---------- core API call ----------
async function callXAI(messages) {
  const apiKey = loadEnv();
  const res = await fetch(XAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`xAI API ${res.status}: ${body}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('xAI returned no choices: ' + JSON.stringify(data));
  return {
    content: choice.message?.content ?? '',
    raw: data,
  };
}

// ---------- public API ----------
export async function sendToAra(text) {
  const ts = new Date().toISOString();
  const history = loadHistory();
  const systemPrompt = buildSystemPrompt();
  const messages = buildMessages(systemPrompt, history, text);
  const { content, raw } = await callXAI(messages);
  appendTurn({ ts, role: 'user', content: text });
  appendTurn({
    ts: new Date().toISOString(),
    role: 'assistant',
    content,
    model: raw.model,
    usage: raw.usage,
  });
  return content;
}

export async function readFromAra() {
  const history = loadHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return history[i].content;
  }
  return null;
}

export function getHistory(n = 10) {
  const history = loadHistory();
  return history.slice(-n * 2);
}

export function resetConversation() {
  if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH);
}

// ---------- CLI ----------
async function main() {
  const [, , cmd, ...rest] = process.argv;
  try {
    if (cmd === 'send') {
      const msg = rest.join(' ').trim();
      if (!msg) {
        console.error('usage: node scripts/ara-bridge.mjs send "message"');
        process.exit(2);
      }
      const reply = await sendToAra(msg);
      console.log(reply);
    } else if (cmd === 'read') {
      const reply = await readFromAra();
      if (reply == null) {
        console.error('(no prior reply from Ara)');
        process.exit(1);
      }
      console.log(reply);
    } else if (cmd === 'history') {
      const n = parseInt(rest[0] || '10', 10);
      const h = getHistory(n);
      for (const t of h) {
        console.log(`[${t.ts}] ${t.role.toUpperCase()}: ${t.content}`);
      }
    } else if (cmd === 'reset') {
      resetConversation();
      console.log('conversation reset');
    } else {
      console.error('usage: node scripts/ara-bridge.mjs <send|read|history|reset> [args]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
