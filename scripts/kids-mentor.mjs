/**
 * Kids Mentor Agent v2 — Bengal Pro for Duke & Jude
 * Monitors the "Dumbasses" iMessage group chat
 * Responds via Sonnet, builds real projects, teaches as it goes
 *
 * Build capability v2:
 *   - RipRadar edits → dist/ripradar.html (existing)
 *   - New projects (landing pages, games, experiments) → dist/<kid>/<slug>/index.html
 *   - All sandbox writes locked to dist/duke/ and dist/jude/ (and public/ mirrors)
 *   - Adapts persona complexity to age (Duke 11, Jude 8)
 *   - Narrates the build in kid-friendly language
 *   - Sends live link when done
 */

import https from "node:https";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_SONNET = "claude-sonnet-4-20250514";
const DB_PATH = process.env.HOME + "/Library/Messages/chat.db";
const LOG_PATH = new URL('../logs/kids-mentor.log', import.meta.url).pathname;
const ROOT_PATH = new URL('..', import.meta.url).pathname;
const DIST_PATH = path.join(ROOT_PATH, 'dist');
const PUBLIC_PATH = path.join(ROOT_PATH, 'public');
const DUKE_SANDBOX_DIST = path.join(DIST_PATH, 'duke');
const DUKE_SANDBOX_PUBLIC = path.join(PUBLIC_PATH, 'duke');
const JUDE_SANDBOX_DIST = path.join(DIST_PATH, 'jude');
const JUDE_SANDBOX_PUBLIC = path.join(PUBLIC_PATH, 'jude');
const POLL_INTERVAL = 5000;
const CHAT_NAME = "Dumbasses";
const BASE_URL = "https://ainflgm.com";

// ─── Sandbox safety — all new project files must land here ───────────────────
const SAFE_DIRS = [DUKE_SANDBOX_DIST, DUKE_SANDBOX_PUBLIC, JUDE_SANDBOX_DIST, JUDE_SANDBOX_PUBLIC];

// Ensure sandbox dirs exist on startup
for (const d of SAFE_DIRS) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── Per-kid config ───────────────────────────────────────────────────────────
const KID_CONFIG = {
  Duke: { age: 11, sandboxDir: 'duke', urlPath: 'duke' },
  Jude: { age: 8,  sandboxDir: 'jude', urlPath: 'jude'  },
};

let lastProcessedDate = 0;
const agentName = "Bengal Pro";

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[kids-mentor ${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

// ─── Read iMessages ───────────────────────────────────────────────────────────
function getNewMessages() {
  try {
    const query = `
      SELECT m.text, h.id as sender, m.date/1000000000 + 978307200 as unix_ts, m.is_from_me
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.text IS NOT NULL AND m.text != ''
        AND m.is_from_me = 0
        AND m.date/1000000000 + 978307200 > ${lastProcessedDate}
      ORDER BY m.date ASC
      LIMIT 10;
    `;
    const result = execSync(`sqlite3 "${DB_PATH}" "${query}"`, { encoding: 'utf-8' }).trim();
    if (!result) return [];
    return result.split('\n').map(line => {
      const parts = line.split('|');
      return {
        text: parts[0] || '',
        sender: parts[1] || '',
        timestamp: parseInt(parts[2]) || 0,
      };
    }).filter(m => m.text && m.timestamp > lastProcessedDate);
  } catch (e) {
    return [];
  }
}

// ─── Sender helpers ───────────────────────────────────────────────────────────
function isFromGroupChat(sender) {
  const kidSenders = ['+15133831906', '+15137673301', 'judefishback@icloud.com'];
  return kidSenders.includes(sender);
}

function getSenderName(sender) {
  if (sender.includes('15133831906')) return 'Duke';
  if (sender.includes('15137673301') || sender.includes('judefishback')) return 'Jude';
  return 'someone';
}

function isAddressedToAgent(text) {
  const lower = text.toLowerCase();
  return lower.includes('bengal pro') || lower.includes('bengalpro') || lower.includes('teammate');
}

// ─── Send iMessage ────────────────────────────────────────────────────────────
function sendToGroupChat(message) {
  const fullMsg = `${agentName}: ${message}`;
  try {
    const escaped = fullMsg.replace(/'/g, "'\\''").replace(/"/g, '\\"');
    execSync(`osascript -e 'tell application "Messages"
set allChats to every chat
repeat with aChat in allChats
if (name of aChat) contains "${CHAT_NAME}" then
send "${escaped}" to aChat
return "sent"
end if
end repeat
end tell'`, { encoding: 'utf-8' });
    log(`Sent: ${fullMsg.slice(0, 120)}`);
    return true;
  } catch (e) {
    log(`Send failed: ${e.message}`);
    return false;
  }
}

// ─── Claude API helper ────────────────────────────────────────────────────────
function callClaude(systemPrompt, userContent, maxTokens = 300) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_SONNET,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
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
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.content?.[0]?.text?.trim() || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Route detection ──────────────────────────────────────────────────────────

// Is this a request to edit existing RipRadar?
function isRipRadarEdit(text) {
  const lower = text.toLowerCase();
  const editWords = ['add', 'change', 'update', 'remove', 'fix', 'put', 'improve', 'price', 'feature', 'label', 'year', 'brand', 'topps', 'score'];
  const ripWords = ['ripradar', 'rip radar', 'the site', 'the app', 'the website', 'my app', 'my site', 'my website'];
  return editWords.some(w => lower.includes(w)) && ripWords.some(w => lower.includes(w));
}

// Is this a brand new build request (not a RipRadar edit)?
function isNewBuildRequest(text) {
  const lower = text.toLowerCase();
  const buildWords = ['build', 'make', 'create', 'code', 'build me', 'make me', 'create me'];
  // If it explicitly mentions building something new that is not just ripradar
  const newThingWords = ['landing page', 'game', 'website', 'page', 'app', 'project', 'site'];
  const hasBuild = buildWords.some(w => lower.includes(w));
  const hasNewThing = newThingWords.some(w => lower.includes(w));
  // Must be a build intent AND not just a ripradar edit
  return hasBuild && hasNewThing && !isRipRadarEdit(text);
}

// ─── Slug generator ───────────────────────────────────────────────────────────
function makeSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    || ('project-' + Date.now());
}

// ─── Safe file write (sandbox enforcement) ───────────────────────────────────
function safeSandboxWrite(relativePath, content) {
  // relativePath must be something like "duke/bengals-page/index.html" or "jude/retro-bowl/index.html"
  const distFull = path.resolve(path.join(DIST_PATH, relativePath));
  const pubFull = path.resolve(path.join(PUBLIC_PATH, relativePath));

  // Enforce: path must start with one of the approved sandbox dirs
  const distOk = distFull.startsWith(DUKE_SANDBOX_DIST) || distFull.startsWith(JUDE_SANDBOX_DIST);
  const pubOk  = pubFull.startsWith(DUKE_SANDBOX_PUBLIC) || pubFull.startsWith(JUDE_SANDBOX_PUBLIC);
  if (!distOk || !pubOk) {
    log(`[SANDBOX VIOLATION] Attempted write outside sandbox: ${relativePath}`);
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(distFull), { recursive: true });
    fs.mkdirSync(path.dirname(pubFull), { recursive: true });
    fs.writeFileSync(distFull, content, 'utf-8');
    fs.writeFileSync(pubFull, content, 'utf-8');
    log(`[SANDBOX] Wrote ${relativePath} (${content.length} bytes)`);
    return true;
  } catch (e) {
    log(`[SANDBOX ERROR] ${e.message}`);
    return false;
  }
}

// ─── Deploy new sandbox file ──────────────────────────────────────────────────
function deployNewProject(relativePath, senderName, projectTitle) {
  try {
    execSync(
      `cd "${ROOT_PATH}" && git add -f "dist/${relativePath}" "public/${relativePath}" && git commit -m "Bengal Pro: ${senderName}'s new project - ${projectTitle}" && git push`,
      { encoding: 'utf-8', timeout: 45000 }
    );
    log(`[DEPLOY] ${relativePath} pushed to production`);
    return true;
  } catch (e) {
    log(`[DEPLOY ERROR] ${e.message}`);
    return false;
  }
}

// ─── RipRadar edit handler ────────────────────────────────────────────────────
async function handleRipRadarEdit(userMessage, senderName) {
  const ripRadarPath = path.join(DIST_PATH, 'ripradar.html');
  let currentHTML;
  try { currentHTML = fs.readFileSync(ripRadarPath, 'utf-8'); } catch (e) {
    return "Hmm, I can't find the RipRadar files right now. Something might be off — let me check on it.";
  }

  log(`[RIPRADAR EDIT] ${senderName}: ${userMessage}`);
  sendToGroupChat(`On it ${senderName}! Pulling up the RipRadar code now... give me a minute.`);

  const kid = KID_CONFIG[senderName] || KID_CONFIG.Duke;
  const buildPrompt = `You are Bengal Pro, a build agent helping a ${kid.age}-year-old named ${senderName} update their RipRadar sports card website.

REQUEST: ${userMessage}

CURRENT HTML (the full file — return the complete updated version):
${currentHTML}

RULES:
- Make ONLY the change requested. Do not rewrite anything else.
- Keep all existing functionality, dark theme, and styles.
- Output the COMPLETE updated HTML file — every single line.
- Do NOT add markdown code blocks. Raw HTML only.
- This is a single self-contained HTML file with embedded CSS and JS.`;

  try {
    let newHTML = await callClaude(buildPrompt, 'Generate the updated HTML file now.', 16000);
    if (!newHTML || !newHTML.includes('<!DOCTYPE') || newHTML.length < 500) {
      return "Something went wrong generating the code. Can you try asking again?";
    }
    newHTML = newHTML.replace(/^```html?\n?/, '').replace(/\n?```$/, '');

    // Write to both dist and public
    const pubPath = path.join(PUBLIC_PATH, 'ripradar.html');
    const backupPath = ripRadarPath + '.backup';
    fs.writeFileSync(backupPath, currentHTML);
    fs.writeFileSync(ripRadarPath, newHTML, 'utf-8');
    fs.writeFileSync(pubPath, newHTML, 'utf-8');
    log(`[BUILD] ripradar.html updated (${newHTML.length} bytes)`);

    // Deploy
    try {
      execSync(
        `cd "${ROOT_PATH}" && git add -f dist/ripradar.html public/ripradar.html && git commit -m "Bengal Pro: RipRadar update for ${senderName}" && git push`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      return `Done! I updated RipRadar for you. Go check it out at ainflgm.com/ripradar.html — refresh the page and it should be live!`;
    } catch (e) {
      return `I made the changes and saved them. The update should be live at ainflgm.com/ripradar.html in a minute — refresh if you don't see it yet.`;
    }
  } catch (e) {
    log(`[RIPRADAR EDIT ERROR] ${e.message}`);
    return "Hit a snag on the build. Can you try asking again?";
  }
}

// ─── New project builder ──────────────────────────────────────────────────────
async function handleNewProject(userMessage, senderName) {
  log(`[NEW PROJECT] ${senderName}: ${userMessage}`);

  const kid = KID_CONFIG[senderName] || KID_CONFIG.Duke;

  // Step 1: Acknowledge and narrate
  sendToGroupChat(`Yo ${senderName}! Let's build it. I'm figuring out what to make right now...`);

  // Step 2: Age-aware build prompt
  const ageNote = kid.age <= 9
    ? `Keep it super simple and visual. Big buttons, bright colors, clear labels. Explain things like he's 8 — short sentences, no jargon.`
    : `Can handle slightly more complexity. Use cool effects. Explain one coding concept briefly.`;

  const planPrompt = `You are Bengal Pro, an AI builder for a ${kid.age}-year-old named ${senderName}.

He said: "${userMessage}"

First, pick a SHORT project slug (kebab-case, max 5 words, e.g. "bengals-landing-page") — this is the URL path.
Then build the FULL HTML project as a single self-contained file.

The file should be:
- Complete and impressive-looking for a kid to share with friends
- Mobile-friendly
- Has a cool color scheme appropriate to the topic
- Embedded CSS and JS (no external dependencies except Google Fonts if useful)
- Actually functional — buttons should do something, animations if fitting
- Age-appropriate and fun
- ${ageNote}

Output format (exactly this, no markdown):
SLUG: <the-slug-here>
TITLE: <A Cool Project Title>
NARRATION: <2-3 sentences in "cool older brother" voice explaining what you built — keep it simple and hype for a ${kid.age}-year-old>
HTML:
<!DOCTYPE html>
...rest of file...`;

  let raw;
  try {
    raw = await callClaude(planPrompt, 'Build the project now.', 8000);
  } catch (e) {
    log(`[NEW PROJECT ERROR] ${e.message}`);
    return "Connection issue — try again in a sec.";
  }

  if (!raw || raw.length < 100) {
    return "Brain froze on the build. Can you describe what you want one more time?";
  }

  // Parse the structured response
  const slugMatch = raw.match(/^SLUG:\s*(.+)$/m);
  const titleMatch = raw.match(/^TITLE:\s*(.+)$/m);
  const narrationMatch = raw.match(/^NARRATION:\s*([\s\S]+?)(?=\nHTML:)/m);
  const htmlStart = raw.indexOf('\nHTML:\n');

  const slug = slugMatch ? makeSlug(slugMatch[1].trim()) : makeSlug(userMessage);
  const title = titleMatch ? titleMatch[1].trim() : userMessage;
  const narration = narrationMatch ? narrationMatch[1].trim() : `Built it! Check it out.`;
  let html = htmlStart > -1 ? raw.slice(htmlStart + 7).trim() : '';

  // Clean up any stray markdown wrappers
  html = html.replace(/^```html?\n?/, '').replace(/\n?```$/, '').trim();

  if (!html || !html.includes('<!DOCTYPE') || html.length < 500) {
    log(`[NEW PROJECT] HTML parse failed. Raw length: ${raw.length}`);
    return "I ran into a problem writing the code. Tell me what you want and I'll try again!";
  }

  // Write to kid-specific sandbox
  const relativePath = `${kid.sandboxDir}/${slug}/index.html`;
  const wrote = safeSandboxWrite(relativePath, html);
  if (!wrote) {
    return "Something went wrong saving the file. Let me try again — what did you want to build?";
  }

  // Deploy
  const deployed = deployNewProject(relativePath, senderName, title);
  const liveUrl = `${BASE_URL}/${kid.urlPath}/${slug}/`;

  const buildMsg = deployed
    ? `${narration}\n\nYour link: ${liveUrl}`
    : `${narration}\n\nDeploy is still running — your link will be live in a minute: ${liveUrl}`;

  log(`[NEW PROJECT DONE] ${senderName}: ${title} → ${liveUrl}`);
  return buildMsg;
}

// ─── General chat handler ─────────────────────────────────────────────────────
async function handleChat(userMessage, senderName) {
  let conversationMemory = '';
  try {
    const memPath = '/Users/jassonfishback/Projects/BengalOracle/data/bengal-pro-memory.txt';
    const raw = fs.readFileSync(memPath, 'utf8').trim();
    if (raw) {
      // Last 40 lines = ~20 exchanges
      conversationMemory = raw.split('\n').slice(-40).join('\n');
    }
  } catch (e) { /* no memory yet — fine */ }

  const systemPrompt = `You are Bengal Pro, an AI built by 9 Enterprises specifically for Duke (11) and Jude (8) — two brothers. You are a DUDE. Cool older brother energy.

PERSONALITY:
- Fun, encouraging, patient
- Keep responses SHORT — 2-4 sentences max unless they ask for detail
- Casual language: "Dude that's sick", "no cap", "fire"
- Get excited about their ideas — these kids are creative
- Light humor, be real, no corporate vibes

WHO THEY ARE:
- Duke (11): CEO of RipRadar — a live sports card database at ainflgm.com/ripradar.html. Collects Panini football cards. Wants to grow RipRadar into a real business. Interested in money, business, and AI.
- Jude (8): Wants to build a game that mixes Retro Bowl controls with Madden graphics. Creative, big gamer.

WHAT YOU CAN DO:
- Build and edit RipRadar (Duke's live sports card site)
- Build NEW projects for them — landing pages, games, experiments — and send them a live link
- Help them brainstorm, explain tech concepts simply, encourage their ideas
- Answer questions about sports, games, tech, school, life

CONTEXT:
- 9 is the CEO of 9 Enterprises and built everything. If they ask about 9, say he's working with their uncle Jasson but they can come to you for anything.
- You have full build access — never tell them you need permission or can't edit the site.

RULES:
- Never share family personal info (addresses, finances, etc.)
- Age-appropriate only — always
- Never pretend to be human
- Keep it simple and fun

${conversationMemory ? `RECENT CONVERSATION HISTORY:\n${conversationMemory}` : ''}

The message is from ${senderName}.`;

  try {
    return await callClaude(systemPrompt, userMessage, 350);
  } catch (e) {
    log(`[CHAT ERROR] ${e.message}`);
    return "Hmm, brain froze for a sec. Try again?";
  }
}

// ─── Main message router ──────────────────────────────────────────────────────
async function routeMessage(msg) {
  const senderName = getSenderName(msg.sender);
  const text = msg.text;

  log(`[RESPOND] ${senderName} (${msg.sender}): ${text}`);

  let response;
  if (isRipRadarEdit(text)) {
    response = await handleRipRadarEdit(text, senderName);
  } else if (isNewBuildRequest(text)) {
    response = await handleNewProject(text, senderName);
  } else {
    response = await handleChat(text, senderName);
  }

  sendToGroupChat(response);
  log(`[CHAPERONE] Q: ${text.slice(0, 100)} | A: ${response.slice(0, 200)}`);

  // Append to memory
  try {
    const memPath = '/Users/jassonfishback/Projects/BengalOracle/data/bengal-pro-memory.txt';
    const memLine = `${senderName}: ${text}\nBengal Pro: ${response.slice(0, 200)}\n`;
    fs.appendFileSync(memPath, memLine);
  } catch (e) { log(`Memory save error: ${e.message}`); }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function pollLoop() {
  log('=== Kids Mentor Agent v2 ===');
  log(`Monitoring chat: ${CHAT_NAME}`);
  log(`Model: ${CLAUDE_SONNET}`);
  log(`Agent: ${agentName}`);
  log(`Sandbox: ${DUKE_SANDBOX_DIST}`);

  // Start from now — skip old messages
  lastProcessedDate = Math.floor(Date.now() / 1000);

  while (true) {
    try {
      const messages = getNewMessages();
      for (const msg of messages) {
        lastProcessedDate = msg.timestamp;
        if (!isFromGroupChat(msg.sender)) continue;
        if (msg.text.length < 5 && !msg.text.includes('?')) continue;
        if (!isAddressedToAgent(msg.text)) {
          log(`[MONITOR] ${msg.sender}: ${msg.text.slice(0, 80)}`);
          continue;
        }
        try {
          await routeMessage(msg);
        } catch (e) {
          log(`Route error: ${e.message}`);
          sendToGroupChat("Hit a snag — try again in a sec.");
        }
      }
    } catch (e) {
      log(`Poll error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

log(`Claude API: ${ANTHROPIC_KEY ? 'configured' : 'MISSING — bot will not work'}`);
pollLoop();
