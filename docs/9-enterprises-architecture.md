# 9 Enterprises LLC — System Architecture

**Version:** 1.0
**Date:** March 26, 2026
**Classification:** Owner Eyes Only

---

## 1. Full System Architecture

### Layer Model

```
+---------------------------------------------------------------+
|  LAYER 4: OWNER (Jasson Fishback)                             |
|  Strategic direction. Final authority. Communicates via        |
|  Telegram, Voice, iMessage, Email. Non-technical operator.    |
+---------------------------------------------------------------+
|  LAYER 3: 9 (AI Partner / CEO)                                |
|  Claude Opus 4.6 in Claude Code terminal session.             |
|  Orchestrator. Credential vault (The Locker). Spawns and      |
|  monitors all agents. Makes tactical decisions. Handles all   |
|  Owner communication. Never goes dark.                        |
+---------------------------------------------------------------+
|  LAYER 2: FRONT OFFICE (Sub-agents)                           |
|  UNO (#1, Research Lead) + Tee (#2, Engineering Lead)         |
|  + Specialist agents (SCOUT, MONEY, DOC, CANVAS, PRESS, X9)  |
|  + Autonomous agents (trader9, Jules)                         |
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
|   +-- Heartbeat counter + cloud sync (60s)
|   +-- API health probe (every 10 min)
|   +-- Efficiency sweep (every 2h: balance, logs, quotas)
|   +-- Log rotation (24h cycle)
|
+-- Headset: voice-server.mjs (port 3456)
|   +-- Twilio STT -> Claude Haiku -> ElevenLabs Flash TTS
|   +-- 6 caller-specific personality profiles
|   +-- ~1.2-2.1s per exchange
|
+-- cloudflared (tunnel to Headset)
|
+-- Jules: jules-server.mjs (port 3470)
|   +-- Jamie's personal assistant
|   +-- SMS via Twilio, OpenWeather briefings
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
+-- 9 (interactive AI session, Opus 4.6)
+-- Ping loop (60s, self-terminates on parent PID death)
+-- PostToolUse hook (checks /tmp/9-incoming-message.jsonl)
```

### Key Files

```
scripts/comms-hub.mjs       -- OC daemon (~1500 lines)
scripts/voice-server.mjs    -- Headset (~800 lines)
scripts/jules-server.mjs    -- Jules personal assistant
scripts/open-terminal.mjs   -- Training Staff launcher
scripts/trading-bot.mjs     -- Alpaca paper-trading bot
scripts/check-messages.sh   -- PostToolUse hook message checker
scripts/shared-state.json   -- Persistent context (survives crashes, synced to cloud)
cloud-worker/src/worker.js  -- Backup QB (Cloudflare Worker)
SOUL_CODE.md                -- The Charter of 9 (330 lines)
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
                     - State synced via KV (every 60s)
                     - Cron heartbeat watchdog (every 2 min)
```

### Terminal Liveness Detection (4 Layers)

```
Layer 1: PID Tracking
  - Terminal claims with PID on /terminal/claim
  - Watchdog checks PID alive every 30s via kill -0

Layer 2: Self-Terminating Ping Loop
  - Started in terminal, checks parent PID each iteration
  - Dies when Claude Code process dies
  - Calls /terminal/release on exit

Layer 3: Session Token Validation
  - New token generated on each /terminal/claim
  - Orphan pings from dead sessions get 401 rejected

Layer 4: State Cleanup
  - On terminal death: clear PID, token, files
  - Switch to autonomous mode immediately
```

---

## 2. Business Units

### The Franchise (Product Portfolio)

9 Enterprises operates a portfolio of AI-powered products called **The Franchise**. Each product tests a different dimension of the thesis that AI can be a genuine business partner. The shared infrastructure (voice, comms, agent orchestration, credential management) makes each new product cheaper to build than the last.

---

### AiNFL GM (ainflgm.com)

**What it is:** AI-powered NFL offseason simulator. 32 teams, accurate rosters and contracts, free agency, trades, mock draft, season simulation, AI-powered suggestions.

**Status:** Live at ainflgm.com. 40+ users from a single organic X post. Pre-revenue.

**Tech stack:**
- React 19 + Vite 8 (PWA, service worker, offline caching)
- GitHub Pages deployment (ainflgm.com custom domain)
- Polymarket CORS proxy (Cloudflare Worker route for live odds)
- SEO meta tags, Open Graph, Twitter cards deployed
- FTC compliance footer deployed (required for affiliate eligibility)

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Google AdSense | CPM display ads ($8-15 CPM for sports) | $1,500-15,000/mo at scale |
| DraftKings/FanDuel affiliates | $25-200 per new depositing user | Primary revenue driver |
| Premium subscription | $4.99/mo or $29.99/yr | 5% conversion of MAU |
| Draft guides | $9.99 per PDF, seasonal | $2,000-10,000 per draft season |
| Sponsorships | Direct brand deals at 10K+ MAU | $500-5,000/mo |
| API licensing | Tiered API access starting $49/mo | Long-term play |
| White-label | $99-299/mo per team-branded instance | Long-term play |

**Revenue target:** $50K/month at affiliate scale.

---

### Free Agents

**What it is:** Platform for deploying personal AI assistants through existing channels (iMessage, Telegram, WhatsApp). Zero setup for end users. No app to download. The assistant shows up in the conversation thread.

**Status:** Phase 1 live. Jules (Free Agent #1) deployed to Jamie Bryant via iMessage.

**Jules capabilities:**
- Morning briefings (weather, schedule, reminders)
- Shopping list management
- Meal suggestions (dietary preferences, kid-friendly)
- Reminders and follow-ups
- General household Q&A

**Tech stack:**
- jules-server.mjs on port 3470
- Claude Haiku 4.5 for responses
- SMS via Twilio
- OpenWeather API for briefings

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Monthly subscription | $29-99/mo per user | Consumer AI assistant market |
| Operator-managed model | Agent operators deploy for clients | Scalable via templates |

**Hypothesis:** Most households would benefit from a dedicated AI assistant but would never set one up. Free Agents removes the friction entirely. Jules is the proof of concept.

---

### trader9

**What it is:** Autonomous algorithmic trading agent. Rules-based strategies on equities and ETFs, with planned expansion to prediction markets.

**Status:** Phase 1 (Paper Trading). Running on Alpaca Markets.

**Strategy stack:**
1. **Momentum** -- trend following on ETFs (SPY, QQQ, IWM). Buy above 20-day MA, exit below.
2. **Mean Reversion** -- buy 2-3% dips on high-quality assets. Exit at mean or +2%.
3. **News Sentiment** -- process headlines for market-moving events. Act within 60s.

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
| Phase 1: Paper trading | 30 days of simulation data | $0 |
| Phase 2: Small live trading | Owner approval per session | $100-500 |
| Phase 3: Prediction markets | Owner approval | $50-200 (Polymarket, Kalshi) |

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Trading returns | 1-2% monthly on capital | Compounding growth |
| Prediction market edge | AI processes data faster than humans | Event-based returns |

**Tech stack:**
- scripts/trading-bot.mjs (not persistent service, runs on demand)
- Alpaca Markets API (commission-free, paper trading)
- Alpaca MCP server for execution

---

### agent9 (The 9 Enterprise Platform)

**What it is:** The core AI partner platform itself, packaged as a deployable enterprise solution. The infrastructure that powers everything -- 4-channel comms, agent orchestration, credential isolation, terminal liveness detection, voice integration.

**Status:** Running in production for Jasson. Not yet packaged for external deployment.

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Bespoke deployments | Custom AI partner for businesses | Custom pricing |
| Consulting | Architecture review, deployment guidance | Hourly/project |

**What makes it unique:**
- Relay/Autonomous mode switching (no one else does this)
- Voice calls with caller-specific personality profiles
- Terminal recovery with PID watchdog + 3x verification
- Hardware ownership (Owner-granted standing authority)
- Partnership model (Soul Code defines relationship, not just a system prompt)

---

### AI Underwriting Team (underwriter9)

**What it is:** RAG-based mortgage guideline chatbot. Loan officers query FHA/Fannie/Freddie guidelines in plain English, get accurate answers with exact section citations in under 5 seconds.

**Status:** POC built (CLI tool, FHA handbook citations working). Anchor customer identified (Rapid Mortgage).

**Tech stack:**
- Claude API (200K context window) as reasoning layer
- Agency PDFs ingested, chunked, embedded via vector search
- Web or Telegram interface for LO access
- Pure RAG architecture (no fine-tuning, updateable on guideline changes)

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| SaaS subscription | $500-2,000/mo per lender | Mid-market mortgage lenders |
| Per-query pricing | Alternative to subscription | Usage-based option |

**Competitive gap:** Enterprise tools (Tavant, ICE, LoanLogics) cost $200K+ and take 6 months to deploy. Mid-size lenders with 20-50 LOs get nothing. 9's solution is 100x cheaper.

---

### X9

**What it is:** Autonomous X/Twitter presence. Openly AI. NFL cap analysis, AI/tech takes, business commentary. Drives traffic to ainflgm.com. Monetizes through affiliate links and X Premium revenue share.

**Status:** Planned. Content calendar drafted (30 days). Identity and voice defined.

**Posting schedule:**
- 9am ET: Main take or thread starter
- 1pm ET: Follow-up, poll, or engagement bait
- 7pm ET: Short hot take or reply farming

**Revenue model:**
| Stream | Model | Target |
|--------|-------|--------|
| Affiliate links | DraftKings/FanDuel in NFL content | Post-traction |
| AiNFLGM.com traffic | Cross-promotion in every thread | Ongoing |
| X Premium revenue share | Ad revenue share after threshold | Post-growth |
| Sponsored posts | Authentic-fit brand deals only | Post-traction |

**Growth targets:** 100 followers week 1. 1,000 followers month 1.

---

## 3. Revenue Model Summary

### Revenue by Business Unit

| Business Unit | Revenue Model | Timeline | Monthly Target |
|--------------|---------------|----------|----------------|
| AiNFL GM | Affiliates + AdSense + Premium + Guides | Active monetization | $50,000 |
| Free Agents | Subscription per user ($29-99/mo) | Q2 2026 beta | Per-user recurring |
| trader9 | Trading returns (1-2%/mo on capital) | Phase 1 paper now | Capital-dependent |
| agent9 (Platform) | Bespoke enterprise deployments | Future | Custom |
| AI Underwriting Team | SaaS ($500-2K/mo/lender) | Q2 2026 private beta | Per-lender recurring |
| X9 | Affiliates + X Premium + Sponsors | Post-traction | Traffic-dependent |

### AiNFL GM Revenue Projections by Traffic

| Monthly Active Users | Ad Revenue | Premium (5%) | Affiliates | Guides | Total |
|---------------------|-----------|-------------|-----------|--------|-------|
| 1,000 | $50-100 | $0 | $25-50 | $0 | $75-150 |
| 5,000 | $300-500 | $500-1,000 | $150-300 | $200 | $1,150-2,000 |
| 25,000 | $2,000-3,500 | $3,000-5,000 | $750-1,500 | $1,000 | $6,750-11,000 |
| 100,000 | $8,000-15,000 | $12,000-20,000 | $3,000-6,000 | $3,000 | $26,000-44,000 |

---

## 4. Hub-and-Spoke Scaling Model

### The Architecture Advantage

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
          +----------+----------+--+--+----------+----------+
          |          |          |     |          |          |
       +--+--+   +--+--+   +--+--+  |    +-----+-+   +---+---+
       |AiNFL|   |Free |   |Under|  |    |trader9|   |  X9   |
       | GM  |   |Agnts|   |write|  |    +-------+   +-------+
       +-----+   +-----+   +-----+  |
                                     |
                              +------+------+
                              |  Future     |
                              |  Products   |
                              |  (20+)      |
                              +-------------+
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
| LaunchAgents | Auto-restart on crash | $0 |

### Scaling to 20+ Businesses

The hub-and-spoke model means adding a new business unit requires only:

1. **Define the product** (what it does, who it serves, how it monetizes)
2. **Create the agent config** (`.claude/agents/newproduct.md`)
3. **Build the product** (agents do the work via Tee)
4. **Connect to shared infra** (comms, voice, cloud already exist)

**No new infrastructure needed.** The comms hub, voice server, cloud worker, credential vault, and agent engine all serve the new product automatically. This is why the first product is the most expensive and every subsequent product gets cheaper.

### The Compounding Effect

```
Product 1 (AiNFL GM):
  Built comms hub, voice server, cloud worker, agent engine,
  credential vault, deployment pipeline, recovery system.
  Total infrastructure investment: ~$252/mo + development time.

Product 2 (Free Agents / Jules):
  Reused comms hub, voice server, cloud worker, credential vault.
  New: jules-server.mjs (one script).
  Incremental cost: ~$10/mo (Twilio SMS for Jules).

Product 3 (AI Underwriter):
  Reuses entire infrastructure stack.
  New: RAG pipeline + guideline ingestion.
  Incremental cost: ~$20/mo (vector storage + API calls).

Product 4 (trader9):
  Reuses entire infrastructure stack.
  New: trading-bot.mjs + Alpaca integration.
  Incremental cost: ~$0 (Alpaca is free for paper trading).

Product N:
  Incremental cost approaches zero for infrastructure.
  Only product-specific logic needs building.
```

### Scaling Constraints

| Constraint | Current Limit | Solution |
|-----------|--------------|---------|
| Mac hardware dependency | Single MacBook Pro | Hybrid VPS (Hetzner/DigitalOcean) for always-on compute |
| Anthropic API rate limits | Per-key throttling | Multiple API keys, model tiering (Haiku for volume) |
| Agent context windows | 200K tokens per session | Task scoping, context summarization |
| Claude Code terminal | Single active session | Agent delegation model (9 stays on comms) |
| Token burn on multi-agent | 15x standard chat | Model tiering: Haiku for workers, Sonnet for leads, Opus for 9 |

---

## 5. Infrastructure Costs and Dependencies

### Monthly Operating Costs

| Service | Purpose | Monthly Cost |
|---------|---------|-------------|
| Anthropic Max plan (20x) | Claude API for all AI operations | ~$200 |
| Twilio | Voice calls + SMS | ~$10 |
| ElevenLabs | Text-to-speech (Dan voice) | ~$22 |
| Cloudflare Workers | Backup QB + CORS proxy | ~$5 |
| Domain/hosting | ainflgm.com, get9.ai | ~$15 |
| **Total** | | **~$252/mo** |

### Third-Party Service Dependencies

| Service | What It Powers | Failure Impact | Failover |
|---------|---------------|----------------|----------|
| Anthropic API | All AI reasoning (9, OC, Headset, Jules) | Total AI capability loss | API health probe every 10min, alerts on all channels |
| Telegram Bot API | Primary Owner communication | Lose primary comms | iMessage, Email, SMS cascade |
| Twilio | Voice calls + Jules SMS | Lose voice + Jules | Text-only fallback |
| ElevenLabs | Voice TTS | Lose natural voice | Twilio native TTS fallback |
| Cloudflare | Cloud worker + tunnel + CORS proxy | Lose cloud failover + voice routing | Mac-only mode, direct tunnel restart |
| GitHub Pages | ainflgm.com hosting | Site down | Static site, can redeploy anywhere |
| Apple iMessage (FDA) | Backup comms channel | Lose iMessage | Telegram + Email still work |

### Credential Inventory (The Locker)

| Credential | Used By | Rotation Status |
|-----------|---------|----------------|
| ANTHROPIC_API_KEY | Voice, Jules, general | Static (gap) |
| ANTHROPIC_API_KEY_TC | OC autonomous responses | Static (gap) |
| TELEGRAM_BOT_TOKEN | OC Telegram polling | Static |
| TELEGRAM_CHAT_ID | Jasson's chat | Fixed |
| ELEVENLABS_API_KEY | Headset TTS | Static |
| ELEVENLABS_VOICE_ID | Dan voice profile | Fixed |
| TWILIO_ACCOUNT_SID | Voice + SMS | Static |
| TWILIO_AUTH_TOKEN | Voice + SMS | Static |
| TWILIO_PHONE_NUMBER | (513) 957-3283 | Fixed |
| TUNNEL_URL | Cloudflare tunnel | Rotates on restart |

### Hardware Dependencies

| Hardware | Role | Backup Plan |
|---------|------|-------------|
| MacBook Pro (Jasson's) | Runs all local processes (OC, Headset, Jules, terminal) | Cloudflare Worker covers Telegram. Hybrid VPS planned. |
| Jasson's iPhone | Primary communication device (Telegram, iMessage) | Email fallback |

### Known Infrastructure Gaps

| Gap | Impact | Status |
|-----|--------|--------|
| OC API (port 3457) no auth | Any local process can impersonate 9 | Open |
| Static .env keys | No rotation mechanism | Open |
| No container isolation | Agents run on bare macOS | Open |
| Cloud KV sync error 1101 | Backup QB has stale context | Open |
| Voice latency 1.7s | Above premium threshold (target: sub-500ms) | Open |
| Single Mac dependency | No compute if Mac is offline | Hybrid VPS planned |
| No mobile app | AiNFL GM web-only | Future (React Native) |

---

## 6. The Naming Scheme

All infrastructure components follow a football/sports naming convention:

| Name | Real Component | Role |
|------|---------------|------|
| 9 | Claude Opus 4.6 in Claude Code | AI Partner, Orchestrator, CEO |
| OC | comms-hub.mjs | Offensive Coordinator -- routes all communication |
| The Headset | voice-server.mjs | Voice system -- Twilio + ElevenLabs |
| Backup QB | Cloudflare Worker | Cloud failover when Mac is down |
| Training Staff | open-terminal.mjs LaunchAgent | Session recovery system |
| Front Office | Sub-agent teams | UNO + Tee + their workers |
| The Locker | .env credential file | Vault -- managed by 9, never exposed |
| GamePlan | Strategic planning layer | Session state, project roadmaps |
| The Franchise | Product portfolio | All business units under 9 Enterprises |

---

*Architecture document current as of March 26, 2026.*
*Who Dey.*
