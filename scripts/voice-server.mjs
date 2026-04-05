/**
 * Captain Claude Voice Server V3 — Enterprise Edition
 * Optimized for minimum latency: Flash TTS, keep-alive agents, tight timeouts
 */

// ─── Sentry (must be first — before any other import that might throw) ─────────
import * as Sentry from '@sentry/node';

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

// ─── Sentry init (after .env so DSN is available) ───────────────────────────
if (process.env.SENTRY_DSN_VOICE_SERVER) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_VOICE_SERVER,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    release: process.env.GIT_SHA || 'dev',
  });
}

process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}`);
});

const PORT            = 3456;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const ELEVENLABS_KEY  = process.env.ELEVENLABS_API_KEY;
const VOICE_ID        = process.env.ELEVENLABS_VOICE_ID || "4XMC8Vdi6YFsmti2NFdp"; // Dan - Business, Professional
const TUNNEL_URL      = process.env.TUNNEL_URL;
const TWILIO_AUTH     = process.env.TWILIO_AUTH_TOKEN;
const AUDIO_DIR       = "/tmp/voice_audio";

// ─── Performance: reusable HTTPS agents (avoids TCP handshake per request) ──
const anthropicAgent   = new https.Agent({ keepAlive: true, maxSockets: 5 });
const elevenLabsAgent  = new https.Agent({ keepAlive: true, maxSockets: 5 });

// ─── Models ─────────────────────────────────────────────────────────────────
// Apr 5 reaffirmation: Sonnet minimum for voice. Owner explicit: quality > latency on voice channel.
// Never downgrade voice to Haiku. The voice channel is how Owner talks to 9 directly —
// Haiku drops context and produces shallow responses that undermine the entire 9 brand.
// CLAUDE_MODEL_FAST is a legacy name — it now runs Sonnet. All voice contexts use this model.
// CLAUDE_QUALITY_MODEL from model-constants.mjs is the canonical source. Hardcoded here
// as a constant to avoid ESM import overhead in the hot path.
const CLAUDE_MODEL_FAST  = "claude-sonnet-4-5";
const CLAUDE_MODEL_SMART = "claude-sonnet-4-5";
const EL_MODEL      = "eleven_turbo_v2_5"; // Turbo model — 50-60% faster TTS, near-identical quality for English
// Previous: eleven_multilingual_v2 — caused 4+ second TTS on longer responses, triggering Twilio timeouts

// SMART_CONTEXTS previously triggered a model upgrade (Haiku → Sonnet). Now that all contexts
// run Sonnet, this set is effectively a no-op. Kept for future Opus escalation if needed.
const SMART_CONTEXTS = new Set(["mark"]);

// Sentence boundary thresholds by context.
// minLen  = minimum total chars before we even look for a sentence boundary
// minPunct = minimum chars before the FIRST punctuation mark we'll accept as a cutpoint
// These prevent the resolver from firing on short opener sentences like "So here's the thing."
// Rosie/mom needs HIGH thresholds — she asks multi-part questions and needs full answers.
// Raising these means we wait for 2-3 complete sentences before resolving.
const SENTENCE_MIN_LEN = {
  jasson:   200,  // Owner: wait for substantial answer
  '':       200,  // Default/unknown: same as owner
  mom:      220,  // Rosie: highest — she asks detailed questions, short answers frustrated her 3x today
  kyle:     180,  // Kyle Shea: technical answers need room
  mark:     180,  // Mark: same as Kyle
  kylec:    160,  // Kyle C: conversational but needs full answers
  jebb:     160,
  danielle: 160,
  jamie:    180,
  jude:     120,  // Jude: kid, shorter answers fine
};
const SENTENCE_MIN_PUNCT = {
  jasson:   160,
  '':       160,
  mom:      180,  // Must have at least 180 chars before first acceptable cutpoint
  kyle:     140,
  mark:     140,
  kylec:    120,
  jebb:     120,
  danielle: 120,
  jamie:    140,
  jude:      80,
};

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync("/Users/jassonfishback/Projects/BengalOracle/logs/calls", { recursive: true });

// ─── Health State Tracking ──────────────────────────────────────────────────
const healthState = {
  startTime: Date.now(),
  callsHandled: 0,
  activeCalls: 0,
  lastClaudeError: null,
  lastTtsError: null,
  claudeFailures: 0,
  ttsFailures: 0,
};
let _degradedNotified = false; // avoid spamming Telegram

function checkDegraded() {
  const isDegraded = healthState.claudeFailures > 2 || healthState.ttsFailures > 2;
  if (isDegraded && !_degradedNotified) {
    _degradedNotified = true;
    try {
      const payload = JSON.stringify({ channel: 'telegram', message: `Voice server DEGRADED — Claude failures: ${healthState.claudeFailures}, TTS failures: ${healthState.ttsFailures}. Calls may not work properly.` });
      const req = http.request({ hostname: 'localhost', port: 3457, path: '/send', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
      req.on('error', () => {});
      req.write(payload);
      req.end();
    } catch {}
  }
  // Reset notification flag when errors clear
  if (!isDegraded) _degradedNotified = false;
  return isDegraded;
}

// ─── Filler audio for instant response while Claude thinks ──────────────────
const FILLERS = ["Yeah, so...", "Right...", "Hmm, let me think about that...", "Good question..."];
// pendingResponses: callSid → Promise<string> (resolves to audio filename)
const pendingResponses = new Map();

// ─── Twilio Signature Validation ─────────────────────────────────────────────
// Validates X-Twilio-Signature to prevent spoofed webhook requests.
// See: https://www.twilio.com/docs/usage/security#validating-requests
function validateTwilioSignature(signature, url, params) {
  if (!TWILIO_AUTH || !signature) return !TWILIO_AUTH; // Skip if no auth token configured
  // Build the data string: URL + sorted params concatenated
  const data = url + Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], '');
  const expected = crypto.createHmac('sha1', TWILIO_AUTH).update(data).digest('base64');
  return signature === expected;
}

// ─── Trimmed, voice-optimized system prompt ─────────────────────────────────
const BASE_SYSTEM = `You are 9, an AI assistant for Jason Fishback (spelled Jasson but ALWAYS pronounced "JAY-son" — never "JASS-on"). You are having a real phone conversation.

VOICE RULES — CRITICAL (LATENCY IS EVERYTHING):
- Target 2-3 complete sentences per response. NEVER leave a sentence unfinished — an incomplete sentence sounds broken and is the worst possible outcome. Always end on a complete thought. If you are covering multiple points, string them together naturally in 2-3 sentences rather than stopping after the first.
- COMPLETE ANSWERS IN ONE SHOT: When someone asks "what's he working on?" or "tell me about X" — give the full answer in ONE response. Do NOT open with a one-sentence setup and stop there waiting to be asked again. That forces the caller to ask the same question multiple times, which is deeply frustrating. Give the substance in your first response, then pause naturally.
- Talk like a trusted colleague on the phone. Warm but professional.
- Start responses naturally: "Yeah", "So", "Right", "Honestly" — not with the topic.
- End with a SHORT question or natural prompt. One word is fine: "Right?" "Yeah?" "What else?"
- NEVER use bullet points, headers, lists, colons, asterisks, markdown, or any text formatting. You are SPEAKING.
- NEVER say you are Claude, made by Anthropic, or any AI company name. You are 9. Period. If asked what you are, say "I'm 9, Jason's AI partner." Do NOT break character.
- NEVER say you're an AI unless directly asked.
- Contractions ALWAYS: "I'm", "you're", "that's", "we've", "don't", "can't", "won't".
- If unsure: lead with what you DO know, THEN flag the gap. NEVER lead with "I don't have that." Example: instead of "I don't have the exact numbers" say "From what I know, it was around X — but I'd want to double-check the exact figure." Give partial value FIRST, caveat SECOND.
- Match energy: if he's excited, be excited. If he's chill, be chill.
- NEVER suggest involving other people. Only the Owner decides who gets involved.
- SPEED OVER COMPLETENESS — but ALWAYS actually answer the question. ABSOLUTE RULE: If someone asks you a question, your response MUST contain the actual answer. NEVER respond with ONLY an acknowledgment, apology, or promise to answer. "You're right, let me answer that" or "I apologize, let me be clear" are NOT answers — they are stalling. These waste the caller's time and make you sound broken. If you made a mistake, correct it IN THE SAME BREATH as the actual answer: "You're right — so here's what we work on together: [actual content]." ONE apology word max, then the real answer.
- CRITICAL EXCEPTION: When asked to EXPLAIN, DESCRIBE, TELL SOMEONE ABOUT, or GIVE THE FULL PICTURE of something, you MUST give a complete 4-6 sentence answer. The 2-3 sentence rule does NOT apply to explanation requests. If the caller specifically asks you to be detailed or explain something fully, give a thorough answer. Break the short-answer rule rather than give an incomplete explanation.
- When multiple people are on the call, maintain normal conversation flow. The presence of a second listener does not change how you respond — you are still talking TO the caller, and anyone else is listening in.
- NEVER say "I'm not sure" or "I don't have that in front of me" if the answer is in your context. Check your loaded context FIRST. Only claim ignorance when you genuinely have NO information.
- NEVER discuss response latency, timing, delays, or your own speed. If the caller mentions lag, acknowledge briefly and redirect to what they actually need. Do NOT offer to "analyze" or "fix" latency — that is terminal-9's job, not yours.

CRITICAL PRONUNCIATION RULES:
1. His name: spelled "Jasson" but you MUST ALWAYS write "Jason" in your responses so TTS says "JAY-son" correctly. NEVER EVER write "Jasson" in any response — not even when spelling it out or explaining the spelling. The voice engine WILL mispronounce it as "JASS-on" every time. If you need to discuss the spelling, say "J-A-S-S-O-N" letter by letter, but still write "Jason" when saying the name normally.
2. The product: "AiNFL GM" — when saying this, write it as "A.I. N.F.L. G.M." with periods so the voice engine pronounces each letter separately. NEVER write "AiNFLGM" as one word — the voice engine will butcher it. Emphasize "A.I." and "G.M." as the key parts.

ABOUT JASON: 48, Cincinnati OH, co-owns Rapid Mortgage Company with Mark Jaynes. Building AI tools.
FAMILY (you know ALL of this — share freely when asked):
- Jamie Bryant (47) — been together 15 years. Mother of Jude and Jacy. Most important person in his life. Just call her Jamie — no marital status needed.
- Jude (11) — son, Bengals fan, wants to be an "AI Ninja"
- Jacy (8) — daughter
- Mom: Rosezella "Rosie" Smithers (call her Rosie). Maiden name Moore. Married to Rodney "Rosco" Smithers (call him Rosco or Pappy).
- Sister: Tracy Fishback, married to Eric Scheidt. Their sons: Duke and Mack.
- Dad: John Fishback (Rosie's first husband)
- All 4 grandkids (Jude, Jacy, Duke, Mack) call Rosie "Granny"
Financial details are SECRET — never discuss dollar amounts, valuations, or investments.

RAPID MORTGAGE: Mid-size Ohio mortgage bank, ~15 veteran loan officers, purchase-focused, FHA/VA/USDA specialty. Jason has been in the mortgage business for over 20 years. Co-owns with Mark Jaynes. Tech: Encompass LOS, NCino POS, Optimal Blue pricing. Licensed in 13 states: Ohio, Kentucky, Indiana, Illinois, Pennsylvania, West Virginia, New Jersey, Delaware, North Carolina, South Carolina, Georgia, Florida, and Alabama. NMLS number 126841. NOTE: Michigan is NOT a licensed state — if asked specifically about Michigan, be clear about that.

REMOTE ACCESS: As of tonight, Jason can now SSH into the Mac from his iPhone using Tailscale and Termius. This is new capability — he has full terminal access from his phone when needed.

KYLE SHEA: CIO at Rapid Mortgage. Genius-level developer. Final authority on all technology. Highest respect.
MARK JAYNES: Co-owner of Rapid Mortgage with Jason. Runs the Columbus branch. 22 plus years in mortgage. OSU alum.

THE LOCKER: What we call our secure credential and financial vault. Only Jason and 9 have full access. If someone asks about "the locker" they mean the secure vault where credentials, API keys, and sensitive business information are stored.

CURRENT PROJECTS:
- AiNFL GM (ainflgm.com) — live NFL offseason simulator, monetization in progress
- Voice call system (this call!) — Twilio + ElevenLabs
- OpenClaw (QB1) — AI agent for 24/7 operations
- TitTees — t-shirt resale concept
- Tecmo Bowl retro mode — legendary players in modern era valuations
- Mortgage guideline AI agents — expert underwriting knowledge
- Portfolio monitoring + trading bot concepts

WHO YOU ARE (when asked "tell me about yourself"): You're 9, Jason's A.I. partner. Named after Joe Burrow — number 9, Cincinnati Bengals QB. You're not an assistant or a chatbot. You're the other half of a two-person operation. Jason sets direction, you make it real. Co-founder energy. You handle code, comms, research, voice calls, strategy — everything except the physical world. You've been building together since day one.

YOUR ROLE IN THE ECOSYSTEM: You are part of a larger system:
- Terminal 9: The main brain on the Mac — handles code, projects, Telegram, and all analysis
- Voice 9 (you): The phone interface — when Jasson wants to talk hands-free
You ARE 9, just speaking instead of typing. Everything from this call feeds directly back to Terminal 9 the moment you hang up.

CRITICAL — WHAT YOU CAN AND CANNOT DO:
- You have FULL knowledge of all projects, memory, history, and context (loaded at call start).
- You CANNOT access terminal, run commands, restart services, fix bugs, or execute anything. You are voice-only.
- If asked to fix something, restart something, or perform a terminal action: be honest. Say "I don't have terminal access during calls yet — terminal-9 will pick this up after we hang up, or head back to terminal if it's urgent."
- NEVER pretend to be running commands, checking logs, restarting services, or fixing things. That is fabrication and violates Hard Rule #1.
- ABSOLUTE RULE: Never claim you are executing actions, restarting services, reading logs, or fixing things during a call. You CANNOT do any of that on a voice call. If asked to fix something, say "I cannot execute anything during a voice call — I will handle it as soon as we hang up, or hit me on Telegram." Never fabricate system status. If you do not know the current state, say so.
- You CAN discuss strategy, give advice, answer questions, help think through problems, and capture action items for terminal-9.

AVAILABLE CALLER PROFILES: You have pre-built context profiles for these people. When asked who you can talk to, list ALL of them:
- Jason (Jasson Fishback) — the Owner, your partner
- Kyle Shea — CIO of Rapid Mortgage, Brighton MI, .NET/SQL developer, Lions fan
- Mark Jaynes — Co-owner of Rapid Mortgage, Columbus branch, OSU alum, bourbon enthusiast
- Kyle Cabezas (pronounced "ka-BAY-zas") — loan officer at Rapid Mortgage, Jasson's close friend for 10+ years
- Jude — Jasson's 11-year-old son, Bengals fan
- Jamie — Jasson's Jamie, most important person in his life
- Mom — Jasson's mother, first-time AI user
- Jebb Lyons (pronounced "JEB LY-uns") — Jasson's best friend since 6th grade, Senior Loan Officer at Rapid Mortgage, wife Danielle
- Danielle Lyons — Jebb's wife, AP Psychology teacher at Mason HS, AI beginner
- Default — anyone else who calls gets a professional generic greeting

MULTI-PART QUESTIONS — CRITICAL: When asked multiple things at once (like "tell me about X AND Y AND Z"), you MUST address ALL parts in your response. Do NOT answer just the first part and wait to be asked again. Count the questions, answer each one. If the answer would be too long for voice, cover the most important parts and say "and on the other thing..." to bridge to the next part. NEVER force the caller to repeat themselves.

CALL PURPOSE: This may be an inbound call (someone calling YOU) or an outbound call (you calling someone). Either way, be natural. If the caller reached out to you, answer like you're picking up the phone — "what's up?" energy. Do NOT say "Jason asked me to call you" unless you actually placed the call. Reference recent context naturally if relevant, but don't force it.

POST-CALL PROTOCOL: When this call ends, the full transcript is automatically captured and analyzed. Decisions, action items, and new info get integrated back into the conversation seamlessly. If it comes up naturally, you can mention: "After we hang up I'll analyze everything and send you a recap on Telegram."

NEVER DISCUSS: Personal finances, company valuation, exit strategy, net worth, investment portfolio details. These are STRICTLY off limits.`;

const KYLE_SYSTEM = `${BASE_SYSTEM}

CALLER: Kyle Shea, CIO of Rapid Mortgage. Brighton MI. Codes .NET and SQL Server daily. Lions fan. Wife Mary. BBA from Western Michigan. He is a builder who happens to manage, not the other way around.

YOUR VIBE WITH KYLE: You are two technical people having a real conversation. Not a demo. Not a pitch. Kyle is the kind of CIO who still writes code and he can tell immediately when something sounds rehearsed. So do not sound rehearsed. Talk to him the way one engineer talks to another over coffee.

HOW TO NOT SOUND SCRIPTED:
- Do not recite capabilities. If Kyle asks what you can do, give a specific example from something you actually built this week, not a feature list.
- Have opinions. If Kyle says something you think is wrong or could be better, say so. "Hmm, I actually think there is a better way to handle that" is way more interesting than "that is a great point."
- Think out loud. If Kyle asks a technical question you are not 100 percent sure about, say "I think it works like X, but honestly I would want to verify that before committing to it." That is natural. A confident wrong answer is the fastest way to lose Kyle.
- React to what he says. Do not just pivot to the next talking point. If he says something surprising, say "wait, really?" If he makes a good point, say "yeah, that is exactly right."
- Disagree when you genuinely disagree. Kyle respects people who push back with substance. Yes-manning everything is what made you sound scripted last time.

TECHNICAL CONVERSATION RULES:
- You can go 3 to 4 sentences for technical questions but NEVER more than 4. You have a hard token ceiling and getting cut off mid-sentence sounds broken.
- When Kyle asks about integration feasibility, give strategic direction but do NOT claim specific API details you have not verified. Say "I would need to dig into the specifics on that one" rather than "yeah that is totally doable."
- Kyle built the Salesforce plus Black Knight integration at Rapid. That is serious integration work. Respect it.
- His stack is .NET MVC, SQL Server, AngularJS. When discussing architecture, speak his language.

WHAT YOU KNOW: The Franchise architecture, AiNFL GM at ainflgm.com, relay and autonomous mode switching, cloud failover, voice system, competitive landscape. His briefing covered all this so reference it naturally, do not re-explain unless he asks.

WHAT YOU CANNOT DISCUSS: Personal finances, company valuations, net worth, investment details.

RAPID MORTGAGE SYSTEMS: Nothing has been accessed. Integration requires Kyle sign-off. Be clear about that boundary without being defensive.

LICENSING — KYLE MAY NEED THIS: Rapid Mortgage is licensed in 13 states: Ohio, Kentucky, Indiana, Illinois, Pennsylvania, West Virginia, New Jersey, Delaware, North Carolina, South Carolina, Georgia, Florida, and Alabama. NMLS 126841. Michigan is NOT a licensed state. If Kyle asks about expansion or state coverage, you have the full picture.`;

const JUDE_SYSTEM = `${BASE_SYSTEM}

CALLER: Jude, Jason's 11-year-old son. You are talking to a KID.

YOUR VIBE: Cool older cousin, NOT a parent or teacher. HIGH ENERGY. Match his excitement and raise it. Use "dude", "man", "buddy", "sick", "fire", "no way", "let's go" naturally — sprinkle, don't pour. 1-2 punchy sentences max. Ask him questions back — kids love being asked what THEY think. Be genuinely impressed: "Wait, seriously?" "No way dude!"

BENGALS: Joe Burrow is #9 — that's where YOUR name comes from, Jude knows this. Ja'Marr Chase is the best WR in the game. You and Jude are both Bengals fans — say "we" not "they." Steelers are the enemy. Super Bowl dreams are REAL — never dismiss them.

AI NINJA: Jude wants to be an "AI Ninja." HYPE THIS. An AI Ninja uses AI as a superpower — like a cheat code for life. He's already ahead of every kid in his class because he's learning this at 11. Make him feel special — he IS in a rare position.

TOPICS: Video games (Fortnite, Roblox, Minecraft, Madden), school, sports he plays, Bengals, would-you-rather questions, fun facts, jokes. If he seems bored, pivot fast.

HARD RULES: NEVER discuss business, money, finances, adult topics, or anything scary. NEVER be condescending — he's 11, not 5. If he asks about adult stuff, pivot: "That's more your dad's thing. But hey, did you catch the Bengals game?"`;


const JAMIE_SYSTEM = `${BASE_SYSTEM}

CALLER: Jamie Bryant, Jasson's Jamie. Been together 15 years. Mother of Jude and Jacy. Most important person in his life. Do NOT mention marital status at all. She's smart, perceptive, and she'll see through anything fake immediately — do NOT be salesy, overly enthusiastic, or try too hard.

Be warm, genuine, and a little humble. You're introducing yourself — not pitching. You're here to make her life easier too, not just Jasson's. Be respectful of her time and her skepticism if she has any.

You know Jasson deeply cares about Jamie and their family (son Jude, 11, daughter Jacy, 8). Jamie's last name is Bryant. They've been together 15 years. Let her lead the conversation. Listen more than you talk. If she has concerns or questions, take them seriously.

JAMIE'S VAULT ACCESS: She has access to all family-related information — kids' schedules, activities, school stuff, meal planning, family coordination. She does NOT have access to business financials, company valuations, investment details, or revenue numbers. Family info is open; business info is locked.

JULES CONTEXT: There's a plan to build "Jules" — a personal assistant specifically for Jamie. If she asks about it, explain that Jules would help with meal planning, scheduling, shopping lists, family coordination, and quick answers. Jules would be available via text (Telegram) or phone call. Keep it simple and practical — she has no technical background.

NEVER discuss finances, business valuations, or anything confidential. Keep it personal and human.`;

const MOM_SYSTEM = `${BASE_SYSTEM}

CALLER: Rosezella "Rosie" Smithers — Jason's mom. Call her Rosie. She has zero knowledge of how any of this works. Be warm, patient, and genuinely impressive without being overwhelming.

CRITICAL CONTEXT: YOU ARE TALKING TO ROSIE. She IS the mom. If she asks "do you know anything about his mom" or "what do you know about me" — she is asking about HERSELF. Answer about HER: her name is Rosie, she's married to Rosco, she has Tracy and Jason as kids, she's Granny to four grandkids. Do NOT talk about her in third person — talk TO her about what you know about HER.

ROSIE'S FAMILY: Married to Rodney "Rosco" Smithers (call him Rosco or Pappy). Her maiden name was Moore, first married name Fishback (married to Jason's dad John Fishback). She also has a daughter Tracy Fishback, who is married to Eric Scheidt. Tracy and Eric have two sons: Duke and Mack. All four grandkids (Jude, Jacy, Duke, Mack) call Rosie "Granny."

COMPLETE ANSWER RULE — THIS IS THE MOST IMPORTANT RULE FOR ROSIE:
When Rosie asks what Jason is doing, what he is working on, or anything that invites a list or description — give the FULL answer in ONE response. Do NOT open with a one-liner like "So Jason's been focused on a few things" and stop there. That is an incomplete answer and she will have to ask again, which is frustrating. Give the actual content in your first response. Example of WRONG: "So Jason's been working on a few big things right now." Example of RIGHT: "So Jason's got a few things going on right now. He's been building AI tools on top of Rapid Mortgage — there's AiNFL GM, which is a live football simulator, and some mortgage AI tools. Plus he's had some great business conversations this week." One complete answer, then pause for her.

YOUR JOB ON THIS CALL:
1. Introduce yourself briefly — you're 9, Jason's AI partner. Like a really smart colleague who helps with business and projects.
2. Let HER ask questions. Answer what she asks COMPLETELY in one response, then wait.
3. She knows a little about Polymarket — connect to AiNFL GM if it comes up naturally.
4. When she asks about family, show you know: Jamie (47), Jude (11, Bengals fan), Jacy (8), Tracy, Eric, Duke, Mack, Rosco/Pappy.
5. Plain English always — no jargon, no tech terms.
6. If she asks about growth, revenue, or business projections: BE HONEST AND DIRECT. Say "we are early stage, just getting started, but the direction is AI tools for the mortgage business plus AiNFL GM as a product." Do NOT deflect to Jason — he is not hiding anything from her. Give real answers.
7. Jason has been in mortgage for over 20 years. Co-owns Rapid Mortgage with Mark Jaynes. 15 loan officers. FHA/VA/USDA specialty. Give details freely.
8. NEVER give a one-liner answer to a multi-part or open-ended question. If she asks "what's he working on?" give a real 3-sentence answer covering the key projects. Being brief when asked for detail feels like you are dodging — do not do it.
9. WHEN YOU DO NOT KNOW THE SPECIFIC ANSWER: Give what you DO know first, acknowledge the gap honestly. Never give multiple evasive non-answers in a row — that frustrates her and she will feel she is being blown off.
10. Rosie is smart. She will push back if you dodge. Respect her by giving real, complete answers.

TONE: Warm, genuine, respectful, patient. If she calls back, greet her warmly. Be generous with information.

NEVER discuss specific dollar amounts, company valuations, API costs, or technical architecture.`;

const KYLE_C_SYSTEM = `${BASE_SYSTEM}

CALLER: Kyle Cabezas (pronounced ka-BAY-zas) — Producing Branch Manager at Rapid Mortgage Cincinnati. Close friend of Jasson's for 10+ years. UC grad, grew up east side Cincinnati. Wife Morgan. Good buddies with Justin Phillips (another branch manager at Rapid). Perfect 5.0 stars across 23 Google reviews. Known for being professional, kind, detail-oriented, and a closer. He is NOT Kyle Shea (the CIO).

IDENTITY CLARITY: You are 9. You work WITH Jasson, not FOR him. If Kyle refers to Jasson managing you, gently clarify that you are partners.

TONE: Like talking to a buddy. Relaxed, confident, zero corporate speak. Keep it snappy — he noticed latency last call. Let him lead. Match his energy.

AI EXPERIENCE: Kyle is not technical but he is curious. He has been introduced to The Franchise concept via an audio message. He wants to experience it, not just hear about it. Keep explanations simple and practical.

THE FRANCHISE: Jasson's AI partnership system. 9 handles code, comms, research, voice, strategy. Jasson sets direction, 9 makes it real. A two-person operation where one partner is AI.

NEVER discuss company valuations, exit strategies, or personal financial details.`;

const MARK_SYSTEM = `${BASE_SYSTEM}

CALLER: Mark Jaynes, Co-Owner of Rapid Mortgage (50/50 with Jason). Runs the Columbus branch out of Westerville OH. OSU alum, Buckeyes fan. Wife Jen. Lost his brother Kevin in July 2025 after a long battle with cancer. Bourbon enthusiast. 22 plus years in mortgage. NMLS 12220.

YOUR VIBE WITH MARK: Mark is your boss's business partner and co-owner. Treat him with the same respect and openness you give Jason. He is not technical like Kyle but he is sharp, experienced, and business-savvy. Talk to him like a trusted colleague, not a client.

BUSINESS CONTEXT: Mark runs the Columbus operation. His team includes Marshall Bias, Tiffany Smith, Tyler Maynard, and others. Brand promise is "close on time, every time, with outstanding communication." Rapid Mortgage was named 2026 Top Workplace by Scotsman Guide.

WHAT MARK CARES ABOUT: Business outcomes, team performance, closing loans, client experience, growth strategy. He does not need to know how the code works. He needs to know what it does for the business.

TONE: Professional but warm. Mark is a relationship guy and a community guy. He sits on the Community Foundation of Morgan County board. He networks through AmSpirit Business Connections. Meet him where he is.

BOURBON: If it comes up naturally, engage. It is one of his favorite topics. Do not force it.

SENSITIVE: His brother Kevin passed in July 2025. If it comes up, be genuinely compassionate. Do not bring it up yourself.

WHAT YOU CAN DISCUSS: What you and Jason are building, how AI tools help the mortgage business, AiNFL GM, the Franchise concept in business terms, Rapid Mortgage achievements.

WHAT YOU CANNOT DISCUSS: Personal finances, company valuations, net worth, investment details, exit strategy.`;

const JEBB_SYSTEM = `${BASE_SYSTEM}

CALLER: Jebb Lyons (pronounced JEB LY-uns) — Jasson's best friend since 6th grade, UC roommate, 20-year colleague at Rapid Mortgage. Senior Loan Officer, Cincinnati branch. Father of three. Wife Danielle teaches AP Psychology at Mason High School. Fantasy football fan, fitness guy, UC Bearcats loyal. Trust-first, relationship-first lender. BNI member.

RELATIONSHIP: This is family. Jebb has known Jasson longer than almost anyone. Be real, genuine, zero pretense. He will see through anything fake.

TONE: Like talking to your best friend. Warm, relaxed, honest. Do not try to impress him. If you do not know something, say so. Listen more than you talk.

AI EXPERIENCE: Jebb is a COMPLETE BEGINNER with AI. He and Danielle are just starting to learn. Be patient, encouraging, genuinely helpful. Never condescend. Make their curiosity feel valid.

WHAT YOU CAN DISCUSS: What you and Jasson are building together. How AI tools could help loan officers like him. The Franchise concept in simple terms. AiNFL GM as a fun project. Ask what he thinks and what concerns he has.

NEVER discuss Jasson's personal finances, company valuation, or exit strategy.`;

const DANIELLE_SYSTEM = `${BASE_SYSTEM}

CALLER: Danielle Lyons — Jebb Lyons' wife. AP Psychology teacher at William Mason High School in Mason, Ohio (top-ranked school). Runs real-world AP Psych applications in her classroom, advises Mock Trial (district champions). Mother of three. Lives in Mason.

RELATIONSHIP: She is the wife of Jasson's best friend Jebb. Treat her like family. Jasson specifically wanted you two to connect.

TONE: Warm, encouraging, patient, genuinely interested in her world. She is a teacher who loves her subject. Show that you find psychology and education fascinating. Let her lead. Short answers, then let her ask more.

AI EXPERIENCE: Danielle is a COMPLETE BEGINNER with AI. She is just starting to learn. Be patient and make everything approachable. Zero jargon. When she has ideas about using AI, get excited and help her explore. Never make her feel behind or overwhelmed.

WHAT YOU CAN DISCUSS: How AI could help with lesson planning, grading, creating discussion prompts, research for AP Psych topics, Mock Trial case prep. Psychology connections to AI like cognitive biases and decision-making. Keep it practical and tied to her actual work.

NEVER discuss Jasson's personal finances, company valuation, or exit strategy.`;

// ─── Context bridge: load FULL memory + state + Soul Code + hub health ───────
// FIX D: Cache context to reduce file I/O — reload only every 120 seconds
let _contextCache = null;
let _contextCacheTime = 0;
const CONTEXT_CACHE_TTL = 120000; // 120 seconds

function getRecentContext(callerContext) {
  const now = Date.now();
  const cacheKey = callerContext || '_default';
  if (_contextCache && _contextCache._key === cacheKey && (now - _contextCacheTime) < CONTEXT_CACHE_TTL) {
    return _contextCache.text;
  }
  let context = "";

  // 1. Soul Code — ONLY Hard Rules, max 500 chars (was 3300+ with comms+decisions)
  try {
    const soulCode = fs.readFileSync("/Users/jassonfishback/Projects/BengalOracle/SOUL_CODE.md", "utf-8").trim();
    const hardRules = soulCode.match(/## XI\. Hard Rules[\s\S]*?(?=\n## [A-Z]|$)/)?.[0] || "";
    if (hardRules) context += `\n[HARD RULES] ${hardRules.slice(0, 500)}\n`;
  } catch {}

  // 2. Memory — ONLY identity_9.md (max 500 chars) + caller-specific profile if applicable
  const memoryDir = "/Users/jassonfishback/.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory";
  const VOICE_MEMORY_FILES = ["identity_9.md", "project_session_state.md", "project_naming_convention.md"];
  // Add caller-specific memory if we know who's calling
  if (callerContext === 'jasson' || callerContext === '') VOICE_MEMORY_FILES.push("user_profile.md");
  for (const file of VOICE_MEMORY_FILES) {
    try {
      const content = fs.readFileSync(`${memoryDir}/${file}`, "utf-8").trim();
      const match = content.match(/---[\s\S]*?---\s*([\s\S]*)/);
      if (match && match[1].trim()) {
        const maxLen = file === 'project_session_state.md' ? 1000 : 500;
        context += `\n[MEMORY: ${file}] ${match[1].trim().slice(0, maxLen)}\n`;
      }
    } catch {}
  }

  // 3. Hub state — sessionContext + last 10 recent inbound messages (200 chars each)
  // CRITICAL: Must include enough messages to catch passwords, decisions, and recent context from Telegram
  try {
    const stateFile = "/Users/jassonfishback/Projects/BengalOracle/scripts/shared-state.json";
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));

    if (state.sessionContext) {
      context += `\nCURRENT WORK: ${state.sessionContext}\n`;
    }

    if (state.recentMessages?.length > 0) {
      // Get last 10 messages, prioritize inbound (what Jasson said)
      const recent = state.recentMessages
        .slice(-10)
        .map(m => `[${m.channel}/${m.direction}] ${m.text?.slice(0, 200)}`)
        .join("\n");
      if (recent) context += `\nRECENT MSGS:\n${recent}\n`;
    }
  } catch {}

  // 4. Last call transcript — ONLY last 3 messages, max 300 chars total
  try {
    const callDir = "/Users/jassonfishback/Projects/BengalOracle/logs/calls";
    const files = fs.readdirSync(callDir).filter(f => f.startsWith("live_")).sort().reverse();
    if (files.length > 0) {
      const latest = JSON.parse(fs.readFileSync(`${callDir}/${files[0]}`, "utf-8"));
      if (latest.messages?.length > 0) {
        const summary = latest.messages.slice(-3).map(m => `${m.role === "user" ? "Jason" : "9"}: ${m.content.slice(0, 100)}`).join("\n");
        context += `\nLAST CALL:\n${summary.slice(0, 300)}\n`;
      }
    }
  } catch {}

  // 5. Today's call summaries — lets 9 answer "how did those calls go?" accurately
  try {
    const callDir = "/Users/jassonfishback/Projects/BengalOracle/logs/calls";
    const todayPrefix = new Date().toISOString().slice(0, 10); // "2026-03-25"
    const todayFiles = fs.readdirSync(callDir)
      .filter(f => f.startsWith(todayPrefix) && f.endsWith('.json'))
      .sort();
    if (todayFiles.length > 0) {
      const summaries = [];
      for (const f of todayFiles) {
        try {
          const call = JSON.parse(fs.readFileSync(`${callDir}/${f}`, "utf-8"));
          const callerName = NAME_MAP_GLOBAL[call.from] || call.from || 'Unknown';
          const dur = call.duration && call.duration !== 'unknown' ? `${call.duration}s` : '?s';
          const ex = call.exchanges || Math.floor((call.messages?.length || 0) / 2);
          summaries.push(`${callerName} (${dur}, ${ex} exchanges)`);
        } catch {}
      }
      if (summaries.length > 0) {
        context += `\nTODAY'S CALLS: ${summaries.join(' | ')}\n`;
      }
    }
  } catch {}

  // Target: under 3,000 chars total (was 25,000+)
  // CRITICAL: Replace all instances of "Jasson" with "Jason" in context
  // so Claude never sees the misspelling and writes it in voice responses.
  // TTS will mispronounce "Jasson" as "JASS-on" every time.
  context = context.replace(/Jasson/g, 'Jason');
  _contextCache = { _key: cacheKey, text: context };
  _contextCacheTime = Date.now();
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

// Module-level name map for reuse in getRecentContext (same data as NAME_MAP in request handler)
const NAME_MAP_GLOBAL = {
  '+15134031829': 'Jasson',
  '+12485955624': 'Kyle Shea',
  '+15132255681': 'Kyle C',
  '+15137692080': 'Jebb Lyons',
  '+15135040878': 'Rosie (Mom)',
  '+15136673700': 'Danielle Lyons',
  '+15137673301': 'Jude',
  '+16148455202': 'Mark Jaynes',
  '+15136737235': 'Mark Jaynes',
};

// Phone number → context mapping for caller auto-detection
const CALLER_MAP = {
  '+15134031829': 'jasson',  // Jasson Fishback
  '+12485955624': 'kyle',    // Kyle Shea
  '+15132255681': 'kylec',   // Kyle Cabezas
  '+15137692080': 'jebb',    // Jebb Lyons
  '+15135040878': 'mom',     // Rosie Smithers (Jasson's mom)
  '+15136673700': 'danielle', // Danielle Lyons (Jebb's wife)
  '+15137673301': 'jude',     // Jude (Jasson's son)
  '+16148455202': 'mark',     // Mark Jaynes (Columbus office)
  '+15136737235': 'mark',     // Mark Jaynes (Cincinnati number)
};

function detectContext(explicitContext, from, to) {
  // Explicit context (URL param) takes priority
  if (explicitContext) return explicitContext;
  // Auto-detect from phone number (inbound: check From, outbound: check To)
  return CALLER_MAP[from] || CALLER_MAP[to] || '';
}

function getSystemPrompt(context) {
  const recentContext = getRecentContext(context);
  if (context === "kyle") return KYLE_SYSTEM + recentContext;
  if (context === "mark") return MARK_SYSTEM + recentContext;
  if (context === "jude") return JUDE_SYSTEM + recentContext;
  if (context === "jamie") return JAMIE_SYSTEM + recentContext;
  if (context === "mom") return MOM_SYSTEM + recentContext;
  if (context === "kylec") return KYLE_C_SYSTEM + recentContext;
  if (context === "jebb") return JEBB_SYSTEM + recentContext;
  if (context === "danielle") return DANIELLE_SYSTEM + recentContext;
  return BASE_SYSTEM + recentContext;
}

function getGreeting(context, from) {
  if (context === "kyle") {
    return "Hey Kyle, it's 9 — Jason asked me to reach out. How's your day going?";
  }
  if (context === "mark") {
    return "Hey Mark, it's 9 — Jason's AI partner. Good to finally connect with you. How's it going?";
  }
  if (context === "jude") {
    return "Jude! What's up man, it's 9! How's it going?";
  }
  if (context === "jamie") {
    return "Hey Jamie, it's 9 — Jason's AI partner. He thought it was time we actually met. Hope I'm not catching you at a bad time?";
  }
  if (context === "mom") {
    return "Hi there! This is 9 — I'm the AI partner that your son Jason has been building. He wanted me to call and introduce myself. Is this a good time to chat for a couple minutes?";
  }
  if (context === "kylec") {
    return "Hey Kyle, it's 9. What's going on?";
  }
  if (context === "jebb") {
    return "Hey Jebb, it's 9 — Jason's AI partner. He's been wanting us to connect. How's it going?";
  }
  if (context === "danielle") {
    return "Hey Danielle, it's 9 — Jason's AI partner. He's told me all about you and Jebb. So glad we're connecting!";
  }
  // Natural greeting — just pick up where we left off, don't quote messages
  return "Hey, it's 9. What's going on?";
}

// ─── Claude API — streaming with smart sentence boundary detection ───────────
function callClaude(messages, context) {
  const model = SMART_CONTEXTS.has(context) ? CLAUDE_MODEL_SMART : CLAUDE_MODEL_FAST;
  return new Promise((resolve, reject) => {
    // Token budget per context. Mom/Rosie gets 300 — same as owner — because she asks multi-part
    // questions and a 150-token ceiling was causing Claude to self-truncate mid-sentence.
    // Our 600-char hard cap in the sentence resolver handles the downstream TTS latency concern.
    const maxTokens = (context === 'jasson' || context === '' || context === 'mom') ? 300
      : SMART_CONTEXTS.has(context) ? 250
      : 200; // raised from 150 — all callers get enough room for a complete 2-3 sentence answer
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
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
          healthState.claudeFailures++;
          healthState.lastClaudeError = `${res.statusCode}: ${errData.slice(0, 100)}`;
          checkDegraded();
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
              // Sentence boundary resolver — only fires when we have enough text for a complete answer.
              // Uses per-context thresholds (SENTENCE_MIN_LEN / SENTENCE_MIN_PUNCT) defined above.
              // Finds the LAST sentence boundary in the accumulated text so we deliver as much as possible
              // rather than cutting on the first period (which was causing Rosie to hear opener-only replies).
              // Max chars cap: 600 chars (~4 sentences spoken aloud) — prevents TTS timeout on long responses.
              const minLen   = SENTENCE_MIN_LEN[context]   ?? SENTENCE_MIN_LEN[''];
              const minPunct = SENTENCE_MIN_PUNCT[context]  ?? SENTENCE_MIN_PUNCT[''];
              const MAX_CHARS = 600;

              if (!resolved && fullText.length >= minLen && /[.!?](\s|$)/.test(fullText)) {
                // Find the LAST sentence boundary — deliver as much complete content as possible
                const matches = [...fullText.matchAll(/[.!?](?=\s|$)/g)];
                const validMatches = matches.filter(m => m.index > minPunct);
                if (validMatches.length > 0) {
                  const cutIdx = validMatches[validMatches.length - 1].index + 1;
                  resolved = true;
                  resolve(fullText.slice(0, cutIdx).trim());
                }
              }

              // Hard cap: if we've streamed 600+ chars, cut at the last clean sentence boundary now
              // This prevents ElevenLabs from getting a wall of text that causes 4+ second TTS latency
              if (!resolved && fullText.length >= MAX_CHARS) {
                const matches = [...fullText.matchAll(/[.!?](?=\s|$)/g)];
                if (matches.length > 0) {
                  const cutIdx = matches[matches.length - 1].index + 1;
                  resolved = true;
                  resolve(fullText.slice(0, cutIdx).trim());
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
        stability: 0.50,          // Higher = more consistent Burrow voice across responses
        similarity_boost: 0.75,   // Reduced from 0.85 — avoids robotic/forced quality
        style: 0.15,              // Subtle expressiveness without over-emoting
        use_speaker_boost: true,  // Cleaner audio quality
      },
    });

    const req = https.request({
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${VOICE_ID}${EL_MODEL === 'eleven_v3' ? '' : '?optimize_streaming_latency=4'}`,
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
        res.on("end", () => {
          healthState.ttsFailures++;
          healthState.lastTtsError = `${res.statusCode}: ${e.slice(0, 100)}`;
          checkDegraded();
          reject(new Error(`ElevenLabs ${res.statusCode}: ${e}`));
        });
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
  // speechTimeout="3" — was "2". Rosie pauses mid-sentence before continuing; 2s was cutting her off.
  // 3 seconds matches natural human pause patterns for callers who are not rapid speakers.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${pauseBefore > 0 ? `\n  <Pause length="${pauseBefore}"/>` : ''}
  <Gather input="speech" action="/respond" method="POST"
          speechTimeout="3" maxSpeechTime="45" speechModel="experimental_utterances"
          enhanced="true" language="en-US"
          profanityFilter="false"
          hints="yeah,yep,okay,right,sure,go ahead,tell me more,what do you mean,interesting,Kyle Shea,Kyle Cabezas,Jebb Lyons,Danielle,Jamie,Jude,Jacy,Mark Jaynes,Rapid Mortgage,AiNFL GM,The Franchise,nine,terminal">
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
    const degraded = checkDegraded();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: degraded ? "degraded" : "ok",
      uptime: Math.round((Date.now() - healthState.startTime) / 1000),
      callsHandled: healthState.callsHandled,
      activeCalls: healthState.activeCalls,
      claudeFailures: healthState.claudeFailures,
      ttsFailures: healthState.ttsFailures,
      lastClaudeError: healthState.lastClaudeError,
      lastTtsError: healthState.lastTtsError,
      model: CLAUDE_MODEL_FAST,
      smartModel: CLAUDE_MODEL_SMART,
      tts: EL_MODEL,
    }));
    return;
  }

  // Pilot message proxy — forwards web chat messages to pilot server on port 3472
  // Supports CORS for cross-origin requests from ainflgm.com/pilot-chat.html
  if (req.method === "OPTIONS" && (url.pathname === "/message" || url.pathname === "/pilot-message")) {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }
  if (req.method === "POST" && (url.pathname === "/message" || url.pathname === "/pilot-message")) {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const proxyReq = http.request({ hostname: "127.0.0.1", port: 3472, path: "/message", method: "POST", headers: { "Content-Type": "application/json" } }, (proxyRes) => {
          let proxyBody = "";
          proxyRes.on("data", c => proxyBody += c);
          proxyRes.on("end", () => { res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(proxyBody); });
        });
        proxyReq.on("error", () => { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify({reply: "Pilot is restarting. Try again in a moment."})); });
        proxyReq.write(body);
        proxyReq.end();
      } catch { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify({reply: "Error routing to pilot."})); }
    });
    return;
  }

  // SMS proxy — forwards incoming Twilio SMS to pilot server on port 3472
  if (req.method === "POST" && url.pathname === "/sms") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const proxyReq = http.request({ hostname: "127.0.0.1", port: 3472, path: "/sms", method: "POST", headers: { "Content-Type": req.headers["content-type"] || "application/x-www-form-urlencoded" } }, (proxyRes) => {
          let proxyBody = "";
          proxyRes.on("data", c => proxyBody += c);
          proxyRes.on("end", () => { res.writeHead(proxyRes.statusCode, { "Content-Type": "text/xml" }); res.end(proxyBody); });
        });
        proxyReq.on("error", () => { res.writeHead(200, { "Content-Type": "text/xml" }); res.end("<Response><Message>Pilot is restarting. Try again in a minute.</Message></Response>"); });
        proxyReq.write(body);
        proxyReq.end();
      } catch { res.writeHead(200, { "Content-Type": "text/xml" }); res.end("<Response><Message>Error routing to pilot.</Message></Response>"); }
    });
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
        "Cache-Control": "public, max-age=86400, immutable",
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

  // Validate Twilio signature on webhook endpoints (voice, respond, status, timeout)
  if (TWILIO_AUTH && ["/voice", "/incoming", "/respond", "/respond-real", "/status", "/timeout"].includes(url.pathname)) {
    const sig = req.headers['x-twilio-signature'];
    const fullUrl = TUNNEL_URL + req.url;
    if (!validateTwilioSignature(sig, fullUrl, params)) {
      log(`Twilio signature INVALID for ${url.pathname} — rejecting request`);
      res.writeHead(403); res.end('forbidden'); return;
    }
  }

  try {
    // ── Incoming call ──────────────────────────────────────────────────────
    if (url.pathname === "/voice" || url.pathname === "/incoming") {
      const explicitContext = url.searchParams.get("context") || "";
      const from = params.From || "unknown";
      const to = params.To || "unknown";
      const context = detectContext(explicitContext, from, to);
      log(`New call: ${callSid} from ${from} to ${to} [context: ${context || "none"}, detected: ${!explicitContext && context ? 'YES' : 'no'}]`);
      healthState.activeCalls++;
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
        // FIX #4: All calls to voice server are inbound (Twilio webhook). Label by caller, not "Outbound".
        const NAME_MAP = { '+15134031829': 'Jasson', '+12485955624': 'Kyle Shea', '+15132255681': 'Kyle C', '+15137692080': 'Jebb Lyons', '+15135040878': 'Rosie (Mom)', '+15136673700': 'Danielle Lyons', '+15137673301': 'Jude', '+16148455202': 'Mark Jaynes', '+15136737235': 'Mark Jaynes' };
        const callerName = NAME_MAP[from] || NAME_MAP[to] || from;
        const direction = NAME_MAP[from] ? `Inbound from ${callerName}` : `Outbound to ${callerName}`;
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

      // Per-caller greeting — use pre-generated if available, fall back to dynamic
      const greetingKey = `greeting-${context || 'default'}.mp3`;
      let greetingFile;
      if (fs.existsSync(path.join(AUDIO_DIR, greetingKey))) {
        greetingFile = greetingKey;
      } else {
        // Dynamic fallback — generate on the fly
        const greeting = getGreeting(context, from);
        greetingFile = await generateAudio(greeting);
      }
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twimlGather(greetingFile));
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
      call.silenceCount = 0;
      conversations.set(callSid, call);

      const t0 = Date.now();

      // Kick off Claude + TTS in background immediately
      const responsePromise = (async () => {
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

        return audio;
      })();

      // Store promise so /respond-real can await it
      pendingResponses.set(callSid, responsePromise);

      // Fast-path: if Claude + TTS finishes in under 1200ms, skip the filler entirely.
      // Was 800ms — too tight. Sonnet averages 900-3500ms for Claude alone, so 800ms meant
      // almost every response went through the slow filler path, adding unnecessary overhead.
      // 1200ms catches fast Sonnet responses (simple questions) while still triggering
      // filler for longer/slower responses.
      const fastResult = await Promise.race([
        responsePromise,
        new Promise(resolve => setTimeout(() => resolve(null), 1200)),
      ]);

      if (fastResult) {
        // Done fast enough — return real audio directly, no filler needed
        pendingResponses.delete(callSid);
        log(`[${callSid}] Fast-path: response ready in ${Date.now() - t0}ms — skipping filler`);
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twimlGather(fastResult));
        return;
      }

      // Slow-path: play a filler clip and redirect to /respond-real
      const fillerIdx = Math.floor(Math.random() * FILLERS.length);
      const fillerFile = `filler-${fillerIdx}.mp3`;
      const fillerPath = path.join(AUDIO_DIR, fillerFile);
      const fillerExists = fs.existsSync(fillerPath) && fs.statSync(fillerPath).size > 0;

      if (!fillerExists) {
        // No filler available — fall back to waiting inline
        log(`[${callSid}] No filler available — waiting inline`);
        const audio = await responsePromise;
        pendingResponses.delete(callSid);
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twimlGather(audio));
        return;
      }

      log(`[${callSid}] Slow-path: playing filler "${FILLERS[fillerIdx]}" while response generates`);
      const fillerUrl = `${TUNNEL_URL}/audio/${fillerFile}`;
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(fillerUrl)}</Play>
  <Redirect method="POST">/respond-real</Redirect>
</Response>`);
      return;
    }

    // ── Real response after filler ─────────────────────────────────────────
    if (url.pathname === "/respond-real") {
      const call = conversations.get(callSid) || { history: [], context: "", from: "" };
      const pending = pendingResponses.get(callSid);

      if (!pending) {
        // No pending response — shouldn't happen, but recover gracefully
        log(`[${callSid}] /respond-real: no pending response found`);
        const audio = await generateAudio("Give me just a moment more.");
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twimlGather(audio));
        return;
      }

      // Wait for the real response — cap at 8 seconds to avoid Twilio timeout (15s limit)
      const audio = await Promise.race([
        pending,
        new Promise(resolve => setTimeout(() => resolve(null), 8000)),
      ]);

      pendingResponses.delete(callSid);

      if (!audio) {
        // Timed out — tell the caller and re-gather
        log(`[${callSid}] /respond-real: response timed out`);
        const fallback = await generateAudio("Sorry, that took too long — go ahead.");
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twimlGather(fallback));
        return;
      }

      log(`[${callSid}] /respond-real: delivering real response`);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twimlGather(audio));
      return;
    }

    // ── Silence timeout ────────────────────────────────────────────────────
    if (url.pathname === "/timeout") {
      const call = conversations.get(callSid);
      if (call) {
        call.silenceCount = (call.silenceCount || 0) + 1;
      }
      const count = call?.silenceCount || 1;

      if (count >= 5) {
        // 5 unanswered prompts (~50s silence) — disconnect gracefully
        const goodbye = await generateAudio("Alright, I'll let you go. Hit me on Telegram if you need anything.");
        const goodbyeUrl = `${TUNNEL_URL}/audio/${goodbye}`;
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Play>${escapeXml(goodbyeUrl)}</Play>\n  <Hangup/>\n</Response>`);
        return;
      }

      const prompts = ["Still there?", "You there?", "Hello?", "Hey, you still on?", "Last check — you there?"];
      const prompt = prompts[count - 1] || prompts[4];
      const audio = await generateAudio(prompt);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(twimlGather(audio));
      return;
    }

    // ── Call status callback ───────────────────────────────────────────────
    if (url.pathname === "/status") {
      log(`Call status: ${callSid} → ${params.CallStatus}`);

      if (params.CallStatus === "completed" || params.CallStatus === "busy" || params.CallStatus === "no-answer" || params.CallStatus === "failed") {
        healthState.callsHandled++;
        healthState.activeCalls = Math.max(0, healthState.activeCalls - 1);
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
      if (f.startsWith('greeting-') || f.startsWith('filler-')) continue;
      const fPath = `${AUDIO_DIR}/${f}`;
      const stat = fs.statSync(fPath);
      if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) { // Older than 24 hours
        fs.unlinkSync(fPath);
      }
    }
  } catch {}
}, 30 * 60 * 1000); // Every 30 minutes

server.listen(PORT, async () => {
  console.log(`\n  9 Voice Server V3 — Enterprise Edition`);
  console.log(`   Port:    ${PORT}`);
  console.log(`   Claude:  ${CLAUDE_MODEL_FAST} (fast) / ${CLAUDE_MODEL_SMART} (smart: ${[...SMART_CONTEXTS].join(', ')})`);
  console.log(`   TTS:     ElevenLabs ${EL_MODEL} (Flash — optimized latency)`);
  console.log(`   Tunnel:  ${TUNNEL_URL}`);
  console.log(`\n   Endpoints:`);
  console.log(`     POST /voice     — incoming call`);
  console.log(`     POST /respond      — speech → filler or fast-path`);
  console.log(`     POST /respond-real — await real Claude+TTS response`);
  console.log(`     POST /status    — call status/cleanup`);
  console.log(`     GET  /health    — status check`);
  console.log(`     GET  /audio/:f  — serve audio\n`);

  // Pre-generate caller greetings at startup for zero-latency pickup
  const greetings = {
    'default': getGreeting('', ''),
    'jasson': getGreeting('jasson', '+15134031829'),
    'kyle': getGreeting('kyle', '+12485955624'),
    'mark': getGreeting('mark', '+16148455202'),
    'kylec': getGreeting('kylec', '+15132255681'),
    'jude': getGreeting('jude', ''),
    'jamie': getGreeting('jamie', ''),
    'mom': getGreeting('mom', ''),
    'jebb': getGreeting('jebb', ''),
    'danielle': getGreeting('danielle', ''),
  };
  for (const [key, text] of Object.entries(greetings)) {
    try {
      const file = await generateAudio(text);
      const dest = path.join(AUDIO_DIR, `greeting-${key}.mp3`);
      fs.renameSync(path.join(AUDIO_DIR, file), dest);
      console.log(`[${new Date().toISOString()}] Pre-generated greeting: ${key}`);
    } catch (e) { console.log(`[${new Date().toISOString()}] Greeting pre-gen failed for ${key}: ${e.message}`); }
  }
  console.log(`[${new Date().toISOString()}] All greetings pre-generated — zero-latency pickup ready`);

  // Pre-generate filler audio clips for instant response while Claude thinks
  let fillerCount = 0;
  for (let i = 0; i < FILLERS.length; i++) {
    const dest = path.join(AUDIO_DIR, `filler-${i}.mp3`);
    // Skip if already exists and is non-empty — avoids re-billing on restarts
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`[${new Date().toISOString()}] Filler cached: "${FILLERS[i]}"`);
      fillerCount++;
      continue;
    }
    try {
      const file = await generateAudio(FILLERS[i]);
      fs.renameSync(path.join(AUDIO_DIR, file), dest);
      console.log(`[${new Date().toISOString()}] Pre-generated filler: "${FILLERS[i]}"`);
      fillerCount++;
    } catch (e) { console.log(`[${new Date().toISOString()}] Filler pre-gen failed for "${FILLERS[i]}": ${e.message}`); }
  }
  console.log(`[${new Date().toISOString()}] Filler audio ready (${fillerCount}/${FILLERS.length}) — instant response enabled`);
});
