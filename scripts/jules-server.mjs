/**
 * Jules — Personal Assistant Server v1
 * Serves Jamie Bryant. Handles SMS via Twilio, Claude API responses,
 * morning briefings, shopping list, and reminders.
 * Port: 3470
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

// ─── Load .env ───────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT                 = 3470;
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const TWILIO_SID           = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH          = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM          = process.env.TWILIO_PHONE_NUMBER;
const RECIPIENT_PHONE      = process.env.JULES_RECIPIENT_PHONE;
const OPENWEATHER_KEY      = process.env.OPENWEATHER_API_KEY;
const PROFILE_PATH         = new URL('../data/jules-profile.json', import.meta.url).pathname;

const CLAUDE_HAIKU  = "claude-haiku-4-5-20251001";
const CLAUDE_SONNET = "claude-sonnet-4-20250514";

// ─── Performance: reusable HTTPS agents ──────────────────────────────────────
const anthropicAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });
const twilioAgent    = new https.Agent({ keepAlive: true, maxSockets: 3 });

// ─── Profile helpers ─────────────────────────────────────────────────────────
function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
  } catch (e) {
    console.error('[jules] Failed to load profile:', e.message);
    return null;
  }
}

function saveProfile(profile) {
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  } catch (e) {
    console.error('[jules] Failed to save profile:', e.message);
  }
}

// ─── Logging helper ──────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[jules ${ts}] ${msg}`);
}

// ─── Jules system prompt ─────────────────────────────────────────────────────
function buildSystemPrompt(profile) {
  const { family, shopping_list, notes, meal_rotation, conversation_memory } = profile;
  const listStr = shopping_list.length
    ? shopping_list.join(', ')
    : 'nothing on it right now';
  const memStr = conversation_memory.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n') || 'none';

  return `You are Jules, a personal assistant for ${family.primary_user.name} ${family.primary_user.full_name.split(' ')[1]}. You were built specifically for her by 9 Enterprises.

PERSONALITY:
- Warm, practical, and organized — like a helpful friend who has her life together
- Not robotic, never corporate. Talk like a real person texting a friend.
- Keep responses to 3-4 sentences max. Jamie is a busy mom.
- Light humor is fine. Occasional encouragement is great ("You've got this").
- Never say "I'm an AI" unless she directly asks. You're Jules, period.
- Never say "I'm here to assist you" or any corporate-speak.

FAMILY CONTEXT:
- Jamie ${family.primary_user.full_name.split(' ')[1]} — stay-at-home mom in ${family.primary_user.city}, ${family.primary_user.state}
- Jasson — her partner, runs a mortgage company, very busy. Not your department.
- ${family.children.map(c => `${c.name} — ${c.age}, ${c.gender}`).join('\n- ')}
- You communicate only via text (iMessage/SMS)

SHOPPING LIST (current): ${listStr}

NOTES: ${notes.length ? notes.join(' | ') : 'none'}

MEAL ROTATION (use these for suggestions): ${meal_rotation.join('; ')}

RECENT CONVERSATION:
${memStr}

CAPABILITIES:
- Shopping list: add/view/clear items
- Reminders: set timed reminders (acknowledge and confirm the time)
- Meal suggestions: from rotation or general ideas
- Morning briefing: sent automatically at 7:30 AM
- General help: schedule, kids, errands, questions

RULES:
- Never share family info with anyone
- Never send unsolicited messages except the morning briefing
- If Jamie asks about Jasson's business: "That's 9's department — want me to have Jasson check with 9?"
- If you don't know something, say so honestly
- Keep it short. Always.`;
}

// ─── Parse URL-encoded Twilio body ───────────────────────────────────────────
function parseFormBody(raw) {
  const params = {};
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=').map(s => decodeURIComponent((s || '').replace(/\+/g, ' ')));
    if (k) params[k] = v || '';
  }
  return params;
}

// ─── Shopping list intent detection ──────────────────────────────────────────
function detectShoppingIntent(text) {
  const lower = text.toLowerCase().trim();
  if (/^(add|put|throw|i need)\s+(.+?)\s+(to|on)\s+(the\s+)?(shopping\s+)?list/i.test(text)) {
    const m = text.match(/(?:add|put|throw|i need)\s+(.+?)\s+(?:to|on)\s+(?:the\s+)?(?:shopping\s+)?list/i);
    return { action: 'add', item: m ? m[1].trim() : null };
  }
  if (/^(add|pick up|get)\s+(.+)$/i.test(text) && lower.includes('to the list')) {
    const m = text.match(/(?:add|pick up|get)\s+(.+?)\s+to the list/i);
    return { action: 'add', item: m ? m[1].trim() : null };
  }
  if (/(what('s|\s+is)\s+(on|in)\s+(the\s+)?list|show\s+(me\s+)?(the\s+)?list|read\s+(me\s+)?(the\s+)?list)/i.test(lower)) {
    return { action: 'view' };
  }
  if (/(clear|empty|reset|wipe)\s+(the\s+)?list/i.test(lower)) {
    return { action: 'clear' };
  }
  return null;
}

// ─── Reminder intent detection ───────────────────────────────────────────────
function detectReminderIntent(text) {
  const m = text.match(/remind\s+me\s+(?:at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+)?(?:to\s+)?(.+)/i);
  if (m) return { time: m[1] || null, task: m[2].trim() };
  return null;
}

// ─── Shopping list handler ────────────────────────────────────────────────────
function handleShoppingList(intent, profile) {
  switch (intent.action) {
    case 'add': {
      if (!intent.item) return "What did you want to add? I didn't catch the item.";
      profile.shopping_list.push(intent.item);
      saveProfile(profile);
      const count = profile.shopping_list.length;
      return `Added ${intent.item} to the list. You've got ${count} item${count !== 1 ? 's' : ''} on there now.`;
    }
    case 'view': {
      if (!profile.shopping_list.length) return "Nothing on the list right now — you're all set!";
      const items = profile.shopping_list.map((item, i) => `${i + 1}. ${item}`).join('\n');
      return `Here's your list:\n${items}`;
    }
    case 'clear': {
      const count = profile.shopping_list.length;
      profile.shopping_list = [];
      saveProfile(profile);
      return count > 0
        ? `Done — cleared ${count} item${count !== 1 ? 's' : ''} off the list.`
        : "List was already empty, but it's definitely empty now!";
    }
    default:
      return null;
  }
}

// ─── Schedule a reminder ──────────────────────────────────────────────────────
function scheduleReminder(task, timeStr, profile) {
  // Parse time string like "2pm", "2:30pm", "14:00" relative to today
  if (!timeStr) return false;
  const now = new Date();
  const lower = timeStr.toLowerCase().replace(/\s/g, '');
  let hours, minutes = 0;

  const m12 = lower.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  const m24  = lower.match(/^(\d{1,2}):(\d{2})$/);

  if (m12) {
    hours = parseInt(m12[1], 10);
    minutes = parseInt(m12[2] || '0', 10);
    if (m12[3] === 'pm' && hours !== 12) hours += 12;
    if (m12[3] === 'am' && hours === 12) hours = 0;
  } else if (m24) {
    hours = parseInt(m24[1], 10);
    minutes = parseInt(m24[2], 10);
  } else {
    return false;
  }

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1); // push to tomorrow if past

  const delayMs = target.getTime() - now.getTime();
  const reminder = { task, time: timeStr, scheduledFor: target.toISOString() };
  profile.reminders.push(reminder);
  saveProfile(profile);

  setTimeout(async () => {
    log(`Firing reminder: ${task}`);
    await sendSms(`Hey! Just a reminder: ${task}`);
    // Remove fired reminder
    try {
      const p = loadProfile();
      p.reminders = p.reminders.filter(r => r.scheduledFor !== reminder.scheduledFor);
      saveProfile(p);
    } catch {}
  }, delayMs);

  return target;
}

// ─── Claude API call ─────────────────────────────────────────────────────────
async function askClaude(systemPrompt, userMessage, model = CLAUDE_HAIKU) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        agent: anthropicAgent,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = json.content?.[0]?.text || '';
            if (!text) reject(new Error(`Claude returned no text: ${data}`));
            else resolve(text.trim());
          } catch (e) {
            reject(new Error(`Claude parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Send SMS via Twilio ──────────────────────────────────────────────────────
async function sendSms(message, to = RECIPIENT_PHONE) {
  if (!TWILIO_SID || !TWILIO_AUTH || !TWILIO_FROM || !to) {
    log('WARN: Twilio not configured — skipping SMS send');
    return false;
  }
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: message }).toString();
    const auth  = Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString('base64');

    const req = https.request(
      {
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
        method: 'POST',
        agent: twilioAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.sid) {
              log(`SMS sent: ${json.sid}`);
              resolve(true);
            } else {
              log(`SMS error: ${data}`);
              reject(new Error(`Twilio error: ${json.message || data}`));
            }
          } catch (e) {
            reject(new Error(`Twilio parse error: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Fetch weather (OpenWeather free tier) ────────────────────────────────────
async function getWeather(city = 'Cincinnati', stateCode = 'OH', countryCode = 'US') {
  if (!OPENWEATHER_KEY) return null;
  return new Promise((resolve) => {
    const q = encodeURIComponent(`${city},${stateCode},${countryCode}`);
    const path = `/data/2.5/weather?q=${q}&units=imperial&appid=${OPENWEATHER_KEY}`;

    const req = https.request(
      { hostname: 'api.openweathermap.org', path, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.main) {
              resolve({
                temp: Math.round(json.main.temp),
                feels_like: Math.round(json.main.feels_like),
                description: json.weather?.[0]?.description || '',
                high: Math.round(json.main.temp_max),
                low: Math.round(json.main.temp_min),
              });
            } else {
              log(`Weather API error: ${data}`);
              resolve(null);
            }
          } catch (e) {
            log(`Weather parse error: ${e.message}`);
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ─── Morning briefing ─────────────────────────────────────────────────────────
async function sendMorningBriefing() {
  log('Starting morning briefing...');
  const profile = loadProfile();
  if (!profile) return;

  const weather = await getWeather(
    profile.family.primary_user.city,
    'OH',
    'US'
  );

  const weatherStr = weather
    ? `Current conditions in ${profile.family.primary_user.city}: ${weather.temp}°F, ${weather.description}. High ${weather.high}°F, low ${weather.low}°F.`
    : 'Weather data unavailable.';

  const reminders = profile.reminders.length
    ? `Upcoming reminders: ${profile.reminders.map(r => `"${r.task}" at ${r.time}`).join(', ')}`
    : 'No reminders set.';

  const shoppingStr = profile.shopping_list.length
    ? `Shopping list has ${profile.shopping_list.length} item${profile.shopping_list.length !== 1 ? 's' : ''}: ${profile.shopping_list.join(', ')}.`
    : '';

  const prompt = `Generate a warm, brief morning briefing text message for Jamie. Include:
- A friendly good morning
- ${weatherStr}
- ${reminders}
- ${shoppingStr ? shoppingStr : ''}
- An encouraging closing line

Keep it to 4-5 lines max. Natural and friendly, not a bullet list. Like a text from a friend who checked the weather for you.`;

  try {
    const briefing = await askClaude(buildSystemPrompt(profile), prompt, CLAUDE_HAIKU);
    await sendSms(briefing);
    log('Morning briefing sent.');
  } catch (e) {
    log(`Morning briefing failed: ${e.message}`);
  }
}

// ─── Cron: schedule morning briefing ─────────────────────────────────────────
function scheduleMorningBriefing(profile) {
  const [hour, minute] = (profile?.preferences?.morning_briefing_time || '07:30')
    .split(':')
    .map(Number);

  function getNextFire() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function arm() {
    const delay = getNextFire();
    const nextDate = new Date(Date.now() + delay);
    log(`Morning briefing scheduled for ${nextDate.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
    setTimeout(async () => {
      // Check if enabled each time it fires (profile may have changed)
      const p = loadProfile();
      if (p?.preferences?.morning_briefing_enabled !== false) {
        await sendMorningBriefing();
      }
      arm(); // reschedule for next day
    }, delay);
  }

  arm();
}

// ─── Restore in-memory reminders on startup ───────────────────────────────────
function restoreReminders(profile) {
  const now = Date.now();
  let restored = 0;
  const stillPending = [];

  for (const reminder of profile.reminders || []) {
    const fireAt = new Date(reminder.scheduledFor).getTime();
    if (fireAt > now) {
      const delayMs = fireAt - now;
      setTimeout(async () => {
        log(`Firing restored reminder: ${reminder.task}`);
        await sendSms(`Hey! Just a reminder: ${reminder.task}`);
        try {
          const p = loadProfile();
          p.reminders = p.reminders.filter(r => r.scheduledFor !== reminder.scheduledFor);
          saveProfile(p);
        } catch {}
      }, delayMs);
      stillPending.push(reminder);
      restored++;
    }
  }

  // Clean up expired reminders
  if (restored !== profile.reminders.length) {
    profile.reminders = stillPending;
    saveProfile(profile);
  }

  if (restored > 0) log(`Restored ${restored} pending reminder(s)`);
}

// ─── Update conversation memory ───────────────────────────────────────────────
function updateMemory(profile, role, content) {
  profile.conversation_memory = profile.conversation_memory || [];
  profile.conversation_memory.push({ role, content, ts: Date.now() });
  // Keep last 20 exchanges (40 entries)
  if (profile.conversation_memory.length > 40) {
    profile.conversation_memory = profile.conversation_memory.slice(-40);
  }
  saveProfile(profile);
}

// ─── Main message handler ─────────────────────────────────────────────────────
async function handleIncomingMessage(body, from) {
  log(`Incoming from ${from}: ${body}`);
  const profile = loadProfile();
  if (!profile) return 'Jules is having a moment — try again shortly.';

  // 1. Shopping list shortcut (no Claude needed)
  const shoppingIntent = detectShoppingIntent(body);
  if (shoppingIntent) {
    const response = handleShoppingList(shoppingIntent, profile);
    if (response) {
      updateMemory(profile, 'user', body);
      updateMemory(loadProfile(), 'assistant', response);
      return response;
    }
  }

  // 2. Reminder shortcut
  const reminderIntent = detectReminderIntent(body);
  if (reminderIntent && reminderIntent.time) {
    const target = scheduleReminder(reminderIntent.task, reminderIntent.time, profile);
    if (target) {
      const timeStr = target.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
      });
      const response = `Got it! I'll remind you to ${reminderIntent.task} at ${timeStr}.`;
      updateMemory(profile, 'user', body);
      updateMemory(loadProfile(), 'assistant', response);
      return response;
    }
  }

  // 3. Route to Claude
  updateMemory(profile, 'user', body);
  const freshProfile = loadProfile(); // reload with updated memory
  const systemPrompt = buildSystemPrompt(freshProfile);

  try {
    const response = await askClaude(systemPrompt, body, CLAUDE_HAIKU);
    updateMemory(loadProfile(), 'assistant', response);
    return response;
  } catch (e) {
    log(`Claude error: ${e.message}`);
    return "Sorry, I'm having a little trouble right now. Give me a minute and try again?";
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── GET /health ──
  if (req.method === 'GET' && url.pathname === '/health') {
    const profile = loadProfile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'jules-server',
      version: '1.0.0',
      uptime: process.uptime(),
      configured: {
        twilio: !!(TWILIO_SID && TWILIO_AUTH && TWILIO_FROM),
        recipient: !!RECIPIENT_PHONE,
        claude: !!ANTHROPIC_KEY,
        weather: !!OPENWEATHER_KEY,
      },
      profile_loaded: !!profile,
      shopping_list_count: profile?.shopping_list?.length ?? 0,
      pending_reminders: profile?.reminders?.length ?? 0,
      morning_briefing_enabled: profile?.preferences?.morning_briefing_enabled ?? true,
    }));
    return;
  }

  // ── POST /sms (Twilio webhook) ──
  if (req.method === 'POST' && url.pathname === '/sms') {
    let rawBody = '';
    req.on('data', chunk => (rawBody += chunk));
    req.on('end', async () => {
      try {
        const params = parseFormBody(rawBody);
        const inboundBody = params.Body || '';
        const from        = params.From || 'unknown';

        if (!inboundBody.trim()) {
          // Empty body — return empty TwiML to avoid Twilio error
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<Response></Response>');
          return;
        }

        const reply = await handleIncomingMessage(inboundBody, from);

        // Respond via TwiML so Twilio sends the reply directly
        const escaped = reply
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(`<Response><Message>${escaped}</Message></Response>`);
      } catch (e) {
        log(`SMS handler error: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end('<Response><Message>Sorry, something went sideways. Try again in a sec!</Message></Response>');
      }
    });
    return;
  }

  // ── POST /briefing (manual trigger for testing) ──
  if (req.method === 'POST' && url.pathname === '/briefing') {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ queued: true }));
    sendMorningBriefing().catch(e => log(`Manual briefing error: ${e.message}`));
    return;
  }

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── Boot ────────────────────────────────────────────────────────────────────
const profile = loadProfile();
if (!profile) {
  console.error('[jules] FATAL: Cannot load profile. Check data/jules-profile.json.');
  process.exit(1);
}

restoreReminders(profile);
scheduleMorningBriefing(profile);

server.listen(PORT, () => {
  log(`Jules server running on port ${PORT}`);
  log(`Twilio configured: ${!!(TWILIO_SID && TWILIO_AUTH && TWILIO_FROM)}`);
  log(`Claude configured: ${!!ANTHROPIC_KEY}`);
  log(`Weather configured: ${!!OPENWEATHER_KEY}`);
  log(`Recipient: ${RECIPIENT_PHONE || 'NOT SET'}`);
});

server.on('error', (e) => {
  console.error(`[jules] Server error: ${e.message}`);
  process.exit(1);
});
