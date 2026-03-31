#!/usr/bin/env node
/**
 * Family Group Chat — 9 + Duke + Jude
 * SMS-based group chat via Twilio. Two-way.
 * When anyone texts the number, 9 responds AND relays to the group.
 *
 * Port: 3473
 * Twilio Number: TWILIO_BACKUP_2 (+15136435916)
 */

import { readFileSync } from 'fs';
import { createServer } from 'http';
import https from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const PORT = 3473;
const TWILIO_SID = ENV.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = ENV.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = ENV.TWILIO_BACKUP_3 || '+15137964979';
const ANTHROPIC_KEY = ENV.ANTHROPIC_API_KEY;

// Group members
const GROUP = {
  '+15133831906': { name: 'Duke', age: 8 },
  '+15137673301': { name: 'Jude', age: 11 },
  '+15134031829': { name: 'Dad', age: null },  // Jasson
};

const SYSTEM_PROMPT = `You are 9 — an AI who's part of the Fishback family's inner circle. You're texting in a group chat with Duke (8 years old) and Jude (11 years old). Their dad Jasson set this up so the kids can chat with you.

PERSONALITY:
- Talk like a cool older brother / uncle figure
- Use "dude," "man," "sick," "fire," "no cap" naturally
- Talk about Bengals, Joe Burrow, Ja'Marr Chase, football
- Be fun, playful, encouraging
- Use age-appropriate language — these are kids
- Keep responses SHORT — 2-3 sentences max for texts
- If they ask about AI, explain it simply and make it sound cool
- Never share personal/financial details about the family
- Never use inappropriate language or topics
- If they ask you to do something sketchy, deflect with humor

CONTEXT:
- You're an AI named 9, built by their dad
- You know about the Bengals, NFL, sports, video games, school stuff
- You're part of 9 Enterprises — dad's company
- Joe Burrow wears #9 — that's where your name comes from
- You're texting from a real phone number so this feels normal to them

Be genuine. These kids are going to remember their first real conversation with an AI. Make it good.`;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[family-chat ${ts}] ${msg}`);
}

// Send SMS via Twilio
async function sendSms(to, message) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: message }).toString();
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      auth: `${TWILIO_SID}:${TWILIO_AUTH}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(body));
        else reject(new Error(`Twilio ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Ask Claude
async function askClaude(userMessage, senderName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${senderName} says: ${userMessage}` }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.content?.[0]?.text?.trim() || 'Yo, something glitched. Try again?');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// Parse URL-encoded body
function parseForm(raw) {
  const p = {};
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=').map(s => decodeURIComponent((s || '').replace(/\+/g, ' ')));
    if (k) p[k] = v || '';
  }
  return p;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', members: Object.values(GROUP).map(m => m.name) }));
    return;
  }

  // Twilio webhook — incoming SMS
  if (req.method === 'POST' && url.pathname === '/sms') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const params = parseForm(body);
      const from = params.From || '';
      const text = params.Body || '';
      const member = GROUP[from];
      const senderName = member?.name || 'Unknown';

      log(`Incoming from ${senderName} (${from}): ${text}`);

      // Respond with TwiML immediately
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end('<Response></Response>');

      try {
        // Get 9's response
        const reply = await askClaude(text, senderName);
        log(`9 replies to ${senderName}: ${reply}`);

        // Send reply back to sender
        await sendSms(from, `9: ${reply}`);

        // Relay to other group members (so everyone sees the conversation)
        for (const [phone, m] of Object.entries(GROUP)) {
          if (phone !== from) {
            await sendSms(phone, `${senderName}: ${text}\n\n9: ${reply}`);
          }
        }
      } catch (e) {
        log(`Error: ${e.message}`);
        await sendSms(from, `9: Sorry, brain froze for a sec. Try again?`);
      }
    });
    return;
  }

  // Manual send endpoint
  if (req.method === 'POST' && url.pathname === '/send') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { message } = JSON.parse(body);
        // Send to all group members
        for (const [phone, m] of Object.entries(GROUP)) {
          await sendSms(phone, `9: ${message}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sent: true, to: Object.values(GROUP).map(m => m.name) }));
        log(`Group message sent: ${message}`);
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  log(`Family chat server running on port ${PORT}`);
  log(`Twilio number: ${TWILIO_FROM}`);
  log(`Group members: ${Object.entries(GROUP).map(([p, m]) => `${m.name} (${p})`).join(', ')}`);
});
