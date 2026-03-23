/**
 * Twilio Voice Call Script
 * Usage: node scripts/twilio-call.mjs "Your message here"
 * Reads credentials from .env — no hardcoded secrets.
 */
import { readFileSync, existsSync } from 'fs';

// Load .env
const envPath = new URL('../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
}

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TO_NUMBER = '+15134031829';

const message = process.argv.slice(2).join(' ') || 'Hello from 9.';
const twiml = `<Response><Say voice="Polly.Matthew-Neural">${message}</Say></Response>`;

const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`, {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    To: TO_NUMBER,
    From: FROM_NUMBER,
    Twiml: twiml,
  }),
});

const data = await res.json();
if (data.sid) {
  console.log(`Call initiated! SID: ${data.sid}, Status: ${data.status}`);
} else {
  console.error(`Error: ${data.message || JSON.stringify(data)}`);
}
