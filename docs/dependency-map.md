# 9 Enterprises — Full System Dependency Map

**Generated:** 2026-03-26
**Author:** Tee (Engineering Team Lead)
**Purpose:** Complete inventory for architecture review, security audit, and failover planning.

---

## 1. Infrastructure Components

### Running Processes

| Process | Script | Port | Managed By | Purpose |
|---|---|---|---|---|
| comms-hub | `scripts/comms-hub.mjs` | 3457 | LaunchAgent + nohup | Central message router. All 4 channels. Terminal relay + autonomous OC mode. |
| voice-server | `scripts/voice-server.mjs` | 3456 | Spawned by comms-hub | Twilio voice webhook. ElevenLabs TTS. Captain Claude voice persona. |
| jules-server | `scripts/jules-server.mjs` | 3470 | Manual / not in LaunchAgent | Jamie Bryant personal assistant. SMS via Twilio. OpenWeather briefings. |
| open-terminal | `scripts/open-terminal.mjs` | none | LaunchAgent | Watches `/tmp/9-open-terminal`. Opens Terminal + Claude Code on signal. |
| cloud-worker | `cloud-worker/src/worker.js` | N/A (Cloudflare Edge) | Cloudflare Workers + Wrangler | Always-on cloud backup. Telegram failover when Mac is down. |
| cloudflared | system binary | none | Spawned by comms-hub | Exposes voice-server port 3456 to public internet via trycloudflare.com tunnel. |
| trading-bot | `scripts/trading-bot.mjs` | none | Manual | Alpaca paper-trading bot. SPY momentum strategy. NOT a persistent service. |

### LaunchAgents (auto-start on Mac login)

| Label | Plist | Restarts on crash |
|---|---|---|
| com.9.comms-hub | `~/Library/LaunchAgents/com.9.comms-hub.plist` | Yes (KeepAlive: true) |
| com.9.terminal-opener | `~/Library/LaunchAgents/com.9.terminal-opener.plist` | Yes (KeepAlive: true) |

Both LaunchAgents run as the `jassonfishback` user with a 10-second throttle interval to prevent restart spam.

### Ports in Use

| Port | Service | Exposed To |
|---|---|---|
| 3456 | voice-server | Internet via cloudflared tunnel (trycloudflare.com) |
| 3457 | comms-hub HTTP API | Localhost only |
| 3470 | jules-server | Localhost only (Twilio routes via public URL, not set up yet) |

### AiNFL GM Frontend (ainflgm.com)

- **Framework:** React 19 + Vite 8
- **PWA:** vite-plugin-pwa (service worker, installable, offline icon caching)
- **Build output:** `dist/` directory
- **Deployment:** GitHub Pages (ainflgm.com custom domain)
- **Config:** `vite.config.js`, `index.html`

---

## 2. Third-Party APIs and Services

### Anthropic / Claude API

| Detail | Value |
|---|---|
| Endpoint | `https://api.anthropic.com/v1/messages` |
| Models used | `claude-haiku-4-5-20251001` (fast path — OC, Jules, voice default) |
| | `claude-sonnet-4-20250514` (smart path — voice for Kyle/Mark) |
| | `claude-sonnet-4-6` (Doorman, API health probe) |
| API key used by hub | `ANTHROPIC_API_KEY_TC` (dedicated terminal/cloud key) |
| API key used by voice + Jules | `ANTHROPIC_API_KEY` (primary key) |
| Cloud worker key | Separate key stored in Cloudflare Worker env vars |
| Health probe | Every 10 minutes. Consecutive failures trigger iMessage + email + Telegram alert. |
| Max tokens | 2048 (cloud OC), 300 (Jules), 5 (health probe) |

### Telegram Bot API

| Detail | Value |
|---|---|
| Endpoint | `https://api.telegram.org/bot{TOKEN}/...` |
| Methods used | `getUpdates` (long polling from Mac), `sendMessage`, `sendChatAction` |
| Auth | Bot token (`TELEGRAM_BOT_TOKEN`) |
| Chat ID | `TELEGRAM_CHAT_ID` (Jasson's personal chat, hardcoded fallback `8784022142`) |
| Webhook mode | Cloud worker sets webhook when Mac is down; Mac clears it on reclaim |
| Polling interval | Long polling with 30-second timeout, 0-second offset, immediate retry on error |

### Twilio

| Detail | Value |
|---|---|
| Account | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` |
| From number | `TWILIO_FROM_NUMBER` (primary voice/SMS number) |
| Backup numbers | `TWILIO_BACKUP_1`, `TWILIO_BACKUP_2`, `TWILIO_BACKUP_3` |
| Used for | Inbound voice calls (webhook to voice-server), outbound SMS (Jules), Twilio-signed webhook validation |
| Voice webhook | Points to `TUNNEL_URL/voice` — updated automatically when tunnel restarts |
| Webhook validation | HMAC-SHA1 signature check (`X-Twilio-Signature` header) in voice-server |
| Failover | If tunnel is unreachable, Twilio falls back to cloud worker URL |
| Balance monitoring | Hub checks balance every 30 minutes. Alerts at <$5, iMessage at <$2. |

### ElevenLabs

| Detail | Value |
|---|---|
| API key | `ELEVENLABS_API_KEY` |
| Voice ID | `ELEVENLABS_VOICE_ID` (default: `4XMC8Vdi6YFsmti2NFdp` — "Dan - Business, Professional") |
| Model | `eleven_multilingual_v2` |
| Endpoint | `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` |
| Used for | TTS audio generation during voice calls. Audio cached in `/tmp/voice_audio/`. |
| Keep-alive | Reusable HTTPS agent (5 max sockets) to minimize per-request latency |

### Cloudflare

| Component | Detail |
|---|---|
| Workers | `9-cloud-standin` worker deployed via Wrangler. ID visible in `wrangler.toml`. |
| KV namespace | Binding `STATE`, ID `beaed39708284704b322b20b5190e22d` — stores heartbeat, shared state, conversation history |
| Cron trigger | `*/2 * * * *` — checks Mac heartbeat every 2 minutes, switches Telegram webhook accordingly |
| Tunnel | `cloudflared` binary creates ephemeral `*.trycloudflare.com` URLs for voice-server |
| DNS | ainflgm.com pointed to GitHub Pages |
| Auth | `CLOUDFLARE_API_TOKEN` — used by hub to update Twilio webhook URLs and by Wrangler for deploy |
| Shared secret | `CLOUD_SECRET` header — prevents unauthorized posts to `/heartbeat` endpoint |
| Cloud-to-Mac secret | `HUB_API_SECRET` — authenticates cloud worker POSTs to Mac hub `/context` endpoint |

### GitHub / GitHub Pages

| Detail | Value |
|---|---|
| Repo | BengalOracle (private) |
| Deployment | GitHub Pages serves `dist/` at ainflgm.com |
| Deploy method | `npm run build` then push `dist/` to Pages branch |
| No GitHub Actions currently | Manual deploy workflow |

### Google Analytics

| Detail | Value |
|---|---|
| Measurement ID | `G-PLW4H1NNF6` |
| Implementation | Script tag in `index.html` loading from `googletagmanager.com` |
| Data collected | Page views, session data, device type, referrer |
| No server-side tracking | Client-side only |

### Buy Me A Coffee

| Detail | Value |
|---|---|
| Profile | `buymeacoffee.com/ainflgm` |
| Integration | External links in Layout.jsx, FloatingMenu.jsx, SummaryPage.jsx, DraftPage.jsx |
| Status | Active (live links, no SDK — pure link-out) |

### ntfy.sh (Visitor Notifications)

| Detail | Value |
|---|---|
| Channel | `ainfl-gm-visitors-jf2026` (public topic, security by obscurity) |
| Used for | New visitor alert to `emailfishback@gmail.com` — fires once per browser session |
| Data sent | Timestamp, device type (Mobile/Desktop), referrer URL (first 80 chars) |
| Auth | None — public ntfy.sh endpoint |

### Polymarket

| Detail | Value |
|---|---|
| API | `https://gamma-api.polymarket.com/markets` (public, no auth) |
| Proxy | Requests go through cloud worker (`9-cloud-standin.workers.dev/api/polymarket`) to avoid CORS |
| Cache | 15-minute in-memory cache in browser |
| Fallback | Mock data hardcoded in `src/utils/predictionMarkets.js` when no live NFL markets found |

### OpenWeatherMap

| Detail | Value |
|---|---|
| API key | `OPENWEATHER_API_KEY` |
| Endpoint | `https://api.openweathermap.org/data/2.5/weather` |
| Used by | Jules server — morning briefing weather for Cincinnati, OH |
| Free tier | Current conditions only (temp, feels_like, description, high/low) |

### Alpaca Markets

| Detail | Value |
|---|---|
| API keys | `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` (NOT in `.env` currently — bot not running) |
| Endpoints | `https://paper-api.alpaca.markets` (trading), `https://data.alpaca.markets` (market data) |
| Mode | Paper trading ONLY. No real money without Owner approval. |
| Status | Script exists (`scripts/trading-bot.mjs`). Not a running service. Not in LaunchAgent. |

### Sportsbook Affiliates (Planned, Not Active)

| Partner | Status |
|---|---|
| DraftKings | Config stub in `affiliates.js`, `active: false` |
| FanDuel | Config stub, `active: false` |
| BetMGM | Config stub, `active: false` |
| Kalshi | Config stub, `active: false` |

### Apple Mail + Apple Messages (iMessage)

| Detail | Value |
|---|---|
| Method | `osascript` (AppleScript via `execSync`) |
| Email send | AppleScript tells Mail.app to compose and send from `captain@ainflgm.com` to `emailfishback@gmail.com` |
| Email read | AppleScript reads last 5 messages from Mail.app inbox, filtered by sender |
| iMessage send | AppleScript tells Messages.app to send to `JASSON_PHONE` |
| iMessage read | Direct SQLite query against `~/Library/Messages/chat.db` |
| FDA requirement | Full Disk Access required for chat.db access. Lost after Mac reboot if hub started by LaunchAgent before FDA granted. |
| Jules routing | iMessages from `JAMIE_PHONE` are routed to Jules server instead of OC |

---

## 3. Credentials and API Keys

Every credential lives in `/Users/jassonfishback/Projects/BengalOracle/.env`. No credentials are stored anywhere else on disk. Loaded at process startup via manual `.env` parser in each script.

| Variable | Used By | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | voice-server, jules-server | Claude API for voice + Jules |
| `ANTHROPIC_API_KEY_TC` | comms-hub | Claude API for hub OC + health probe (separate key for rate limit isolation) |
| `TELEGRAM_BOT_TOKEN` | comms-hub | Telegram Bot API authentication |
| `TELEGRAM_CHAT_ID` | comms-hub | Jasson's Telegram chat (fallback hardcoded: `8784022142`) |
| `TWILIO_ACCOUNT_SID` | comms-hub, voice-server, jules-server | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | comms-hub, voice-server, jules-server | Twilio API authentication + webhook signature validation |
| `TWILIO_FROM_NUMBER` | voice-server, jules-server | Outbound SMS/voice caller ID |
| `TWILIO_BACKUP_1/2/3` | comms-hub | Backup Twilio phone numbers |
| `ELEVENLABS_API_KEY` | voice-server | ElevenLabs TTS |
| `ELEVENLABS_VOICE_ID` | voice-server | Voice clone ID for Captain Claude |
| `CLOUDFLARE_API_TOKEN` | comms-hub, Wrangler | Cloudflare API for webhook updates + Worker deployment |
| `TUNNEL_URL` | voice-server, comms-hub | Current cloudflared tunnel URL (auto-updated on tunnel restart) |
| `CLOUD_WORKER_URL` | comms-hub | Cloud worker URL for Mac-to-cloud heartbeat sync |
| `CLOUD_SECRET` | comms-hub | Shared secret for cloud heartbeat auth |
| `HUB_API_SECRET` | comms-hub | Authenticates cloud POSTs to Mac hub `/context` endpoint |
| `JASSON_PHONE` | comms-hub | Jasson's phone number for iMessage send |
| `OPENWEATHER_API_KEY` | jules-server | Weather data for morning briefings |

**Not currently in `.env` but referenced in code:**
- `ALPACA_API_KEY` + `ALPACA_SECRET_KEY` — trading bot (not running)
- `JAMIE_PHONE` — Jules iMessage routing (listed in hub code, may or may not be set)
- `JULES_RECIPIENT_PHONE` — Jules SMS recipient

**Accounts needed:**
- Anthropic (console.anthropic.com) — billing, API key management
- Telegram (BotFather) — bot token management
- Twilio (twilio.com/console) — voice numbers, webhooks, SMS, balance
- ElevenLabs (elevenlabs.io) — voice clones, TTS quota
- Cloudflare (dash.cloudflare.com) — Workers, KV, DNS, API tokens
- GitHub — repo, Pages deployment
- Google Analytics (analytics.google.com) — GA4 property G-PLW4H1NNF6
- Buy Me A Coffee (buymeacoffee.com/ainflgm)
- ntfy.sh — no account, public endpoint
- OpenWeatherMap — API key for Jules
- Alpaca Markets — paper trading account (not active)

---

## 4. Data Storage

### Local Files

| File | Purpose | Persists across restarts |
|---|---|---|
| `scripts/shared-state.json` | Comms hub state — channel status, recent 50 messages, session context, heartbeat count. Conversation history intentionally NOT persisted (cleared on restart to prevent stale replay). | Yes |
| `data/jules-profile.json` | Jules assistant profile — family info, shopping list, reminders, meal rotation, conversation memory (last 40 entries), preferences | Yes |
| `data/trading-bot-state.json` | Trading bot position state (not in use) | Yes |
| `scripts/shared-state.json` | Main shared state file | Yes |

### NFL Data Files (in scripts/)

All generated by scrape scripts. Static at build time.

| File | Source |
|---|---|
| `scripts/all-teams-raw.json` | Scraped from OverTheCap |
| `scripts/all-teams-deadmoney.json` | Scraped from OverTheCap |
| `scripts/fa-2026-raw.json` | Scraped from OverTheCap / PFF |
| `scripts/pff-raw.json` | PFF API |
| `scripts/dead-caps.json` | Scraped data |
| `scripts/contract-end-years.json` | Scraped data |
| `scripts/live-data.json` | Live game data |
| `scripts/espn-rosters.json` | ESPN API |
| `scripts/scraped-raw.json` | OverTheCap scrape output |

### Signal Files (/tmp/)

| File | Purpose | Created by | Read by |
|---|---|---|---|
| `/tmp/9-open-terminal` | Tells open-terminal.mjs to launch Terminal + Claude | comms-hub | open-terminal.mjs |
| `/tmp/9-session-token` | Persists active terminal session token across hub restarts | comms-hub | comms-hub on startup |
| `/tmp/9-terminal-pid` | Persists Claude Code process PID for liveness checks | comms-hub | comms-hub watchdog |
| `/tmp/9-healing` | Signals open-terminal.mjs is in API recovery mode | open-terminal.mjs | hub status endpoint |
| `/tmp/9-last-tool-call` | Unix timestamp of last tool call (for freeze detection — currently disabled) | check-messages.sh hook | comms-hub (disabled) |
| `/tmp/9-incoming-message.jsonl` | Incoming message signal for PostToolUse hook | comms-hub write path | check-messages.sh |
| `/tmp/tc-agent-offset.txt` | Telegram getUpdates offset — prevents reprocessing old messages | comms-hub | comms-hub |
| `/tmp/terminal-ping.pid` | PID of terminal ping background loop | 9 session startup | 9 session startup (kill old) |
| `/tmp/voice_audio/` | ElevenLabs TTS audio cache. Files served during active calls. | voice-server | voice-server |
| `/tmp/cloudflared.log` | Cloudflare tunnel startup log — hub reads this to extract new tunnel URL | cloudflared | comms-hub |
| `/tmp/trading-bot.log` | Trading bot log (not in use) | trading-bot.mjs | Manual review |
| `/tmp/9-terminal-opener.log` | Terminal opener logs | open-terminal.mjs | Manual review |

### Log Files (persistent)

| File | Purpose |
|---|---|
| `logs/comms-hub.log` | Main hub log — all events, errors, decisions |
| `logs/comms-hub-stdout.log` | LaunchAgent stdout capture |
| `logs/comms-hub-stderr.log` | LaunchAgent stderr capture |
| `logs/calls/` | Per-call transcripts from voice-server |

### Claude Memory Files

| Location | Purpose |
|---|---|
| `~/.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory/*.md` | Persistent agent memory — identity, user profile, project state, feedback, references. Read by comms-hub OC on startup to build system prompt context. |

### Cloudflare KV (cloud-side persistence)

| KV Key | Purpose |
|---|---|
| `mac-bundle` | Synced state bundle from Mac (state + conversation history + memory context). Updated every 5 minutes. |
| `conversation-history` | Cloud-side conversation history for Telegram when Mac is down |
| Last heartbeat timestamp | Mac alive/down detection |

---

## 5. Deployment Dependencies

### Runtime

| Dependency | Version / Detail |
|---|---|
| Node.js | v25.8.1 (installed at `/opt/homebrew/bin/node`) |
| npm | Bundled with Node |
| cloudflared | Cloudflare tunnel binary — path not pinned, expected in PATH |
| osascript | macOS built-in AppleScript runner — required for iMessage + Mail |
| sqlite3 | macOS built-in — used indirectly via chat.db access |

### npm Packages (production dependencies)

| Package | Version | Purpose |
|---|---|---|
| react | ^19.2.4 | UI framework |
| react-dom | ^19.2.4 | React DOM renderer |
| react-router-dom | ^7.13.1 | SPA routing |
| html-to-image | ^1.11.13 | Summary card export to image |
| vite-plugin-pwa | ^1.2.0 | PWA manifest + service worker |

### npm Packages (dev dependencies)

| Package | Version | Purpose |
|---|---|---|
| vite | ^8.0.0 | Build tool and dev server |
| @vitejs/plugin-react | ^6.0.0 | Vite React plugin |
| playwright | ^1.58.2 | Browser automation (scraping scripts) |
| eslint | ^9.39.4 | Linting |
| @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals | various | ESLint config |
| @types/react, @types/react-dom | various | TypeScript types (JSDoc use) |

### macOS-Specific Dependencies

| Dependency | Purpose | Risk if missing |
|---|---|---|
| Full Disk Access (FDA) | `~/Library/Messages/chat.db` read access for iMessage monitoring | iMessage read fails silently; send still works |
| Terminal.app | Claude Code launch target via osascript | Terminal auto-opener fails |
| Mail.app | Email send + read via AppleScript | Email channel down |
| Messages.app | iMessage send via AppleScript | iMessage send fails |
| Accessibility permissions | osascript keystroke injection (freeze detector — currently disabled) | No impact while disabled |

### Hardware Requirements

- Mac with Apple Silicon or Intel (osascript is macOS-only — the entire iMessage + email stack is Mac-tied)
- Always-on internet connection (Telegram polling, Cloudflare tunnel, Twilio webhooks)
- Mac must stay powered on for all local processes to function

### Cloud Worker Build

- Wrangler CLI (installed globally or via npx)
- Cloudflare account with Workers enabled
- Deploy: `cloud-worker/deploy.sh`

---

## 6. Communication Flows

### Telegram Message (Mac active, terminal running)

```
Jasson sends Telegram message
    → Telegram servers
    → Hub polling loop (getUpdates, 30s long poll)
    → comms-hub.mjs receives update
    → Terminal is active (recent ping) → writes to /tmp/9-incoming-message.jsonl
    → PostToolUse hook (check-messages.sh) reads signal file after next tool call
    → 9 sees message as system-reminder in Claude Code session
    → 9 responds directly via POST /send to hub
    → Hub calls Telegram sendMessage API
    → Jasson receives reply
```

### Telegram Message (Mac active, terminal DOWN — OC autonomous mode)

```
Jasson sends Telegram message
    → Hub polling loop receives it
    → Terminal is inactive (ping timeout or PID dead)
    → Hub calls askClaude() with OC system prompt
    → Claude API (ANTHROPIC_API_KEY_TC) generates response
    → Hub prefixes "OC: " and sends via Telegram sendMessage
    → If terminal has been down a while, hub also writes /tmp/9-open-terminal
    → open-terminal.mjs reads signal → osascript opens Terminal + Claude Code
```

### Telegram Message (Mac completely down — cloud failover)

```
Jasson sends Telegram message
    → Telegram servers
    → Cloud worker cron (every 2 min) previously detected Mac down
    → Cloud worker set Telegram webhook to point at cloud worker
    → Telegram delivers webhook POST to Cloudflare Worker
    → Worker calls Claude API (worker's own key) with Backup QB system prompt
    → Worker sends reply via Telegram sendMessage
    → Worker queues complex requests for when Mac comes back
    → Mac comes back online → hub claims polling, clears webhook → normal flow resumes
```

### Voice Call (inbound)

```
Caller dials Twilio number
    → Twilio validates call, POSTs to TUNNEL_URL/voice (TwiML webhook)
    → cloudflared tunnel receives request → forwards to voice-server port 3456
    → voice-server validates Twilio signature (HMAC-SHA1)
    → Identifies caller by number → selects caller profile (Kyle, Mark, Jude, etc.)
    → Starts async Claude generation (Haiku for most, Sonnet for Kyle/Mark)
    → Plays filler word TTS while Claude thinks (latency optimization)
    → ElevenLabs generates TTS audio for Claude response
    → Audio file served from /tmp/voice_audio/
    → Twilio plays audio to caller
    → Caller speaks → Twilio STT → POST to /gather → loop continues
    → Call ends → transcript saved to logs/calls/
```

### iMessage Flow

```
Jasson sends iMessage to Mac
    → Messages.app receives → stores in ~/Library/Messages/chat.db
    → comms-hub imessageMonitor() polls chat.db every 5 seconds (SQLite query)
    → New message detected → check if from Jamie phone → route to Jules if yes
    → Otherwise: if terminal active → write to inbox signal → 9 sees it
    → If terminal inactive → askClaude() → respond via osascript/Messages.app

Outbound iMessage:
    → Hub calls sendIMessage(text)
    → osascript tells Messages.app to send to JASSON_PHONE
```

### Email Flow

```
Outbound:
    → Hub calls sendEmail(subject, body)
    → osascript tells Mail.app to compose new message from captain@ainflgm.com
    → Mail.app sends to emailfishback@gmail.com via configured SMTP

Inbound:
    → emailMonitor() polls Mail.app inbox every 5 minutes via AppleScript
    → Reads last 5 messages, filters for sender containing "emailfishback" or "jassonfishback"
    → New subject detected → if terminal active: queues for 9
    → If terminal inactive: OC generates reply → sendEmail() back
```

---

## 7. Security Concerns (Kyle's Feedback)

### Autonomous OS Access Points

The following code paths execute OS-level operations without human confirmation:

| Access Point | Trigger | What it does |
|---|---|---|
| `osascript` — Terminal open | Hub detects terminal down | Opens Terminal.app and runs `claude --dangerously-skip-permissions` |
| `osascript` — iMessage send | Any message to Jasson's phone | Sends iMessage on Jasson's behalf via Messages.app |
| `osascript` — Email send | Any alert or recovery event | Composes and sends email from captain@ainflgm.com |
| `chat.db` direct read | Every 5 seconds | Reads ALL iMessage history (not scoped) |
| `execSync('pgrep -a claude')` | Every 30 seconds | Reads process list |
| `process.kill(pid, 0)` | Every 30 seconds | Checks PID liveness |
| `cloudflared` tunnel spawn | Voice server start / tunnel failure | Opens new internet tunnel, auto-updates Twilio webhook URL |
| `.env` file write | Tunnel URL update | Hub writes new TUNNEL_URL back to `.env` on tunnel restart |

**Note:** The freeze detector (`osascript keystroke return`) is currently DISABLED. If re-enabled, it would inject keystrokes into the active application without confirmation.

### Credential Storage

| Concern | Detail |
|---|---|
| All credentials in one plaintext `.env` file | `/Users/jassonfishback/Projects/BengalOracle/.env` — not encrypted, readable by any process running as the user |
| `.env` is NOT in `.gitignore` (verify this) | If committed to git, all keys would be in repo history |
| Credentials loaded by 3 separate processes | comms-hub, voice-server, jules-server each parse `.env` on startup |
| Hub modifies `.env` at runtime | `TUNNEL_URL` line is overwritten when tunnel restarts — any write error could corrupt the file |
| Claude Code sessions can read `.env` | With `--dangerously-skip-permissions`, Claude Code has unrestricted file access |
| Cloud worker secrets | Stored in Cloudflare Worker environment variables — separate from `.env`, managed via Wrangler |

### Network Exposure

| Exposure | Detail |
|---|---|
| Voice server port 3456 | Exposed to internet via cloudflared tunnel. Twilio signature validation is the only auth layer. |
| Hub port 3457 | Localhost only. Not externally accessible. |
| Jules server port 3470 | Localhost only currently. If Twilio webhook is pointed at it, would need exposure. |
| Polymarket proxy via cloud worker | Cloud worker forwards requests to `gamma-api.polymarket.com`. Worker URL is public. |
| ntfy.sh visitor topic | Public endpoint. Topic name `ainfl-gm-visitors-jf2026` is the only secret. Anyone who knows it can post to or subscribe from it. |
| Cloudflare KV | KV namespace accessible only with Cloudflare API token. State bundle includes recent messages and memory context. |

### Data That Leaves the Machine

| Data | Destination | Sensitivity |
|---|---|---|
| All Telegram messages | Anthropic API (for OC responses) | Medium — business and personal context |
| All iMessages from Jasson | Anthropic API (for OC responses) | High — personal and financial context |
| Voice call transcripts | Anthropic API, ElevenLabs | High — real-time verbal conversations |
| Jules conversations (Jamie's texts) | Anthropic API, Twilio | Personal family data |
| Memory files (identity, projects, contacts) | Anthropic API on every OC response | High — full business + personal context |
| Shared state bundle | Cloudflare KV every 5 minutes | Medium — includes last 20 messages |
| Visitor device/referrer data | ntfy.sh | Low — anonymized device type + referrer |
| Google Analytics page views | Google | Low — no PII, standard analytics |
| NFL roster/cap data | Static, generated locally | None — public data |

### Single Points of Failure

| Component | Impact if it fails |
|---|---|
| `.env` file | All credentials lost — all services fail |
| comms-hub.mjs | All communication channels go dark (LaunchAgent restarts in ~10s) |
| Anthropic API | OC/voice/Jules all fail; hub sends offline responses |
| cloudflared tunnel | Voice calls fail; hub auto-restarts tunnel |
| Twilio account balance | Voice calls and SMS fail with no warning until <$5 balance alert |
| Mac power/internet | All local processes fail; cloud worker takes over Telegram only |
| FDA permission revoked | iMessage read fails silently; no alert generated |

---

## 8. Deprecated / Inactive Files

These scripts exist in `scripts/` but are deprecated and should NOT be run:

| File | Status |
|---|---|
| `inbox-monitor.mjs.deprecated` | Replaced by comms-hub |
| `telegram-agent.mjs.deprecated` | Replaced by comms-hub |
| `telegram-bot.mjs.deprecated` | Replaced by comms-hub |
| `telegram-listener.mjs.deprecated` | Replaced by comms-hub |
| `telegram-webhook.mjs.deprecated` | Replaced by comms-hub |

---

## 9. Claude Agent Configuration

| File | Agent | Role |
|---|---|---|
| `.claude/agents/` | Sub-agents directory | Various specialized agents |
| `.claude/uno.md` | UNO | #1 sub-agent, research and strategy |
| `.claude/tee.md` | Tee (this agent) | Engineering team lead |
| `.claude/canvas.md` | Canvas | Design/frontend |
| `.claude/doc.md` | DOC | Documentation |
| `.claude/money.md` | Money | Financial analysis |
| `.claude/press.md` | Press | Content and social |
| `.claude/scout.md` | Scout | Research |
| `.claude/settings.local.json` | Claude Code settings | PostToolUse hook pointing to `scripts/check-messages.sh` |

---

*This document should be updated any time a new service, API, or credential is added to the system.*
