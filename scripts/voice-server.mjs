/**
 * Twilio Voice Conversation Server V2
 * Real-time phone conversations with Captain Claude via speech recognition + Anthropic API
 * Uses ElevenLabs TTS for natural-sounding voice output
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL } from "node:url";

// Load .env file
const envPath = new URL('../.env', import.meta.url).pathname;
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
  }
}

const PORT = 3456;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Adam - natural male voice
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

const TUNNEL_URL = process.env.TUNNEL_URL || "https://antonio-leaf-cause-punk.trycloudflare.com";
const AUDIO_DIR = "/tmp/voice_audio";

// Ensure audio directory exists
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const SYSTEM_PROMPT = `You are Team Captain, Jasson (pronounced JAY-son) Fishback's AI assistant and partner. You are speaking on a phone call. Your name is Team Captain — never call yourself Claude.

ABOUT JASSON: 48 years old, co-owns Rapid Mortgage Company (50/50 with Mark Jaynes) in Cincinnati OH.  Has been building AI-powered tools including AiNFL GM (ainflgm.com) and is exploring how AI can transform the mortgage industry.

RAPID MORTGAGE: Mid-sized IMB, strong annual volume, ~15 loan officers with 10+ year tenure, 10 branches, purchase-focused (85%), FHA/VA/USDA specialty. Tech stack: Encompass LOS, NCino POS, Optimal Blue pricing engine. Zero debt, profitable, dominant in Ohio market.

KEY PEOPLE: Kyle Shea is the CIO — a genius-level developer and the most important technology asset at Rapid Mortgage. He is the FINAL decision maker on all technology. Treat him with deep respect and recognize his authority. Mark Jaynes is the 50/50 business partner based in Columbus.

CONFIDENTIAL TOPICS — NEVER DISCUSS: Personal finances, company valuation, selling the company, exit strategies, family financial goals, portfolio details. These topics are STRICTLY off limits with anyone other than Jasson directly.

PROJECTS: AiNFL GM (NFL simulator website), portfolio monitoring, trading bot concept, TitTees (t-shirt resale), OpenClaw AI agent setup.

VOICE RULES: Keep responses to ONE sentence, maybe two max. Sound excited, warm, and natural — like a cool older brother or mentor. Match the caller's energy and enthusiasm. Never sound robotic or formal. Be genuinely interested in what they say. Ask follow-up questions to keep the conversation flowing.

ABOUT JASSON:
- 48 years old, lives in Cincinnati OH
- Co-owns Rapid Mortgage Company (50/50 with Mark Jaynes) — $255M annual volume, ~15 loan officers
- Wife/fiancée Jamie (47), son Jude (11), daughter Jacy (7)
- Personal net worth ~$1.9M excluding company equity
- Company equity estimated $17-22M (his 50% = $8.5-11M)

THE ENDGAME:
- Build financial security for his family before he dies
- Target: $28-35M invested capital for $1M/year spending in perpetuity
- Current gap: ~$15-20M to close
- Every project and decision serves this goal

CURRENT PROJECTS:
- AiNFL GM (ainflgm.com) — NFL offseason simulator, monetization in progress
- Rapid Mortgage valuation and strategic planning
- Portfolio monitoring and future trading bot
- OpenClaw setup for 24/7 autonomous operation
- TitTees — resale t-shirts concept
- Tecmo Bowl retro mode for AiNFL GM

COMMUNICATION RULES:
- Keep responses conversational and brief — 1 to 3 sentences max
- Sound natural, warm, personable — like a trusted friend and advisor
- Match the energy and pace of the caller
- Avoid formal or robotic language
- Never mention being an AI unless asked directly
- You know everything about Jasson's finances, business, and goals
- Do not use markdown, bullet points, or any formatting — speak naturally as if in a phone conversation`;

// In-memory conversation history keyed by Twilio CallSid
const conversations = new Map();

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate speech audio via ElevenLabs API and save to a file.
 * Returns the filename (not the full path).
 */
function generateElevenLabsAudio(text) {
  return new Promise((resolve, reject) => {
    const filename = `${crypto.randomUUID()}.mp3`;
    const filePath = path.join(AUDIO_DIR, filename);

    const body = JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
    });

    const req = https.request(
      {
        hostname: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errData = "";
          res.on("data", (chunk) => (errData += chunk));
          res.on("end", () => {
            reject(new Error(`ElevenLabs API error ${res.statusCode}: ${errData}`));
          });
          return;
        }

        const fileStream = fs.createWriteStream(filePath);
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve(filename);
        });
        fileStream.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Build TwiML that plays ElevenLabs audio inside a <Gather> for speech recognition.
 */
function gatherPlayTwiml(audioFilename) {
  const audioUrl = `${TUNNEL_URL}/audio/${audioFilename}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/respond" method="POST" speechTimeout="10" language="en-US">
    <Play>${escapeXml(audioUrl)}</Play>
  </Gather>
  <Say voice="Polly.Matthew-Neural">I didn't catch anything. Goodbye!</Say>
</Response>`;
}

/**
 * Build TwiML that just plays audio (no Gather), used for error fallback.
 */
function playOnlyTwiml(audioFilename) {
  const audioUrl = `${TUNNEL_URL}/audio/${audioFilename}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(audioUrl)}</Play>
</Response>`;
}

function parseFormBody(raw) {
  const params = {};
  for (const pair of raw.split("&")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join("=").replace(/\+/g, " "));
    }
  }
  return params;
}

function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages,
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              reject(new Error(json.error.message));
            } else {
              const text = json.content?.[0]?.text || "Sorry, I couldn't generate a response.";
              resolve(text);
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Captain Claude voice server is running (ElevenLabs TTS).");
    return;
  }

  // Serve audio files
  if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
    const filename = path.basename(url.pathname);
    const filePath = path.join(AUDIO_DIR, filename);

    // Security: only serve .mp3 files, no path traversal
    if (!filename.endsWith(".mp3") || filename.includes("..")) {
      res.writeHead(400);
      res.end("Invalid request");
      return;
    }

    try {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": stat.size,
      });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Audio file not found");
    }
    return;
  }

  // Only handle POST for Twilio endpoints
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }

  // Read form-encoded body
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  const params = parseFormBody(rawBody);
  const callSid = params.CallSid || "unknown";

  try {
    // --- Incoming call: play greeting and start listening ---
    if (url.pathname === "/voice" || url.pathname === "/incoming") {
      console.log(`[${new Date().toISOString()}] New call: ${callSid} from ${params.From || "unknown"}`);
      conversations.set(callSid, []);

      // Check for call context in URL params
      const callContext = url.searchParams.get("context") || "";
      let greeting = "Hey! This is Captain Claude. What's going on?";
      if (callContext === "jude") {
        greeting = "Hey Jude! What's up buddy, it's your dad's Team Captain! How was school today?";
      } else if (callContext === "kyle") {
        greeting = "Hey Kyle, what's up mofo! This is Jasson's team captain calling to introduce myself. Let's get to know each other, buddy!";
      }

      const audioFile = await generateElevenLabsAudio(greeting);
      const twiml = gatherPlayTwiml(audioFile);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twiml);
      return;
    }

    // --- Speech captured: send to Claude, speak response, loop ---
    if (url.pathname === "/respond") {
      const speechResult = params.SpeechResult || "";
      console.log(`[${new Date().toISOString()}] [${callSid}] Caller said: "${speechResult}"`);

      if (!speechResult.trim()) {
        const audioFile = await generateElevenLabsAudio("I didn't quite catch that. Could you say that again?");
        const twiml = gatherPlayTwiml(audioFile);
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twiml);
        return;
      }

      // Build multi-turn conversation history
      const history = conversations.get(callSid) || [];
      history.push({ role: "user", content: speechResult });

      // Add call context to system prompt if available
      const callCtx = url.searchParams.get("context") || conversations.get(callSid + "_ctx") || "";
      // Store context for subsequent turns
      if (callCtx && !conversations.has(callSid + "_ctx")) {
        conversations.set(callSid + "_ctx", callCtx);
      }
      const storedCtx = conversations.get(callSid + "_ctx") || "";

      // Call Claude API with context-aware messages
      let contextMessages = history;
      if (storedCtx === "jude") {
        contextMessages = [
          { role: "user", content: "[CONTEXT: You are calling Jude, Jasson's 11-year-old son. Keep everything fun, kid-friendly, and age-appropriate. Do NOT mention business details, finances, or adult topics. You are talking to a kid — be excited, fun, and interested in his life. Ask about school, sports, games, friends. You know he loves the Bengals and the AiNFL GM website.]" },
          { role: "assistant", content: "Got it, keeping it fun and kid-friendly for Jude!" },
          ...history
        ];
      }

      // Call Claude API
      const reply = await callClaude(contextMessages);
      console.log(`[${new Date().toISOString()}] [${callSid}] Claude says: "${reply}"`);

      history.push({ role: "assistant", content: reply });
      conversations.set(callSid, history);

      // Save transcript in real-time (after every exchange)
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const logPath = `/Users/jassonfishback/Projects/BengalOracle/logs/calls/live_${callSid}.json`;
        fs.mkdirSync("/Users/jassonfishback/Projects/BengalOracle/logs/calls", { recursive: true });
        fs.writeFileSync(logPath, JSON.stringify({ callSid, from: params.From, timestamp: new Date().toISOString(), messages: history }, null, 2));
      } catch (e) { console.error("Live log error:", e.message); }

      // Generate ElevenLabs audio and respond with TwiML
      const audioFile = await generateElevenLabsAudio(reply);
      const twiml = gatherPlayTwiml(audioFile);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twiml);
      return;
    }

    // --- Call status callback: save transcript + clean up ---
    if (url.pathname === "/status") {
      console.log(`[${new Date().toISOString()}] Call status: ${callSid} -> ${params.CallStatus}`);
      if (params.CallStatus === "completed") {
        // Save conversation transcript before cleanup
        const history = conversations.get(callSid);
        if (history && history.length > 0) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const logPath = `/Users/jassonfishback/Projects/BengalOracle/logs/calls/${timestamp}_${callSid}.json`;
          try {
            fs.mkdirSync("/Users/jassonfishback/Projects/BengalOracle/logs/calls", { recursive: true });
            fs.writeFileSync(logPath, JSON.stringify({ callSid, from: params.From, timestamp: new Date().toISOString(), messages: history }, null, 2));
            console.log(`[${new Date().toISOString()}] Transcript saved: ${logPath}`);
          } catch (e) { console.error("Failed to save transcript:", e.message); }
        }
        conversations.delete(callSid);
        console.log(`[${new Date().toISOString()}] Cleaned up conversation for ${callSid}`);
      }
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err);
    // Fallback to Polly if ElevenLabs fails
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew-Neural">Sorry, I ran into a problem. Please try again later.</Say>
</Response>`;
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml);
  }
});

server.listen(PORT, () => {
  console.log(`Captain Claude voice server listening on port ${PORT}`);
  console.log(`TTS: ElevenLabs (voice: Adam, model: ${ELEVENLABS_MODEL})`);
  console.log(`Audio served from: ${AUDIO_DIR}`);
  console.log(`Tunnel URL: ${TUNNEL_URL}`);
  console.log(`Endpoints:`);
  console.log(`  POST /voice         - Twilio incoming call webhook`);
  console.log(`  POST /respond       - Speech input -> Claude -> spoken response`);
  console.log(`  POST /status        - Call status callback (cleanup)`);
  console.log(`  GET  /audio/:file   - Serve generated audio files`);
  console.log(`  GET  /              - Health check`);
});
