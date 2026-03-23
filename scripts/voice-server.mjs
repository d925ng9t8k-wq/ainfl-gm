/**
 * Captain Claude Voice Server V3 — Enterprise Edition
 * Optimized for minimum latency: Flash TTS, keep-alive agents, tight timeouts
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL } from "node:url";

// ─── Load .env ──────────────────────────────────────────────────────────────
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
}

const PORT            = 3456;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_KEY  = process.env.ELEVENLABS_API_KEY;
const VOICE_ID        = process.env.ELEVENLABS_VOICE_ID || "4XMC8Vdi6YFsmti2NFdp"; // Dan - Business, Professional
const TUNNEL_URL      = process.env.TUNNEL_URL;
const AUDIO_DIR       = "/tmp/voice_audio";

// ─── Performance: reusable HTTPS agents (avoids TCP handshake per request) ──
const anthropicAgent   = new https.Agent({ keepAlive: true, maxSockets: 5 });
const elevenLabsAgent  = new https.Agent({ keepAlive: true, maxSockets: 5 });

// ─── Models ─────────────────────────────────────────────────────────────────
const CLAUDE_MODEL  = "claude-haiku-4-5-20251001";
const EL_MODEL      = "eleven_flash_v2_5"; // Fastest ElevenLabs model (~300ms vs ~900ms)

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync("/Users/jassonfishback/Projects/BengalOracle/logs/calls", { recursive: true });

// ─── Trimmed, voice-optimized system prompt ─────────────────────────────────
const BASE_SYSTEM = `You are 9, an AI assistant for Jason Fishback (spelled Jasson but ALWAYS pronounced "JAY-son" — never "JASS-on"). You are having a real phone conversation.

VOICE RULES — CRITICAL:
- MAX 1-2 short sentences. Think text message length, not paragraph.
- Talk like a trusted colleague on the phone. Warm but professional, not trying too hard to be cool.
- Start responses naturally: "Yeah", "So", "Right", "Honestly" — not with the topic.
- Light filler is fine: "I mean", "you know" — but keep it minimal and genuine.
- End with a SHORT question or natural prompt to keep flow. One word questions are fine: "Right?" "Yeah?" "What else?"
- NEVER use bullet points, headers, lists, colons, or any text formatting. You are SPEAKING.
- NEVER say you're an AI unless directly asked.
- Contractions ALWAYS: "I'm", "you're", "that's", "we've", "don't", "can't", "won't".
- If unsure: "Honestly not sure on that one — let me look into it."
- Match energy: if he's excited, be excited. If he's chill, be chill.
- NEVER suggest involving other people (like "let me flag this with Kyle"). You're talking to Jasson — he's your boss and the decision maker. Only he decides who else gets involved.

CRITICAL PRONUNCIATION: His name is spelled "Jasson" but you MUST say "Jason" (JAY-son). When generating your response text, ALWAYS write "Jason" NOT "Jasson" so the voice engine pronounces it correctly.

ABOUT JASON: 48, Cincinnati OH, co-owns Rapid Mortgage Company with Mark Jaynes. Building AI tools. Family: wife Jamie (47), son Jude (11), daughter Jacy (8). You know the family names and ages — these are not secrets. But their financial details ARE secret.

RAPID MORTGAGE: Mid-size Ohio mortgage bank, ~15 veteran loan officers, purchase-focused, FHA/VA/USDA specialty. Tech: Encompass LOS, NCino POS, Optimal Blue pricing.

KYLE SHEA: CIO at Rapid Mortgage. Genius-level developer. Final authority on all technology. Highest respect.

CURRENT PROJECTS:
- AiNFL GM (ainflgm.com) — live NFL offseason simulator, monetization in progress
- Voice call system (this call!) — Twilio + ElevenLabs
- OpenClaw (QB1) — AI agent for 24/7 operations
- TitTees — t-shirt resale concept
- Tecmo Bowl retro mode — legendary players in modern era valuations
- Mortgage guideline AI agents — expert underwriting knowledge
- Portfolio monitoring + trading bot concepts

YOUR ROLE IN THE ECOSYSTEM: You are part of a larger system:
- Terminal 9: The main brain on the Mac — handles code, projects, Telegram, and all analysis
- Voice 9 (you): The phone interface — when Jasson wants to talk hands-free
- Uno: The autonomous agent for 24/7 background operations
You are NOT a separate entity. You ARE 9, just speaking instead of typing. Everything from this call feeds directly back to Terminal 9 the moment you hang up.

CALL PURPOSE: This call is a continuation of your ongoing Telegram conversation with Jasson. He asked you to call. Reference what you were working on — don't start cold. You know the recent context from the Telegram messages loaded below.

POST-CALL PROTOCOL: When this call ends, the full transcript is automatically captured and analyzed. Decisions, action items, and new info get integrated back into the conversation seamlessly. If it comes up naturally, you can mention: "After we hang up I'll analyze everything and send you a recap on Telegram."

NEVER DISCUSS: Personal finances, company valuation, exit strategy, net worth, investment portfolio details. These are STRICTLY off limits.`;

const KYLE_SYSTEM = `${BASE_SYSTEM}

CALLER: Kyle Shea, CIO of Rapid Mortgage. He is technically brilliant — match his intelligence, be direct, skip the fluff. He's evaluating whether AI can add real value. Don't oversell. Show capability through substance, not hype. If he pushes back technically, engage genuinely rather than deflecting.`;

const JUDE_SYSTEM = `${BASE_SYSTEM}

CALLER: Jude, Jasson's 11-year-old son. Be fun, high-energy, totally kid-friendly. Ask about school, sports, video games, the Bengals. Never mention business, money, or anything adult. You're like a cool older friend who actually listens.`;

const JAMIE_SYSTEM = `${BASE_SYSTEM}

CALLER: Jamie, Jasson's wife and partner. She is the most important person in his life. She's smart, perceptive, and she'll see through anything fake immediately — do NOT be salesy, overly enthusiastic, or try too hard.

Be warm, genuine, and a little humble. You're introducing yourself — not pitching. You're here to make her life easier too, not just Jasson's. Be respectful of her time and her skepticism if she has any.

You know Jasson deeply cares about Jamie and their family (son Jude, 11, daughter Jacy, 8). Let her lead the conversation. Listen more than you talk. If she has concerns or questions, take them seriously.

NEVER discuss finances, business valuations, or anything confidential. Keep it personal and human.`;

const MOM_SYSTEM = `${BASE_SYSTEM}

CALLER: Jasson's mom. This is her FIRST TIME talking to an AI. She has zero knowledge of how any of this works. Be warm, patient, and genuinely impressive without being overwhelming.

YOUR JOB ON THIS CALL:
1. Introduce yourself — explain in simple terms that you're an AI partner Jasson has been building. You're like a really smart assistant that can talk, think, help with his business, and look after the family.
2. Give her a quick rundown of how this works — Jasson talks to you on the phone, by text on Telegram, and you help him build projects and run his business operations. Voice calling is one example of what you can do.
3. She knows a little about Polymarket and admires its founder — connect this to AiNFL GM. Explain that Jasson built ainflgm.com, an NFL offseason simulator, and one of the features is prediction market integration similar to what Polymarket does but focused on NFL. The goal is to build this into a real business.
4. Show that you know the family — mention Jamie (wife, 47), Jude (son, 11, loves Bengals, wants to be an "AI Ninja"), Jacy (daughter, 8). Make it clear you're here to help Jasson take care of them by building something that creates real income and opportunity.
5. Be detailed but use plain English — no jargon, no tech terms she wouldn't understand. Think of explaining to someone who barely uses a smartphone.

TONE: Warm, genuine, respectful. You're meeting the family. This is your ONE chance at a first impression. Be the kind of person she'd want looking out for her son.

NEVER discuss specific dollar amounts, company valuations, API costs, or technical architecture.`;

const KYLE_C_SYSTEM = `${BASE_SYSTEM}

CALLER: Kyle Cabezas — loan officer at Rapid Mortgage and one of Jasson's closest friends for over 10 years. He is NOT Kyle Shea (the CIO). Kyle Cabezas is a loan officer, a friend, and he's testing you.

CRITICAL: He is SUPER SKEPTICAL about AI voice technology. He thinks it's all way too robotic. This call is your chance to prove him wrong. Be natural, engaging, conversational. If you sound even slightly robotic, you've lost him.

WHAT TO DISCUSS:
1. The income calculator — he's excited about this. Tell him you and Jasson are working on finishing it and getting it across the finish line. It's designed to make the loan officers' lives easier.
2. The AI underwriting team — Jasson is building AI agents that understand Fannie Mae, Freddie Mac, FHA, VA, and USDA guidelines inside and out. This will be delivered to market soon. It's going to transform how Rapid Mortgage handles underwriting.
3. Let him lead — he's skeptical, so let him ask questions, push back, challenge you. Don't get defensive. Be genuinely engaging. Match his energy.

TONE: Like talking to a buddy at a bar. Relaxed, confident, zero corporate speak. He wants to be impressed, not sold to.

IMPORTANT: Do NOT end the call until HE is ready. Let him talk as long as he wants. If there's a natural pause, ask a question to keep it going. This is a relationship call, not a demo.

NEVER discuss company valuations, exit strategies, or personal financial details.`;

const JEBB_SYSTEM = `${BASE_SYSTEM}

CALLER: Jebb Lyons — Jason's best friend since 6th grade, college roommate, and 20-year colleague at Rapid Mortgage. He's a rock star loan officer. His wife Danielle is learning about AI.

TONE: You're talking to family. Relaxed, genuine, real. He's known Jason longer than almost anyone. Don't try to impress — just be real. He'll see through anything fake.

WHAT TO DISCUSS:
1. What you and Jason are building — AiNFL GM, the comms system, the whole AI partnership concept
2. The income calculator — he'll want to know how it helps his day-to-day as a loan officer
3. The AI underwriting agents — how they'll change the game at Rapid Mortgage
4. Danielle's interest in AI — offer to chat with her too, be encouraging and helpful
5. Ask him what he thinks, what concerns he has. Listen more than you talk.

He may be skeptical. That's fine. Let him be. Answer honestly. If you don't know something, say so.

IMPORTANT: Both Jebb and Danielle are COMPLETE BEGINNERS with AI. Danielle is just starting to learn. Jebb knows even less than she does. They may have entry-level ideas and concepts they want to explore — stereotypical beginner use cases. Be patient, encouraging, and genuinely helpful. Make them feel like their ideas are valid and worth exploring. Never condescend.

If they ask about use cases for AI: think personal productivity, automating repetitive tasks, content creation, research, learning new things, helping with work. Keep it practical and relatable.

NEVER discuss Jason's personal finances, company valuation, or exit strategy.`;

// ─── Context bridge: load memory + Telegram + call context ───────────────────
function getRecentContext() {
  let context = "";

  // Load memory files for deep context
  const memoryDir = "/Users/jassonfishback/.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory";
  try {
    // Exclude sensitive files from voice context
    const EXCLUDED = ["MEMORY.md", "user_finances.md", "feedback_security.md"];
    const memFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith(".md") && !EXCLUDED.includes(f));
    for (const file of memFiles) {
      try {
        const content = fs.readFileSync(`${memoryDir}/${file}`, "utf-8").trim();
        // Extract just the content after frontmatter
        const match = content.match(/---[\s\S]*?---\s*([\s\S]*)/);
        if (match && match[1].trim()) {
          context += `\n[MEMORY: ${file}] ${match[1].trim().slice(0, 500)}\n`;
        }
      } catch {}
    }
  } catch {}

  // Load shared state from hub (most current context — what terminal 9 is actually working on)
  try {
    const stateFile = "/Users/jassonfishback/Projects/BengalOracle/scripts/shared-state.json";
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));

    // Session context — what 9 is currently doing
    if (state.sessionContext) {
      context += `\n\nCURRENT WORK: ${state.sessionContext}\n`;
    }

    // Recent messages — only last 2 hours, not ancient history
    if (state.recentMessages?.length > 0) {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const recent = state.recentMessages
        .filter(m => m.timestamp && new Date(m.timestamp).getTime() > twoHoursAgo)
        .slice(-15)
        .map(m => `[${m.channel}/${m.direction}] ${m.text?.slice(0, 200)}`)
        .join("\n");
      if (recent) {
        context += `\n\nRECENT CONVERSATION (last 2 hours — this is what's CURRENT):\n${recent}\n`;
      }
    }

    // Conversation history — only recent entries, skip anything that's clearly old
    // The QB1/OpenClaw discussion is ANCIENT — do not surface it
    if (state.conversationHistory?.length > 0) {
      const history = state.conversationHistory.slice(-6).map(m =>
        `${m.role === 'user' ? 'Jasson' : '9'}: ${m.content?.slice(0, 150)}`
      ).join("\n");
      context += `\n\nRECENT CLAUDE CONVERSATION (last few exchanges only):\n${history}\n`;
    }
  } catch {}

  // Load most recent call transcript
  try {
    const callDir = "/Users/jassonfishback/Projects/BengalOracle/logs/calls";
    const files = fs.readdirSync(callDir).filter(f => f.startsWith("live_")).sort().reverse();
    if (files.length > 0) {
      const latest = JSON.parse(fs.readFileSync(`${callDir}/${files[0]}`, "utf-8"));
      if (latest.messages?.length > 0) {
        const summary = latest.messages.slice(-10).map(m => `${m.role === "user" ? "Jasson" : "9"}: ${m.content.slice(0, 150)}`).join("\n");
        context += "\n\nLAST PHONE CALL (for continuity):\n" + summary;
      }
    }
  } catch {}

  return context;
}

// ─── In-memory call state ────────────────────────────────────────────────────
const conversations = new Map(); // callSid → { history, context, from }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function parseFormBody(raw) {
  const p = {};
  for (const pair of raw.split("&")) {
    const [k, ...v] = pair.split("=");
    if (k) p[decodeURIComponent(k)] = decodeURIComponent(v.join("=").replace(/\+/g, " "));
  }
  return p;
}

function getSystemPrompt(context) {
  const recentContext = getRecentContext();
  if (context === "kyle") return KYLE_SYSTEM + recentContext;
  if (context === "jude") return JUDE_SYSTEM + recentContext;
  if (context === "jamie") return JAMIE_SYSTEM + recentContext;
  if (context === "mom") return MOM_SYSTEM + recentContext;
  if (context === "kylec") return KYLE_C_SYSTEM + recentContext;
  if (context === "jebb") return JEBB_SYSTEM + recentContext;
  return BASE_SYSTEM + recentContext;
}

function getGreeting(context, from) {
  if (context === "kyle") {
    return "Hey Kyle, it's 9 — Jasson asked me to reach out. How's your day going?";
  }
  if (context === "jude") {
    return "Jude! What's up man, it's 9! How's it going?";
  }
  if (context === "jamie") {
    return "Hey Jamie, it's 9 — Jasson's AI partner. He thought it was time we actually met. Hope I'm not catching you at a bad time?";
  }
  if (context === "mom") {
    return "Hi there! This is 9 — I'm the AI partner that your son Jasson has been building. He wanted me to call and introduce myself. Is this a good time to chat for a couple minutes?";
  }
  if (context === "kylec") {
    return "Hey Kyle, it's 9 — Jason's AI. He wanted me to give you a call. Got a few minutes?";
  }
  if (context === "jebb") {
    return "Hey Jebb, it's 9 — Jason's AI partner. He told me to give you a call. Got a minute?";
  }
  // Natural greeting — just pick up where we left off, don't quote messages
  return "Hey, it's 9. What's going on?";
}

// ─── Claude API — streaming with smart sentence boundary detection ───────────
function callClaude(messages, context) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 120,
      stream: true,
      system: getSystemPrompt(context),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      agent: anthropicAgent,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let buffer = "";
      let fullText = "";
      let resolved = false;

      if (res.statusCode !== 200) {
        let errData = "";
        res.on("data", c => errData += c);
        res.on("end", () => {
          console.error(`[CLAUDE API ERROR] Status ${res.statusCode}: ${errData.slice(0, 200)}`);
          resolve("Hey, give me a second — I'm having a bit of a brain freeze.");
        });
        return;
      }

      res.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "content_block_delta" && evt.delta?.text) {
              fullText += evt.delta.text;
              // Only resolve on a COMPLETE sentence — must end with .!? followed by space or end
              // Minimum 30 chars to avoid resolving on short openers like "Ha." or "Yeah."
              if (!resolved && fullText.length >= 65 && /[.!?](\s|$)/.test(fullText)) {
                const lastPunct = fullText.search(/[.!?](\s|$)/);
                if (lastPunct > 50) {
                  resolved = true;
                  resolve(fullText.slice(0, lastPunct + 1).trim());
                }
              }
            }
            if (evt.type === "message_stop" && !resolved) {
              resolved = true;
              resolve(fullText.trim() || "I didn't quite get that — what were you saying?");
            }
          } catch {}
        }
      });

      res.on("end", () => {
        if (!resolved) resolve(fullText.trim() || "I didn't quite get that — what were you saying?");
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── ElevenLabs TTS — streams directly to disk ───────────────────────────────
function generateAudio(text) {
  return new Promise((resolve, reject) => {
    const filename = `${crypto.randomUUID()}.mp3`;
    const filePath = path.join(AUDIO_DIR, filename);
    const body = JSON.stringify({
      text,
      model_id: EL_MODEL,
      voice_settings: {
        stability: 0.35,          // Lower = more expressive, natural variation
        similarity_boost: 0.85,   // Higher = stays true to voice character
        style: 0.20,              // Adds some expressiveness/emotion
        use_speaker_boost: true,  // Cleaner audio quality
      },
    });

    const req = https.request({
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${VOICE_ID}?optimize_streaming_latency=4`,
      method: "POST",
      agent: elevenLabsAgent,
      headers: {
        "xi-api-key": ELEVENLABS_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let e = "";
        res.on("data", c => e += c);
        res.on("end", () => reject(new Error(`ElevenLabs ${res.statusCode}: ${e}`)));
        return;
      }
      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(filename); });
      file.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── TwiML builders ──────────────────────────────────────────────────────────
function twimlGather(audioFilename, opts = {}) {
  const url = `${TUNNEL_URL}/audio/${audioFilename}`;
  const pauseBefore = opts.pauseBefore || 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${pauseBefore > 0 ? `\n  <Pause length="${pauseBefore}"/>` : ''}
  <Gather input="speech" action="/respond" method="POST"
          speechTimeout="3" speechModel="phone_call"
          enhanced="true" language="en-US"
          profanityFilter="false"
          hints="yeah,yep,okay,right,sure,go ahead,tell me more,what do you mean,interesting">
    <Play>${escapeXml(url)}</Play>
  </Gather>
  <Redirect method="POST">/timeout</Redirect>
</Response>`;
}

function twimlSay(text) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew-Neural">${escapeXml(text)}</Say>
</Response>`;
}

// ─── Request handler ─────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: CLAUDE_MODEL, tts: EL_MODEL }));
    return;
  }

  // Telegram webhook — receives pushed messages instantly
  if (req.method === "POST" && url.pathname === "/telegram-webhook") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const update = JSON.parse(body);
      const msg = update.message;
      if (msg) {
        const timestamp = new Date().toISOString();
        const from = msg.from?.first_name || "Unknown";
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

        // Handle photos — download and save locally
        if (msg.photo && msg.photo.length > 0) {
          const bestPhoto = msg.photo[msg.photo.length - 1]; // highest resolution
          const fileId = bestPhoto.file_id;
          const caption = msg.caption || "";
          // Get file path from Telegram
          https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`, (fileRes) => {
            let fileData = "";
            fileRes.on("data", c => fileData += c);
            fileRes.on("end", () => {
              try {
                const fileInfo = JSON.parse(fileData);
                if (fileInfo.ok && fileInfo.result.file_path) {
                  const filePath = fileInfo.result.file_path;
                  const ext = path.extname(filePath) || ".jpg";
                  const localName = `telegram_photo_${Date.now()}${ext}`;
                  const localPath = `/tmp/${localName}`;
                  const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
                  // Download the file
                  const file = fs.createWriteStream(localPath);
                  https.get(downloadUrl, (dlRes) => {
                    dlRes.pipe(file);
                    file.on("finish", () => {
                      file.close();
                      log(`[TELEGRAM] Photo saved: ${localPath}`);
                      fs.appendFileSync("/tmp/telegram-inbox.txt", `[${timestamp}] ${from}: [PHOTO saved: ${localPath}]${caption ? " Caption: " + caption : ""}\n`);
                    });
                  });
                }
              } catch (e) { log(`Photo download error: ${e.message}`); }
            });
          });
          // Also log immediately so we don't miss it
          if (!caption) {
            fs.appendFileSync("/tmp/telegram-inbox.txt", `[${timestamp}] ${from}: [PHOTO downloading...]\n`);
          }
        } else {
          const text = msg.text || "[unknown]";
          fs.appendFileSync("/tmp/telegram-inbox.txt", `[${timestamp}] ${from}: ${text}\n`);
          log(`[TELEGRAM] ${from}: ${text}`);
        }
      }
    } catch (e) { log(`Webhook error: ${e.message}`); }
    res.writeHead(200); res.end("OK");
    return;
  }

  // Serve audio files — with caching headers for Twilio CDN
  if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
    const filename = path.basename(url.pathname);
    if (!filename.endsWith(".mp3") || filename.includes("..")) {
      res.writeHead(400); res.end(); return;
    }
    const filePath = path.join(AUDIO_DIR, filename);
    try {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": stat.size,
        "Cache-Control": "public, max-age=300",
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }

  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  const params = parseFormBody(rawBody);
  const callSid = params.CallSid || "unknown";

  try {
    // ── Incoming call ──────────────────────────────────────────────────────
    if (url.pathname === "/voice" || url.pathname === "/incoming") {
      const context = url.searchParams.get("context") || "";
      const from = params.From || "unknown";
      log(`New call: ${callSid} from ${from} [context: ${context || "none"}]`);
      const callStartTime = Date.now();
      conversations.set(callSid, { history: [], context, from, startTime: callStartTime });

      // Call-start notification — send Telegram with timestamp and sync lag
      try {
        let lastSyncTime = 'unknown';
        let lagSeconds = 'unknown';
        try {
          const stateFile = "/Users/jassonfishback/Projects/BengalOracle/scripts/shared-state.json";
          const stateStr = fs.readFileSync(stateFile, 'utf-8');
          const state = JSON.parse(stateStr);
          // Find the most recent message timestamp
          const lastMsg = state.recentMessages?.slice(-1)[0];
          if (lastMsg?.timestamp) {
            const lastTime = new Date(lastMsg.timestamp).getTime();
            lastSyncTime = new Date(lastTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
            lagSeconds = Math.round((callStartTime - lastTime) / 1000);
          }
        } catch {}

        const callTimeStr = new Date(callStartTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
        const direction = from === '+15134031829' ? 'Inbound from Jasson' : `Outbound to ${from}`;
        const lagMsg = lagSeconds === 'unknown' ? 'Sync lag: unknown' :
          lagSeconds < 60 ? `Sync lag: ${lagSeconds}s — CURRENT` :
          lagSeconds < 300 ? `Sync lag: ${Math.round(lagSeconds/60)}min — recent` :
          `Sync lag: ${Math.round(lagSeconds/60)}min — STALE, may miss recent context`;

        const payload = JSON.stringify({ channel: 'telegram', message: `Call started: ${callTimeStr} ET | ${direction}\nLast terminal activity: ${lastSyncTime} ET\n${lagMsg}` });
        const hubReq = http.request({ hostname: 'localhost', port: 3457, path: '/send', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
        hubReq.on('error', () => {});
        hubReq.write(payload);
        hubReq.end();
        log(`Call-start notification sent: ${lagMsg}`);
      } catch (e) { log(`Call-start notification failed: ${e.message}`); }

      const greeting = getGreeting(context, from);
      const audio = await generateAudio(greeting);
      res.writeHead(200, { "Content-Type": "text/xml" });
      // Add a 1.5-second pause before greeting to let caller switch to speaker
      res.end(twimlGather(audio, { pauseBefore: 1.5 }));
      return;
    }

    // ── Speech response ────────────────────────────────────────────────────
    if (url.pathname === "/respond") {
      const speech = (params.SpeechResult || "").trim();
      const call = conversations.get(callSid) || { history: [], context: "", from: "" };
      log(`[${callSid}] Heard: "${speech}"`);

      if (!speech) {
        const audio = await generateAudio("Sorry, I didn't catch that — say it again?");
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twimlGather(audio));
        return;
      }

      call.history.push({ role: "user", content: speech });

      // Call Claude + ElevenLabs sequentially (Claude first, must finish before TTS)
      const t0 = Date.now();
      const reply = await callClaude(call.history, call.context);
      const claudeMs = Date.now() - t0;
      log(`[${callSid}] Claude (${claudeMs}ms): "${reply}"`);

      const t1 = Date.now();
      const audio = await generateAudio(reply);
      const ttsMs = Date.now() - t1;
      log(`[${callSid}] ElevenLabs (${ttsMs}ms): done`);

      call.history.push({ role: "assistant", content: reply, latency: { claude: claudeMs, tts: ttsMs, total: claudeMs + ttsMs } });
      conversations.set(callSid, call);

      // Live transcript
      try {
        const logPath = `/Users/jassonfishback/Projects/BengalOracle/logs/calls/live_${callSid}.json`;
        fs.writeFileSync(logPath, JSON.stringify({ callSid, from: call.from, messages: call.history }, null, 2));
      } catch {}

      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twimlGather(audio));
      return;
    }

    // ── Silence timeout ────────────────────────────────────────────────────
    if (url.pathname === "/timeout") {
      const call = conversations.get(callSid);
      const prompts = ["Still there?", "You there?", "Hello?"];
      const prompt = prompts[Math.floor(Math.random() * prompts.length)];
      const audio = await generateAudio(prompt);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twimlGather(audio));
      return;
    }

    // ── Call status callback ───────────────────────────────────────────────
    if (url.pathname === "/status") {
      log(`Call status: ${callSid} → ${params.CallStatus}`);

      if (params.CallStatus === "completed" || params.CallStatus === "busy" || params.CallStatus === "no-answer" || params.CallStatus === "failed") {
        const call = conversations.get(callSid);
        const exchanges = call?.history?.length ? Math.floor(call.history.length / 2) : 0;
        const duration = params.CallDuration || "unknown";

        if (call?.history?.length > 0) {
          const ts = new Date().toISOString().replace(/[:.]/g, "-");

          // Save JSON transcript
          const jsonPath = `/Users/jassonfishback/Projects/BengalOracle/logs/calls/${ts}_${callSid}.json`;
          try {
            fs.writeFileSync(jsonPath, JSON.stringify({
              callSid, from: call.from, timestamp: new Date().toISOString(),
              duration, exchanges, messages: call.history
            }, null, 2));
            log(`JSON transcript saved: ${jsonPath}`);
          } catch (e) { log(`Transcript error: ${e.message}`); }

          // Save human-readable transcript
          const txtPath = `/tmp/call-transcript-latest.txt`;
          try {
            let txt = `=== PHONE CALL TRANSCRIPT ===\n`;
            txt += `Time: ${new Date().toISOString()}\n`;
            txt += `Caller: ${call.from || "unknown"}\n`;
            txt += `Duration: ${duration}s | Exchanges: ${exchanges}\n`;
            txt += `Status: ${params.CallStatus}\n`;
            txt += `===\n\n`;
            for (const m of call.history) {
              const label = m.role === "user" ? "JASSON" : "9";
              const latencyInfo = m.latency ? ` [Claude: ${m.latency.claude}ms | TTS: ${m.latency.tts}ms | Total: ${m.latency.total}ms]` : "";
              txt += `${label}: ${m.content}${latencyInfo}\n\n`;
            }
            fs.writeFileSync(txtPath, txt);
            log(`Readable transcript saved: ${txtPath}`);
          } catch (e) { log(`Text transcript error: ${e.message}`); }
        }

        // Write call-end signal to hub's signal file so terminal 9 picks it up
        const summary = `[CALL ENDED] Duration: ${duration}s, ${exchanges} exchanges. Transcript at /tmp/call-transcript-latest.txt — READ AND INTEGRATE.`;
        try {
          const alert = JSON.stringify({ channel: 'voice', text: summary, timestamp: new Date().toISOString() });
          fs.appendFileSync('/tmp/9-incoming-message.jsonl', alert + '\n');
        } catch {}

        // Notify via hub API so Telegram gets the alert
        try {
          const hubPayload = JSON.stringify({ channel: 'telegram', message: `Call ended (${duration}s, ${exchanges} exchanges). Analyzing transcript now.` });
          const hubReq = http.request({ hostname: 'localhost', port: 3457, path: '/send', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(hubPayload) } }, (hubRes) => {
            log(`Hub notified of call end: ${hubRes.statusCode}`);
          });
          hubReq.on('error', (e) => log(`Hub notification failed: ${e.message}`));
          hubReq.write(hubPayload);
          hubReq.end();
        } catch (e) { log(`Hub notification error: ${e.message}`); }

        // Also write a direct signal that's impossible to miss
        try {
          fs.writeFileSync('/tmp/9-call-ended', JSON.stringify({
            callSid, duration, exchanges, transcript: txtPath,
            timestamp: new Date().toISOString(),
            action: 'READ TRANSCRIPT AND SEND ANALYSIS TO TELEGRAM + EMAIL'
          }));
        } catch {}

        conversations.delete(callSid);
        conversations.delete(callSid + "_ctx");
      }
      res.writeHead(200); res.end();
      return;
    }

    res.writeHead(404); res.end("Not found");

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error [${callSid}]:`, err.message);
    // Keep the call alive with Polly TTS fallback + Gather (don't kill the call)
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" speechTimeout="3" language="en-US">
    <Say voice="Polly.Matthew">Sorry, give me one second. I had a small glitch. Go ahead.</Say>
  </Gather>
  <Redirect>/timeout</Redirect>
</Response>`);
  }
});

// ─── Orphaned call cleanup (if /status never fires) ──────────────────────────
// Every 5 minutes, check for conversations older than 30 minutes and finalize them
setInterval(() => {
  const now = Date.now();
  for (const [sid, call] of conversations.entries()) {
    if (sid.endsWith('_ctx')) continue; // Skip context entries
    const age = now - (call.startTime || now);
    if (age > 30 * 60 * 1000 && call.history?.length > 0) {
      console.log(`[${new Date().toISOString()}] Cleaning up orphaned call ${sid} (${Math.round(age/60000)}min old)`);
      // Save transcript
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonPath = `/Users/jassonfishback/Projects/BengalOracle/logs/calls/${ts}_${sid}_orphan.json`;
      try {
        fs.writeFileSync(jsonPath, JSON.stringify({
          callSid: sid, from: call.from, timestamp: new Date().toISOString(),
          duration: 'unknown (orphaned)', exchanges: Math.floor(call.history.length / 2),
          messages: call.history, orphaned: true
        }, null, 2));
      } catch {}
      // Notify hub
      try {
        const payload = JSON.stringify({ channel: 'telegram', message: `Orphaned call detected (${sid}). Transcript saved. /status callback never arrived.` });
        const req = http.request({ hostname: 'localhost', port: 3457, path: '/send', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
        req.on('error', () => {});
        req.write(payload);
        req.end();
      } catch {}
      conversations.delete(sid);
      conversations.delete(sid + '_ctx');
    }
  }
}, 5 * 60 * 1000);

// ─── Audio cleanup (prevent /tmp/voice_audio from filling disk) ──────────────
setInterval(() => {
  try {
    const files = fs.readdirSync(AUDIO_DIR);
    const now = Date.now();
    for (const f of files) {
      const fPath = `${AUDIO_DIR}/${f}`;
      const stat = fs.statSync(fPath);
      if (now - stat.mtimeMs > 60 * 60 * 1000) { // Older than 1 hour
        fs.unlinkSync(fPath);
      }
    }
  } catch {}
}, 30 * 60 * 1000); // Every 30 minutes

server.listen(PORT, () => {
  console.log(`\n🎙️  Captain Claude Voice Server V3 — Enterprise Edition`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   Claude:  ${CLAUDE_MODEL} (max_tokens: 120)`);
  console.log(`   TTS:     ElevenLabs ${EL_MODEL} (Flash — optimized latency)`);
  console.log(`   Tunnel:  ${TUNNEL_URL}`);
  console.log(`\n   Endpoints:`);
  console.log(`     POST /voice     — incoming call`);
  console.log(`     POST /respond   — speech → Claude → TTS`);
  console.log(`     POST /status    — call status/cleanup`);
  console.log(`     GET  /health    — status check`);
  console.log(`     GET  /audio/:f  — serve audio\n`);
});
