/**
 * Telegram Bot for AiNFL GM — two-way communication
 *
 * Usage:
 *   Send:    node scripts/telegram-bot.mjs send "Your message here"
 *   Check:   node scripts/telegram-bot.mjs check
 *   Poll:    node scripts/telegram-bot.mjs poll (continuous polling)
 *
 * Set TELEGRAM_BOT_TOKEN env var or edit the token below.
 * Set TELEGRAM_CHAT_ID after first message from Jasson.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'PASTE_TOKEN_HERE';
const BASE = `https://api.telegram.org/bot${TOKEN}`;

// Chat ID gets set after Jasson first messages the bot
let CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const command = process.argv[2];
const message = process.argv.slice(3).join(' ');

async function sendMessage(text, chatId) {
  const id = chatId || CHAT_ID;
  if (!id) {
    console.error('No chat ID set. Jasson needs to message the bot first. Run: node scripts/telegram-bot.mjs check');
    return;
  }
  const res = await fetch(`${BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log('Message sent!');
  } else {
    console.error('Send failed:', data.description);
  }
}

async function getUpdates(offset) {
  const url = offset
    ? `${BASE}/getUpdates?offset=${offset}&timeout=30`
    : `${BASE}/getUpdates?timeout=0`;
  const res = await fetch(url);
  const data = await res.json();
  return data.ok ? data.result : [];
}

async function checkMessages() {
  const updates = await getUpdates();
  if (updates.length === 0) {
    console.log('No messages yet. Jasson needs to open @ainflgm_bot in Telegram and send a message.');
    return;
  }
  for (const u of updates) {
    const msg = u.message;
    if (msg) {
      const chatId = msg.chat.id;
      const from = msg.from.first_name || 'Unknown';
      const text = msg.text || '(no text)';
      console.log(`[${from}] (chat_id: ${chatId}): ${text}`);

      // Save chat ID for future use
      if (!CHAT_ID) {
        CHAT_ID = chatId;
        console.log(`\nChat ID discovered: ${chatId}`);
        console.log(`Set env: export TELEGRAM_CHAT_ID=${chatId}`);
      }
    }
  }
}

async function pollMessages() {
  console.log('Polling for messages... (Ctrl+C to stop)');
  let offset = 0;

  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        const msg = u.message;
        if (msg) {
          const from = msg.from.first_name || 'Unknown';
          const text = msg.text || '(no text)';
          const chatId = msg.chat.id;
          console.log(`[${new Date().toLocaleTimeString()}] ${from}: ${text}`);

          if (!CHAT_ID) {
            CHAT_ID = String(chatId);
            console.log(`Chat ID set: ${chatId}`);
          }
        }
        offset = u.update_id + 1;
      }
    } catch (err) {
      console.error('Poll error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

if (command === 'send') {
  if (!message) {
    console.error('Usage: node scripts/telegram-bot.mjs send "Your message"');
    process.exit(1);
  }
  await sendMessage(message);
} else if (command === 'check') {
  await checkMessages();
} else if (command === 'poll') {
  await pollMessages();
} else {
  console.log('Usage:');
  console.log('  node scripts/telegram-bot.mjs send "message"');
  console.log('  node scripts/telegram-bot.mjs check');
  console.log('  node scripts/telegram-bot.mjs poll');
}
