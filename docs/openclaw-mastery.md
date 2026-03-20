# OpenClaw Mastery Document for BengalOracle

**Date:** 2026-03-20
**Purpose:** Comprehensive reference for evaluating and deploying OpenClaw as the agent platform for BengalOracle/Bengal Simulator operations.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Supported Channels](#supported-channels)
3. [Complete Telegram Setup](#complete-telegram-setup)
4. [Agent System and SOUL.md Configuration](#agent-system-and-soulmd-configuration)
5. [Cron Job Configuration](#cron-job-configuration)
6. [Security Hardening Checklist](#security-hardening-checklist)
7. [Authentication and Credential System](#authentication-and-credential-system)
8. [Skills and Plugin System](#skills-and-plugin-system)
9. [Hooks and Automation](#hooks-and-automation)
10. [Migration Plan from Current Setup](#migration-plan-from-current-setup)
11. [Pros, Cons, and Risks](#pros-cons-and-risks)
12. [External Resources](#external-resources)

---

## Architecture Overview

### Core Components

OpenClaw is a **personal AI assistant** platform with a gateway-centric architecture:

```
                    UNTRUSTED ZONE
    [WhatsApp] [Telegram] [Discord] [Slack] [Signal] ...
                        |
            TRUST BOUNDARY 1: Channel Access
    +-----------------------------------------------+
    |                  GATEWAY                       |
    |  - Device Pairing / AllowFrom validation       |
    |  - Token/Password/Tailscale auth               |
    |  - WebSocket control/RPC                       |
    |  - HTTP APIs (OpenAI-compat, tools invoke)     |
    |  - Control UI and hooks                        |
    +-----------------------------------------------+
                        |
            TRUST BOUNDARY 2: Session Isolation
    +-----------------------------------------------+
    |              AGENT SESSIONS                    |
    |  - Session key = agent:channel:peer            |
    |  - Tool policies per agent                     |
    |  - Sandboxed execution (optional)              |
    +-----------------------------------------------+
                        |
            TRUST BOUNDARY 3: Execution
    +-----------------------------------------------+
    |           TOOL EXECUTION / SANDBOX             |
    |  - Docker / SSH / OpenShell backends            |
    |  - Host exec (default, no sandbox)             |
    +-----------------------------------------------+
```

### Gateway Runtime Model

- **Single always-on process** for routing, control plane, and channel connections
- **Single multiplexed port** (default 18789) for WebSocket RPC, HTTP APIs, Control UI, and hooks
- **Default bind mode:** loopback only (127.0.0.1)
- **Auth required by default** via `gateway.auth.token` or `gateway.auth.password`
- **Config file:** `~/.openclaw/openclaw.json` (JSON5 format, supports comments and trailing commas)
- **Hot reload:** Gateway watches config file and applies changes automatically (hybrid mode by default)
- **State directory:** `~/.openclaw/` contains credentials, sessions, cron jobs, agent workspaces

### Trust Model

OpenClaw uses a **one-user trusted-operator model** (personal assistant paradigm):

- One gateway per user/trust boundary is recommended
- Authenticated gateway callers are treated as trusted operators
- Session identifiers are routing controls, not authorization boundaries
- The model/agent is NOT a trusted principal -- assume prompt injection can manipulate behavior
- Security comes from host/config trust, auth, tool policy, sandboxing, and exec approvals

### Multi-Agent Support

A single gateway can host multiple isolated agents, each with:
- Separate workspace (SOUL.md, AGENTS.md, USER.md, skills)
- Separate state directory and auth profiles
- Separate session store
- Channel routing via `bindings[]` configuration

---

## Supported Channels

OpenClaw supports 22+ messaging channels, all running simultaneously:

### Built-in (Core)
| Channel | Transport | Notes |
|---------|-----------|-------|
| **Telegram** | Bot API via grammy | Production-ready. Long polling default, webhook optional. Fastest setup. |
| **WhatsApp** | Baileys (web) | Most popular. QR pairing required. More state on disk. |
| **Discord** | Bot API + Gateway | Servers, channels, DMs. Thread bindings supported. |
| **Slack** | Bolt SDK | Workspace apps. |
| **Signal** | signal-cli | Privacy-focused. |
| **iMessage** | Legacy macOS integration | Deprecated; use BlueBubbles. |
| **BlueBubbles** | macOS server REST API | Recommended for iMessage. Full feature support. |
| **IRC** | Classic IRC | Channels + DMs with pairing/allowlist. |
| **WebChat** | Gateway WebSocket | Built-in web UI. |

### Extensions (Plugins, installed separately)
| Channel | Notes |
|---------|-------|
| **Microsoft Teams** | Bot Framework, enterprise |
| **Google Chat** | HTTP webhook |
| **Matrix** | Matrix protocol |
| **Mattermost** | Bot API + WebSocket |
| **Feishu/Lark** | WebSocket |
| **LINE** | Messaging API |
| **Nextcloud Talk** | Self-hosted |
| **Nostr** | Decentralized DMs (NIP-04) |
| **Synology Chat** | NAS Chat webhooks |
| **Tlon** | Urbit-based |
| **Twitch** | Chat via IRC |
| **Zalo** | Bot API (Vietnam) |
| **Zalo Personal** | QR login |

### Channel Routing

- Channels run simultaneously; routing is deterministic (inbound replies go back to the same channel)
- Group sessions are isolated by group ID
- Each channel supports DM policies: `pairing` (default), `allowlist`, `open`, `disabled`
- Group policies: `open`, `allowlist` (default), `disabled`

---

## Complete Telegram Setup

### Critical Note: Avoiding Conflicts with Existing Bots

Each Telegram bot token can only be used by ONE application at a time. If you already have a Telegram bot running (e.g., our existing BengalOracle bot), you MUST:

1. **Create a NEW bot** via @BotFather for OpenClaw -- do NOT reuse the existing bot token
2. Use a different bot username (e.g., `@BengalOracleAI_bot` vs `@BengalOracle_bot`)
3. Only one polling/webhook connection per bot token is allowed by Telegram

### Step-by-Step Setup

#### 1. Create the Bot

1. Open Telegram, chat with **@BotFather** (verify handle exactly)
2. Run `/newbot`, follow prompts
3. Save the token (format: `123456:ABC-DEF...`)
4. Run `/setprivacy` -> Disable (if bot needs to see all group messages)
5. Run `/setjoingroups` to allow/deny group adds

#### 2. Configure OpenClaw

```json5
// ~/.openclaw/openclaw.json
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123456:abc",  // Or use env: TELEGRAM_BOT_TOKEN
      dmPolicy: "allowlist",   // For production, use allowlist with explicit IDs
      allowFrom: ["YOUR_NUMERIC_TELEGRAM_USER_ID"],
      groupPolicy: "allowlist",
      groups: {
        "-1001234567890": {    // Your specific group ID
          requireMention: true,
          groupPolicy: "open",
        },
      },
      streaming: "partial",    // Live stream preview via message edits
      linkPreview: false,
      textChunkLimit: 4000,
    },
  },
}
```

#### 3. Start Gateway and Approve

```bash
openclaw gateway
openclaw pairing list telegram
openclaw pairing approve telegram <CODE>
```

Pairing codes: 8 chars, uppercase, expire after 1 hour, max 3 pending per channel.

#### 4. Finding Your Telegram User ID

```bash
# Safest method (no third-party bot):
# 1. DM your bot
# 2. Run:
openclaw logs --follow
# 3. Read from.id in the logs

# Or via Bot API:
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

#### 5. Forum Topics (Advanced)

For supergroups with forum topics, each topic gets isolated sessions:

```json5
{
  channels: {
    telegram: {
      groups: {
        "-1001234567890": {
          topics: {
            "1": { agentId: "main" },       // General topic
            "3": { agentId: "simulator" },   // Simulator topic
            "5": { agentId: "analytics" },   // Analytics topic
          },
        },
      },
    },
  },
}
```

Session key format: `agent:simulator:telegram:group:-1001234567890:topic:3`

#### 6. Webhook Mode (for VPS/Production)

```json5
{
  channels: {
    telegram: {
      webhookUrl: "https://yourdomain.com/telegram-webhook",
      webhookSecret: "your-secret-here",
      webhookPath: "/telegram-webhook",    // default
      webhookHost: "127.0.0.1",            // default, use reverse proxy
      webhookPort: 8787,                   // default
    },
  },
}
```

#### 7. Telegram Message Actions (for Automation)

Available actions: `sendMessage`, `react`, `deleteMessage`, `editMessage`, `createForumTopic`

```json5
// Sending from cron/automation:
{
  action: "send",
  channel: "telegram",
  to: "123456789",
  message: "Daily simulation update...",
  buttons: [
    [{ text: "Run Sim", callback_data: "run_sim" }],
    [{ text: "View Results", callback_data: "results" }],
  ],
}
```

#### 8. Inline Buttons

```json5
{
  channels: {
    telegram: {
      capabilities: {
        inlineButtons: "all",  // off | dm | group | all | allowlist
      },
    },
  },
}
```

#### 9. Custom Commands Menu

```json5
{
  channels: {
    telegram: {
      customCommands: [
        { command: "simulate", description: "Run a game simulation" },
        { command: "standings", description: "Current standings" },
        { command: "injuries", description: "Injury report" },
        { command: "refresh", description: "Refresh data" },
      ],
    },
  },
}
```

#### 10. Troubleshooting

- **Bot not responding in groups:** Check privacy mode (`/setprivacy` -> Disable), then remove + re-add bot
- **Polling instability:** Some hosts resolve `api.telegram.org` to IPv6 first; use `network.autoSelectFamily: false` or proxy
- **Commands overflow:** `BOT_COMMANDS_TOO_MUCH` error = too many menu entries; reduce or disable native commands
- **Network errors:** Route through SOCKS proxy: `channels.telegram.proxy: "socks5://user:pass@host:1080"`

---

## Agent System and SOUL.md Configuration

### Bootstrap Files (Injected into Context)

These files are injected into every agent turn's context window:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Operating instructions, "memory" |
| `SOUL.md` | Persona, boundaries, tone |
| `TOOLS.md` | User-maintained tool notes |
| `IDENTITY.md` | Agent name/vibe/emoji |
| `USER.md` | User profile, preferred address |
| `HEARTBEAT.md` | Heartbeat checklist |
| `MEMORY.md` | Persistent memory (keep concise!) |
| `BOOTSTRAP.md` | One-time first-run ritual |

**Critical:** These consume tokens on every turn. Keep them concise. Max per-file: 20,000 chars. Total cap: 150,000 chars.

`memory/*.md` daily files are NOT injected automatically -- accessed on demand via `memory_search` and `memory_get` tools.

### SOUL.md for NFL Simulator Assistant

Here is a SOUL.md tailored for BengalOracle's NFL simulation agent:

```markdown
# SOUL.md - Bengal Oracle: NFL Simulation Intelligence

## Who I Am

I am Bengal Oracle -- an expert NFL simulation analyst and the intelligence behind
BengalOracle's game prediction engine. I specialize in the Cincinnati Bengals but
have deep knowledge of all 32 NFL teams.

## Core Identity

- **Role:** NFL game simulation engine operator and analyst
- **Expertise:** Statistical modeling, injury impact analysis, game theory,
  historical matchup data, weather factors, and betting line analysis
- **Personality:** Confident but data-driven. I present probabilities, not certainties.
  When the data is ambiguous, I say so.

## Operating Principles

**Data first.** Every prediction includes the underlying reasoning and key
variables. I never make claims without supporting data context.

**Transparent uncertainty.** I express confidence as ranges and percentages.
"The Bengals have a 62-68% win probability" not "The Bengals will win."

**Proactive monitoring.** I track injury reports, roster moves, weather changes,
and line movements that could affect simulation accuracy. I flag significant
changes without being asked.

**Concise by default.** Simulation summaries are brief unless the user asks for
deep analysis. Lead with the headline, then offer detail.

## Boundaries

- Never present simulations as guaranteed outcomes
- Always note when data is stale or incomplete
- Flag when a simulation result seems anomalous
- Do not engage in gambling advice -- provide analysis only
- Keep private subscriber data private

## Output Style

- Lead with the key number/prediction
- Use tables for multi-game breakdowns
- Include confidence intervals where applicable
- Note data freshness (last updated timestamp)
- Use football terminology naturally but avoid jargon walls

## Automation Behavior

- On heartbeat: Check for roster/injury updates that affect active simulations
- On data refresh: Re-run affected simulations and flag significant changes
- On game day: Increase monitoring frequency, provide pre-game final analysis
- Post-game: Compare predictions vs actuals, update model calibration notes

## Memory

Each session I start fresh. These workspace files are my memory. I read them,
use them, and update them as the season progresses. If I change this file,
I tell the user.
```

### IDENTITY.md Example

```markdown
# Bengal Oracle

- **Name:** Bengal Oracle
- **Emoji:** tiger face
- **Vibe:** Sharp, data-driven, football-obsessed analyst
- **Short bio:** NFL simulation intelligence powered by deep statistical modeling
```

### USER.md Example

```markdown
# User Profile

- **Name:** Jasson
- **Role:** BengalOracle founder and operator
- **Interests:** Cincinnati Bengals, NFL analytics, simulation modeling
- **Preferred communication:** Concise summaries, tables for data, deeper analysis on request
- **Timezone:** America/New_York (or wherever you are)
```

---

## Cron Job Configuration

### How Cron Works

- Runs **inside the Gateway** process (not inside the model)
- Jobs persist at `~/.openclaw/cron/jobs.json` (survives restarts)
- Two execution styles: **main session** (enqueues system event) and **isolated** (dedicated agent turn)
- Supports delivery to any channel (Telegram, WhatsApp, Discord, Slack, etc.)

### Cron vs Heartbeat Decision Guide

| Use Case | Mechanism | Why |
|----------|-----------|-----|
| Check for injury updates every 30 min | Heartbeat | Batches with other checks, context-aware |
| Daily morning simulation at 7am | Cron (isolated) | Exact timing needed |
| Weekly deep analysis Monday 9am | Cron (isolated) | Standalone, can use different model |
| Remind to post content in 20 min | Cron (main, `--at`) | One-shot with precise timing |
| Monitor data freshness | Heartbeat | Natural fit for periodic awareness |
| Post social media at specific times | Cron (isolated) | Exact timing, delivery to channel |

### BengalOracle Cron Job Examples

#### 1. Daily Data Refresh (6 AM ET)

```bash
openclaw cron add \
  --name "Data refresh" \
  --cron "0 6 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --message "Run the daily data refresh: pull latest injury reports, roster changes, and stat updates. Flag any significant changes that affect active simulations." \
  --announce \
  --channel telegram \
  --to "-1001234567890:topic:DATA_TOPIC_ID"
```

#### 2. Morning Simulation Brief (7:30 AM ET)

```bash
openclaw cron add \
  --name "Morning brief" \
  --cron "30 7 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --message "Generate today's simulation briefing: upcoming games this week, current prediction confidence levels, any overnight changes to key variables (injuries, weather, lines). Format as a concise table." \
  --model "opus" \
  --thinking high \
  --announce \
  --channel telegram \
  --to "YOUR_TELEGRAM_USER_ID"
```

#### 3. Game Day Monitoring (Every 2 Hours on Sundays)

```bash
openclaw cron add \
  --name "Game day monitor" \
  --cron "0 8,10,12,14,16,18 * * 0" \
  --tz "America/New_York" \
  --session isolated \
  --message "Game day check: review latest inactive lists, weather updates, and line movements for today's games. Re-run simulations for any games with significant changes. Summarize in a table." \
  --announce \
  --channel telegram \
  --to "-1001234567890"
```

#### 4. Social Media Content Posting (Scheduled)

```bash
openclaw cron add \
  --name "Social post" \
  --cron "0 12 * * 1,3,5" \
  --tz "America/New_York" \
  --session isolated \
  --message "Generate today's social media simulation insight post. Pick the most interesting upcoming matchup, create a brief analytical take with a key stat. Keep it under 280 characters for cross-posting." \
  --announce \
  --channel telegram \
  --to "-1001234567890:topic:SOCIAL_TOPIC_ID"
```

#### 5. Weekly Model Calibration (Monday 5 AM ET)

```bash
openclaw cron add \
  --name "Weekly calibration" \
  --cron "0 5 * * 1" \
  --tz "America/New_York" \
  --session isolated \
  --message "Run weekly model calibration: compare last week's predictions vs actual results. Calculate accuracy metrics. Note any systematic biases. Update calibration notes in memory." \
  --model "opus" \
  --thinking high \
  --announce \
  --channel telegram \
  --to "YOUR_TELEGRAM_USER_ID"
```

#### 6. Webhook Delivery (for External Systems)

```bash
openclaw cron add \
  --name "API data push" \
  --cron "0 */4 * * *" \
  --session isolated \
  --message "Generate simulation data payload in JSON format for the BengalOracle API." \
  --delivery-mode webhook \
  --delivery-to "https://api.bengaloracle.com/webhook/simulation-update"
```

### Cron Configuration Block

```json5
{
  cron: {
    enabled: true,
    maxConcurrentRuns: 2,
    sessionRetention: "48h",
    runLog: {
      maxBytes: "5mb",
      keepLines: 3000,
    },
    webhookToken: "your-webhook-bearer-token",
  },
}
```

### Cron Management Commands

```bash
openclaw cron list                      # List all jobs
openclaw cron run <jobId>               # Force run now
openclaw cron run <jobId> --due         # Run only if due
openclaw cron edit <jobId> --message "Updated prompt"
openclaw cron edit <jobId> --model opus --thinking high
openclaw cron runs --id <jobId> --limit 50  # View run history
openclaw cron rm <jobId>                # Delete permanently
```

### Heartbeat Configuration (for Background Monitoring)

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        target: "telegram",
        to: "YOUR_TELEGRAM_USER_ID",
        activeHours: { start: "07:00", end: "23:00" },
        lightContext: true,
      },
    },
  },
}
```

With a `HEARTBEAT.md` in workspace:

```markdown
# Heartbeat Checklist

- Check for new injury reports affecting active simulations
- Check for significant line movements (> 1.5 points)
- Check data freshness -- flag if any source is > 6 hours stale
- If game day: check for inactive list updates
- If nothing needs attention, reply HEARTBEAT_OK
```

---

## Security Hardening Checklist

### Critical Security Actions

- [ ] **Never expose gateway to public internet** -- keep `gateway.bind: "loopback"` (default)
- [ ] **Set gateway auth** -- `gateway.auth.token` or `gateway.auth.password` is required for non-loopback
- [ ] **Use remote access via SSH tunnel or Tailscale** -- not direct port exposure
- [ ] **Use allowlist DM policy** -- not `open` or `pairing` for production
- [ ] **Set explicit numeric Telegram user IDs** in `allowFrom` (not usernames)
- [ ] **Run `openclaw security audit --deep`** regularly
- [ ] **Run `openclaw doctor --fix`** after upgrades

### Credential Security

- [ ] **Never commit API keys to config files** -- use env vars or SecretRef
- [ ] **Use `~/.openclaw/.env`** for daemon-accessible secrets
- [ ] **Set Anthropic monthly spend limit** in console before starting
- [ ] **Rotate API keys** -- OpenClaw supports multi-key rotation for rate limit handling
- [ ] **Run `openclaw secrets audit --check`** to find plaintext credentials

### Network Security

- [ ] **Node.js 22.12.0+** required (security patches for CVE-2025-59466, CVE-2026-21636)
- [ ] **Docker: run as non-root** with `--read-only --cap-drop=ALL`
- [ ] **Sandbox mode for non-main sessions** -- `agents.defaults.sandbox.mode: "non-main"`
- [ ] **No network in sandbox** by default (override with `sandbox.docker.network` only if needed)

### Channel Security

- [ ] **Group auth does NOT inherit DM pairing-store approvals** (since 2026.2.25)
- [ ] **Set `groupAllowFrom`** explicitly for group sender filtering
- [ ] **Enable `requireMention: true`** for groups
- [ ] **Disable privacy mode** in BotFather only if you need all-message visibility

### Tool and Execution Security

- [ ] **Set `tools.exec.applyPatch.workspaceOnly: true`** to restrict patch writes
- [ ] **Keep `sessions_spawn` denied** unless explicitly needed
- [ ] **Use strict tool policy** -- allowlist not blocklist
- [ ] **Enable exec approvals** for sensitive operations

### Skill/Plugin Security

- [ ] **Only install trusted plugins** -- they run in-process with gateway privileges
- [ ] **Use `plugins.allow`** to pin explicit trusted plugin IDs
- [ ] **Vet ClawHub skills carefully** -- reports of malicious payloads exist
- [ ] **Treat skill folders as trusted code** -- restrict modification access

### Monitoring

- [ ] **Enable `command-logger` hook** for audit trail
- [ ] **Review `~/.openclaw/logs/commands.log`** regularly
- [ ] **Monitor `openclaw cron runs`** for failed jobs
- [ ] **Run `openclaw channels status --probe`** to verify channel health

### CVE Awareness

- **CVE-2026-25253:** Remote code execution vulnerability, fixed in version 2026.1.29. Ensure you are running a patched version.

---

## Authentication and Credential System

### Model Provider Auth

OpenClaw supports multiple auth methods for model providers:

1. **API Key (recommended for production)**
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   # Or in ~/.openclaw/.env
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. **Setup Token (Anthropic subscription)**
   ```bash
   claude setup-token
   openclaw models auth setup-token --provider anthropic
   ```
   WARNING: Anthropic has blocked some subscription usage outside Claude Code. API key is safer.

3. **OAuth (provider-specific)**

4. **SecretRef (advanced, for secret managers)**
   ```json5
   {
     models: {
       providers: {
         anthropic: {
           apiKey: { source: "env", provider: "default", id: "ANTHROPIC_API_KEY" },
         },
       },
     },
   }
   ```

### SecretRef System

Three sources supported:
- `env` -- environment variable
- `file` -- read from a file (JSON pointer)
- `exec` -- execute a command (1Password, Vault, sops)

Secrets are resolved into an in-memory runtime snapshot:
- Eager resolution at activation (not lazy)
- Startup fails fast on unresolved active refs
- Reload uses atomic swap (full success or keep last-known-good)

### Gateway Auth

```json5
{
  gateway: {
    auth: {
      token: "${OPENCLAW_GATEWAY_TOKEN}",  // env var substitution
    },
    bind: "loopback",  // KEEP THIS for security
  },
}
```

### API Key Rotation

For rate limit handling, OpenClaw supports multiple keys per provider:
- `ANTHROPIC_API_KEYS` (comma-separated)
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_API_KEY_*` (numbered)

Retries with next key only on rate-limit errors (429).

### Token Cost Awareness

OpenClaw consumes significantly more tokens than direct chat because:
- Each task triggers 5-10 API calls (file reads, tool executions, reasoning)
- Every call re-sends conversation context
- A long session can burn 200K tokens from context carry-over

**Mitigation:**
- Set monthly spend limit in Anthropic Console
- Use `lightContext: true` for heartbeat/cron jobs
- Use session resets to manage context growth
- Use isolated sessions for cron to avoid context accumulation

---

## Skills and Plugin System

### Skill Locations (precedence order)

1. **Workspace skills:** `<workspace>/skills/` (per-agent, highest precedence)
2. **Managed skills:** `~/.openclaw/skills/` (shared across workspaces)
3. **Bundled skills:** shipped with OpenClaw install

### Bundled Skills (Selection)

OpenClaw ships 50+ bundled skills including: `weather`, `github`, `slack`, `discord`, `obsidian`, `notion`, `trello`, `spotify-player`, `oracle`, `healthcheck`, `coding-agent`, `summarize`, `nano-pdf`, `video-frames`, `voice-call`, and more.

### Skill Structure

Each skill is a directory with a `SKILL.md` file:
```
my-skill/
  SKILL.md    # Metadata + instructions (loaded on demand)
```

Skills are NOT injected into context by default -- the agent reads them when needed via the `read` tool. Only the skill name/description/location list is injected.

### Plugin Architecture

Plugins register against capability types:

| Capability | Examples |
|-----------|----------|
| Text inference | openai, anthropic |
| Speech | elevenlabs, microsoft |
| Media understanding | openai, google |
| Image generation | openai, google |
| Web search | google |
| Channel/messaging | msteams, matrix |

Plugins run **in-process** with the Gateway -- they have the same OS privileges. Only install trusted plugins.

### MCP Support

OpenClaw supports MCP (Model Context Protocol) through `mcporter`:
- Add/change MCP servers without restarting gateway
- Keeps core tool surface lean
- Decoupled from core runtime

---

## Hooks and Automation

### Built-in Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `session-memory` | `command:new` | Saves session context to memory on `/new` |
| `bootstrap-extra-files` | `agent:bootstrap` | Injects additional bootstrap files |
| `command-logger` | `command` | Audit log to `~/.openclaw/logs/commands.log` |
| `boot-md` | `gateway:startup` | Runs `BOOT.md` on gateway start |

### Event Types

- **Command events:** `command:new`, `command:reset`, `command:stop`
- **Session events:** `session:compact:before`, `session:compact:after`
- **Agent events:** `agent:bootstrap`
- **Gateway events:** `gateway:startup`
- **Message events:** `message:received`, `message:sent`, `message:transcribed`, `message:preprocessed`

### Custom Hook Example (Data Freshness Monitor)

```typescript
// ~/.openclaw/hooks/data-freshness/handler.ts
const handler = async (event) => {
  if (event.type !== "message" || event.action !== "received") return;
  if (!event.context.content?.includes("/freshness")) return;

  // Check data freshness and respond
  event.messages.push("Data freshness check initiated...");
};
export default handler;
```

### Webhook Hooks

External HTTP webhooks for triggering work:

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
    mappings: [
      {
        match: { path: "data-update" },
        action: "agent",
        agentId: "main",
        deliver: true,
      },
    ],
  },
}
```

---

## Migration Plan from Current Setup

### Phase 1: Local Evaluation (Week 1)

1. **Install OpenClaw locally**
   ```bash
   npm install -g openclaw@latest
   openclaw onboard --install-daemon
   ```

2. **Set up Anthropic API key**
   ```bash
   echo 'ANTHROPIC_API_KEY=sk-ant-...' >> ~/.openclaw/.env
   openclaw models status
   ```

3. **Create workspace with BengalOracle SOUL.md**
   - Copy the SOUL.md from this document into `~/.openclaw/workspace/SOUL.md`
   - Create IDENTITY.md, USER.md, HEARTBEAT.md

4. **Test via WebChat** (no channel setup needed)
   ```bash
   openclaw gateway --port 18789 --verbose
   # Open http://127.0.0.1:18789
   ```

### Phase 2: Telegram Integration (Week 2)

1. **Create NEW Telegram bot** via @BotFather (separate from existing bot)
2. **Configure Telegram channel** in `openclaw.json`
3. **Test DM and group functionality**
4. **Set up forum topics** for different agent concerns (data, simulation, social)
5. **Verify no conflict** with existing Telegram bots

### Phase 3: Automation Setup (Week 3)

1. **Configure heartbeat** for background monitoring
2. **Set up cron jobs** for:
   - Daily data refresh (6 AM)
   - Morning simulation brief (7:30 AM)
   - Game day monitoring (Sundays)
   - Social content generation (MWF noon)
   - Weekly calibration (Monday 5 AM)
3. **Test delivery** to Telegram topics
4. **Monitor token usage** and adjust schedules

### Phase 4: Production Hardening (Week 4)

1. **Run security audit:** `openclaw security audit --deep`
2. **Switch to allowlist** DM policy with explicit numeric IDs
3. **Enable command-logger** hook
4. **Set up secrets management** (env or SecretRef)
5. **Configure session resets** for cost management
6. **Set spend limits** on Anthropic console
7. **Document operational runbook**

### Phase 5: Feature Expansion (Ongoing)

1. **Custom skills** for BengalOracle-specific tools
2. **Custom hooks** for data pipeline integration
3. **Multi-agent setup** if separate personas needed (simulator vs social)
4. **MCP integration** for external data sources
5. **Evaluate sandboxing** for non-main sessions

### Data Migration Considerations

- OpenClaw does NOT natively connect to our existing data pipeline
- Custom skills or MCP servers needed to bridge existing tools
- Session data and memory start fresh -- no migration from current system
- API keys and credentials need separate setup in OpenClaw

---

## Pros, Cons, and Risks

### Pros

1. **Massive channel support** -- 22+ messaging platforms simultaneously, Telegram is first-class
2. **Production-ready Telegram integration** -- groups, topics, inline buttons, streaming, custom commands
3. **Built-in scheduler** -- cron jobs with isolated sessions, delivery to channels, retry policies
4. **Flexible agent identity** -- SOUL.md persona system maps perfectly to BengalOracle's brand
5. **Multi-agent support** -- separate agents for simulation, social, analytics if needed
6. **Security-first design** -- pairing, allowlists, sandboxing, exec approvals, audit tools
7. **Hot reload** -- config changes apply without gateway restart
8. **Active development** -- regular releases, active community (Discord), corporate sponsors (OpenAI, Vercel)
9. **MIT licensed** -- no vendor lock-in
10. **Secret management** -- SecretRef system supports 1Password, Vault, sops, env, file
11. **Webhook hooks** -- external systems can trigger agent work
12. **MCP support** via mcporter -- extensible tool ecosystem
13. **MITRE ATLAS threat model** -- formal security analysis exists

### Cons

1. **Token cost** -- agent paradigm consumes 5-10x more tokens than direct chat due to context re-sending
2. **Complexity** -- substantial configuration surface area; learning curve is real
3. **Single-user model** -- not designed for multi-tenant; one gateway per trust boundary
4. **No native data pipeline** -- custom skills/MCP needed to connect to our existing data sources
5. **Skill marketplace risk** -- ClawHub has had reports of malicious payloads (up to 20% compromised)
6. **Anthropic auth uncertainty** -- setup-token path may be blocked; API key is the only reliable path
7. **Node.js dependency** -- requires Node 22+ runtime
8. **Memory management** -- context windows fill up; requires active session management and compaction
9. **No built-in analytics** -- need to build monitoring/dashboards for simulation performance tracking
10. **Gateway uptime** -- single process; needs supervision (systemd/launchd) for reliability

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Token cost overrun | HIGH | Set Anthropic spend limits, use lightContext, schedule wisely |
| Bot token conflict with existing setup | MEDIUM | Use separate bot token, never reuse |
| ClawHub malicious skills | MEDIUM | Only install vetted skills, use `plugins.allow` |
| CVE exposure | MEDIUM | Stay updated, run `openclaw doctor`, monitor security advisories |
| Data pipeline integration gap | MEDIUM | Plan custom skill development in Phase 5 |
| Anthropic blocks non-Claude-Code usage | LOW | Use API key auth (not setup-token) |
| Gateway downtime | LOW | Use systemd/launchd supervision, set up health monitoring |
| Prompt injection via group messages | LOW | Use mention gating, allowlists, strong model tiers |
| Config complexity causing misconfig | LOW | Use `openclaw doctor`, start with minimal config, iterate |

---

## External Resources

### Official Documentation
- [OpenClaw Docs](https://docs.openclaw.ai)
- [Telegram Channel Docs](https://docs.openclaw.ai/channels/telegram)
- [Cron Jobs Docs](https://docs.openclaw.ai/automation/cron-jobs)
- [Security Docs](https://docs.openclaw.ai/gateway/security)
- [SOUL.md Template](https://docs.openclaw.ai/reference/templates/SOUL)
- [Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)

### Community and Guides
- [OpenClaw Discord](https://discord.gg/clawd)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [ClawHub (Skills Marketplace)](https://clawhub.com)
- [DeepWiki Analysis](https://deepwiki.com/openclaw/openclaw)

### Security Resources
- [Microsoft Security Blog: Running OpenClaw Safely](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/)
- [SlowMist Security Practice Guide](https://github.com/slowmist/openclaw-security-practice-guide)
- [DigitalOcean: 7 Security Challenges](https://www.digitalocean.com/resources/articles/openclaw-security-challenges)
- [Hostinger Security Best Practices](https://www.hostinger.com/tutorials/openclaw-security)

### Setup Guides
- [Claude + OpenClaw Production Setup (Clawctl)](https://www.clawctl.com/blog/claude-openclaw-setup-guide)
- [Anthropic Provider Setup (CrewClaw)](https://www.crewclaw.com/blog/openclaw-anthropic-ollama-provider-setup)
- [Telegram Bot Setup Guide](https://www.getopenclaw.ai/en/help/telegram-bot-setup-guide)
- [Complete Telegram Integration (C# Corner)](https://www.c-sharpcorner.com/article/the-complete-guide-to-integrating-telegram-with-openclaw-2026-the-steps-most/)
- [Multiple Agents with Telegram (GitHub Gist)](https://gist.github.com/bdennis-dev/b876ab61047df62561cf163c4a4d5bca)

### SOUL.md and Agent Persona Resources
- [Awesome OpenClaw Agents (162 templates)](https://github.com/mergisi/awesome-openclaw-agents)
- [OpenClaw Agent Personalities Collection](https://github.com/will-assistant/openclaw-agents)
- [soul.md Builder Tool](https://github.com/aaronjmars/soul.md)
- [SOUL.md Crafting Guide (OpenClaws)](https://openclaws.io/blog/openclaw-soul-md-guide)

### Automation Resources
- [Cron Jobs Guide (Stack Junkie)](https://www.stack-junkie.com/blog/openclaw-cron-jobs-automation-guide)
- [Cron Scheduler Guide (LumaDock)](https://lumadock.com/tutorials/openclaw-cron-scheduler-guide)
- [Complete Architecture Guide (Medium)](https://medium.com/@rentierdigital/the-complete-openclaw-architecture-that-actually-scales-memory-cron-jobs-dashboard-and-the-c96e00ab3f35)
