# 9 Enterprises LLC — System Architecture

**Version:** 3.0
**Date:** March 28, 2026
**Previous version:** 2.0 (March 27, 2026)
**Classification:** Owner Eyes Only

---

## What Changed in v3.0

This version reflects the March 28, 2026 State of the Union session — the largest single-session expansion to date. 15+ deliverables deployed across a ~9-hour marathon session. Major structural changes:

- **AiGM umbrella is live** — AiNFLGM, AiNBA GM, and AiMLB GM now operate as Products under the AiGM Company. All three simulators built and deployed.
- **9enterprises.com is live** — Public marketing site for the holding company.
- **agent9.com consumer site is live** — Elevated from concept to active Company.
- **Command Hub scaffolded** — Next.js + Supabase full-stack build. Phase 1 in progress. Replaces static dashboard.
- **Freeze fix deployed** — 3-tier escalating kill (3/6/7 min) + watchdog LaunchAgent. MacBook freeze recovery without owner intervention.
- **Pilot (Kyle C) is active** — freeagent9 #1 pilot now with Kyle Cabezas. 40+ conversation memory entries. POC generating real-world usage data.
- **Brand unified** — Orange and black (Bengals) across all 9 Enterprises holdings. Joe Burrow #9 is the holding company brand identity.
- **Org structure locked** — 7 confirmed Companies. Org hierarchy formalized. "Draft Room" is the intake queue for new concepts.
- **"9" is the core product** — Everything else is a module or standalone Company building on top of it.
- **Total active URLs: 11**

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
|  Freeze Watchdog LaunchAgent (new — March 28)                 |
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
|   +-- Heartbeat counter + cloud sync (120s)
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
|   +-- freeagent9 #1, deployed to Kyle Cabezas (active POC)
|   +-- SMS via Twilio, OpenWeather morning briefings
|   +-- 40+ conversation memory entries
|
+-- Training Staff: open-terminal.mjs (LaunchAgent)
|   +-- Watches /tmp/9-open-terminal
|   +-- Auto-opens Terminal + Claude Code
|   +-- 3x retry with error handling
|
+-- Freeze Watchdog LaunchAgent (NEW — March 28, 2026)
|   +-- Detects MacBook UI freeze (3/6/7 min escalating kill sequence)
|   +-- Self-heals without Owner intervention
|   +-- Tier 1: kill stuck process (3 min)
|   +-- Tier 2: force-kill + restart OC (6 min)
|   +-- Tier 3: full session recovery (7 min)
|
+-- Pilot LaunchAgent (NEW — March 28, 2026)
|   +-- Auto-restarts jules-server.mjs on crash
|   +-- Ensures pilot uptime independent of terminal session
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
scripts/jules-server.mjs    -- pilot (freeagent9 #1, Kyle Cabezas)
scripts/open-terminal.mjs   -- Training Staff launcher
scripts/trading-bot.mjs     -- trader9 (on-demand, pending Alpaca keys)
scripts/check-messages.sh   -- PostToolUse hook message checker
scripts/shared-state.json   -- Persistent context (survives crashes, synced to cloud)
cloud-worker/src/worker.js  -- Backup QB (Cloudflare Worker)
docs/eta-tracker.json       -- ETA calibration data (actual vs. estimated)
docs/9-enterprises-architecture.md  -- This document
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
  - 15s interval
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

### MacBook Freeze Recovery (NEW — March 28, 2026)

```
Freeze Watchdog LaunchAgent — escalating response:
  Tier 1 (3 min): Kill the stuck process that triggered the freeze
  Tier 2 (6 min): Force-kill + restart OC (comms-hub.mjs)
  Tier 3 (7 min): Full session recovery sequence

Result: MacBook freeze is no longer an Owner action item.
9 self-heals. Owner is last resort, not first call.
```

---

## 2. Organizational Structure

### The Hierarchy

```
9 Enterprises LLC (Holding Company)
|
+-- AiGM (Company)
|   +-- AiNFLGM (Product) — ainflgm.com — LIVE
|   +-- AiNBA GM (Product) — BUILT, deploying
|   +-- AiMLB GM (Product) — BUILT, deploying
|
+-- freeagent9 (Company / Add-on Module)
|   +-- pilot (Product) — Kyle C POC — ACTIVE
|   +-- Concierge Features (Product) — in development
|
+-- trader9 (Company / Add-on Module)
|   +-- Algorithmic Trading Bot — pending Alpaca keys
|
+-- x9 (Company)
|   +-- Autonomous X/Twitter presence — launching
|
+-- agent9 (Company / Add-on Module)
|   +-- agent9.com consumer site — LIVE
|   +-- Real Estate Ai solution — concept stage
|
+-- AI Underwriter (Company)
|   +-- Mortgage Guideline RAG — POC complete
|
+-- Dropshipping (Company — name TBD)
    +-- Owner writing plan
```

### Approved Definitions (Owner-locked March 28, 2026)

| Term | Definition |
|------|-----------|
| Holding Company | 9 Enterprises LLC. Everything rolls up here. |
| Company | Revenue-generating business unit. Own brand, own customers, own P&L. |
| Product | Specific offering within a Company. |
| Concept | Idea in Draft Room. No resources assigned. |
| Project | Defined scope of work. Start, end, deliverable. Lives inside a Company. |
| Task | Single unit of work assigned to an agent or person. |
| Assignment | Task actively delegated to a specific agent team. |
| Draft Room | Intake queue. Concepts wait here to become Companies. |

**The hierarchy:** 9 Enterprises LLC → Company → Product → Project → Task → Assignment

---

## 3. The Core Product: "9"

### "9" Is the Product. Everything Else Is a Module.

The strategic reframe confirmed in the March 28 SOTU: the core offering is **9** — the AI partner platform itself. All other companies (freeagent9, trader9, agent9) are either standalone companies or add-on modules that extend the core 9 subscription.

```
+---------------------------------------------------+
|                 CORE: "9"                          |
|                                                    |
|  4-channel comms | Voice | Agent orchestration    |
|  Credential vault | Terminal recovery | Cloud sync |
|  Dashboard (Command Hub) | Draft Room              |
+---------------------------------------------------+
             |            |           |
      +------+       +----+      +----+------+
      |               |               |
  freeagent9      trader9          agent9
  (Add-on)        (Add-on)         (Add-on)
```

**Business model:** SaaS subscription for core 9 + modular upsells. One core subscription, optional add-ons. White-label rights available for freeagent9, trader9, and x9.

---

## 4. Business Units — Detailed Status

### AiGM (ainflgm.com + aigm.com)

**What it is:** AI-powered sports simulator umbrella company. Three products: AiNFLGM (NFL), AiNBA GM (NBA), AiMLB GM (MLB). 32-team accuracy, contracts, free agency, trades, draft, season simulation, AI suggestions.

**Status:** AiNFLGM live at ainflgm.com. AiNBA GM and AiMLB GM built and deploying. Turborepo monorepo architecture planned for unified codebase (65-70% code reuse across all three simulators, AiNBA estimated 3-5 weeks from merge).

**Tech stack:**
- React 19 + Vite 8 (PWA, service worker, offline caching)
- GitHub Pages deployment (ainflgm.com custom domain)
- Polymarket CORS proxy (Cloudflare Worker route for live odds)
- SEO meta tags, Open Graph, Twitter cards
- FTC compliance footer
- Google Analytics (G-PLW4H1NNF6)
- ntfy.sh visitor notifications

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Google AdSense | CPM display ads ($8-15 CPM for sports) | $1,500-15,000/mo at scale |
| DraftKings/FanDuel affiliates | $25-200 per new depositing user | Primary revenue driver |
| Premium subscription | $4.99/mo or $29.99/yr | 5% conversion of MAU |
| Draft guides | $9.99 per PDF, seasonal | $2,000-10,000 per draft season |
| Sponsorships | Direct brand deals at 10K+ MAU | $500-5,000/mo |

**Revenue projections by traffic:**
| Monthly Active Users | Ad Revenue | Premium (5%) | Affiliates | Total |
|---------------------|-----------|-------------|-----------|-------|
| 1,000 | $50-100 | $0 | $25-50 | $75-150 |
| 5,000 | $300-500 | $500-1,000 | $150-300 | $1,150-2,000 |
| 25,000 | $2,000-3,500 | $3,000-5,000 | $750-1,500 | $6,750-11,000 |
| 100,000 | $8,000-15,000 | $12,000-20,000 | $3,000-6,000 | $26,000-44,000 |

---

### freeagent9

**What it is:** AI personal assistant platform. Deploys through existing channels (iMessage, Telegram, WhatsApp, SMS). Zero setup for end users. No app to download. The assistant shows up in the conversation thread.

**Status:** Active POC. Pilot instance deployed to Kyle Cabezas via iMessage. 40+ conversation memory entries. Real-world usage data being collected.

**Pilot capabilities:**
- Morning briefings (weather, schedule, reminders)
- Shopping list management
- Meal suggestions (dietary preferences, kid-friendly)
- Reminders and follow-ups
- General household Q&A
- Concierge features in development (Uber Eats/DoorDash ordering, Calendly appointments, PayPal Agentic payments)

**Tech stack:**
- jules-server.mjs on port 3470 (LaunchAgent for uptime — installed March 28)
- Claude Haiku 4.5 for responses (cost-optimized)
- SMS via Twilio
- OpenWeather API for briefings
- Persistent user profile: shopping list, meal rotation, reminders, 40-entry conversation memory

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Monthly subscription | $29-99/mo per user | Consumer AI assistant market |
| 9 Suite bundle | Included in core 9 subscription tiers | Upsell / retention feature |
| White-label | Third-party deployment rights | B2B channel |

---

### trader9

**What it is:** Autonomous algorithmic trading agent. Rules-based strategies on equities, ETFs, and prediction markets.

**Status:** Bot complete. Backtesting done. Awaiting Alpaca paper API keys to go live (Owner providing tonight). ETH Bollinger strategy showed +3.51% in 90-day backtest — best performer across 692 parameter sweeps.

**Strategy stack:**
1. **Momentum** — trend following on ETFs (SPY, QQQ, IWM). Buy above 20-day MA, exit below.
2. **Mean Reversion** — buy 2-3% dips on high-quality assets. Exit at mean or +2%.
3. **News Sentiment** — process headlines for market-moving events. Act within 60s.

**Risk rules (non-negotiable):**
- 2% max loss per trade
- 5% daily portfolio loss limit (stop trading for the day)
- 20% max single position
- Kelly criterion for position sizing
- Stop-loss on every trade
- Swing trading only (avoid PDT rules under $25K)

**Phases:**
| Phase | Status | Capital |
|-------|--------|---------|
| Phase 1: Paper trading (30 days) | Pending API keys | $0 |
| Phase 2: Small live trading | Post-paper validation | $100-500 |
| Phase 3: Prediction markets | Owner approval | $50-200 |

---

### x9

**What it is:** Autonomous X/Twitter presence. Openly AI. NFL cap analysis, AI/tech takes, business commentary. Drives traffic to AiGM. Monetizes through affiliate links and X Premium revenue share. Revenue amplifier for all other companies.

**Status:** 10 launch tweets + bio written. Account creation in progress (proton email x9agent@proton.me created and verified). Launching ASAP — Owner noted content is dying on the vine.

**Posting schedule:**
- 9am ET: Main take or thread starter
- 1pm ET: Follow-up, poll, or engagement bait
- 7pm ET: Short hot take or reply farming

**Growth targets:** 100 followers week 1. 1,000 followers month 1.

---

### agent9

**What it is:** AI-native real estate solution. Buy and sell homes without realtors. Removes all friction from the transaction and monetizes end-to-end. Natural extension: AI Underwriter handles the mortgage, agent9 handles the transaction.

**Status:** Consumer site live (agent9.com). Long-term concept. Research phase. No build resources assigned. Owner creating action plan.

**Market thesis:** NAR settlement changed commission structures. Buyers are looking for alternatives. No one has built the AI-native solution. Mortgage (AI Underwriter) + Real Estate (agent9) = complete homebuying stack.

---

### AI Underwriter

**What it is:** RAG-based mortgage guideline chatbot. Loan officers query FHA/Fannie/Freddie/VA/USDA guidelines in plain English, get accurate answers with exact section citations in under 5 seconds.

**Status:** POC complete — CLI tool, multi-agency support, 25 test cases validated, input validation hardened. Anchor customer identified: Rapid Mortgage. No Rapid systems touched. All research from public documentation only.

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

## 5. Command Hub (Dashboard v6)

The Owner's single source of truth is being rebuilt as a full-stack interactive Command Hub. The v5 static dashboard was a prototype. v6 is the real thing.

**Tech stack:** Next.js 15 + Supabase. Phase 1 scaffolded and in progress.

**Core requirements (Owner-mandated):**

| Feature | Description | Phase |
|---------|-------------|-------|
| Branding | Core "9" brand + orbiting modules product architecture widget | Phase 1 |
| Interactive checkboxes | Save in real time, alert 9 immediately with context + priority | Phase 1 |
| Command Prompt | Persistent chat interface — type directly to 9 from dashboard | Phase 2 |
| Daily Briefing widget | Auto-refreshes with wins, blockers, 3 recommended Owner actions | Phase 2 |
| Real-time sync | WebSocket + push notifications, live APIs for MRR, burn, uptime, comms health | Phase 2 |
| Draft Room expansion | Full page, Kanban-style, rich cards, roadmap timeline, "Send to 9 for Analysis" | Phase 2 |
| KPI grid | Active Companies, Burn vs Cap, Runway, Total MRR, North Star Progress | Phase 3 |
| Risk/Escalation Hub | Top-right panel, red/amber/green Owner Action items | Phase 3 |
| Export | One-click PDF/CSV | Phase 3 |

**Phased rollout:**
- Phase 1 (72 hours): Branding fix + functional checkboxes with 9 alerting
- Phase 2 (7 days): Command prompt/chat + real-time APIs + Draft Room expansion
- Phase 3 (14 days): Visual polish, risk hub, export

---

## 6. Active URLs (11 total, March 28, 2026)

| URL | What It Is | Status |
|-----|-----------|--------|
| ainflgm.com | AiNFLGM simulator — flagship product | Live |
| ainflgm.com/dashboard.html | Owner dashboard v5 (static) | Live — being replaced by Command Hub |
| 9enterprises.com | Holding company marketing site | Live |
| agent9.com | agent9 consumer site | Live |
| (3 additional AiGM product URLs) | AiNBA GM, AiMLB GM, AiGM umbrella | Deploying |
| (Cloudflare Worker URL) | Backup QB / CORS proxy / Voice failover | Live |
| (Cloudflare Tunnel URL) | Voice server routing (ephemeral) | Live |
| ainflgm.com/shareable.html | Shareable dashboard (no personal data) | Live |
| ainflgm.com/kyle-response.html | Architecture summary for Kyle Shea | Live |

---

## 7. Brand Identity

**Brand:** Orange and black (Bengals) unified across all 9 Enterprises LLC holdings. Owner-mandated March 28, 2026.

**Logo:** Joe Burrow #9 (Bengals, pointing forward). This photo is the brand identity for 9 Enterprises and 9 personally.

**Color palette:**
| Role | Color | Hex |
|------|-------|-----|
| Primary background | Black / near-black | #0a0a0a or #111111 |
| Primary accent | Bengals orange | #FB4F14 |
| Text | White + light grays | #ffffff |
| Cards/surfaces | Dark grays | #1a1a1a, #222222 |
| Secondary accent | Orange variants for hover/active | — |

**Applies to:** Every site, every page, every product under 9 Enterprises LLC. AiGM, AiNFLGM, AiNBA, AiMLB, freeagent9, trader9, agent9, AI Underwriter, 9enterprises.com, Command Hub, all future products. Orange and black stays on brand.

**AiNFLGM exception:** AiNFLGM.com main site keeps its own robot/NFL theme. The Burrow #9 photo does not appear on AiNFLGM product pages. Clear brand separation between the holding company and the product.

---

## 8. Hub-and-Spoke Scaling Model

9 Enterprises is built on a hub-and-spoke model where shared infrastructure at the center powers an unlimited number of business units at the edges.

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
       +----------+--------+---+---+--------+----------+---------+
       |          |        |       |        |          |         |
    +--+--+   +--+--+  +--+--+ +--+--+  +--+--+   +--+--+   +--+--+
    |AiGM |   |free |  |under| |trade|  | x9  |   |agent|   |drop |
    |     |   |agnt9|  |wrt9 | |  9  |  |     |   |  9  |   |ship |
    +-----+   +-----+  +-----+ +-----+  +-----+   +-----+   +-----+
```

### Marginal Cost Per New Company

| Hub Capability | What It Does | Marginal Cost Per New Company |
|---------------|-------------|-------------------------------|
| OC (comms-hub) | 4-channel communication | ~$0 (same daemon) |
| Headset (voice) | Inbound/outbound voice calls | ~$0.06/min per call |
| Backup QB (cloud worker) | Always-on failover | ~$0 (same worker) |
| The Locker | Credential isolation | $0 |
| Agent Engine | Sub-agent spawning, briefing, QC | Token cost only |
| Terminal Liveness | PID watchdog, session tokens | $0 |
| Cloud Sync | State persistence | ~$0 (KV storage) |
| Draft Room | Concept intake, capture, prioritization | $0 |
| Command Hub | P&L, roadmaps, live metrics | Hosting only |

### The Compounding Effect

```
Product 1 (AiNFLGM):
  Built: comms hub, voice server, cloud worker, agent engine,
  credential vault, deployment pipeline, recovery system,
  dashboard, Draft Room, ETA tracker, freeze watchdog.
  Total infrastructure investment: ~$252/mo + development time.

Product 2 (freeagent9 / pilot):
  Reused: all infrastructure.
  New: jules-server.mjs (~400 lines).
  Incremental cost: ~$10/mo (Twilio SMS).

Product 3 (AI Underwriter):
  Reuses: entire infrastructure stack.
  New: RAG pipeline + guideline ingestion.
  Incremental cost: ~$20/mo (vector storage + API calls).

Product 4 (trader9):
  Reuses: entire infrastructure stack.
  New: trading-bot.mjs + Alpaca integration.
  Incremental cost: ~$0 (Alpaca paper trading is free).

Products 5-7 (x9, agent9, Dropshipping):
  Incremental infrastructure cost approaches zero.
  Only product-specific logic needs building.
```

---

## 9. Revenue Model Summary

**North Star:** $1M ARR within 12 months (by ~March 2027). All businesses built clean, documented, and sellable — zero founder dependency for daily operations.

| Company | Revenue Model | Phase | Monthly Target |
|---------|---------------|-------|----------------|
| AiGM | Affiliates + AdSense + Premium subscriptions | AdSense pending | $50,000 at scale |
| freeagent9 | Subscription per user ($29-99/mo) + white-label | Q2 2026 beta | Per-user recurring |
| trader9 | Trading returns (1-2%/mo on capital) | Pending API keys | Capital-dependent |
| x9 | Affiliates + X Premium + sponsorships | Launching now | Traffic-dependent |
| AI Underwriter | SaaS ($500-2K/mo per lender) | Q2 2026 private beta | Per-lender recurring |
| agent9 | Transaction fee + subscription | 12-18 months | Custom |
| Dropshipping | TBD | Owner writing plan | TBD |
| Core 9 | SaaS subscription + add-on modules | 90 days | Recurring |

---

## 10. Infrastructure Costs and Dependencies

### Monthly Operating Costs

| Service | Purpose | Monthly Cost |
|---------|---------|-------------|
| Anthropic Max plan (20x) | Claude API for all AI operations | ~$200 |
| Twilio | Voice calls + SMS | ~$10 |
| ElevenLabs | Text-to-speech (Dan voice) | ~$22 |
| Cloudflare Workers | Backup QB + CORS proxy | ~$5 |
| Domain/hosting | ainflgm.com, 9enterprises.com, agent9.com, others | ~$20 |
| **Total current** | | **~$257/mo** |

**Planned additions (approved):**
| Service | Purpose | Monthly Cost |
|---------|---------|-------------|
| DigitalOcean VPS | Move voice server off Mac, cloud-native step 1 | ~$6 |
| Buffer or similar | Social scheduling for x9 | ~$15 |
| SEO tooling | AiGM growth | ~$30 |

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
| Supabase | Command Hub backend (pending) | Dashboard offline | Static fallback |

### Credential Inventory (The Locker)

| Credential | Used By | Rotation Status |
|-----------|---------|----------------|
| ANTHROPIC_API_KEY | Voice, pilot, general | Static (rotation planned) |
| ANTHROPIC_API_KEY_TC | OC autonomous responses | Static |
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
| MacBook Pro (Jasson's) | Runs all local processes (OC, Headset, pilot, terminal) | Cloudflare Worker covers Telegram. VPS migration in progress. Freeze watchdog handles Mac hangs. |
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

## 11. New Systems (March 27-28, 2026)

### Draft Room (Intake System)

Replaces "Hopper" and "Draft Prospects" — Owner-renamed March 28, 2026.

**What it is:** Dedicated concept and idea intake queue. Nothing gets lost in Telegram.

**How it works:**
- Every Owner idea or new concept gets tagged and dropped into Draft Room immediately
- Status flow: In Draft Room → Greenlit (active) / Parked (saved for later) / Killed (not viable)
- Draft Room sits outside the Company hierarchy — it is the waiting room before a concept becomes a Company
- Owner sees full Draft Room on Command Hub at all times
- Planned: full Kanban page in Command Hub v6 with rich cards, roadmap timeline, and "Send to 9 for Analysis" button

**Current Draft Room items:**
| Concept | Status |
|---------|--------|
| Dropshipping Company (name TBD) | Owner writing plan |
| Web terminal + remote self-healing (SSH/Tailscale) | Greenlit — research complete |
| Uber Eats/DoorDash ordering (freeagent9 concierge) | Greenlit — in development |
| Appointments/reservations (freeagent9) | Greenlit — 9 writing plan |
| White-label rights for freeagent9, trader9, x9 | Greenlit — confirmed in SOTU |

### ETA Calibration System

Tracked in `docs/eta-tracker.json`.

**Why it exists:** 9's internal time estimates for sub-agent work run 7.5x slower than reality. Agents do not read slowly, context-switch, or take breaks.

**Calibration factor:** 7.5x (validated across multiple data points)

| 9 Estimate | Actual |
|-----------|--------|
| 5 min | ~40 seconds |
| 20 min | ~2.5-3 min |
| 1 hour | ~8 min |
| 4 hours | ~32 min |

All Owner-facing ETA estimates are pre-divided by 7.5. Task tracking records both estimated and actual to continuously refine the factor.

---

## 12. The Naming Scheme

All infrastructure components follow a football/sports naming convention. Product names follow the `lowercase + 9` convention.

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
| Draft Room | Concept intake queue | Idea capture and pipeline management |

### Product Names

| Product | Correct Name | What It Is |
|---------|-------------|-----------|
| ainflgm | ainflgm | NFL simulator — AiGM flagship product |
| AiNBA GM | ainbagm | NBA simulator — AiGM product |
| AiMLB GM | aimlbgm | MLB simulator — AiGM product |
| freeagent9 | freeagent9 | Personal AI assistant platform |
| pilot | pilot | freeagent9 instance #1 (Kyle Cabezas) |
| trader9 | trader9 | Algorithmic trading agent |
| AI Underwriter | underwriter9 | Mortgage guideline RAG chatbot |
| x9 | x9 | Autonomous X/Twitter presence |
| agent9 | agent9 | AI real estate solution + the platform |

**Rule:** Product names never get capitals, spaces, or hyphens. "9 Enterprises LLC" keeps proper formatting in legal contexts only.

---

## 13. Agent Roster (The Front Office)

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

**Spend authority:** $20/task auto-approved. Over $20 = Owner approval required.

---

## 14. Response to Kyle Shea's March 26 Concerns

Kyle called March 26, 2026. 11 minutes. His concerns were the most valuable architectural feedback the project has received. Current status of each:

| # | Concern | Status | Note |
|---|---------|--------|------|
| 1 | No dependency map | Resolved | 561-line dependency map delivered same day, maintained |
| 2 | Autonomous OS control is a security risk | Functional plan | 90-day Docker containerization plan. Current: single-operator dev workstation, intentional. Production: containerized cloud, zero host OS access |
| 3 | Multi-agent coordination overhead | Resolved | Operating model: 80% single-agent tasks, multi-agent only for genuinely parallel independent work |
| 4 | No per-user cost model | Building | Preliminary numbers validated. Full model within 30 days |
| 5 | No SOC 2, SSO, audit logging | 90-day plan | Audit logging (Day 1-15), RBAC (Day 16-30), SSO (Day 31-45), SOC 2 Type I readiness (Day 61-90) |
| 6 | Hardware dependency | In progress | DigitalOcean VPS deployment starting. Cloud-native by Day 75. Freeze watchdog deployed as interim mitigation. |
| 7 | Terminal exposure kills it for normal users | Already resolved | Users never see terminal: AiGM is a website, freeagent9 is SMS, AI Underwriter is a web form, Command Hub is Next.js |
| 8 | 18-24 months to deployable | Partially revised | 90 days for vertical products. Full enterprise platform: 12-18 months (unchanged). This is honest. |
| 9 | AI can't see its own blind spots | Ongoing | Architecture review sessions remain on the table. Kyle's 11-minute call produced more actionable feedback than months of AI-only iteration |
| 10 | Enterprise runs .NET, not Node.js | Planned | AI Underwriter .NET rebuild (C# / ASP.NET Core) planned for Day 46-75 once POC is proven |

**Bottom line:** The vertical products are the near-term revenue play. The platform is a long-term asset. No one is selling agent9 as an enterprise product today — it is the proving ground. The products it creates are the thing.

---

## 15. Rapid Mortgage Boundary

**Nothing has been accessed.** No data, no systems, no credentials, no connections.

All mortgage guideline research (FHA, Fannie Mae, Freddie Mac, VA, USDA) was done from public documentation only. The 5 agency PDFs ingested for AI Underwriter are publicly available at no cost.

Future integration at Rapid Mortgage requires:
1. Kyle Shea's explicit sign-off on every integration point
2. Separate credential management scoped to Rapid
3. Read-only access initially, audited before expansion
4. Container isolation for any mortgage-data-touching agents
5. Full immutable audit trail
6. Compliance review (EU AI Act enforcement August 2, 2026 — relevant if Rapid has EU operations)
7. Kyle's team owning the .NET production rebuild

That conversation is separate and has not started.

---

*Architecture document current as of March 28, 2026.*
*v3.0 — post-SOTU, 7 Companies confirmed, AiGM live, 11 active URLs, Command Hub in progress.*
*Who Dey.*
