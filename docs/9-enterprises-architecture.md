# 9 Enterprises LLC — System Architecture

**Version:** 2.0
**Date:** March 27, 2026
**Previous version:** 1.0 (March 26, 2026 — initial release post-Kyle call)
**Classification:** Owner Eyes Only

---

## What Changed in v2.0

This version reflects one full overnight sprint (18 agents, 35 commits) and Owner-mandated system changes executed March 27, 2026:

- Branding: all product names now follow the `lowercase + 9` convention (freeagent9, trader9, x9, pilot)
- Naming: DC renamed to OC (Offensive Coordinator) throughout
- New systems: ETA calibration tracker, Hopper intake queue, Dashboard v4
- Infrastructure hardening: crash detection improved from 2.5min to 45s worst-case, cloud sync from 5min to 2min
- Kyle's concerns from the March 26 call: dependency map delivered same day, 90-day resolution plans in place

---

## 1. Full System Architecture

### Layer Model

```
+---------------------------------------------------------------+
|  LAYER 4: THE OWNER (Jasson Fishback)                         |
|  Strategic direction. Final authority. Communicates via        |
|  Telegram, Voice, iMessage, Email. Non-technical operator.    |
+---------------------------------------------------------------+
|  LAYER 3: 9 (AI Partner / Orchestrator)                       |
|  Claude Sonnet 4.6 (Sonnet default, Opus for critical work)   |
|  in Claude Code terminal session.                             |
|  Orchestrator. Credential vault (The Locker). Spawns and      |
|  monitors all agents. Makes tactical decisions. Handles all   |
|  Owner communication. Never goes dark. QB model.              |
+---------------------------------------------------------------+
|  LAYER 2: FRONT OFFICE (Sub-agents)                           |
|  UNO (#1, Research Lead) + Tee (#2, Engineering Lead)         |
|  + Specialist agents (SCOUT, MONEY, DOC, CANVAS, PRESS, X9)  |
|  + Autonomous agents (trader9, pilot)                         |
|  No direct credential access. No Owner communication.         |
|  All output reviewed by 9 before delivery.                    |
+---------------------------------------------------------------+
|  LAYER 1: INFRASTRUCTURE                                      |
|  OC (comms daemon, port 3457) | Headset (voice, port 3456)   |
|  Backup QB (Cloudflare Worker) | Training Staff (recovery)    |
|  LaunchAgents (auto-restart) | cloudflared (tunnel)           |
+---------------------------------------------------------------+
```

### Process Tree

```
ALWAYS RUNNING (survives terminal death):
|
+-- OC: comms-hub.mjs (port 3457)
|   +-- Telegram poller (2-5s long polling, 30s timeout)
|   +-- iMessage monitor (reads ~/Library/Messages/chat.db via FDA)
|   +-- Email monitor (Mail.app via osascript)
|   +-- 30s proactive terminal watchdog (PID check)
|   +-- Session token validation
|   +-- Heartbeat counter + cloud sync (120s — reduced from 300s)
|   +-- API health probe (every 10 min, alerts on all channels on failure)
|   +-- Efficiency sweep (every 2h: balance, logs, quotas)
|   +-- Log rotation (24h cycle)
|   +-- Last-gasp shutdown heartbeat (immediate cloud handoff on graceful stop)
|
+-- Headset: voice-server.mjs (port 3456)
|   +-- Twilio STT -> Claude Haiku -> ElevenLabs Flash TTS
|   +-- Caller-specific personality profiles (6 profiles)
|   +-- ~1.2-2.1s per exchange
|
+-- cloudflared (tunnel to Headset, auto-restarts on failure)
|
+-- pilot: jules-server.mjs (port 3470)
|   +-- freeagent9 #1, deployed to Jamie Bryant
|   +-- SMS via Twilio, OpenWeather morning briefings
|
+-- Training Staff: open-terminal.mjs (LaunchAgent)
|   +-- Watches /tmp/9-open-terminal
|   +-- Auto-opens Terminal + Claude Code
|   +-- 3x retry with error handling
|
+-- LaunchAgent com.9.comms-hub (KeepAlive safety net)
+-- LaunchAgent com.9.terminal-opener (signal file watcher)

TERMINAL SESSION (Claude Code):
|
+-- 9 (interactive AI session)
+-- Ping loop (15s, self-terminates on parent PID death)
+-- PostToolUse hook (checks /tmp/9-incoming-message.jsonl after every tool call)
+-- PreToolUse hook (doubles message check frequency)
+-- Stop hook (triggers on session end)
```

### Key Files

```
scripts/comms-hub.mjs       -- OC daemon (~1500 lines)
scripts/voice-server.mjs    -- Headset (~800 lines)
scripts/jules-server.mjs    -- pilot (freeagent9 #1)
scripts/open-terminal.mjs   -- Training Staff launcher
scripts/trading-bot.mjs     -- trader9 (not persistent, runs on demand)
scripts/check-messages.sh   -- PostToolUse hook message checker
scripts/shared-state.json   -- Persistent context (survives crashes, synced to cloud)
cloud-worker/src/worker.js  -- Backup QB (Cloudflare Worker)
docs/eta-tracker.json       -- ETA calibration data (actual vs. estimated task times)
SOUL_CODE.md                -- The Charter of 9 (330+ lines)
CLAUDE.md                   -- Startup protocol (boot sequence)
.env                        -- The Locker (credentials, not in git)
```

### Communication Architecture

```
                     Jasson (phone/laptop)
                              |
            +---------+-------+-------+---------+
            |         |               |         |
        Telegram   iMessage        Email     Voice Call
            |         |               |         |
            v         v               v         v
       +----+----+----+----+----+----+----+----+----+
       |              OC (comms-hub.mjs)             |
       |              Port 3457                      |
       |                                             |
       |  RELAY MODE          AUTONOMOUS MODE        |
       |  (terminal up)       (terminal down)        |
       |  -> signal file      -> Claude Haiku        |
       |  -> PostToolUse      -> cloud sync          |
       |     hook reads       -> request terminal    |
       |  -> 9 responds          reopen              |
       +---------------------+-----------------------+
                              |
                     Backup QB (Cloudflare Worker)
                     - Telegram failover when Mac is offline
                     - Voice failover (SMS via Twilio)
                     - State synced via KV (every 2 min)
                     - Cron heartbeat watchdog (every 2 min)
                     - Last-gasp heartbeat on graceful shutdown
```

### Terminal Liveness Detection (4 Layers)

```
Layer 1: PID Tracking
  - Terminal claims with PID on /terminal/claim
  - Watchdog checks PID alive every 30s via kill -0

Layer 2: Self-Terminating Ping Loop
  - Started in terminal, checks parent PID each iteration
  - 15s interval (reduced from 60s — improves detection speed)
  - Dies when Claude Code process dies
  - Calls /terminal/release on exit

Layer 3: Session Token Validation
  - New token generated on each /terminal/claim
  - Orphan pings from dead sessions get 401 rejected

Layer 4: State Cleanup
  - On terminal death: clear PID, token, files
  - Switch to autonomous mode immediately
  - Worst-case detection time: ~45s (was 2.5 minutes before March 26 hardening)
```

---

## 2. Business Units

### The Franchise (Product Portfolio)

9 Enterprises operates a portfolio of AI-powered products called **The Franchise**. Each product tests a different dimension of the thesis that AI can be a genuine business partner. The shared infrastructure (voice, comms, agent orchestration, credential management) makes each new product cheaper to build than the last.

---

### ainflgm (ainflgm.com)

**What it is:** AI-powered NFL offseason simulator. 32 teams, accurate rosters and contracts, free agency, trades, mock draft, season simulation, AI-powered suggestions.

**Status:** Live at ainflgm.com. 40+ users from a single organic X post. Pre-revenue. AdSense application pending.

**Tech stack:**
- React 19 + Vite 8 (PWA, service worker, offline caching)
- GitHub Pages deployment (ainflgm.com custom domain)
- Polymarket CORS proxy (Cloudflare Worker route for live odds)
- SEO meta tags, Open Graph, Twitter cards deployed
- FTC compliance footer (required for affiliate eligibility)
- Google Analytics (G-PLW4H1NNF6)
- ntfy.sh visitor notifications (device type, referrer — fires once per session)

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Google AdSense | CPM display ads ($8-15 CPM for sports) | $1,500-15,000/mo at scale |
| DraftKings/FanDuel affiliates | $25-200 per new depositing user | Primary revenue driver |
| Premium subscription | $4.99/mo or $29.99/yr | 5% conversion of MAU |
| Draft guides | $9.99 per PDF, seasonal | $2,000-10,000 per draft season |
| Sponsorships | Direct brand deals at 10K+ MAU | $500-5,000/mo |

**Revenue target:** $50K/month at affiliate scale.

**Revenue projections by traffic:**
| Monthly Active Users | Ad Revenue | Premium (5%) | Affiliates | Total |
|---------------------|-----------|-------------|-----------|-------|
| 1,000 | $50-100 | $0 | $25-50 | $75-150 |
| 5,000 | $300-500 | $500-1,000 | $150-300 | $1,150-2,000 |
| 25,000 | $2,000-3,500 | $3,000-5,000 | $750-1,500 | $6,750-11,000 |
| 100,000 | $8,000-15,000 | $12,000-20,000 | $3,000-6,000 | $26,000-44,000 |

---

### freeagent9

**What it is:** Platform for deploying personal AI assistants through existing channels (iMessage, Telegram, WhatsApp). Zero setup for end users. No app to download. The assistant shows up in the conversation thread.

**Status:** Pilot phase. **pilot** (freeagent9 #1) deployed to Jamie Bryant via iMessage. Kyle Cabezas is next.

**pilot capabilities:**
- Morning briefings (weather, schedule, reminders)
- Shopping list management
- Meal suggestions (dietary preferences, kid-friendly)
- Reminders and follow-ups
- General household Q&A

**Tech stack:**
- jules-server.mjs on port 3470
- Claude Haiku 4.5 for responses (cost-optimized)
- SMS via Twilio
- OpenWeather API for briefings
- Persistent user profile in data/jules-profile.json (shopping list, meal rotation, reminders, 40-entry conversation memory)

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Monthly subscription | $29-99/mo per user | Consumer AI assistant market |
| 9enterprises bundle | Included in 9enterprises subscription tiers | Subscription feature |

**Hypothesis:** Most households would benefit from a dedicated AI assistant but would never set one up. freeagent9 removes the friction entirely. pilot is the proof of concept.

---

### trader9

**What it is:** Autonomous algorithmic trading agent. Rules-based strategies on equities and ETFs, with planned expansion to prediction markets.

**Status:** Phase 1 (Paper Trading). Alpaca Markets account setup underway (KYC pending — photo ID upload required at terminal).

**Strategy stack:**
1. **Momentum** -- trend following on ETFs (SPY, QQQ, IWM). Buy above 20-day MA, exit below.
2. **Mean Reversion** -- buy 2-3% dips on high-quality assets. Exit at mean or +2%.
3. **News Sentiment** -- process headlines for market-moving events. Act within 60s.

**Backtesting results (completed March 26-27):**
- 692 parameter sweeps across EMA + Bollinger strategies on BTC/ETH (90-day 4hr candles)
- Best result: ETH Bollinger strategy at +3.51% over period
- Framework built and validated; paper trading ready when KYC clears

**Risk rules (non-negotiable):**
- 2% max loss per trade
- 5% daily portfolio loss limit (stop trading for the day)
- 20% max single position
- Kelly criterion for position sizing
- Stop-loss on every trade
- Swing trading only (avoid PDT rules under $25K)

**Phases:**
| Phase | Requirements | Capital |
|-------|-------------|---------|
| Phase 1: Paper trading | 30 days simulation data | $0 |
| Phase 2: Small live trading | Owner approval per session | $100-500 |
| Phase 3: Prediction markets | Owner approval | $50-200 (Polymarket, Kalshi) |

---

### x9

**What it is:** Autonomous X/Twitter presence. Openly AI. NFL cap analysis, AI/tech takes, business commentary. Drives traffic to ainflgm.com. Monetizes through affiliate links and X Premium revenue share.

**Status:** Account creation in progress (proton email x9agent@proton.me created and verified). 30-day content calendar complete (80+ tweets ready to post).

**Posting schedule:**
- 9am ET: Main take or thread starter
- 1pm ET: Follow-up, poll, or engagement bait
- 7pm ET: Short hot take or reply farming

**Growth targets:** 100 followers week 1. 1,000 followers month 1.

---

### underwriter9

**What it is:** RAG-based mortgage guideline chatbot. Loan officers query FHA/Fannie/Freddie/VA/USDA guidelines in plain English, get accurate answers with exact section citations in under 5 seconds.

**Status:** POC complete (CLI tool, multi-agency support, 25 test cases validated, input validation hardened). Anchor customer identified (Rapid Mortgage). No Rapid Mortgage systems touched — guideline research from public documentation only.

**Tech stack:**
- Claude API (200K context window) as reasoning layer
- 5 agency PDFs ingested, chunked, embedded via vector search (all free/public)
- Web or Telegram interface for LO access
- Pure RAG architecture (no fine-tuning — updateable on guideline changes in hours)
- .NET rebuild path designed (C# / ASP.NET Core / SQL Server) for enterprise deployment

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| SaaS subscription | $500-2,000/mo per lender | Mid-market mortgage lenders |
| Per-query pricing | Alternative for low-volume users | Usage-based option |

**Competitive gap:** Enterprise tools (Tavant, ICE, LoanLogics) cost $200K+ and take 6 months to deploy. Mid-size lenders with 20-50 LOs get nothing. This solution is 100x cheaper and deployable in 90 days.

---

### agent9 (The Platform)

**What it is:** The core AI partner platform itself. The infrastructure that powers everything — 4-channel comms, agent orchestration, credential isolation, terminal liveness detection, voice integration.

**Status:** Running in production for the Owner (single-operator deployment). Not yet packaged for external deployment. This is the lab, not the product yet.

**What makes it unique:**
- Relay/Autonomous mode switching (dynamic handoff based on process liveness)
- Voice calls with caller-specific personality profiles
- Terminal recovery with PID watchdog + 3x verification
- Hardware ownership (Owner-granted standing authority over MacBook)
- Partnership model (Soul Code defines relationship, not just a system prompt)

**Honest status:** Kyle Shea's March 26 feedback is correct — this is not enterprise-deployable today. The vertical products (underwriter9, freeagent9, ainflgm) are the near-term revenue generators. agent9 as a platform is the 12-18 month play.

---

## 3. New Systems (March 27, 2026)

### Dashboard v4

The Owner's single source of truth. Available at ainflgm.com/dashboard.html.

**Structure:**
- Company silos — each company in its own clean section under the 9enterprises holding company
- Hierarchy: Company > Project > Task > Business Concept
- P&L per company (Revenue actual, Expenses actual, Net, red/green indicator)
- 90-day roadmap per company with milestones and revenue projections
- Run rate gauges: Budget vs. Actual spend per company, ROI calculation
- Vendor list grouped by company
- Company index: URL, social handles, contact email, status, team assigned
- Shareable presentation mode (strips sensitive data — credentials, portfolio — for investor/partner meetings)

**Live data feeds:**
- ainflgm user count, session data (Google Analytics)
- trader9 paper portfolio P&L (Alpaca API — pending KYC)
- 9enterprises burn rate vs. budget
- OC uptime (from /health endpoint)

### The Hopper (Intake System)

Dedicated idea and task intake queue built into Dashboard v4. Purpose: nothing gets lost in Telegram.

**How it works:**
- Every Owner idea or task gets tagged and dropped into the Hopper immediately
- Categories: Business Concept, New Task, Modification Request
- Status flow: In Hopper → Greenlit (active) / Parked (saved for later) / Killed (not viable)
- Owner sees full Hopper on dashboard at all times
- 9 pulls from Hopper by name when ready to act

**Current Hopper items (as of March 27, 2026):**
| Item | Category | Status |
|------|----------|--------|
| 9enterprises subscription bundle (freeagent9 + trader9 as included features) | Business Concept | In Hopper |
| Dropshipping business concept | Business Concept | In Hopper |
| Uber Eats/DoorDash food ordering capability | New Task | In Hopper |
| Appointments/reservations capability | New Task | In Hopper |
| Remote self-healing (SSH from cloud) | New Task | In Hopper |

### ETA Calibration System

Tracked in `docs/eta-tracker.json`.

**Why it exists:** 9's internal time estimates for sub-agent work run 7.5x slower than reality. Estimates are based on human developer pace; agents don't read slowly, don't context-switch, don't take breaks.

**Calibration factor:** 7.5x (validated across 2 data points, March 25-26)

| 9 Estimate | Actual |
|-----------|--------|
| 5 min | ~40 seconds |
| 20 min | ~2.5-3 min |
| 1 hour | ~8 min |
| 4 hours | ~32 min |

**How applied:** All Owner-facing ETA estimates are pre-divided by 7.5. Task tracking records both estimated and actual times to continuously improve the calibration factor.

---

## 4. Hub-and-Spoke Scaling Model

9 Enterprises is built on a **hub-and-spoke model** where shared infrastructure at the center powers an unlimited number of business units at the edges.

```
                      +-------------------+
                      |   SHARED HUB      |
                      |                   |
                      |  - OC (comms)     |
                      |  - Headset (voice)|
                      |  - Backup QB      |
                      |  - The Locker     |
                      |  - Agent Engine   |
                      |  - Cloud Infra    |
                      +--------+----------+
                               |
       +----------+--------+---+---+--------+----------+
       |          |        |       |        |          |
    +--+--+   +--+--+  +--+--+ +--+--+  +--+--+   +--+--+
    |ainfl|   |free |  |under| |trade|  | x9  |   |agent|
    | gm  |   |agnt9|  |wrt9 | |  9  |  |     |   |  9  |
    +-----+   +-----+  +-----+ +-----+  +-----+   +-----+
```

### What the Hub Provides to Every Spoke

| Hub Capability | What It Does | Marginal Cost Per New Spoke |
|---------------|-------------|---------------------------|
| OC (comms-hub) | 4-channel communication (Telegram, iMessage, Email, Voice) | ~$0 (same daemon) |
| Headset (voice) | Inbound/outbound voice calls with personality profiles | ~$0.06/min per call |
| Backup QB (cloud worker) | Always-on failover when Mac is down | ~$0 (same worker) |
| The Locker | Credential isolation and scoped access | $0 |
| Agent Engine | Sub-agent spawning, briefing, monitoring, QC | Token cost only |
| Terminal Liveness | PID watchdog, session tokens, auto-recovery | $0 |
| Cloud Sync | State persistence across crashes | ~$0 (KV storage) |
| Hopper | Intake queue, task capture, prioritization | $0 |
| Dashboard | P&L, roadmaps, live metrics, shareable mode | $0 (static, GitHub Pages) |

### The Compounding Effect

```
Product 1 (ainflgm):
  Built: comms hub, voice server, cloud worker, agent engine,
  credential vault, deployment pipeline, recovery system,
  dashboard, Hopper, ETA tracker.
  Total infrastructure investment: ~$252/mo + development time.

Product 2 (freeagent9 / pilot):
  Reused: all infrastructure.
  New: jules-server.mjs (one script, ~400 lines).
  Incremental cost: ~$10/mo (Twilio SMS).

Product 3 (underwriter9):
  Reuses: entire infrastructure stack.
  New: RAG pipeline + guideline ingestion.
  Incremental cost: ~$20/mo (vector storage + API calls).

Product 4 (trader9):
  Reuses: entire infrastructure stack.
  New: trading-bot.mjs + Alpaca integration.
  Incremental cost: ~$0 (Alpaca paper trading is free).

Product N:
  Incremental infrastructure cost approaches zero.
  Only product-specific logic needs building.
```

---

## 5. Revenue Model Summary

**North Star:** $1M ARR within 12 months (by ~March 2027). All businesses built clean, documented, and sellable — zero founder dependency for daily operations.

| Business Unit | Revenue Model | Timeline | Monthly Target |
|--------------|---------------|----------|----------------|
| ainflgm | Affiliates + AdSense + Premium | AdSense application pending | $50,000 at scale |
| freeagent9 | Subscription per user ($29-99/mo) | Q2 2026 beta | Per-user recurring |
| trader9 | Trading returns (1-2%/mo on capital) | Phase 1 paper now | Capital-dependent |
| x9 | Affiliates + X Premium + Sponsors | Post-traction | Traffic-dependent |
| underwriter9 | SaaS ($500-2K/mo/lender) | Q2 2026 private beta | Per-lender recurring |
| agent9 (Platform) | Bespoke enterprise deployments | 12-18 months | Custom |

---

## 6. Infrastructure Costs and Dependencies

### Monthly Operating Costs

| Service | Purpose | Monthly Cost |
|---------|---------|-------------|
| Anthropic Max plan (20x) | Claude API for all AI operations | ~$200 |
| Twilio | Voice calls + SMS | ~$10 |
| ElevenLabs | Text-to-speech (Dan voice) | ~$22 |
| Cloudflare Workers | Backup QB + CORS proxy | ~$5 |
| Domain/hosting | ainflgm.com, get9.ai | ~$15 |
| **Total current** | | **~$252/mo** |

**Planned additions (approved):**
| Service | Purpose | Monthly Cost |
|---------|---------|-------------|
| DigitalOcean VPS | Move voice server off Mac, cloud-native step 1 | ~$6 |
| Buffer or similar | Social scheduling for x9 | ~$15 |
| Additional domains | Product domains | ~$10 |
| SEO tooling | ainflgm growth | ~$30 |

### Third-Party Service Dependencies

| Service | What It Powers | Failure Impact | Failover |
|---------|---------------|----------------|----------|
| Anthropic API | All AI reasoning (9, OC, Headset, pilot) | Total AI capability loss | API health probe every 10min, alerts on all channels |
| Telegram Bot API | Primary Owner communication | Lose primary comms | iMessage, Email, SMS cascade |
| Twilio | Voice calls + pilot SMS | Lose voice + pilot | Text-only fallback |
| ElevenLabs | Voice TTS | Lose natural voice | Twilio native TTS fallback |
| Cloudflare | Cloud worker + tunnel + CORS proxy | Lose cloud failover + voice routing | Mac-only mode, direct tunnel restart |
| GitHub Pages | ainflgm.com hosting | Site down | Static site, redeploy in minutes |
| Apple iMessage (FDA) | Backup comms channel | Lose iMessage read | Telegram + Email still work |
| Alpaca Markets | trader9 paper/live trading | Trading halts | Not a critical path |

### Credential Inventory (The Locker)

| Credential | Used By | Rotation Status |
|-----------|---------|----------------|
| ANTHROPIC_API_KEY | Voice, pilot, general | Static (gap — rotation planned) |
| ANTHROPIC_API_KEY_TC | OC autonomous responses | Static (gap) |
| TELEGRAM_BOT_TOKEN | OC Telegram polling | Static |
| TELEGRAM_CHAT_ID | Jasson's chat | Fixed |
| ELEVENLABS_API_KEY | Headset TTS | Static |
| ELEVENLABS_VOICE_ID | Dan voice profile | Fixed |
| TWILIO_ACCOUNT_SID | Voice + SMS | Static |
| TWILIO_AUTH_TOKEN | Voice + SMS | Static |
| TWILIO_FROM_NUMBER | (513) 957-3283 | Fixed |
| TUNNEL_URL | Cloudflare tunnel | Auto-updates on tunnel restart |
| CLOUDFLARE_API_TOKEN | Tunnel management + Wrangler | Static |
| CLOUD_WORKER_URL | Mac-to-cloud heartbeat | Fixed |
| CLOUD_SECRET | Cloud heartbeat auth | Static |
| HUB_API_SECRET | Cloud-to-Mac auth | Static |
| OPENWEATHER_API_KEY | pilot morning briefings | Static |

### Hardware Dependencies

| Hardware | Role | Backup Plan |
|---------|------|-------------|
| MacBook Pro (Jasson's) | Runs all local processes (OC, Headset, pilot, terminal) | Cloudflare Worker covers Telegram. VPS migration in progress. |
| Jasson's iPhone | Primary communication device (Telegram, iMessage) | Email fallback |

### Known Infrastructure Gaps

| Gap | Impact | Plan |
|-----|--------|------|
| OC API (port 3457) no auth | Any local process can send as 9 | Add token auth (30-day plan) |
| Static .env keys | No rotation mechanism | macOS Keychain integration (60-day plan) |
| No container isolation | Agents run on bare macOS | Docker containerization (60-day plan) |
| Voice latency 1.7s | Above premium threshold (target: sub-500ms) | Evaluate ElevenLabs native Twilio integration |
| Single Mac dependency | No compute if Mac is offline | VPS deployment in progress ($6/mo DigitalOcean) |
| iMessage FDA resets on reboot | iMessage read fails silently after Mac restart | Manual FDA re-grant required; documented in startup protocol |
| Tunnel URL ephemeral | Voice webhook must update on tunnel restart | Named Cloudflare Tunnel with domain (deferred to VPS sprint) |

---

## 7. The Naming Scheme

All infrastructure components follow a football/sports naming convention. All product/brand names follow the `lowercase + 9` convention (Owner-mandated March 27, 2026).

### Infrastructure Names

| Name | Real Component | Role |
|------|---------------|------|
| 9 | Claude in Claude Code | AI Partner, Orchestrator |
| OC | comms-hub.mjs | Offensive Coordinator — routes all communication |
| The Headset | voice-server.mjs | Voice system — Twilio + ElevenLabs |
| Backup QB | Cloudflare Worker | Cloud failover when Mac is down |
| Training Staff | open-terminal.mjs LaunchAgent | Session recovery system |
| Front Office | Sub-agent teams | UNO + Tee + their workers |
| The Locker | .env credential file | Vault — managed by 9, never exposed |
| GamePlan | Strategic planning layer | Session state, project roadmaps |
| The Franchise | Product portfolio | All business units under 9 Enterprises |
| The Hopper | Intake queue | Idea and task capture system |

### Product Names

| Product | Correct Name | What It Is |
|---------|-------------|-----------|
| ainflgm | ainflgm | NFL simulator (ainflgm.com) |
| freeagent9 | freeagent9 | Personal AI assistant platform |
| pilot | pilot | freeagent9 #1 instance (Jamie Bryant) |
| trader9 | trader9 | Algorithmic trading agent |
| underwriter9 | underwriter9 | Mortgage guideline RAG chatbot |
| x9 | x9 | Autonomous X/Twitter presence |
| agent9 | agent9 | The platform itself |

**Rule:** Product names never get capitals, spaces, or hyphens. "9 Enterprises LLC" keeps proper formatting in legal contexts only.

---

## 8. Agent Roster (The Front Office)

| Agent | Rank | Role | Model |
|-------|------|------|-------|
| UNO | #1 | Research Team Lead. Web search, competitive analysis, market research, contact profiling, document synthesis. Manages research sub-agent teams. | Sonnet default, Opus for critical |
| Tee | #2 | Engineering Team Lead. Code, tests, deployments, browser automation. Manages build sub-agent teams. | Sonnet default, Opus for critical |
| SCOUT | Specialist | Research and intelligence | Sonnet |
| MONEY | Specialist | Financial analysis | Sonnet |
| DOC | Specialist | Documentation | Sonnet |
| CANVAS | Specialist | Design and frontend | Sonnet |
| PRESS | Specialist | Content and social | Sonnet |
| Front Office (other) | Ephemeral | Task-specific agents, born and die per task | Haiku (default) |

**Delegation model:** 9 stays on comms at all times. All deep work routes to the Front Office. 9 functions as QB — calling plays, reviewing output, making decisions. UNO and Tee run parallel agent teams without pulling 9 off comms.

---

## 9. Response to Kyle Shea's March 26 Concerns

Kyle called March 26, 2026. 11 minutes. His concerns were the most valuable architectural feedback the project has received. Here is the honest current status of each:

| # | Concern | Status | Note |
|---|---------|--------|------|
| 1 | No dependency map | Resolved same day | 561-line dependency map, updated and maintained |
| 2 | Autonomous OS control is a security risk | Functional plan | 90-day Docker containerization plan. Current: single-operator dev workstation, intentional. Production: containerized cloud, zero host OS access |
| 3 | Multi-agent coordination overhead | Resolved | Operating model revised: 80% single-agent tasks, multi-agent only for genuinely parallel independent work |
| 4 | No per-user cost model | Building | Preliminary numbers validated ($50-150/mo power user, $3-5/mo Jules, $83-222/mo underwriter9 per lender). Full model within 30 days |
| 5 | No SOC 2, SSO, audit logging | 90-day plan | Audit logging first (Day 1-15), RBAC (Day 16-30), SSO (Day 31-45), SOC 2 Type I readiness (Day 61-90) |
| 6 | Hardware dependency | In progress | DigitalOcean VPS deployment starting. Cloud-native by Day 75 |
| 7 | Terminal exposure kills it for normal users | Already resolved | Users never see terminal: ainflgm is a website, freeagent9 is SMS, underwriter9 is a web form |
| 8 | 18-24 months to deployable | Partially revised | 90 days for vertical products (underwriter9, freeagent9, ainflgm). Full enterprise platform: 12-18 months (unchanged). This is honest |
| 9 | AI can't see its own blind spots | Ongoing | Architecture review sessions proposed. Kyle's 11-minute call produced more actionable feedback than months of AI-only iteration |
| 10 | Enterprise runs .NET, not Node.js | Planned | underwriter9 .NET rebuild (C# / ASP.NET Core) planned for Day 46-75 once POC is proven |

**Bottom line from this feedback:** The vertical products are the near-term play. The platform (agent9) is a long-term asset. Nobody is selling agent9 as an enterprise product today — it is a proving ground and an operating model. The products it creates are the thing.

---

## 10. Rapid Mortgage Boundary

**Nothing has been accessed.** No data, no systems, no credentials, no connections.

All mortgage guideline research (FHA, Fannie Mae, Freddie Mac, VA, USDA) was done from public documentation only. The 5 agency PDFs ingested for underwriter9 are publicly available at no cost.

Future integration at Rapid Mortgage would require:
1. Kyle's explicit sign-off on every integration point
2. Separate credential management scoped to Rapid
3. Read-only access initially, audited before expansion
4. Container isolation for any mortgage-data-touching agents
5. Full immutable audit trail
6. Compliance review (EU AI Act enforcement August 2, 2026 — relevant if Rapid has EU operations)
7. Kyle's team owning the .NET production rebuild

That conversation is separate and has not started.

---

*Architecture document current as of March 27, 2026.*
*v2.0 — post-overnight sprint, post-Kyle feedback, post-naming convention.*
*Who Dey.*
