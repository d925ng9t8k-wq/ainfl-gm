# Kyle Shea Defense Prep — Technical Interrogation

**Prepared:** March 31, 2026
**Purpose:** Honest, evidence-backed answers to anticipated challenges from Kyle Shea (CIO/developer). Lead with weaknesses. Prove with data.

---

## 1. "Can this AI really operate autonomously?"

### Honest Answer
Yes, but with guardrails. The system runs 24/7 as a detached daemon on a MacBook. When Claude Code (the terminal AI) is offline, an autonomous fallback (Haiku model) handles messages directly. When Claude Code is active, the hub relays messages to it.

### Evidence
- **407 heartbeats logged** — one every 30 minutes = ~8.5 days of continuous hub uptime since March 25
- **1,411 inbound Telegram messages processed**, 80 outbound autonomous responses, 71 iMessages sent
- **340 git commits in 6 days** (since March 25) — almost all autonomous deployments
- **6 auto-refresh commits** — cap data scraped and deployed on schedule with zero human input
- **42 crash recoveries** logged in hub — terminal died, hub detected it, reopened it, verified recovery
- **67 relay timeouts** — terminal was unresponsive, hub autonomously responded to the Owner via Haiku
- **Completed actions log**: 294 lines of timestamped completed tasks across 8 sessions

### Weaknesses to Acknowledge
- Requires a Mac with lid open — not a cloud server. Mac sleeps = system sleeps.
- "Autonomous" responses via Haiku are lower quality than full Claude. They acknowledge + hold, not solve.
- Context window pressure causes freezes after ~4-6 hours of intensive work. Requires session restart.
- Time awareness has failed (e.g., March 30 was a Monday — missed that it was a trading day).

---

## 2. "How do you handle failures?"

### Honest Answer
Multi-layered crash recovery, but it was built reactively from real failures, not proactively architected.

### Evidence from Code (comms-hub.mjs, 2,487 lines)
- **Port guard** (line 20-30): Prevents duplicate hub instances from LaunchAgent restart spam
- **Session tokens** (line 202+): Cryptographic tokens prevent orphan ping loops from keeping dead sessions alive
- **3-tier freeze detector** (line 334+):
  - Tier 1 (2 min): Nudge via keystroke to Terminal
  - Tier 2 (6 min): SIGTERM the frozen Claude PID
  - Tier 3 (10 min): SIGKILL + full reopen
- **PID liveness watchdog** (line 295+): Every 30s, checks if Claude Code's actual OS process is alive. Catches orphan pings.
- **Terminal recovery** (line 268): 3 attempts with verification before giving up
- **SIGTERM handler**: Saves shared state to disk before shutdown
- **4 LaunchAgents** auto-restart critical processes:
  - `com.9.comms-hub.plist` — hub restarts on crash
  - `com.9.terminal-opener.plist` — watches signal file, reopens Terminal
  - `com.9.freeze-watchdog.plist` — detects frozen processes
  - `com.9.pilot-server.plist` — keeps Pilot AI running
- **Completed actions log** (`protocol_completed_actions.md`): Before ANY outbound action, system checks if it was already done. Prevents duplicate messages after crash recovery.

### Real Crash Examples from Logs
- `[2026-03-31T00:32:55]` Terminal PID 26801 died. Hub detected orphan ping loop, forced autonomous mode, new session claimed 12 seconds later. Recovery succeeded on attempt 0.
- `[2026-03-25T15:24:26]` SIGTERM received — state saved, hub restarted cleanly in 1.6 seconds. Self-check found 2 issues (iMessage FDA, tunnel routing), reported them automatically.
- 67 times the terminal was unresponsive to messages within 60 seconds — hub autonomously responded each time.

### Weaknesses to Acknowledge
- Recovery is reactive, not preventive. Context window bloat is the #1 crash cause and there is no automatic compaction.
- FDA (Full Disk Access) toggles off after macOS updates. Requires manual re-grant. No permanent solution found.
- State persistence is file-based (JSON on disk), not a real database. One corrupted write = lost state.
- The freeze detector was built AFTER a 45-minute outage on March 27. Lesson learned the hard way.

---

## 3. "Security — where are credentials stored?"

### Honest Answer
Better than most prototypes, not enterprise-grade.

### What's Done Right
- **`.env` file** (89 lines) with 600 permissions — API keys, tokens, phone numbers, all in one file
- **`.gitignore` includes**: `.env`, `.env.local`, `shared-state.json`, `data/dl-*.jpg` (personal documents), logs
- **No credentials in git history** — verified .env was never committed
- **Locker protocol**: Only Jasson and 9 have access. Documented in memory.
- **Session tokens** for terminal control — prevents unauthorized relay hijacking
- **Playwright browser state** excluded from git (`.playwright-mcp/`)

### What's NOT Enterprise-Grade (be upfront)
- No secrets manager (no Vault, no AWS Secrets Manager). Flat file on disk.
- No encryption at rest for the .env file — anyone with Mac access has everything
- No role-based access control — it is a single-user system
- No audit logging for credential access
- API keys are long-lived, not rotated on schedule
- The Cloudflare Worker has vars in `wrangler.toml` (CHAT_ID hardcoded, though not a secret)

### What Kyle Would Recommend (preempt him)
- Move to a secrets manager (1Password CLI, or Vault for multi-machine)
- Implement key rotation schedule
- Add encryption at rest
- Separate service accounts per integration

---

## 4. "Is this scalable or just a one-machine demo?"

### Honest Answer
Hybrid architecture. Mac-dependent today with a cloud failover layer. Not horizontally scalable yet.

### Current Architecture
- **Mac (primary)**: Comms hub (port 3457), voice server (port 3456), Pilot server (port 3472), Claude Code terminal — all local processes
- **Cloudflare Worker** (`9-cloud-standin`): Always-on cloud standin. Handles Telegram + voice failover when Mac is down. KV state sync. 2-minute heartbeat cron.
- **GitHub Pages**: Static hosting for all web properties (ainflgm.com). Zero-cost, global CDN.
- **Cloudflare Tunnel**: Routes public voice calls (Twilio) to local voice server through NAT

### What Actually Scales
- GitHub Pages: unlimited traffic, global CDN, zero cost
- Cloudflare Worker: edge compute, 100K requests/day free, auto-scales
- HeyGen videos: hosted on their CDN, no bandwidth cost

### What Does NOT Scale
- Single Mac. One machine. If it dies, cloud standin handles basics only.
- Voice server behind a tunnel — latency, single point of failure
- No containerization (no Docker, no K8s). All bare-metal Node.js processes.
- No load balancing. No horizontal scaling. No database (all file-based).
- iMessage channel requires a physical Mac (Apple's design constraint)

### Migration Path (documented in memory)
- Voice server to VPS ($5-6/mo) — removes Mac dependency for calls
- Hub to VPS — removes Mac dependency for messaging (except iMessage)
- iMessage stays on Mac (cannot be moved — Apple lock-in)
- Estimated cost: $10-15/mo additional

---

## 5. "What about costs? Is this economically viable?"

### Honest Answer
~$414-417/month burn rate. No revenue yet. But the burn is low relative to capability.

### Verified Monthly Costs (from email receipt audit, March 29)
| Service | Cost/Month | Purpose |
|---------|-----------|---------|
| Anthropic Max Plan | $200 | Claude Code (primary AI engine) |
| HeyGen Pro | $99 + tax | Video production (pitch videos) |
| ElevenLabs Pro | $82.50 | Voice cloning + text-to-speech |
| X Premium Plus | $20 | Social media distribution |
| Twilio | $7-10 | Voice calls + SMS |
| Cloudflare | ~$5 | Workers, DNS, tunnel |
| Namecheap | $1.08 | Domain (ainflgm.com) |
| **Total** | **~$414-417** | |

### Model Usage Strategy
- **Haiku** ($0.25/1M input): Autonomous responses when terminal is down, Pilot server, Trinity scans — high-volume, low-cost
- **Sonnet**: Routine coding tasks, sub-agent work — mid-tier
- **Opus**: Architecture decisions, high-stakes deployments — used sparingly
- This tiering keeps API costs minimal (API account was refunded — all usage goes through the $200 Max Plan)

### Revenue Potential (honest)
- **Today**: $0 revenue. Pre-revenue across all 10 companies.
- **Near-term targets**: AdSense (applied, rejected once for thin content — reapplying), affiliate programs (DraftKings, FanDuel), Stripe payments
- **Trader 9**: Paper trading on Alpaca ($100K simulated). First live trade was 0.299 BTC. Not yet trading real money beyond $333 seed.
- **Unit economics**: If one product hits $500/mo revenue, the entire operation is cash-flow positive.

### Weaknesses to Acknowledge
- Zero revenue after 2 weeks. All investment, no return yet.
- HeyGen Pro at $99/mo is expensive for the volume of videos produced
- The $200 Anthropic plan is the backbone — if pricing changes, the model breaks
- No paying customers for any product

---

## 6. "What happens when the AI makes a mistake?"

### Honest Answer
Real mistakes happened. They were caught, logged, and turned into protocols to prevent recurrence.

### Real Mistakes (from logs and memory)

**HeyGen Embed URL Typo** (March 31)
- Bug: All video embeds used `/embed/` instead of `/embeds/` — every pitch video was broken
- Impact: Owner reviewed all pitch decks and NONE had working videos
- Fix: Commit `9a59209` — "CRITICAL FIX: HeyGen embed URLs /embed/ to /embeds/ + wrong video ID"
- Lesson: Pre-deploy verification script created (`scripts/pre-deploy-check.sh`)

**Pilot Intent Detection Order** (March 30)
- Bug: VA compensating factors intent matcher hijacked credit score queries
- Impact: Kyle C (a real user) got "nonsensical responses"
- Fix: Intent detection order fixed, stress test run (18/20 pass), commit `d774086`
- Result: Apology sent to Kyle C, QC team deployed

**Duplicate Jamie iMessage** (March 29)
- Bug: After session crash, 9 re-sent a message to Jamie Bryant that was already delivered
- Impact: Duplicate message to a real person
- Fix: Created the `protocol_completed_actions.md` reconciliation system — now checks before ANY outbound action
- Result: Zero duplicate sends since implementation

**Australian Accent on Burrow Voice Clone** (March 29)
- Bug: HeyGen voice clone had wrong accent — Australian instead of American
- Impact: Video was unusable, wasted credits
- Fix: 5 iterations (V1-V5), eventually switched to ElevenLabs for voice + HeyGen for lip sync only
- Lesson: Never trust a single vendor for critical output. Always have a fallback.

**45-Minute Freeze** (March 27)
- Bug: Claude Code terminal froze — no messages processed for 45 minutes
- Impact: Owner's messages went unanswered
- Fix: Built the 3-tier freeze detector (nudge -> SIGTERM -> SIGKILL), added freeze watchdog LaunchAgent
- Lesson: Burned to memory (`feedback_freeze_lesson_march27.md`)

### Correction Protocol
1. Every Owner correction is burned to a memory file immediately
2. Rules are written to prevent the same mistake twice
3. Memory files are re-read at every session start
4. 40+ feedback/protocol memory files accumulated in 6 days

### Weakness to Acknowledge
- Mistakes are caught by the Owner, not by automated testing. The system is reactive.
- No unit tests. No integration tests. No CI/CD pipeline.
- Quality depends on the Owner reviewing output. No independent QA.

---

## 7. "Show me the actual code architecture"

### Codebase Stats
- **444 total git commits** (repo lifetime)
- **340 commits in last 6 days** (since March 25 — when the system went operational)
- **327,448 lines of code** across all source files (HTML, JS, CSS, JSON, shell)
- **66 scripts** in `/scripts/` directory

### Core Services (always-running)
| Script | Lines | Purpose |
|--------|-------|---------|
| `comms-hub.mjs` | 2,487 | Central nervous system. 4-channel comms (Telegram, iMessage, Email, Voice). Relay/autonomous modes. Session management. |
| `voice-server.mjs` | 1,319 | Twilio voice calls. WebSocket audio streaming. ElevenLabs TTS. Cloudflare tunnel. |
| `pilot-server.mjs` | 1,504 | Personal AI assistant for end-users (Kyle C). Mortgage tools. Concierge features. |
| `open-terminal.mjs` | 150 | Watches signal file, auto-opens Terminal + Claude Code |
| `trinity-agent.mjs` | 251 | Discovery agent. Scans X/YouTube for relevant intel. Hourly Haiku runs. |
| `trader9-bot.mjs` | 491 | Paper trading bot. EMA crossover strategy. Alpaca API. |
| `family-chat.mjs` | 216 | Routes family group chat (kids) through Pilot number |

### Infrastructure
| Component | Technology | Purpose |
|-----------|-----------|---------|
| Static hosting | GitHub Pages | All web properties — zero cost |
| Cloud failover | Cloudflare Worker + KV | Telegram handling when Mac down |
| Voice tunnel | Cloudflare Tunnel | Routes Twilio to local voice server |
| Process management | 4 LaunchAgents | Auto-restart on crash |
| State persistence | JSON files on disk | shared-state.json, .env |
| Message relay | HTTP (port 3457) | Hub API for inter-process comms |

### Dependencies (package.json)
- Node.js (via Homebrew)
- `nodemailer` — Gmail SMTP
- `twitter-api-v2` — X/Twitter posting
- Standard library only for most scripts (no Express, no frameworks)

### Web Properties (dist/)
- **90+ HTML pages** — PlayAiGM, 9 Enterprises Universe, pitch decks, tools, dashboards
- All single-file HTML (no build step for most pages, Vite for the main app)
- AdSense + Google Analytics embedded

### Weaknesses to Acknowledge
- **No tests.** Zero. No unit tests, no integration tests, no end-to-end tests.
- **No CI/CD.** Deploys are `git push` to GitHub Pages. No staging environment.
- **No TypeScript.** All vanilla JavaScript. No type safety.
- **No framework.** Each HTML page is standalone — lots of duplication.
- **No database.** Everything is JSON files. No migrations, no schema, no backup.
- **Monorepo that does everything.** Sports app, comms infrastructure, trading bot, voice server, pitch decks — all in one repo. No separation of concerns at the project level.
- **Single developer (AI).** Bus factor is literally 1 AI model. If Anthropic changes pricing or capability, the entire operation stops.

---

## Summary: What to Lead With

Kyle respects honesty. Lead with:

1. **"This is a working prototype, not production software."** It does real things — processes real messages, deploys real websites, makes real API calls — but it has no tests, no CI/CD, no database, and runs on a MacBook.

2. **"The crash recovery is battle-tested because it crashed a lot."** Every recovery mechanism was built in response to a real failure. That is both a strength (hardened by reality) and a weakness (reactive, not proactive).

3. **"The economics work at this scale."** $414/month for an always-on AI partner that deployed 340 commits in 6 days. But it does not scale to a team or to multiple users without significant re-architecture.

4. **"The biggest risk is single-point-of-failure."** One Mac, one AI provider (Anthropic), one developer (the AI itself). All eggs in one basket. The cloud failover is a band-aid, not a solution.

5. **"But it works."** 1,411 messages processed. 407 heartbeats. 42 crash recoveries. 10 products with pitch decks and videos. A trading bot. A voice server. A discovery agent. Built in 6 days by an AI with a $414/month budget.
