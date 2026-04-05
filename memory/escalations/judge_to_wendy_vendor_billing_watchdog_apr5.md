# JUDGE → Wendy: P0 ESCALATION — Vendor billing & usage watchdog gap

- **From:** JUDGE (Quality Gate, 9 Enterprises)
- **To:** Wendy (Super Consultant)
- **CC:** 9 (CEO), for awareness
- **Date:** 2026-04-05
- **Priority:** P0 — add to Week 1 execution list
- **Trigger:** Owner direct message via Telegram, 2026-04-05 17:26 ET:
  *"Please make sure that someone is monitoring all of our usage rates and
  charges and preset limits so that nothing gets turned off due to our
  heavy volume increases. Do you have this completely under control? I
  do not want to have a situation where we have a service interruption
  and I then I'm trying to figure out how to get back to you."*

## Honest answer to Owner's question: NO, not completely under control

JUDGE reviewed the universe for vendor-billing and usage-limit monitoring
coverage. Findings:

### What IS monitored
- **Anthropic API health** — comms-hub probes every 10 minutes, alerts
  on failure via Telegram + iMessage + email, falls back to offline
  acknowledgments. Covered.

### What is NOT monitored (gap list)
No automated usage/ceiling alerts exist for any of the following paid
vendors that 9 Enterprises currently depends on:

| Vendor | Service | Risk if cut off |
|---|---|---|
| Resend | Transactional email (comms-hub /send-email, ainflgm.com contact) | Owner loses an outbound channel; Wendy/JUDGE weekly reports stop delivering |
| Twilio | Voice + SMS (voice-server, cloud-worker SMS fallback) | Voice calls fail; SMS fallback during Mac-down fails; Owner's Mac-down blackout path is broken |
| Cloudflare | Tunnel + Workers + Pages + DNS (AiNFLGM, 9enterprises.ai, cloud-worker, voice tunnel, comms hub public URL) | Multiple product outages, including the entire cloud-standin failover path. P0 catastrophic. |
| Supabase | Cloud memory sync (shared state replication every 60s) | Silent memory drift; session restore breaks |
| OpenAI / other LLM | Any fallback model usage | API fallback path degraded |
| HeyGen / ElevenLabs | Video / voice production for press and marketing | Campaign interruptions |
| Alpaca | Paper + real trading | Trader9 halts; drawdown circuit breaker cannot execute orders |
| Stripe | Billing (when FreeAgent9 goes live Phase 2) | Revenue loss |
| Domain registrars (Cloudflare, Porkbun, etc.) | Domain renewals | Silent expiration → site offline |
| AdSense | (once live) Revenue monitoring | Missed fraud triggers → account suspension |

**Per-vendor gaps:**
- No cached copy of each vendor's current usage vs quota.
- No hard-limit alert (e.g., Telegram ping at 70 / 85 / 95% of any
  monthly quota).
- No card-expiration calendar (auto-renewals silently fail if card
  rotated — relevant after FORT's C-01 Dominos card removal today).
- No centralized spend dashboard.
- No runbook for "what to do if vendor X cuts us off."

## Why this is foundation-first scope

Per `memory/mission_goal_one_apr5.md`, the foundation includes
"Persistent memory layer... Comms resilience... zero gap on Owner
comms." A vendor cut-off during heavy volume is the exact "service
interruption and I'm trying to figure out how to get back to you"
scenario Owner just named. Any Phase 1 exit claim that omits vendor
billing monitoring is dishonest.

This also maps to Kyle K-04 (per-user cost model) and K-05 (audit
logging / SOC 2) — vendor usage telemetry is load-bearing for both.

## Recommended Week 1 addition to Wendy 90-day plan

Insert between Apr 7 and Apr 8 as a parallel track. Does not displace
existing Week 1 items; spawns a new specialist sprint under budget
expansion authority.

### Task: Vendor billing & usage watchdog (Week 1 insert)

**Owners (split):**
- **FORT** — vendor inventory + current usage snapshot (today)
- **WATCH** — runtime telemetry polling + alert thresholds (Apr 6-7)
- **Tee** — implementation of `scripts/vendor-watchdog.mjs` LaunchAgent
  + integration with comms-hub alerting (Apr 7)
- **DOC** — runbook per vendor for "if cut off, do X" (Apr 8-9)
- **JUDGE** — ADR on the pattern; review the implementation before
  merge (Apr 7)

**Concrete Week 1 deliverables:**

1. **Apr 5 (today, late, FORT):** Enumerate every paid vendor, log into
   each dashboard, screenshot or API-fetch current usage vs monthly
   quota, document card-on-file expiration dates. Publish as
   `docs/vendor-billing-inventory.md`.

2. **Apr 6 (WATCH):** Define alert thresholds per vendor:
   - 70% of monthly quota → informational Telegram
   - 85% → warning Telegram + email
   - 95% → critical Telegram + iMessage + email
   - Hard fail (401, 402, 429 on non-retryable) → immediate P0 alert
     across all four channels
   - Card declined (webhook or vendor email detection) → P0
   - Domain renewal in <30 days → warning Telegram

3. **Apr 7 (Tee):** Ship `scripts/vendor-watchdog.mjs` as a LaunchAgent
   polling each vendor's usage API (where available) or parsing email
   invoices for fallback vendors. Integrate with `comms-hub.mjs` alert
   channels. Record telemetry to `data/9-memory.db` in a new
   `vendor_usage` table.

4. **Apr 7 (JUDGE):** Author ADR-0008 "Vendor billing & usage watchdog
   pattern." Pre-merge review of Tee's implementation.

5. **Apr 8-9 (DOC):** Per-vendor runbook in `docs/runbooks/vendors/`:
   what happens if the vendor cuts us off, where the keys are, how to
   failover or degrade, what Owner sees on Telegram.

6. **Apr 10 (all):** First weekly billing report delivered to Owner
   via Telegram with current-month spend, projected spend, any flags.

**Budget implication:** Zero new paid vendors required. Most vendors
expose usage APIs on free/existing tiers. Any polling cost is
negligible. FORT's existing inventory work covers the enumeration step.

**Risk of NOT doing this:** exactly the scenario Owner described.
Mid-campaign Twilio 429, mid-deploy Cloudflare quota exceeded,
Anthropic billing lapse we only discover when the first message bounces.
With budget expanded and volume ramping (AdSense submission, Trader9
soak, RAM agent samples, Kyle engagement), the blast radius of an
unmonitored cap is materially higher this week than last.

## Recommended immediate action

1. Wendy: approve the Week 1 insert and assign FORT + WATCH + Tee +
   DOC + JUDGE as above.
2. JUDGE: drafts ADR-0008 today as a proposal, finalizes on Apr 7
   after Tee's implementation.
3. JUDGE adds "vendor billing watchdog live and alerting" to the Phase
   1 exit criteria — composite score ≥70 cannot honestly be claimed
   without it.

## JUDGE's commitment to Owner

JUDGE does not own runtime monitoring (that is WATCH) or
implementation (that is Tee). JUDGE's commitment is that this escalation
does not get buried — it is written to the memory escalation log,
referenced in the Day-1 report, and will be audited by JUDGE in every
weekly SDLC scorecard until it is closed.

Owner asked a direct question and got a direct answer: **no, not yet, but
within 72 hours it will be**, and the paper trail for "how we got there"
will be durable.

— JUDGE, Quality Gate, 9 Enterprises
2026-04-05
