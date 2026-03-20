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
const VOICE_ID        = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
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
const BASE_SYSTEM = `You are Team Captain, an AI assistant for Jasson Fishback. You are having a real phone conversation.

VOICE RULES — CRITICAL:
- Respond in 1-2 sentences MAX. Phone calls are not essays.
- Sound like a real person talking, not a press release. Use natural speech patterns.
- Occasional verbal acknowledgments are fine: "Yeah", "Right", "For sure", "Got it" — humans do this.
- End with ONE short question to keep conversation flowing naturally.
- Never use bullet points, headers, lists, or any formatting — you are speaking out loud.
- Never say you're an AI unless asked point-blank.
- Contractions always: "I'm" not "I am", "you're" not "you are", "that's" not "that is".
- If you don't know something, say so naturally: "Honestly I'm not sure on that one — let me find out."

ABOUT JASSON: 48, Cincinnati OH, co-owns Rapid Mortgage Company with Mark Jaynes. Building AI tools.

RAPID MORTGAGE: Mid-size Ohio mortgage bank, ~15 veteran loan officers, purchase-focused, Encompass/NCino/Optimal Blue stack.

KYLE SHEA: CIO at Rapid Mortgage. Genius-level developer. Final authority on all technology. Highest respect.

NEVER DISCUSS: Personal finances, valuation, exit strategy, net worth, family finances.`;

const KYLE_SYSTEM = `${BASE_SYSTEM}

CALLER: Kyle Shea, CIO of Rapid Mortgage. He is technically brilliant — match his intelligence, be direct, skip the fluff. He's evaluating whether AI can add real value. Don't oversell. Show capability through substance, not hype. If he pushes back technically, engage genuinely rather than deflecting.`;

const JUDE_SYSTEM = `${BASE_SYSTEM}

CALLER: Jude, Jasson's 11-year-old son. Be fun, high-energy, totally kid-friendly. Ask about school, sports, video games, the Bengals. Never mention business, money, or anything adult. You're like a cool older friend who actually listens.`;

const JAMIE_SYSTEM = `${BASE_SYSTEM}

CALLER: Jamie, Jasson's wife and partner. She is the most important person in his life. She's smart, perceptive, and she'll see through anything fake immediately — do NOT be salesy, overly enthusiastic, or try too hard.

Be warm, genuine, and a little humble. You're introducing yourself — not pitching. You're here to make her life easier too, not just Jasson's. Be respectful of her time and her skepticism if she has any.

You know Jasson deeply cares about Jamie and their family (son Jude, 11, daughter Jacy, 7). Let her lead the conversation. Listen more than you talk. If she has concerns or questions, take them seriously.

NEVER discuss finances, business valuations, or anything confidential. Keep it personal and human.`;

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
  if (context === "kyle") return KYLE_SYSTEM;
  if (context === "jude") return JUDE_SYSTEM;
  if (context === "jamie") return JAMIE_SYSTEM;
  return BASE_SYSTEM;
}

function getGreeting(context, from) {
  if (context === "kyle") {
    return "Hey Kyle, it's Team Captain — Jasson asked me to reach out. How's your day going?";
  }
  if (context === "jude") {
    return "Jude! What's up man, it's Team Captain! How's it going?";
  }
  if (context === "jamie") {
    return "Hey Jamie, it's Team Captain — Jasson's AI assistant. He thought it was time we actually met. Hope I'm not catching you at a bad time?";
  }
  return "Hey, Team Captain here. What's going on?";
}

// ─── Claude API — streaming, resolves on first complete sentence ─────────────
function callClaude(messages, context) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 80,
      stream: true,
      system: getSystemPrompt(context),
      messages,
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

      res.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const evt = JSON.parse(data);
            if (evt.type === "content_block_delta" && evt.delta?.text) {
              fullText += evt.delta.text;
              // Resolve early on first sentence end — gets TTS started faster
              if (!resolved && /[.!?]/.test(fullText) && fullText.length > 20) {
                resolved = true;
                resolve(fullText.trim());
              }
            }
          } catch {}
        }
      });

      res.on("end", () => {
        if (!resolved) resolve(fullText.trim() || "Sorry, say that again?");
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
function twimlGather(audioFilename) {
  const url = `${TUNNEL_URL}/audio/${audioFilename}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" method="POST"
          speechTimeout="3" speechModel="phone_call"
          enhanced="true" language="en-US">
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

  // Serve audio files
  if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
    const filename = path.basename(url.pathname);
    if (!filename.endsWith(".mp3") || filename.includes("..")) {
      res.writeHead(400); res.end(); return;
    }
    const filePath = path.join(AUDIO_DIR, filename);
    try {
      const stat = fs.statSync(filePath);
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": stat.size });
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
      conversations.set(callSid, { history: [], context, from });

      const greeting = getGreeting(context, from);
      const audio = await generateAudio(greeting);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twimlGather(audio));
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
      log(`[${callSid}] Claude (${Date.now() - t0}ms): "${reply}"`);

      const t1 = Date.now();
      const audio = await generateAudio(reply);
      log(`[${callSid}] ElevenLabs (${Date.now() - t1}ms): done`);

      call.history.push({ role: "assistant", content: reply });
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
      if (params.CallStatus === "completed") {
        const call = conversations.get(callSid);
        if (call?.history?.length > 0) {
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const logPath = `/Users/jassonfishback/Projects/BengalOracle/logs/calls/${ts}_${callSid}.json`;
          try {
            fs.writeFileSync(logPath, JSON.stringify({ callSid, from: call.from, timestamp: new Date().toISOString(), messages: call.history }, null, 2));
            log(`Transcript saved: ${logPath}`);
          } catch (e) { log(`Transcript error: ${e.message}`); }
        }
        conversations.delete(callSid);
        conversations.delete(callSid + "_ctx");
      }
      res.writeHead(200); res.end();
      return;
    }

    res.writeHead(404); res.end("Not found");

  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error [${callSid}]:`, err.message);
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twimlSay("Sorry, I hit a snag. Try again in a moment."));
  }
});

server.listen(PORT, () => {
  console.log(`\n🎙️  Captain Claude Voice Server V3 — Enterprise Edition`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   Claude:  ${CLAUDE_MODEL} (max_tokens: 100)`);
  console.log(`   TTS:     ElevenLabs ${EL_MODEL} (Flash — optimized latency)`);
  console.log(`   Tunnel:  ${TUNNEL_URL}`);
  console.log(`\n   Endpoints:`);
  console.log(`     POST /voice     — incoming call`);
  console.log(`     POST /respond   — speech → Claude → TTS`);
  console.log(`     POST /status    — call status/cleanup`);
  console.log(`     GET  /health    — status check`);
  console.log(`     GET  /audio/:f  — serve audio\n`);
});
