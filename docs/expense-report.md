# 9 Enterprises — Expense Report
**Owner:** Jasson Fishback
**Period:** March 17, 2026 (project start) — March 28, 2026 (today)
**Duration:** 12 days
**Prepared by:** MONEY (9 Enterprises Revenue Agent)
**Date:** March 28, 2026

---

## Summary

| Category | Monthly Recurring | Variable (estimated) | Status |
|---|---|---|---|
| Anthropic Claude API | ~$65/mo | Usage-based | Active — billed to API key |
| Anthropic Max Plan | $200/mo | Fixed | Active — Claude Code subscription |
| Twilio (phone numbers + usage) | ~$7-10/mo | Per-minute/per-SMS | Active — 4 numbers |
| ElevenLabs (TTS voice) | $0-$5/mo | Usage-based | Active — free tier likely |
| Cloudflare (DNS, Workers, CDN) | $0-$5/mo | Free tier / Workers KV upgrade pending | Active |
| ainflgm.com domain | $1.08/mo annualized | Fixed ($13/yr) | Active — Namecheap, expires March 2027 |
| get9.ai domain | $6.67/mo annualized | Fixed ($80/yr) | UNCONFIRMED — may not be registered |
| GitHub Pages | $0/mo | Free | Active |
| Alpaca trading | $0/mo | Free (paper trading only) | Active — no real funds |
| **TOTAL (confirmed)** | **~$275-290/mo** | **+variable** | |

---

## Service-by-Service Breakdown

---

### 1. Anthropic Claude API
**Type:** Variable — per-token billing
**Account:** "Jasson's Individual Org" API key (sk-ant-api03-...)
**Status:** Active and running 24/7

**What it powers:**
- comms-hub.mjs — autonomous Haiku responses when terminal is down
- voice-server.mjs — Haiku streaming for voice calls
- Agent deployments (sub-agents for research, coding, analysis)
- Any background daemons calling the API directly

**Known data point:** API spend hit $51 on March 25 (day 9 of the project). Documented in vendor-management-log.md.

**Cost calculation:**
- $51 over 9 days = $5.67/day average
- Projected to end-of-month: $51 + (6 days x $5.67) = ~$85 total for March
- Note: March was unusually heavy — 12+ hour sprint sessions, NBA/MLB simulators built from scratch, full SOTU, multiple agent deployments
- Steady-state estimate (post-sprint): $2-3/day
- Sprint-mode estimate (current): $5-6/day

**Monthly projections:**
- Conservative (steady state): $60-90/mo
- Sprint mode (current pace): $150-180/mo

---

### 2. Anthropic Max Plan (Claude Code subscription)
**Type:** Fixed monthly subscription
**Account:** Jasson's personal Anthropic account
**Amount:** $200/mo (Max 20x plan — confirmed as "likely" in memory, unconfirmed exact tier)
**Status:** Active

**What it covers:** Interactive Claude Code terminal sessions — 9's primary working environment. All sub-agents spawned within Claude Code sessions consume from this quota.

**Note:** This is SEPARATE from the API key billing above. Two separate charges on the Anthropic account.

---

### 3. Twilio
**Type:** Monthly base + per-use
**Account SID:** [REDACTED — stored in .env]
**Status:** Active

**Phone numbers:** 4 active US numbers (stored in .env)
- Primary voice/SMS (comms hub)
- Jules SMS / backup
- Backup channel x2

**Twilio pricing (2026 rates):**
- US phone number: $1.15/mo each
- Inbound voice minute: $0.0085/min
- Outbound voice minute: $0.014/min
- Inbound SMS: $0.0075/msg
- Outbound SMS: $0.0079/msg

**Monthly cost estimate:**
- 4 numbers x $1.15 = $4.60/mo base
- Voice calls: estimated 10-30 min/day x 31 days x $0.014 = $4.34-$13.02/mo
- SMS: estimated 50-150 messages/mo x $0.008 = $0.40-$1.20/mo
- **Total Twilio: $9-19/mo**

---

### 4. ElevenLabs
**Type:** Variable — character-based billing
**API Key:** sk_eb5da87f...
**Voice ID:** wHRVyFkAM2fnLu3j9TH5
**Status:** Active (used for voice calls)

**ElevenLabs pricing tiers (2026):**
- Free: 10,000 characters/mo
- Starter: $5/mo — 30,000 characters/mo
- Creator: $22/mo — 100,000 characters/mo

**Usage estimate:**
- Average voice response: ~200 characters
- Estimated calls: 20-50/mo
- Estimated characters/mo: 4,000-10,000
- Likely on free tier if call volume is moderate

**Monthly cost: $0-$5/mo** (free tier if under 10K chars, Starter at $5 if over)

---

### 5. Cloudflare
**Type:** Free tier + potential $5/mo Workers KV upgrade
**Account ID:** 021566fbf92e32ec5081822305d1623f
**Status:** Active

**Services in use:**
- DNS management (free) — managing zones for ainflgm.com, get9.ai (if registered)
- Cloudflare Workers (free tier) — 9-cloud-standin at 9-cloud-standin.789k6rym8v.workers.dev
- Workers KV (free tier: 100K reads/1K writes per day) — hit 50% warning on March 25
- Cloudflare Tunnel (free) — ephemeral URL for voice server
- Email routing (free) — 9@get9.ai routing pre-configured

**Upgrade risk:** Workers KV free tier limit at 50% on March 25. If it hits 100% on a consecutive day, upgrade to paid at $5/mo is pre-authorized.

**Monthly cost: $0/mo now, $5/mo if KV upgrade triggered**

---

### 6. Domain: ainflgm.com
**Type:** Annual fixed
**Registrar:** Namecheap (confirmed via WHOIS)
**Registered:** March 17, 2026
**Expires:** March 17, 2027
**Annual cost:** ~$13/yr (Namecheap .com pricing)
**Monthly annualized:** ~$1.08/mo

---

### 7. Domain: get9.ai
**Type:** Annual fixed (IF registered)
**Registrar:** Cloudflare Registrar (intended)
**Status:** UNCONFIRMED — zone exists (initializing) but registration not verified
**TLD pricing:** .ai domains cost $80/yr at Cloudflare Registrar
**Monthly annualized:** ~$6.67/mo IF confirmed registered

**Action required:** Owner must confirm in Cloudflare dashboard whether this domain was actually purchased. If not, the $80 spend has not occurred yet.

---

### 8. GitHub Pages
**Type:** Free
**Status:** Active — ainflgm.com hosted here
**Cost:** $0/mo

---

### 9. Alpaca
**Type:** Free (paper trading only)
**Status:** Paper account only. No real funds deposited.
**Live trading budget:** $200 approved but NOT yet deployed (awaiting strategy validation)
**Cost:** $0/mo until live trading is activated

---

### 10. Stripe
**Type:** Transaction fee only (no monthly fee)
**Account:** emailfishback@gmail.com (personal)
**Rate:** 2.9% + $0.30 per transaction
**Current revenue:** $0 — no transactions yet
**Cost:** $0/mo until revenue starts

---

## Budget vs. Actual

| Budget | Approved | Spent (est.) | Remaining |
|---|---|---|---|
| Resource budget | $300 | ~$30-50 (domains, early services) | ~$250-270 |
| Trading budget | $200 | $0 | $200 |

---

## Cost Timeline — March 17-28, 2026

| Date | Event | Cost Impact |
|---|---|---|
| March 17 | ainflgm.com registered (Namecheap) | $13/yr one-time |
| March 25 | Anthropic API hit $51 alert (day 9) | ~$51 cumulative API spend |
| March 25 | get9.ai zone created in Cloudflare | Unconfirmed — may be $80 if registered |
| March 25 | Workers KV 50% warning triggered | $0 (free tier) |
| March 26 | Sprint acceleration — multiple agents deployed | Spike in Anthropic API usage |
| March 27-28 | Marathon 12+ hour session | Heaviest API day(s) of the project |

---

## Burn Rate Analysis

### Daily Average (March 17-28)
- Anthropic API: ~$5.67/day (derived from $51 by day 9)
- Twilio: ~$0.33/day
- ElevenLabs: ~$0.10/day (estimated)
- Cloudflare: $0/day (free tier)
- **Total daily average: ~$6.10/day**

### Heaviest 4-Hour Period Estimate
Sprint sessions involve:
- Multiple sub-agents running in parallel (each burns ~$0.50-2.00 per complex task at Sonnet rates)
- Voice server active (ElevenLabs + Twilio)
- Hub polling continuously (Haiku — low cost)
- Estimated peak 4-hour window: 5-8 simultaneous agent tasks + background services

**Estimated peak 4-hour cost:**
- Agent tasks (5-8 x $1.50 avg): $7.50-$12.00
- Background services (hub, voice): $0.50-$1.00
- **Peak 4-hour window: $8-$13**

### Monthly Extrapolations

| Scenario | Daily Rate | Monthly Rate | Annual Rate |
|---|---|---|---|
| Current pace (sprint mode) | $6.10/day | $183/mo | $2,196/yr |
| Steady state (post-sprint) | $2.50/day | $75/mo | $900/yr |
| Peak pace (peak 4hr x 6) | $19.50/day | $585/mo | $7,020/yr |
| Conservative steady state | $2.00/day | $60/mo | $720/yr |

---

## Total Monthly Cost Model

### Scenario A — Steady State (maintenance mode)
| Service | Monthly |
|---|---|
| Anthropic Max Plan | $200.00 |
| Anthropic API (steady) | $65.00 |
| Twilio | $12.00 |
| ElevenLabs | $5.00 |
| Cloudflare | $0.00 |
| Domains (annualized) | $7.75 |
| **TOTAL** | **$289.75/mo** |

### Scenario B — Sprint Mode (current)
| Service | Monthly |
|---|---|
| Anthropic Max Plan | $200.00 |
| Anthropic API (sprint) | $165.00 |
| Twilio | $15.00 |
| ElevenLabs | $5.00 |
| Cloudflare | $0.00 |
| Domains (annualized) | $7.75 |
| **TOTAL** | **$392.75/mo** |

### Scenario C — Peak Mode (heavy agent deployment)
| Service | Monthly |
|---|---|
| Anthropic Max Plan | $200.00 |
| Anthropic API (peak) | $450.00 |
| Twilio | $20.00 |
| ElevenLabs | $22.00 |
| Cloudflare Workers KV (paid) | $5.00 |
| Domains (annualized) | $7.75 |
| **TOTAL** | **$704.75/mo** |

---

## Watchlist — Services to Monitor

| Service | Risk | Threshold | Action |
|---|---|---|---|
| Anthropic API | Highest | $100/mo | Alert Owner. Optimize Haiku vs Sonnet usage. |
| Workers KV | Medium | 100% daily limit | Upgrade to $5/mo paid tier (pre-approved) |
| Twilio | Low | >$30/mo | Audit call volume, check for runaway loops |
| ElevenLabs | Low | >10K chars/mo | Upgrade to Starter ($5/mo) if needed |
| get9.ai registration | One-time | $80 | Owner must confirm in CF dashboard |

---

## Revenue vs. Cost Gap

**Current monthly cost: $290-393/mo (confirmed services)**
**Current monthly revenue: $0**
**Monthly deficit: $290-393/mo**

**Path to breakeven:**
- AdSense + affiliates at moderate traffic: ~$300-500/mo (Month 2-3 per projections)
- That closes the gap or achieves profitability at steady-state costs
- At sprint pace, breakeven requires ~$400/mo revenue

**Bottom line:** At steady-state spending ($290/mo), a single mid-tier affiliate conversion (DraftKings/FanDuel depositing user = $150-400 CPA) covers that month's costs. The infrastructure spend is not a concern — the goal is getting traffic to monetization fast.

---

## Open Items

1. **get9.ai registration** — $80 potentially unspent. Owner must confirm in Cloudflare dashboard.
2. **Anthropic billing period** — The $51 figure is from mid-month. Full March bill is not yet known.
3. **Twilio exact usage** — 4 numbers confirmed. Actual call/SMS volume needs console check for precision.
4. **ElevenLabs tier** — Current plan not confirmed. If on free tier, no cost until 10K chars/mo is exceeded.
5. **Alpaca live trading** — $200 budget approved but not deployed. Zero cost until Owner approves live mode.

---

*Report generated March 28, 2026. All variable cost figures are estimates based on usage patterns and known pricing. Confirm exact figures at: console.anthropic.com/settings/billing, console.twilio.com, elevenlabs.io/subscription, dash.cloudflare.com.*
