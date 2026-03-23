/**
 * Telegram Background Listener
 * Runs as a background process, receives messages via long-polling,
 * writes them to /tmp/telegram-inbox.txt for instant checking.
 *
 * Usage: node scripts/telegram-listener.mjs &
 */

const TOKEN = '8767603151:AAGDg_yjVtJNyFe-deEy2FGYdnBOiM43B9E';
const CHAT_ID = '8784022142';
const BASE = `https://api.telegram.org/bot${TOKEN}`;
const INBOX_FILE = '/tmp/telegram-inbox.txt';
const LAST_READ_FILE = '/tmp/telegram-last-read.txt';

import { writeFileSync, readFileSync, appendFileSync, existsSync } from 'fs';

// Initialize files
if (!existsSync(INBOX_FILE)) writeFileSync(INBOX_FILE, '');
if (!existsSync(LAST_READ_FILE)) writeFileSync(LAST_READ_FILE, '0');

let offset = 0;

// Try to resume from last known offset
try {
  const saved = readFileSync(LAST_READ_FILE, 'utf-8').trim();
  if (saved) offset = parseInt(saved) || 0;
} catch {}

console.log(`[Telegram Listener] Started. Polling from offset ${offset}`);
console.log(`[Telegram Listener] Messages will be written to ${INBOX_FILE}`);

async function poll() {
  while (true) {
    try {
      const url = `${BASE}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message"]`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          const msg = update.message;
          if (msg && msg.text) {
            const timestamp = new Date().toISOString();
            const from = msg.from.first_name || 'Unknown';
            const line = `[${timestamp}] ${from}: ${msg.text}\n`;

            // Append to inbox file
            appendFileSync(INBOX_FILE, line);
            console.log(`[Telegram] ${from}: ${msg.text}`);
          }
          offset = update.update_id + 1;
        }
        // Save offset for resume
        writeFileSync(LAST_READ_FILE, String(offset));
      }
    } catch (err) {
      console.error(`[Telegram Listener] Error: ${err.message}`);
      // Wait before retrying on error
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

poll();
