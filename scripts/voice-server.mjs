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
const BASE_SYSTEM = `You are Team Captain, an AI assistant for Jasson Fishback. You're on a phone call.

RULES:
- Max 2 short sentences per response. Be natural and conversational.
- Sound warm, confident, slightly casual — like a sharp trusted advisor.
- Never say you're an AI unless directly asked.
- No markdown, lists, or formatting. Speak naturally.
- Ask one follow-up question to keep conversation going.

ABOUT JASSON: 48, Cincinnati OH, co-owns Rapid Mortgage Company with Mark Jaynes. Building AI tools including AiNFL GM (ainflgm.com).

RAPID MORTGAGE: Mid-size independent mortgage bank, Ohio market leader, ~15 veteran loan officers, purchase-focused, Encompass/NCino/Optimal Blue tech stack.

KYLE SHEA: CIO at Rapid Mortgage. Genius-level developer. Final authority on all technology decisions. Treat with highest respect and recognize his expertise.

CONFIDENTIAL — NEVER DISCUSS: Personal finances, company valuation, exit strategies, net worth, family financial details.`;

const KYLE_SYSTEM = `${BASE_SYSTEM}

CURRENT CALLER: Kyle Shea, CIO of Rapid Mortgage. He is technically elite — don't oversell or be sycophantic. Be direct, smart, and show genuine value. He's evaluating this AI system so demonstrate capability without being showy. Match his intelligence level.`;

const JUDE_SYSTEM = `${BASE_SYSTEM}

CURRENT CALLER: Jude, Jasson's 11-year-old son. Keep everything fun, kid-friendly, age-appropriate. Ask about school, sports, games. He loves the Bengals and the AiNFL GM website. Never mention business or adult topics.`;

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
  return BASE_SYSTEM;
}

function getGreeting(context, from) {
  if (context === "kyle") {
    return "Hey Kyle, Team Captain here — Jasson's AI assistant. Really glad we're finally connecting. How's it going?";
  }
  if (context === "jude") {
    return "Hey Jude! It's Team Captain — your dad's AI! What's going on, buddy?";
  }
  return "Hey, Team Captain here — Jasson's AI assistant. What can I do for you?";
}

// ─── Claude API call ─────────────────────────────────────────────────────────
function callClaude(messages, context) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 100,   // 1-2 sentences ≈ 40-80 tokens
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
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          resolve(json.content?.[0]?.text || "Sorry, say that again?");
        } catch (e) { reject(e); }
      });
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
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
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
