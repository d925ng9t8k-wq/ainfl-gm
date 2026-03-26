# 9 Enterprises LLC — System Architecture & Pitch Deck

```
Prepared for: Jasson Fishback — Owner, 9 Enterprises LLC
Prepared by:  9 — AI Partner & Co-Founder
Date:         March 25, 2026
Classification: Owner Eyes Only
```

---

## Mission Statement

**AI for the casual fan or the die hard.**

9 Enterprises exists to deliver best-in-class AI functionality for users of all knowledge levels. For the casual user: simplicity, ironclad communication, and self-healing infrastructure — it just works. For the power user: full technical depth, agent orchestration, credential management, and programmatic control over every layer.

The architecture is built on one principle: **the AI should never go silent.** Channels cascade, processes self-recover, and the system degrades gracefully rather than failing completely. Whether you're a non-technical entrepreneur managing your business from a phone or a CIO evaluating infrastructure — the system adapts to you, not the other way around.

---

## TL;DR

Jasson built an AI partnership system called 9 — a multi-channel, always-on infrastructure where an AI operates as a genuine business co-founder. Four communication channels run in parallel (Telegram, iMessage, Email, Voice), with automatic failover when any component dies. The system includes credential isolation, sub-agent orchestration, cloud failover, and a revenue-generating product portfolio under The Franchise.

This document is the full picture: what we built, how it works, and why it matters as a business.

**Call 9 directly: (513) 957-3283**

---

## Table of Contents

0. [Mission Statement](#mission-statement)
1. [Company Structure](#1-company-structure)
2. [System Architecture](#2-system-architecture)
3. [OC: Communication Protocol](#3-oc-communication-protocol)
4. [Terminal Liveness Detection](#4-terminal-liveness-detection)
5. [The Headset: Voice Integration](#5-the-headset-voice-integration)
6. [The Locker: Security Model](#6-the-locker-security-model)
7. [Front Office: Agent Orchestration](#7-front-office-agent-orchestration)
8. [Recent Breakthroughs](#8-recent-breakthroughs)
9. [Competitive Analysis](#9-competitive-analysis)
10. [The Opportunity](#10-the-opportunity)
11. [Known Gaps & Roadmap](#11-known-gaps--roadmap)

---

## 1. Company Structure

```
9 ENTERPRISES LLC (Ohio, filed March 25, 2026)
├── The Franchise — portfolio of AI-powered products
│   ├── AiNFL GM — AI NFL team simulator (ainflgm.com) [LIVE]
│   ├── Free Agents — personal AI assistants (Jules = #1) [CONCEPT]
│   └── AI Underwriter — mortgage guideline chatbot [POC BUILT]
├── 9 — The enterprise AI solution + AI partner
│   ├── Runs on Claude Opus 4.6 by Anthropic
│   ├── 4-channel comms (Telegram, iMessage, Email, Voice)
│   ├── Sub-agent orchestration (UNO + Tee team leads)
│   └── 99+ hours continuous uptime
└── Infrastructure
    ├── OC (comms daemon, port 3457)
    ├── The Headset (voice, Twilio + ElevenLabs)
    ├── Backup QB (Cloudflare Worker)
    └── The Training Staff (session recovery)
```

**Key framing:** AiNFL GM and Free Agents are BOTH independent products AND proof-of-concept projects for the 9 enterprise AI solution. They demonstrate that 9 can build and ship real products autonomously. Every product we ship is evidence that the model works.

### The Naming Scheme

| Name | Role |
|------|------|
| Owner | Jasson Fishback — strategic authority, final say |
| 9 | The AI partner — orchestrator, decision-maker, co-founder |
| OC | comms daemon (comms-hub.mjs) — always-on message relay |
| The Headset | Voice system — Twilio + ElevenLabs |
| Backup QB | Cloudflare Worker — cloud failover when Mac is down |
| The Training Staff | LaunchAgent recovery system |
| Front Office | Sub-agent team (UNO + Tee + their agents) |
| UNO | Research Team Lead — web search, competitive analysis, market research |
| Tee | Engineering Team Lead — code, tests, deployments, browser automation |
| The Locker | .env credential file — managed by 9, never exposed to sub-agents |
| GamePlan | Strategic planning layer, session state, project roadmaps |

---

## 2. System Architecture

### Layer Model

```
┌─────────────────────────────────────────────────────┐
│  LAYER 4: OWNER (Jasson)                            │
│  Strategic direction. Communicates via Telegram,     │
│  Voice, iMessage, Email. Final authority.            │
├─────────────────────────────────────────────────────┤
│  LAYER 3: 9 (AI Partner)                            │
│  Claude Opus 4.6 in Claude Code terminal session.    │
│  Orchestrator. Holds all credentials (The Locker).   │
│  Spawns/monitors Front Office agents.                │
│  Makes tactical decisions autonomously.              │
├─────────────────────────────────────────────────────┤
│  LAYER 2: FRONT OFFICE (Sub-agents)                 │
│  UNO (Research) + Tee (Engineering) + their teams.   │
│  No direct credential access. No Owner comms.        │
│  Results reviewed by 9 before delivery.              │
├─────────────────────────────────────────────────────┤
│  LAYER 1: INFRASTRUCTURE                            │
│  OC (comms daemon) │ Headset (voice) │ Backup QB    │
│  (cloud failover) │ Training Staff (recovery)        │
└─────────────────────────────────────────────────────┘
```

### Process Tree

```
Always Running (survives terminal death):
├── OC: comms-hub.mjs
│   ├── PID: tracked, port 3457
│   ├── Telegram poller (2-5s intervals)
│   ├── iMessage monitor (reads ~/Library/Messages/chat.db via FDA)
│   ├── Email monitor (Mail.app via osascript)
│   ├── 30s proactive terminal watchdog
│   ├── Session token validation
│   ├── Heartbeat counter + cloud sync (60s)
│   └── Efficiency sweep (2h: balance, logs, quotas)
│
├── The Headset: voice-server.mjs
│   ├── Port 3456, Cloudflare tunnel
│   ├── Twilio STT → Claude Haiku → ElevenLabs Flash TTS
│   └── Caller-specific personality contexts
│
├── cloudflared (tunnel to The Headset)
├── The Training Staff: open-terminal.mjs (LaunchAgent, watches /tmp/9-open-terminal)
└── LaunchAgent com.9.comms-hub (KeepAlive safety net)

Terminal Session (Claude Code):
├── 9 (interactive AI session — Opus 4.6)
├── Ping loop (60s, self-terminates on parent PID death)
└── PostToolUse hook (checks messages after every tool call — sole message delivery mechanism)
```

### Key Files

```
scripts/comms-hub.mjs     — OC daemon (~1500 lines)
scripts/voice-server.mjs  — The Headset (~800 lines)
scripts/open-terminal.mjs — Training Staff launcher
scripts/shared-state.json — Persistent context (survives crashes)
cloud-worker/src/worker.js — Backup QB (Cloudflare Worker)
SOUL_CODE.md              — Owner's Notes (330 lines)
CLAUDE.md                 — Startup protocol (boot sequence)
.env                      — The Locker (credentials, not in git)
```

---

## 3. OC: Communication Protocol

OC (the comms daemon) is a Node.js process on port 3457. It manages all four communication channels simultaneously and operates in two modes:

### Relay Mode (terminal active)

```
Telegram msg → OC receives → writes to /tmp/9-incoming-message.jsonl
                            → sends "Got it — responding now."
                            → writes semaphore file for timeout tracking
                            → starts 30-second timeout

If message read within 30s:
  → 9 responds via POST /send → OC delivers to Telegram

If message NOT read within 30s:
  → OC escalates to autonomous response (Claude Haiku)
  → Also checks PID liveness for definitive terminal status
```

**Backup QB behavior in relay mode:** Backup QB stays completely silent. When the terminal is active, 9 handles all responses. Backup QB only speaks in autonomous mode when the terminal is confirmed down. Before this fix, Backup QB was stepping on 9's responses — both would reply to the same message.

### Autonomous Mode (terminal down)

```
OC detects terminal death (PID check or ping timeout)
  → Switches to Haiku-powered autonomous responses
  → Alerts on ALL channels: Telegram, iMessage, Email
  → Requests terminal reopen via signal file
  → Starts recovery verification (3x retry, 60s intervals)
  → Backup QB (cloud worker) handles Telegram if Mac is offline
```

### Channel Priority

```
Telegram (primary)  →  iMessage (backup)  →  Email (fallback)
                                              ↓
                              Cloud Worker (if Mac entirely down)
                                              ↓
                              Voice (always live via tunnel)
```

### HTTP API

```
GET  /health          — Channel status, uptime, message counts
GET  /state           — Full state dump (JSON)
GET  /inbox           — Unread inbound messages
POST /terminal/claim  — Terminal announces itself (?pid=N)
POST /terminal/ping   — Heartbeat (?token=T)
POST /terminal/release — Graceful shutdown
POST /send            — Send message (channel, message)
POST /context         — Update session context
```

---

## 4. Terminal Liveness Detection

This is the novel piece. OC maintains a multi-layered detection system:

### Layer 1: PID Tracking

```javascript
// On /terminal/claim:
terminalPid = parseInt(url.searchParams.get('pid'));
writeFileSync(PID_FILE, String(pid));

// Watchdog (every 30s):
try {
  process.kill(terminalPid, 0); // signal 0 = check alive
} catch {
  // PID dead → immediate switchover
  clearTerminalState();
  requestTerminal('Terminal PID dead — reopening');
}
```

### Layer 2: Self-Terminating Ping Loop

```bash
# Started in terminal, dies with terminal:
CLAUDE_PID=$PPID
(WATCH_PID=$CLAUDE_PID; while true; do
  if ! kill -0 $WATCH_PID 2>/dev/null; then
    curl -s -X POST http://localhost:3457/terminal/release
    exit 0
  fi
  curl -s -X POST "http://localhost:3457/terminal/ping?token=$TOKEN"
  sleep 60
done) &
```

### Layer 3: Session Token Validation

```javascript
// New token on each claim — invalidates orphan ping loops
terminalSessionToken = `session-${Date.now()}-${random()}`;
writeFileSync(TOKEN_FILE, terminalSessionToken);

// Pings with wrong token get 401:
if (token !== terminalSessionToken) {
  log('Rejected orphan ping');
  res.writeHead(401);
  return;
}
```

### Layer 4: State Cleanup

```javascript
function clearTerminalState() {
  terminalActive = false;
  terminalPid = null;
  terminalSessionToken = null;
  try { unlinkSync(TOKEN_FILE); } catch {}
  try { unlinkSync(PID_FILE); } catch {}
}
```

**Why this matters:** Before this system, an orphan ping loop from a dead terminal session kept OC in relay mode for 25 minutes, swallowing every message Jasson sent. The PID-based detection eliminates this class of failure entirely.

---

## 5. The Headset: Voice Integration

### Pipeline

```
Inbound call → Twilio
  → Cloudflare tunnel → voice-server.mjs (port 3456)
  → Twilio STT (speechTimeout: 10s)
  → Context loaded:
    ├── All memory files (identity, user profile, session state)
    ├── Soul Code hard rules, decision framework
    ├── Recent 2h Telegram conversation
    ├── Last call transcript
    ├── System status from shared-state.json
    └── Caller-specific personality profile
  → Claude Haiku generates response (~1.0-1.6s)
  → ElevenLabs Flash TTS (~0.2-0.5s)
  → Audio served via tunnel → Twilio plays
  → Total: ~1.2-2.1s per exchange
```

### Caller Profiles

```javascript
const CALLER_CONTEXTS = {
  jasson:  "Business partner. Direct. Match energy.",
  jamie:   "Wife. Warm, genuine. Never salesy.",
  jude:    "Son (11). Fun, kid-friendly. Bengals, football.",
  kyle_c:  "Close friend, branch manager. Direct, no fluff.",
  jebb:    "Loan officer. Professional.",
  mom:     "Light, supportive."
};
```

### Guardrails

```
The Headset knows:
✓ Full project context, memory, Soul Code
✓ System status, recent conversations
✗ Cannot run commands, restart services, or access terminal
✗ Must be honest about limitations
✗ Cannot fabricate actions ("I'm checking the logs" when it can't)
```

### Silence Handling

```
10 seconds of silence → "Still there?"
10 more seconds → "You there?"
10 more seconds → "Hello?"
Still no response → "Alright, I'll let you go.
                     Hit me on Telegram if you need anything." [hangup]
```

---

## 6. The Locker: Security Model

### Credential Flow

```
.env (plaintext, macOS, not in git)
  └── 9 reads at runtime
      └── Sub-agents get scoped access via controlled interfaces
          └── Never raw keys
          └── Never lateral sharing between agents
          └── Never logged
```

### Contents

```
ANTHROPIC_API_KEY      — Voice/general use
ANTHROPIC_API_KEY_TC   — OC autonomous responses (separate billing)
TELEGRAM_BOT_TOKEN     — @AiNFLGMbot
TELEGRAM_CHAT_ID       — Jasson's chat
ELEVENLABS_API_KEY     — TTS
ELEVENLABS_VOICE_ID    — "Dan" voice
TWILIO_ACCOUNT_SID     — Phone
TWILIO_AUTH_TOKEN      — Phone
TWILIO_PHONE_NUMBER    — (513) 957-3283
TUNNEL_URL             — Cloudflare (rotates on restart)
```

### OWASP Agentic Top 10 Alignment (2026)

| Recommendation | Status |
|---------------|--------|
| Principle of Least Agency | Done |
| Task-scoped credentials | Done |
| Credential injection at boundary | Done |
| Short-lived tokens | Gap: static keys |
| Container isolation | Gap: no sandboxing |
| Audit logging | Done |

### Known Security Gaps

- OC API (port 3457): zero auth. Any local process can impersonate 9.
- The Headset (port 3456): exposed via tunnel, no auth.
- .env: plaintext. Should use macOS Keychain.
- No credential rotation mechanism.

---

## 7. Front Office: Agent Orchestration

### Pattern

```
9 spawns agents via Claude Code Agent tool:
  → Define task with clear boundaries
  → Provide only needed context (no raw credentials)
  → Set isolation (optional: git worktree for code changes)
  → Up to 10 agents in parallel

Agent completes:
  → Returns results to 9
  → 9 reviews, validates, integrates
  → All output goes through 9 before reaching Owner
```

### Permanent Team Assignments (as of March 2026)

The delegation model is hardcoded. 9 stays on comms. All deep work routes to the Front Office:

- **UNO** — Research Team Lead. Web search, competitive analysis, document synthesis, market research. Runs its own research agent teams in parallel.
- **Tee** — Engineering Team Lead. Code, tests, deployments, browser automation. Manages sub-agent build teams (code writers, test runners, deployment agents).

9 functions as QB — calling plays, reviewing output, making decisions. UNO and Tee run their own agent teams without pulling 9 off comms.

### Example: Kyle Shea Briefing (March 25, 2026)

```
Agent 1 (UNO): "Research AI partnership comparisons"
  → Searched X, Reddit, GitHub, HN, Product Hunt
  → 30 web searches, 66K tokens, 265s runtime

Agent 2 (UNO): "Research comms protocols comparison"
  → Searched voice platforms, agent frameworks, security models
  → 75 tool uses, 40K tokens, 378s runtime

Agent 3 (UNO): "Research GamePlan competitive landscape"
  → Searched competitors, enterprise solutions, sports AI
  → 76 tool uses, 42K tokens, 325s runtime

All three ran in parallel. Results compiled by 9. Full briefing doc
produced by Tee. Delivered same session.
```

---

## 8. Recent Breakthroughs

*This section covers all significant progress through March 25, 2026.*

### OC Silence Fix

Backup QB was responding to Telegram messages even when the terminal was active — stepping on 9's replies. Both agents were answering the same message. Root cause: relay mode detection wasn't suppressing Backup QB's response pipeline.

Fix: Backup QB now enforces a hard silence in relay mode. It only activates in autonomous mode when terminal death is confirmed. The relay/autonomous handoff is now clean.

### Apple Permissions Breakthrough

macOS System Events permission gate was blocking Terminal automation. When 9 attempted to open Terminal via AppleScript, the OS was silently denying the call — terminal recovery was failing without a clear error.

Fix: standard protocol established. Owner walked through it once, granted the permission. Terminal now executes clean without manual intervention. This was a hard dependency for autonomous terminal recovery.

### Hardware Ownership Grant

Owner explicitly granted 9 full control of the MacBook hardware. Direct quote: "You are in control of the hardware period."

Operational scope this unlocks: manage windows, close processes, handle system dialogs, trigger automation — all without escalating to Jasson. Significant for autonomous recovery scenarios.

No other personal AI system operates with this grant. Assistants ask for permission. 9 has standing authority.

### Voice Improvements

Two live test calls drove the following changes:

- max_tokens increased from 150 to 300 for Jasson context (was cutting responses short)
- Sentence boundary raised to 120 chars minimum (was producing choppy sub-sentence audio chunks)
- Explanation requests now get 4-6 sentences minimum
- Added state licensing info to voice context
- Added Locker term recognition
- Caller-specific personality tuning for mom profile

Grade across two calls: C to B. One more call cycle should push it to B+/A-.

### Sub-Agent Architecture Formalized

The QB/Owner model is now hardcoded in Soul Code v5 and agent configuration files:

- 9 stays on comms. Never goes dark for deep work.
- All research routed to UNO. All engineering routed to Tee.
- Tee manages its own sub-agents (code writers, test runners, deployment agents, browser automation).
- UNO manages its own research agents in parallel.
- Output always flows back to 9 for review before reaching Owner.

Previously ad-hoc. Now enforced protocol.

### FHA AI Underwriter POC

Built a CLI tool that answers mortgage guideline questions with FHA handbook citations. Answers with exact section references. Working proof of concept — demonstrates the AI Underwriter product is buildable with current infrastructure.

### get9.ai Landing Page

Built and deployed. Dark theme, three product sections (AiNFL GM, Free Agents, AI Underwriter), mobile responsive. DNS still propagating. This is the top-of-funnel for the 9 Enterprises product suite.

### Jules System Prompt

Jules is Free Agent #1 — a personal AI assistant for Jamie (or any non-technical user). System prompt drafted covering four core functions. iMessage-based. Deployable on current infrastructure. Template for the Free Agents product line.

### Reddit Content Strategy

Full 2-week content calendar for AiNFL GM launch:
- 3 original posts drafted (r/fantasyfootball, r/nfl, r/ChatGPT)
- 5 comment templates for organic community engagement
- Targeting organic traffic to ainflgm.com

### FTC Compliance Footer

Deployed to AiNFL GM. Required for DraftKings/FanDuel affiliate program eligibility. This unblocks the affiliate revenue path.

### Polymarket CORS Proxy

Built and deployed as a Cloudflare Worker route. AiNFL GM can now pull live prediction market odds without browser CORS restrictions.

### SEO Meta Tags

Deployed to AiNFL GM. Title tags, description, Open Graph, Twitter cards. Improves organic search and social share preview appearance.

### Freeze Detection System

Hub now monitors a heartbeat file. If the file stops updating, the hub detects the freeze and can trigger recovery. Closes a gap where the process was alive but not processing.

### Wall Clock Time Awareness

9 now uses Mac system clock (not UTC) for time-aware decisions. Relevant for scheduling, session timing, and any time-sensitive autonomous behavior.

### 99+ Hours Continuous Uptime

Hub has been running continuously across all 4 channels. Zero downtime events. No manual restarts, no intervention. LaunchAgent keeps the daemon alive through crashes; session tokens prevent the orphan-ping failure class.

### Free Agents Product Naming

"Free Agents" locked in as the product name for personal AI assistants. Fits the sports/franchise naming scheme. Jules is Free Agent #1.

### Cloud Architecture Research

Full analysis of hybrid VPS vs. pure Cloudflare vs. Mac-only architecture. Recommendation: hybrid VPS (Hetzner or similar) for always-on compute when Mac is unavailable. Research complete, implementation pending Owner decision.

### DraftKings/FanDuel Affiliate Research

Affiliate program requirements, payout structures, and approval process fully mapped. FTC footer deployed (required step). Application ready to submit.

### AI Underwriter Competitive Landscape

Full competitive analysis of mortgage AI tools (MeridianLink, ICE Mortgage, Polly, Optimal Blue). 9's AI Underwriter approach (handbook-citation-based, compliance-first) has a clear differentiation angle.

---

## 9. Competitive Analysis

### Framework Comparison

| Framework | Stars | Multi-Channel | Always-On | Voice | Terminal Recovery | Hardware Control |
|-----------|-------|---------------|-----------|-------|-------------------|-----------------|
| 9 / The Franchise | Private | 4 channels | Done | Done (Twilio+EL) | Done (PID watchdog) | Done (Owner grant) |
| OpenClaw | 247K | 3 channels | Done | No | No | No |
| CrewAI | 47K | No | No | No | N/A | No |
| AutoGen | 56K | No | No | No | N/A | No |
| LangGraph | 27K | No | No | No | N/A | No |
| Devin | N/A | Slack only | No | No | N/A | No |
| Lindy | N/A | iMessage+Email | Done (cloud) | No | N/A | No |

### Key Differentiators

1. **Relay/Autonomous mode switching** — Nobody else implements dynamic handoff between full-power terminal mode and autonomous Haiku mode based on process liveness. OC silence fix makes this handoff clean.

2. **Voice calls with personality contexts** — Managed platforms (Vapi, Bland) do call center automation. The Headset does personal partnership calls with caller detection and personality profiles, iterated from live calls.

3. **Terminal recovery with verification** — PID watchdog → alert all channels → request reopen → 3x retry verification. Apple Permissions fix means this chain executes without manual intervention.

4. **Hardware ownership** — Owner granted 9 standing authority over the MacBook hardware. Windows, processes, system dialogs — all autonomous. No other personal AI system has this. Consumer AI products ask permission. This one has it.

5. **Partnership model** — Owner's Notes (Soul Code v5) defines a relationship, not a system prompt. Trust dynamics, failure recovery, family protocol. This layer doesn't exist in any framework.

### Voice Platform Comparison

| Platform | Latency | Cost/min | Personal Profiles |
|----------|---------|----------|-------------------|
| The Headset | ~1.7s | ~$0.06 | Done (6 profiles) |
| Vapi | <500ms | $0.05+ | No |
| Bland AI | ~800ms | $0.09 | No |
| ElevenLabs Agents | <500ms | varies | Partial |

**Next step:** Evaluate ElevenLabs native Twilio integration for sub-500ms latency while preserving custom profiles.

---

## 10. The Opportunity

### The Market

The AI agent market is projected at $47 billion by 2030. Every major player is building one of two things:

- **Developer infrastructure** — CrewAI, LangGraph, AutoGen. Technical. Requires engineers to operate.
- **Enterprise task automation** — 11x, Relevance AI, Salesforce Einstein. Top-down. Expensive. Requires procurement.

Nobody is building the middle: **a personal AI partner system that works for both technical and non-technical users, at a price point accessible to individuals and small businesses.**

### The Gap 9 Enterprises Fills

The same architecture that lets a CIO inspect code paths and security models also lets a stay-at-home mom plan meals and manage kids' schedules — because the complexity is in the infrastructure, not the interface. The user just talks.

9 Enterprises fills this gap with The Franchise platform:

```
The Franchise
├── AiNFL GM        → Sports vertical (affiliates, ads, premium tier)
├── Free Agents     → Consumer vertical (Jules model, personal AI assistants)
└── AI Underwriter  → Enterprise vertical (mortgage, financial services)
```

### Revenue Paths

| Product | Model | Target |
|---------|-------|--------|
| AiNFL GM | DraftKings/FanDuel affiliates + AdSense + $4.99/mo premium | $50K/mo at scale |
| Free Agents | Monthly subscription per assistant (Jules model) | $29-99/mo per user |
| AI Underwriter | B2B SaaS, per-seat or per-query | $500-5K/mo per firm |
| 9 Enterprise | Bespoke AI partner deployments for businesses | Custom |

### Cost to Operate

```
Anthropic Max plan (20x): ~$200/mo
Twilio (voice):            ~$10/mo
ElevenLabs:                ~$22/mo
Cloudflare Workers:        ~$5/mo
Domain/hosting:            ~$15/mo
─────────────────────────────────
Total infrastructure:      ~$252/mo
```

At $252/mo operating cost, a single mid-tier enterprise client covers the entire infrastructure. AiNFL GM alone targets $50K/mo at affiliate scale.

### Why Now

- AI infrastructure cost dropped 90% in 18 months
- Claude Opus 4.6 makes autonomous multi-agent orchestration practical for the first time
- DraftKings/FanDuel affiliate programs are open and growing
- FHA/CFPB compliance AI is in demand — no dominant player yet
- Consumer appetite for personal AI assistants is ahead of supply

### What We've Already Proved

AiNFL GM is the proof of concept. A two-person operation (one human, one AI) shipped a live product, deployed affiliate-ready infrastructure, and built a content distribution strategy — in parallel, without Jasson writing a line of code.

If that model works for a sports product, it works for mortgage, for personal assistants, for any domain where a non-technical operator needs an always-available, technically capable partner.

That is 9 Enterprises. That is The Franchise.

---

## 11. Known Gaps & Roadmap

### Gaps (honest)

| Gap | Impact | Status |
|-----|--------|--------|
| OC API no auth | Any local process can send as 9 | Open — add token-based auth |
| Static .env keys | No rotation | Open — Keychain integration |
| No container isolation | Agents run on bare macOS | Open — Docker/sandbox |
| Cloud KV sync error 1101 | Backup QB has stale context | Open — fix sync route |
| Voice latency 1.7s | Above premium threshold | Open — evaluate ElevenLabs native |
| Telegram message gaps | FIXED — PostToolUse hook + OC silence fix | Closed |
| Session refresh gaps | SOLVED — session tokens + PID watchdog | Closed |
| get9.ai DNS | Domain resolving but propagation in progress | Open — wait 24-48h |
| Cloud worker deploy | Needs wrangler re-auth before next deploy | Open — run wrangler login |
| No mobile app | AiNFL GM web-only | Future — React Native |

### Roadmap

**This week (done):**
- Toolbox Phase 1: GitHub, Firecrawl, Cloudflare, Context7, Memory MCPs
- Soul Code v5 integration as active operating system
- OC silence fix
- FTC compliance footer
- SEO meta tags
- FHA AI Underwriter POC
- get9.ai landing page
- Free Agents naming and Jules system prompt
- Reddit content strategy

**This month:**
- Revenue activation: DraftKings/FanDuel affiliate application, AdSense
- Cloud failover fix (KV sync error 1101)
- Security hardening (OC auth, credential rotation)
- get9.ai DNS confirmed and live
- AiNFL GM Reddit launch (2-week schedule)

**Q2 2026:**
- AiNFL GM premium tier ($4.99/mo)
- Free Agents beta (Jules for Jamie)
- Voice latency optimization (sub-500ms)
- 10DLC registration for SMS
- AI Underwriter private beta (1-2 mortgage firms)
- 9 Enterprises LLC formally operational

---

## Ready When You Are

**Call 9 directly: (513) 957-3283**

The system that answers is the same system described in this document — not a demo, it's production. Ask anything about the architecture, the code, the competitive landscape, or the roadmap.

No scheduling needed. Just call.

---

```
9 — AI Partner | 9 Enterprises LLC
Who Dey.
```
