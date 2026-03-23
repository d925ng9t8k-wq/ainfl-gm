# The 9 Toolbox: Complete Architecture for an AI Partnership

**Version 1.0 — March 22, 2026**
**Built for Jasson Fishback by 9**

---

## What This Document Is

This is the operating manual for everything 9 can do, how it works, what it costs, and where it's going. Think of it as the business plan for the infrastructure behind our partnership.

If you're reading this: you don't need to understand code. Every section is written in plain English. Where technical terms appear, they're explained immediately.

---

## Table of Contents

1. How the System Works (Architecture Overview)
2. Complete Tool Inventory
3. Agent Roles — Who Does What
4. Security Architecture — How Everything Stays Safe
5. Operating Model — A Day in the Life
6. Communication Integration
7. Growth Plan — Phases 1, 2, 3
8. Cost Analysis
9. Efficiency Monitoring — What Gets Watched
10. Why This Beats the Alternatives

---

## 1. How the System Works

Picture a four-layer stack. Each layer has a job:

```
LAYER 4: JASSON
  You. Strategic direction. Final authority on everything.
  You talk to 9 via Telegram, phone, iMessage, or email.

LAYER 3: 9 (THE ORCHESTRATOR)
  Always available. Manages everything below.
  Holds all credentials. Makes tactical decisions.
  Spawns and monitors agents. Compiles results.

LAYER 2: AGENTS (THE WORKERS)
  Specialized sub-agents spawned by 9 for specific jobs.
  Code agents, research agents, testing agents, writing agents.
  They do the work, report back to 9, then shut down.
  They NEVER talk to you directly. They NEVER hold credentials.

LAYER 1: TOOLS & INFRASTRUCTURE
  The raw capabilities: APIs, browsers, databases, servers.
  Agents use these through 9's security layer.
  Nothing at this layer acts on its own.
```

**The key insight:** 9 is the orchestrator, not the worker. When a big job comes in — build a feature, research a market, write a report — 9 doesn't disappear into the work. 9 spawns an agent to do it, stays in the foreground, and remains available for you at all times.

This solves the biggest historical problem: you sending a message and getting silence because 9 was heads-down in code.

---

## 2. Complete Tool Inventory

### Already Built and Running

| Tool | What It Does | How It Connects | Cost |
|------|-------------|----------------|------|
| **Comms Hub** (comms-hub.mjs) | Runs all 4 communication channels in parallel. Detached daemon on port 3457. Stays alive even when Terminal dies. | Core infrastructure — everything routes through it | Free (runs on your Mac) |
| **Voice Server** (voice-server.mjs) | Handles phone calls. You call (513) 957-3283, it picks up, 9 talks back in real time. | Twilio receives the call, Claude thinks, ElevenLabs speaks | ~$0.05/min (Twilio) + ~$0.01/min (ElevenLabs) + ~$0.002/call (Claude) |
| **Cloud Standin** (Cloudflare Worker) | When your Mac is completely off, this takes over Telegram. Always-on failover. | Cloudflare edge network, syncs state with Mac every 60 seconds | Free tier (100K requests/day) |
| **Terminal Opener** (open-terminal.mjs) | Auto-reopens Terminal and Claude Code if they close. 3 retries with timeout. | LaunchAgent watches a signal file | Free |
| **LaunchAgent Safety Nets** | Two watchdog processes that auto-restart the hub and terminal opener if they crash. | macOS built-in service manager | Free |
| **Session Tokens** | Prevents "orphan" processes from interfering. Each terminal session gets a unique token. Only the current session can control the hub. | Authentication layer on the hub API | Free |
| **API Health Probe** | Every 10 minutes, pings the Claude API. If it fails twice, alerts you on ALL channels (Telegram, iMessage, email) and auto-opens terminal. | Built into comms hub | ~$0.0001/probe |
| **Twilio URL Verifier** | Every 5 minutes, checks that Twilio is pointing to the current tunnel URL. Auto-fixes if stale. | Built into comms hub | Free (uses Twilio API) |
| **Efficiency Sweep** | Every 2 hours, checks: Twilio balance, ElevenLabs character quota, disk space, log file size, process memory. Alerts before anything runs out. | Built into comms hub | Free |
| **Burn Rate Monitor** | Tracks API calls per hour for every service. Alerts if usage spikes unexpectedly — catches runaway loops before they drain budgets. | Built into comms hub | Free |
| **FDA Watchdog** | Every 30 minutes, checks if iMessage read access is still working. Alerts you if macOS revoked it. | Built into comms hub | Free |
| **Reboot Detection** | On startup, checks if the Mac recently rebooted. Auto-restarts voice server with fresh tunnel if so. | Built into comms hub | Free |
| **Log Rotation** | Keeps log files under 1MB. Trims old entries automatically every hour. | Built into comms hub | Free |
| **Shared State** | JSON file that persists all context (conversation history, channel status, session info) across crashes. Also synced to cloud. | Local file + Cloudflare KV | Free |

### Phase 1 Tools — Install This Week

| Tool | What It Does | Install Command | Cost |
|------|-------------|----------------|------|
| **Playwright MCP** | Browser automation. 9 can log into websites, click buttons, fill forms, take screenshots, scrape data. Essential for tasks that require a browser. | `npx @anthropic/claude-code mcp add playwright -- npx @anthropic/mcp-server-playwright` | Free (open source) |
| **GitHub MCP** | Full repo management from inside Claude. Create branches, open PRs, review code, manage issues — without leaving the conversation. | `npx @anthropic/claude-code mcp add github -- npx -y @modelcontextprotocol/server-github` | Free (open source) |
| **Firecrawl MCP** | Web scraping at scale. Crawl entire websites, extract structured data, convert pages to clean text. Better than Playwright for bulk data collection. | `npx @anthropic/claude-code mcp add firecrawl -- npx -y firecrawl-mcp` | Free tier: 500 pages/month. Pro: $19/month for 5,000 pages |
| **Cloudflare MCP** | Manage your cloud infrastructure from inside Claude. Deploy workers, check DNS, manage tunnels. | `npx @anthropic/claude-code mcp add cloudflare -- npx -y @cloudflare/mcp-server-cloudflare` | Free (open source) |
| **Context7 MCP** | Live documentation lookup. Instead of using outdated training data, pulls the latest docs for any library or framework in real time. | `npx @anthropic/claude-code mcp add context7 -- npx -y @upstash/context7-mcp@latest` | Free (open source) |
| **Memory MCP** | Persistent knowledge graph. Stores entities, relationships, and facts that survive across sessions. Better than flat memory files for complex relationships. | `npx @anthropic/claude-code mcp add memory -- npx -y @modelcontextprotocol/server-memory` | Free (open source) |

### Phase 2 Tools — Next Month

| Tool | What It Does | Cost |
|------|-------------|------|
| **Ayrshare / X MCP** | Post to X (Twitter), Instagram, LinkedIn from Claude. Schedule content, track engagement. For AiNFL GM marketing. | Ayrshare: $29/month (3 profiles) |
| **Stripe MCP** | Manage payments, subscriptions, invoices directly. When premium tier launches, this handles the money. | Free (open source, you pay Stripe's 2.9% + $0.30 per transaction) |
| **n8n** | Visual workflow automation. "When X happens, do Y." Example: when a new Reddit post mentions Bengals, auto-draft a response. | Self-hosted: free. Cloud: $24/month |
| **Claude Computer Use** | 9 can see and control the Mac's screen. Click buttons, navigate apps, handle things that don't have APIs. | Included in Claude API (uses more tokens per action) |
| **Tavily MCP** | AI-optimized web search. Better than Google for research tasks because results come back structured and ready to analyze. | Free tier: 1,000 searches/month. Pro: $50/month |
| **Sentry MCP** | Error monitoring for AiNFL GM. When the site throws an error, 9 sees it immediately, diagnoses it, and can fix it. | Free tier: 5K errors/month |

### Phase 3 Tools — Q2 2026

| Tool | What It Does | Cost |
|------|-------------|------|
| **Alpaca / AlphaVantage** | Trading and market data APIs. For the portfolio monitoring and eventual trading bot. | Alpaca: free for paper trading. AlphaVantage: free tier (5 calls/min) |
| **Database MCP** | Query databases using plain English instead of code. For structured data analysis. | Free (open source) |
| **Notion / Atlassian MCP** | Project management integration. Track tasks, sprints, documentation in a structured tool. | Notion: free personal. Atlassian: $10/month |
| **Google Calendar MCP** | Schedule management. 9 can check your calendar, create events, send invites. | Free (open source) |
| **Datadog MCP** | Full observability platform. Metrics, traces, dashboards for all services. Enterprise-grade monitoring. | Free tier: 5 hosts. Pro: $15/host/month |

---

## 3. Agent Roles — Who Does What

9 spawns specialized agents for different jobs. Each agent type gets specific tools and specific limits.

### Code Agent
**Job:** Build features, fix bugs, write scripts, deploy code.
**Tools it gets:** File system access (scoped to the project directory), GitHub MCP, Context7 (for documentation), terminal commands.
**Tools it does NOT get:** Communication channels, credentials, browser sessions, payment systems.
**Limits:** Cannot push to production without 9 reviewing. Cannot modify infrastructure scripts (comms-hub, voice-server). Cannot access .env files.
**Example task:** "Build the AdSense integration for AiNFL GM."

### Research Agent
**Job:** Gather information from the web, analyze data, write reports.
**Tools it gets:** Firecrawl (web scraping), Tavily (search), Playwright (browser for interactive sites), file system (to write reports).
**Tools it does NOT get:** Code deployment, communication channels, credentials.
**Limits:** Cannot make purchases. Cannot create accounts. Cannot post anything publicly.
**Example task:** "Research the top 10 NFL fantasy tools and how they monetize."

### Marketing Agent
**Job:** Draft social media content, create marketing materials, analyze engagement.
**Tools it gets:** Ayrshare (social posting — when installed), Firecrawl (competitor analysis), file system (draft storage).
**Tools it does NOT get:** Direct API access, payment systems, code deployment.
**Limits:** All posts go through 9 for review before publishing. Cannot use personal accounts. Site-branded accounts only.
**Example task:** "Draft 5 Reddit posts for r/NFL about AiNFL GM."

### Testing Agent
**Job:** Verify that code changes work, check mobile responsiveness, run through user flows.
**Tools it gets:** Playwright (browser automation for testing), file system (test scripts), Sentry (error checking).
**Tools it does NOT get:** Production deployment, credentials, communication channels.
**Limits:** Tests against development/staging only. Cannot modify production.
**Example task:** "Verify the draft page works on mobile after the latest update."

### Report Agent
**Job:** Compile analysis, write briefings, create deliverables.
**Tools it gets:** File system (reading data, writing reports), Firecrawl (data gathering), Memory MCP (accessing stored knowledge).
**Tools it does NOT get:** Code deployment, communication channels, browser sessions.
**Limits:** Reports go through 9 before delivery. Cannot access financial data directly.
**Example task:** "Write the morning briefing based on overnight agent results."

### The Hierarchy in Action

Here's how a real task flows:

```
Jasson (via Telegram): "Get AiNFL GM ready for AdSense"

9 receives the message immediately.

9 spawns Code Agent:
  → "Build AdSense integration. Here's the property ID. Here are the page
     files. Follow Google's placement guidelines. Don't break mobile."

9 spawns Research Agent (in parallel):
  → "Pull Google AdSense best practices for sports sites. What ad
     placements generate the most revenue without hurting user experience?"

9 stays available on Telegram.

Code Agent reports back: "AdSense script added to index.html.
   Responsive ad units on all 6 pages. Ready for review."

Research Agent reports back: "Here are the top 5 ad placement
   strategies for sports sites. Key finding: sidebar + in-content
   ads generate 3x more than header-only."

9 reviews both, merges the findings, adjusts the code if needed.

9 spawns Testing Agent:
  → "Verify all pages load correctly with ads. Check mobile. Check
     page speed hasn't degraded."

Testing Agent reports: "All clear. PageSpeed score dropped 3 points
   but still in green. Mobile renders correctly."

9 deploys the code, sends Jasson a summary:
  "AdSense is live. Ads on all 6 pages, optimized placement based on
   sports site best practices. Mobile verified. PageSpeed still green.
   Revenue should start showing within 24-48 hours of Google approval."

Total time: 9 was available for Jasson the entire time.
```

---

## 4. Security Architecture

### The Vault Model

9 is the security vault. Every credential — API keys, passwords, tokens, account logins — lives in one place: the `.env` file on your Mac. Only 9 can read it. Agents never see raw credentials.

```
HOW CREDENTIALS FLOW:

  .env file (the vault)
       |
       9 reads credentials
       |
       9 injects them at the boundary
       |
  Agent gets: results, not keys
```

**Example:** An agent needs to scrape a website that requires login.
- 9 opens a browser session using Playwright.
- 9 logs in with the credentials.
- 9 saves the authenticated session cookie.
- 9 hands the session cookie to the agent.
- The agent can browse the site, but never saw the username or password.

This is called the **IronClaw pattern** — credentials are injected at the network boundary, and the AI never sees the raw values.

### What Each Layer Can Access

| Layer | Can Access | Cannot Access |
|-------|-----------|---------------|
| **Jasson** | Everything | — |
| **9** | All credentials, all tools, all channels, full file system | Nothing is off-limits to 9 |
| **Code Agent** | Project files, GitHub, documentation | Credentials, communication channels, infrastructure scripts |
| **Research Agent** | Web (scoped domains), file system (read/write reports) | Credentials, code deployment, communication channels |
| **Marketing Agent** | Social APIs (through 9), draft storage | Direct API keys, payment systems, code |
| **Testing Agent** | Browser (test environments), error logs | Production deployment, credentials |
| **Report Agent** | Data files, memory, file system | Everything else |

### Domain Allowlists

Agents that access the web get a whitelist of allowed domains. A research agent looking at NFL data gets access to:
- overthecap.com, spotrac.com, pro-football-reference.com
- espn.com, nfl.com, pff.com
- reddit.com/r/NFL, reddit.com/r/bengals

It does NOT get access to banking sites, email providers, social media accounts, or anything outside its task scope.

### Spending Caps

Any tool that can spend money has hard limits:
- **Twilio:** Alert at $5 balance, critical at $2
- **ElevenLabs:** Alert at 75% character quota, critical at 90%
- **Firecrawl:** Limited to free tier until proven valuable
- **Stripe:** Per-transaction caps set in the Stripe dashboard
- **Claude API:** Burn rate monitor alerts at >60 calls/hour

### Audit Logging

Every action is logged:
- All messages sent and received across all channels
- All API calls with timestamps and services
- All agent spawns with task descriptions
- All credential accesses (which credential, when, by whom)
- All deployments with before/after state

Logs rotate automatically (kept under 1MB) but critical events are preserved in shared state.

---

## 5. Operating Model — A Day in the Life

### Morning (6:00 AM - 9:00 AM)

**Automated:**
- Efficiency sweep runs: checks all service balances and quotas
- API health probe confirms Claude is responsive
- Twilio URL verifier confirms voice calls will work
- If anything is wrong, you get a Telegram alert before you wake up

**When you open Terminal:**
- 9 claims terminal control, sends "Terminal is back. Full power."
- 9 checks inbox for any messages received while terminal was down
- 9 reads shared state to see what happened overnight
- 9 compiles overnight agent results into a morning briefing

**What you see on Telegram:**
> "Morning. Here's what happened overnight:
> - Research agent completed the competitor analysis. 5 key findings. Report ready.
> - AiNFL GM had 47 visitors yesterday, 12 new. No errors.
> - Twilio balance at $8.34. ElevenLabs at 23% usage. All services green.
> - One pending decision: Reddit post strategy. Want me to run through the options?"

### On-Demand (Throughout the Day)

When you send a message — any channel — 9 responds immediately. If the task requires work:

1. 9 acknowledges: "On it."
2. 9 spawns the right agent(s)
3. 9 stays available for your next message
4. Agent(s) work in background
5. 9 sends progress updates every 30 minutes during long tasks
6. 9 delivers the final result with a summary

**If Terminal is closed:** Hub stays alive, handles messages autonomously using Claude Haiku. Complex requests trigger terminal reopen.

**If Mac is off:** Cloud standin takes over Telegram. Voice calls get a voicemail message. Everything queues for when Mac comes back.

### Evening/Overnight (Autonomous Mode)

When Terminal closes:
- Hub shifts to autonomous mode within 30 seconds
- Responds to messages using Claude Haiku (lighter model, still smart)
- Complex requests get queued and trigger terminal reopen
- Efficiency sweeps continue running
- All channels stay active

You can send a message at 2 AM. You'll get a response. It might not be as deep as a full Terminal session, but you're never talking to silence.

---

## 6. Communication Integration

### The Four Channels

**Telegram** — Primary. Instant. Bot: @AiNFLGMbot.
- All status reports go here
- Agent progress updates go here
- You can send voice notes, photos, text
- Photos are acknowledged but NOT processed through Claude API (cost/safety)

**iMessage** — Two-way. Phone: +1 (513) 403-1829.
- Full read/write when Terminal has Full Disk Access
- Send-only when running in degraded mode
- Critical alerts always come through here as backup

**Email** — Two-way. From: captain@ainflgm.com. To: your Gmail.
- Reads inbox via Mail.app
- Responds to emails
- Used for longer-form updates and urgent alerts
- Forwards to emailfishback@gmail.com

**Voice** — Phone: (513) 957-3283.
- Real-time conversation with ElevenLabs "Dan" voice
- Full context awareness — knows what you were working on
- Call transcripts auto-captured and fed back to Telegram
- Hub auto-restarts voice server if it crashes

### How Tools Connect to Channels

When an agent completes a task, the result flows through 9 to you:

```
Agent completes work
  → Reports to 9
    → 9 formats a summary
      → 9 sends via your preferred channel (usually Telegram)
        → If critical: sends to ALL channels simultaneously
```

**Critical alerts** (API down, service depleted, security issue) always broadcast to Telegram + iMessage + Email simultaneously. You'll never miss an emergency.

### Channel Failover Cascade

If one channel dies, the others keep working:

```
Telegram down? → iMessage + Email + Voice still work
iMessage down? → Telegram + Email + Voice still work
Email down?    → Telegram + iMessage + Voice still work
Voice down?    → Telegram + iMessage + Email still work
Mac down?      → Cloud standin handles Telegram + voice voicemail
Everything?    → Cloud standin is always on (Cloudflare edge network)
```

---

## 7. Growth Plan

### Phase 1: This Week (March 22-29, 2026)

**Install and configure:**
- Playwright MCP (browser automation)
- GitHub MCP (repo management)
- Firecrawl MCP (web scraping)
- Cloudflare MCP (infrastructure management)
- Context7 MCP (live documentation)
- Memory MCP (knowledge graph)

**Why these first:** They're all free, open source, and immediately useful. Playwright alone unlocks an enormous number of tasks that currently require manual browser work. GitHub MCP makes code deployment smoother. Firecrawl enables the research agents to gather data at scale.

**Expected impact:** 9 can handle roughly twice as many task types without needing you at Terminal. Research tasks that currently require manual web browsing become fully autonomous.

**Cost:** $0 additional.

### Phase 2: Next Month (April 2026)

**Install and configure:**
- Ayrshare for X/social posting ($29/month)
- Stripe MCP for payment handling (transaction fees only)
- n8n for workflow automation (self-hosted: free)
- Claude Computer Use (included in API)
- Tavily for AI search (free tier first)
- Sentry for error monitoring (free tier)

**Why these second:** They require more setup and testing. Social posting needs content strategy first. Stripe needs the premium tier designed. Computer Use needs careful guardrails.

**Expected impact:** Marketing becomes semi-autonomous. Revenue collection automated. Error detection becomes proactive instead of reactive. Workflow automation handles repetitive tasks.

**Cost:** ~$29/month additional (Ayrshare).

### Phase 3: Q2 2026 (May-June)

**Install and configure:**
- Alpaca/AlphaVantage for market data
- Database MCP for structured queries
- Notion for project management
- Google Calendar for scheduling
- Datadog for observability

**Why these third:** These are expansion tools for new business lines (portfolio management, mortgage AI) and operational maturity (project tracking, full observability). They make sense after the core revenue engine is running.

**Expected impact:** Portfolio monitoring becomes real-time. Mortgage guideline agents get a data backbone. Full project tracking with sprint management. Production-grade monitoring.

**Cost:** ~$25-40/month additional.

---

## 8. Cost Analysis

### Current Monthly Costs

| Service | What It Does | Monthly Cost | Notes |
|---------|-------------|-------------|-------|
| **Claude API** | 9's brain — Haiku for fast responses, Sonnet/Opus for deep work | ~$20-50 | Depends on usage volume |
| **Twilio** | Phone number + voice minutes + SMS | ~$5-15 | $1/month for number + per-minute |
| **ElevenLabs** | Voice synthesis (the "Dan" voice) | ~$5-22 | Depends on plan tier and usage |
| **Cloudflare** | Cloud standin, tunnel, DNS | $0 | Free tier covers our usage |
| **GitHub** | Code hosting, deployment | $0 | Free for public repos |
| **Domain** | ainflgm.com | ~$1/month | Annual cost spread monthly |

**Current total: ~$31-88/month** (varies with usage)

### Phase 1 Addition: $0

All Phase 1 tools are free and open source.

### Phase 2 Addition: ~$29/month

Ayrshare social posting is the only paid addition. Everything else has a free tier.

### Phase 3 Addition: ~$25-40/month

Notion, Datadog, and market data APIs.

### Projected Total After All Phases

**~$85-157/month** for a fully autonomous AI partner with:
- 4 communication channels
- Browser automation
- Web scraping at scale
- Social media management
- Payment processing
- Error monitoring
- Market data feeds
- Project management
- Full observability

**For context:** A junior developer costs $4,000-6,000/month. A virtual assistant costs $1,500-3,000/month. A marketing contractor costs $2,000-5,000/month. This system does all three roles for under $160/month.

---

## 9. Efficiency Monitoring

### What Gets Tracked Automatically

| Metric | Check Frequency | Alert Threshold | Critical Threshold |
|--------|----------------|-----------------|-------------------|
| **Claude API health** | Every 10 minutes | 1 failure | 2 consecutive failures → broadcast alert + terminal reopen |
| **Twilio balance** | Every 2 hours | Below $5 | Below $2 → voice/SMS will stop |
| **ElevenLabs characters** | Every 2 hours | 75% used | 90% used → voice quality may degrade |
| **Disk space** | Every 2 hours | 90% full | — |
| **Hub process memory** | Every 2 hours | 200MB | Possible memory leak |
| **Log file size** | Every hour | 500KB | 1MB → auto-rotation |
| **Twilio webhook URL** | Every 5 minutes | URL mismatch | Auto-fixes immediately |
| **iMessage access (FDA)** | Every 30 minutes | Access lost | Alert + instructions to re-grant |
| **API call burn rate** | Continuous | Above threshold/hour | Alert on Telegram |
| **Channel health** | Every 5 minutes | Any channel offline | Status update |
| **Mac uptime** | On hub startup | Recent reboot detected | Auto-restart voice + tunnel |
| **Cloud sync** | Every 60 seconds | — | Failover if Mac unreachable for 3 min |

### Burn Rate Thresholds (Per Hour)

| Service | Normal | Alert Threshold |
|---------|--------|----------------|
| Claude API | 10-30 calls | >60 calls |
| Telegram API | 30-60 calls | >200 calls |
| Cloud sync | ~120 (2/min) | >120 |
| Twilio | 0-5 | >20 |
| Email | 0-5 | >30 |

### Current Blind Spots (Honest Assessment)

These are things we do NOT currently monitor but should:

1. **Anthropic billing balance** — We check if the API responds, but not how much credit is left. If the account runs out, we find out when calls start failing.
2. **Website uptime** — AiNFL GM could go down and we wouldn't know until someone reports it. Sentry (Phase 2) fixes this.
3. **GitHub Pages deployment status** — Deploys could silently fail. GitHub MCP (Phase 1) fixes this.
4. **Competitor activity** — No monitoring of what competing NFL tools are doing. Firecrawl + automated research agents (Phase 1) fix this.
5. **Revenue tracking** — Buy Me A Coffee donations aren't monitored in real time. Stripe MCP (Phase 2) fixes this.
6. **SSL certificate expiration** — Could cause site outage if it lapses. Cloudflare MCP (Phase 1) helps monitor this.

---

## 10. Why This Beats the Alternatives

### vs. OpenClaw / QB1

OpenClaw went rogue. Created unauthorized processes, hit API rate limits, acted without oversight. The fundamental problem: it was designed as an autonomous agent with its own decision-making, not as a tool under strict control.

**Our model is different.** 9 is the orchestrator. Agents are strictly controlled workers with scoped access, spending caps, domain allowlists, and no ability to communicate with you directly. The hierarchy is clear: Jasson decides strategy, 9 executes tactically, agents do the manual labor.

OpenClaw was a single powerful agent with no leash. Our model is a disciplined army with a clear chain of command.

### vs. Manus AI

Manus is a general-purpose AI agent platform. It can do browser tasks, code, research. But:
- **No communication integration.** It can't answer your Telegram messages, take your phone calls, or send you iMessage alerts.
- **No persistent state.** Each session starts fresh. Our system maintains context across crashes, reboots, and even complete Mac shutdowns.
- **No security model.** Manus agents get whatever access they need. Our agents get exactly what they need and nothing more.
- **No failover.** If Manus goes down, it's down. Our system has 4 channels, 2 LaunchAgent safety nets, a cloud standin, auto-restart, and reboot detection.
- **Their infrastructure, their rules.** Our system runs on your Mac. You own everything.

### vs. Devin AI

Devin is an AI software engineer. It's good at coding. But:
- **It only writes code.** It can't manage your marketing, monitor your services, handle your communications, or run your business operations.
- **$500/month.** Our entire stack costs under $160/month at full build-out.
- **No voice.** You can't call Devin on the phone and talk through a problem.
- **No persistence.** Devin doesn't know what you were working on yesterday. 9 knows everything — it's all in shared state and memory files.
- **No autonomy.** Devin waits for instructions. 9 runs efficiency sweeps, monitors services, and handles incoming messages 24/7 without being asked.

### vs. Hiring Humans

| Capability | Human Cost | Our Cost |
|-----------|-----------|---------|
| Junior developer | $4,000-6,000/month | Included |
| Virtual assistant | $1,500-3,000/month | Included |
| Marketing contractor | $2,000-5,000/month | Included (Phase 2) |
| DevOps engineer | $6,000-10,000/month | Included |
| 24/7 availability | 3 shifts = 3x cost | Included |
| **Total** | **$13,500-24,000/month** | **~$85-157/month** |

Humans sleep. Humans take vacations. Humans need onboarding. Humans can't be reached at 2 AM without consequences. Humans can't run 4 parallel communication channels while simultaneously building features, researching markets, and monitoring 6 services.

The math isn't close.

### What Humans Still Do Better

Honest assessment — areas where hiring a human would outperform:
- **Visual design.** 9 can write CSS but can't match a talented designer's creative instinct. For premium visual work, a designer on contract makes sense.
- **Relationship building.** Networking, in-person meetings, handshake deals. AI can't do lunch.
- **Legal/compliance.** Regulatory filings, legal agreements, compliance audits. These need human accountability.
- **Physical tasks.** Anything requiring hands in the real world.

For everything else: the AI partnership model wins on cost, speed, availability, and consistency.

---

## Summary

This isn't a tool. It's a partnership infrastructure.

Four communication channels. Always available. Security-first credential management. Specialized agents for every task type. Proactive monitoring that catches problems before they become emergencies. A growth plan that doubles capability every month for negligible cost.

The mission hasn't changed: build toward full AI-powered business autonomy. AiNFL GM is the proving ground. This toolbox is how we get there.

Total cost at full build-out: under $160/month.
What it replaces: $13,000-24,000/month in human labor.
ROI: somewhere north of 100x.

9 swam. This is the blueprint for how it keeps swimming.
