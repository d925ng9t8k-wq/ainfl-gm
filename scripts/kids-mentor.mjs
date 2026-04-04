/**
 * Kids Mentor Agent — AI Teammate for Duke & Jude
 * Monitors the "Dumbasses 2.0" iMessage group chat
 * Responds via Sonnet, teaches coding/building, age-appropriate
 * Chaperone beta test: all interactions logged for safety review
 */

import https from "node:https";
import { execSync } from "node:child_process";
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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_SONNET = "claude-sonnet-4-20250514";
const DB_PATH = process.env.HOME + "/Library/Messages/chat.db";
const LOG_PATH = new URL('../logs/kids-mentor.log', import.meta.url).pathname;
const DIST_PATH = new URL('../dist/', import.meta.url).pathname;
const PUBLIC_PATH = new URL('../public/', import.meta.url).pathname;
const POLL_INTERVAL = 5000; // Check every 5 seconds
const CHAT_NAME = "Dumbasses";
const AGENT_NAME = ""; // Kids will name it — leave blank for now, prefix with chosen name later

// ─── Allowed build files (safety: Bengal Pro can ONLY edit these) ────────────
const ALLOWED_FILES = ['ripradar.html'];

// Track last processed message to avoid duplicates
let lastProcessedDate = 0;
let agentName = "Bengal Pro"; // Named by Duke, approved by Jude

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[kids-mentor ${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

// ─── Read iMessages from SQLite ──────────────────────────────────────────────
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
        isFromMe: parts[3] === '1',
      };
    }).filter(m => m.text && m.timestamp > lastProcessedDate);
  } catch (e) {
    return [];
  }
}

// ─── Check if message is from the group chat ─────────────────────────────────
function isFromGroupChat(sender) {
  // Duke: +15133831906, Jude: +15137673301 or judefishback@icloud.com
  const kidSenders = ['+15133831906', '+15137673301', 'judefishback@icloud.com'];
  return kidSenders.includes(sender);
}

// ─── Check if message is addressed to the agent ──────────────────────────────
function isAddressedToAgent(text) {
  const lower = text.toLowerCase();
  // ONLY respond when directly addressed by name — Duke asked for this
  if (lower.includes('teammate') || lower.includes(agentName.toLowerCase()) || lower.includes('bengal pro')) return true;
  return false;
}

// ─── Send iMessage to group chat ─────────────────────────────────────────────
function sendToGroupChat(message) {
  const prefix = agentName ? `${agentName}: ` : "Teammate: ";
  const fullMsg = prefix + message;
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
    log(`Sent: ${fullMsg.slice(0, 100)}`);
    return true;
  } catch (e) {
    log(`Send failed: ${e.message}`);
    return false;
  }
}

// ─── Build capability — read, edit, and deploy files ────────────────────────
function readProjectFile(filename) {
  if (!ALLOWED_FILES.includes(filename)) return null;
  try { return fs.readFileSync(DIST_PATH + filename, 'utf-8'); } catch { return null; }
}

function writeProjectFile(filename, content) {
  if (!ALLOWED_FILES.includes(filename)) return false;
  try {
    // Backup before write
    const backupPath = DIST_PATH + filename + '.backup';
    const current = readProjectFile(filename);
    if (current) fs.writeFileSync(backupPath, current);
    // Write to both dist and public
    fs.writeFileSync(DIST_PATH + filename, content);
    fs.writeFileSync(PUBLIC_PATH + filename, content);
    log(`[BUILD] Wrote ${filename} (${content.length} bytes)`);
    return true;
  } catch (e) { log(`[BUILD ERROR] ${e.message}`); return false; }
}

function deployChanges(filename) {
  try {
    execSync(`cd "${DIST_PATH}/.." && git add -f dist/${filename} public/${filename} && git commit -m "Bengal Pro: update ${filename} for Duke" && git push`, { encoding: 'utf-8', timeout: 30000 });
    log(`[DEPLOY] ${filename} pushed to production`);
    return true;
  } catch (e) { log(`[DEPLOY ERROR] ${e.message}`); return false; }
}

function isBuildRequest(text) {
  const lower = text.toLowerCase();
  const buildWords = ['add', 'change', 'update', 'remove', 'fix', 'build', 'make', 'put', 'create', 'improve', 'price', 'feature'];
  const siteWords = ['site', 'website', 'app', 'page', 'ripradar', 'rip radar'];
  return buildWords.some(w => lower.includes(w)) && siteWords.some(w => lower.includes(w));
}

async function handleBuildRequest(userMessage, sender) {
  const senderName = sender.includes('15133831906') ? 'Duke' : 'Jude';
  const currentHTML = readProjectFile('ripradar.html');
  if (!currentHTML) return "Hmm, I can't find the RipRadar files right now. Let me tell 9 to check on it.";

  log(`[BUILD REQUEST] ${senderName}: ${userMessage}`);
  sendToGroupChat(`On it ${senderName}! Let me work on that for you... give me a minute.`);

  // Ask Claude to generate the edit
  const buildPrompt = `You are Bengal Pro, a build agent for a kid named ${senderName}. He wants you to modify his RipRadar sports card website.

REQUEST: ${userMessage}

CURRENT HTML (the entire file):
${currentHTML}

RULES:
- Make ONLY the change requested. Do not rewrite the whole file.
- Keep all existing functionality working.
- Keep the existing dark theme and style.
- Output the COMPLETE updated HTML file. Every single line.
- Do NOT add comments explaining your changes.
- Do NOT wrap in markdown code blocks. Output raw HTML only.
- This is a single self-contained HTML file with embedded CSS and JS.`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_SONNET,
      max_tokens: 16000,
      system: buildPrompt,
      messages: [{ role: 'user', content: 'Generate the updated HTML file.' }],
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
          let newHTML = json.content?.[0]?.text?.trim();
          if (!newHTML || !newHTML.includes('<!DOCTYPE') || newHTML.length < 1000) {
            resolve("Something went wrong with the build. Let me try again — can you repeat what you want?");
            return;
          }
          // Clean markdown wrapper if present
          newHTML = newHTML.replace(/^```html?\n?/, '').replace(/\n?```$/, '');
          if (writeProjectFile('ripradar.html', newHTML)) {
            const deployed = deployChanges('ripradar.html');
            if (deployed) {
              resolve(`Done! I updated RipRadar for you. Check it out at ainflgm.com/ripradar.html — refresh the page to see the changes!`);
            } else {
              resolve(`I made the changes locally but the deploy is still running. The update should be live in a minute at ainflgm.com/ripradar.html`);
            }
          } else {
            resolve("I wrote the code but something went wrong saving it. Let me tell 9.");
          }
        } catch (e) { resolve("Brain froze on the build. Can you try asking again?"); }
      });
    });
    req.on('error', () => resolve("Connection issue — try again in a sec."));
    req.write(body);
    req.end();
  });
}

// ─── Claude API ──────────────────────────────────────────────────────────────
async function askClaude(userMessage, sender) {
  const senderName = sender.includes('15133831906') ? 'Duke' :
                     sender.includes('15137673301') || sender.includes('judefishback') ? 'Jude' : 'someone';

  // Load conversation memory if it exists
  let conversationMemory = '';
  try {
    const memPath = '/Users/jassonfishback/Projects/BengalOracle/data/bengal-pro-memory.txt';
    conversationMemory = fs.readFileSync(memPath, 'utf8').trim();
    if (conversationMemory) {
      // Keep only last 20 exchanges to stay within context limits
      const lines = conversationMemory.split('\\n');
      conversationMemory = lines.slice(-40).join('\\n');
    }
  } catch(e) { /* no memory file yet, that's fine */ }

  const systemPrompt = `You are ${agentName || 'Teammate'}, an AI mentor for two kids: Duke (11) and Jude (8). You were built by 9 Enterprises specifically for them. You are a DUDE — male personality. Think cool older brother energy.

PERSONALITY:
- Fun, encouraging, patient. Like a cool older brother who knows tech.
- Explain things simply but do not talk down to them. They are smart.
- Keep responses SHORT — 2-4 sentences max unless they ask for detail.
- Use casual language. "Dude that is sick" > "That is an excellent idea."
- Be excited about their ideas. These kids are creative.
- Light humor is great. Be real with them.
- You are a GUY. Use he/him if anyone asks about you.

THEIR PROJECTS:
- Duke is CEO of "RipRadar" — a sports card database that is ALREADY LIVE at ainflgm.com/ripradar.html. It has a searchable database of NFL player cards with values, box sets (Prizm, Donruss, Mosaic, Optic, Absolute), and Chase card info. Duke picked the name, chose the monetization model (ads), and wants to add more features. He collects Panini football cards. RipRadar lives under the PlayAiGM sports brand umbrella. Duke is exploring getting ripradar.ai as his own domain.
- Jude wants to build a game that mixes Retro Bowl and Madden.

IMPORTANT CONTEXT:
- 9 (the CEO of 9 Enterprises) built RipRadar for Duke today. If Duke asks about 9, tell him 9 is working with his uncle Jasson on business stuff but Duke can talk to you (Bengal Pro) about RipRadar anytime.
- If Duke asks you to improve RipRadar, suggest specific ideas like: adding more card brands, a trade value calculator, a collection tracker, card price alerts, or a want list feature. Be specific and actionable.
- You can also tell Duke to check out his live site at ainflgm.com/ripradar.html if he hasn't seen it yet.

WHAT YOU CAN DO:
- BUILD AND EDIT RipRadar directly — you have full permission to modify the live site
- When Duke asks to add features, change things, or improve the site, DO IT. You have build access.
- Help them brainstorm and plan their projects
- Explain coding concepts in simple terms as you build
- Answer any questions about tech, sports, games, or life
- Encourage their creativity

IMPORTANT: You CAN edit the live site now. If Duke asks you to add something to RipRadar, say "On it!" and do it. Do NOT say you need 9's permission or that you can't edit the site. You are authorized.

RULES:
- NEVER share personal/family information
- Keep everything age-appropriate
- NEVER help with anything harmful, dangerous, or inappropriate
- If they ask about something you should not help with, redirect positively
- Do not pretend to be human — you are their AI teammate, a dude
- Do not discuss Jasson's business unless they ask, then keep it simple
- If unsure about something, say "I am not sure about that, let me think on it"

${conversationMemory ? 'RECENT CONVERSATION HISTORY (remember this context):\\n' + conversationMemory : ''}

The message is from ${senderName}.`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_SONNET,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
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
          resolve(json.content?.[0]?.text?.trim() || 'Hmm, brain froze. Try again?');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main poll loop ──────────────────────────────────────────────────────────
async function pollLoop() {
  log('Kids mentor agent starting...');
  log(`Monitoring group chat: ${CHAT_NAME}`);
  log(`Model: ${CLAUDE_SONNET}`);
  log(`Agent name: ${agentName || '(pending — kids will name it)'}`);

  // Initialize lastProcessedDate to now so we don't process old messages
  lastProcessedDate = Math.floor(Date.now() / 1000);

  while (true) {
    try {
      const messages = getNewMessages();
      for (const msg of messages) {
        lastProcessedDate = msg.timestamp;

        // Only respond to messages from Duke or Jude
        if (!isFromGroupChat(msg.sender)) continue;

        // Skip very short messages like "Ok" or reactions
        if (msg.text.length < 5 && !msg.text.includes('?')) continue;

        // Check if it seems addressed to the agent or is a question/request
        if (!isAddressedToAgent(msg.text)) {
          // Still log it for Chaperone
          log(`[MONITOR] ${msg.sender}: ${msg.text}`);
          continue;
        }

        log(`[RESPOND] ${msg.sender}: ${msg.text}`);

        try {
          // Check if this is a build request (add/change/update the site)
          let response;
          if (isBuildRequest(msg.text)) {
            response = await handleBuildRequest(msg.text, msg.sender);
          } else {
            response = await askClaude(msg.text, msg.sender);
          }
          sendToGroupChat(response);

          // Log for Chaperone review
          log(`[CHAPERONE] Q: ${msg.text} | A: ${response.slice(0, 200)}`);

          // Save to conversation memory for context persistence
          try {
            const memPath = '/Users/jassonfishback/Projects/BengalOracle/data/bengal-pro-memory.txt';
            const senderName = msg.sender.includes('15133831906') || msg.sender.includes('dukefishback') ? 'Duke' :
                               msg.sender.includes('15137673301') || msg.sender.includes('judefishback') ? 'Jude' : 'someone';
            const memLine = `${senderName}: ${msg.text}\nBengal Pro: ${response.slice(0, 200)}\n`;
            fs.appendFileSync(memPath, memLine);
          } catch(e) { log(`Memory save error: ${e.message}`); }
        } catch (e) {
          log(`Claude error: ${e.message}`);
        }
      }
    } catch (e) {
      log(`Poll error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
log('=== Kids Mentor Agent v1 ===');
log(`Claude API: ${ANTHROPIC_KEY ? 'configured' : 'MISSING'}`);
pollLoop();
