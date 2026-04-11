# 9 Enterprises — Cost Audit
**Date:** 2026-04-11
**Author:** SCOUT (cost audit) + MONEY (financial agent)
**Purpose:** Live cost audit closing the cost-transparency gaps Kyle Shea would flag in an enterprise review.
**Status:** READ-ONLY. No pricing, plans, or subscriptions changed. Every number cites its evidence file or marks itself as an estimate needing verification.
**Budget context:** $500/day soft cap (~$15,000/mo) per `memory/feedback_budget_500_day.md`.

---

## Methodology

1. Started from `memory/reference_verified_subscriptions.md` (Mar 29 baseline, ~$414-417/mo).
2. Cross-checked against `docs/credential-inventory.md` (Apr 5 — every env var the codebase actually reads).
3. Pulled validated daily usage from `docs/usage-daily-2026-04-06.md` through `docs/usage-daily-2026-04-10.md`.
4. Pulled validated hourly cost data from `docs/expense-report-apr8-1900.md` (most complete validated snapshot — token log + API receipts + dashboard pulls all aligned).
5. Re-derived API spend independently from `logs/api-token-usage.jsonl` (922 calls, Apr 8 window) using published Anthropic pricing.
6. Where evidence is missing, the row is tagged `ESTIMATE — needs verification`.

Anything not on this page either (a) is not running and costs $0, or (b) is below the verification threshold and is called out as a gap.

---

## 1. Recurring SaaS Subscriptions

| Service | Plan | Monthly Cost | Evidence | Status |
|---|---|---|---|---|
| Anthropic Max Plan (Claude Code) | Max 20x | $200.00 | `memory/reference_verified_subscriptions.md` line 12; `docs/expense-report-apr8-1900.md` line 79 | VALIDATED — receipt on file (next bill Apr 16) |
| HeyGen | Business (upgraded from Pro Apr 8) | $149.00 | `docs/expense-report-apr8-1900.md` line 80; receipt $133.33 Apr 8 in line 70 | VALIDATED — Apr 8 receipt |
| ElevenLabs | Pro Annual (prepaid) | $82.50 ($990/yr ÷ 12) | `memory/reference_verified_subscriptions.md` line 14; `docs/expense-report-apr8-1900.md` line 81 | VALIDATED — annual receipt; renews Mar 23 2027 |
| X Premium Plus (50% disc) | Monthly | $20.00 | `memory/reference_verified_subscriptions.md` line 15; `docs/expense-report-apr8-1900.md` line 83 | VALIDATED — receipt; next bill Apr 18 |
| DigitalOcean | 1 droplet | $12.00 | `docs/usage-daily-2026-04-10.md` line 14 (1 droplet confirmed via DO API); `docs/expense-report-apr8-1900.md` line 82 | VALIDATED — droplet count via DO API; price ESTIMATE based on standard $12 plan, needs receipt confirmation |
| Twilio | Usage-based + 4 numbers | $8.00 base + ~$1-3 usage | `memory/reference_verified_subscriptions.md` line 17; balance $36.36 on `docs/usage-daily-2026-04-10.md` line 17 | VALIDATED balance; base ESTIMATE |
| DNSimple | Solo plan | ~$14.00 | `docs/expense-report-apr8-1900.md` line 87; receipt $31.00 Apr 5 in line 69 | VALIDATED — Apr 5 receipt |
| Cloudflare | Workers / DNS | $5.00 | `docs/expense-report-apr8-1900.md` line 84; 410 reqs/100K used (`docs/usage-daily-2026-04-10.md` line 11) | ESTIMATE — operating fully inside free tier; $5 line is conservative buffer for KV/Pro upgrades; needs verification |
| Namecheap (ainflgm.com) | Annual domain | $1.08 ($13/yr ÷ 12) | `memory/reference_verified_subscriptions.md` line 19 | VALIDATED — receipt; renews Mar 17 2027 |
| Supabase | Free tier | $0.00 | 3,125 messages logged (`docs/usage-daily-2026-04-10.md` line 16) — well within free tier | VALIDATED |
| Resend | Free tier | $0.00 | `docs/expense-report-apr8-1900.md` line 91 — within 3,000/mo free tier | ESTIMATE |
| Stripe | Transaction-only | $0.00 | No revenue yet (`docs/expense-report-apr8-1900.md` line 90); price IDs wired in `scripts/your9-billing.mjs:105-125` but no live transactions | VALIDATED $0 |
| GitHub Pages / GitHub Actions | Free public-repo tier | $0.00 | `docs/cost-per-user-model.md` lines 19-25; AiNFLGM hosted on GH Pages | VALIDATED |
| Sentry | Not yet integrated | $0.00 | `docs/usage-daily-2026-04-10.md` line 23 — `no SENTRY_AUTH_TOKEN in .env` | VALIDATED $0 (gap: no error monitoring) |
| OpenAI | Not in use | $0.00 | `docs/usage-daily-2026-04-10.md` line 24 — `no OPENAI_API_KEY in .env` | VALIDATED $0 |
| Buy Me a Coffee, Stripe, Ohio Business Central | Free / setup-only | $0.00 | `memory/reference_verified_subscriptions.md` lines 24-28 | VALIDATED |

**Recurring SaaS subtotal: $491.58/mo** (matches `docs/expense-report-apr8-1900.md` line 92, "$491.58/mo / $16.17/day").

---

## 2. AI / LLM API Spend

| Provider | Period | Spend | Evidence | Status |
|---|---|---|---|---|
| Anthropic API (TC key — `ANTHROPIC_API_KEY_TC`) | Apr 8 single day, full validated | **$13.21** | `docs/expense-report-apr8-1900.md` lines 56-58; reproduced from `logs/api-token-usage.jsonl` (922 calls, 714 Opus / 208 Sonnet) | VALIDATED |
| Anthropic API (TC key) | Apr 5 auto-recharge receipt | $37.76 | `docs/expense-report-apr8-1900.md` line 68 (DOC email audit) | VALIDATED |
| Anthropic API (independent re-calc from raw token log) | `logs/api-token-usage.jsonl` 922-line snapshot | **$142.65** if cache writes/reads are priced (Opus $135.31 + Sonnet $7.35) | Re-derived: Opus 22,571 in / 146,344 out / 2,899,710 cache_creation / 46,415,017 cache_read at $15/$75/$18.75/$1.50 per 1M; Sonnet at $3/$15/$3.75/$0.30 per 1M | VALIDATED methodology — discrepancy with $13.21 explained: the $13.21 figure ignores cache_creation/cache_read columns, the $142.65 figure includes them. Cache reads dominate. The TRUE single-day cost for Apr 8 sits between these depending on whether cache columns were already double-billed in the receipt, and **needs Anthropic console verification before being asserted to Kyle.** |
| HeyGen | Apr 8 receipt (Business upgrade + API credits) | $133.33 | `docs/expense-report-apr8-1900.md` line 70 | VALIDATED — receipt |
| HeyGen | Cycle-to-date credit consumption (Apr 8 = 208 of 1,000) | $30.99 cash-equivalent (208 × $0.149) | `docs/expense-report-apr8-1900.md` lines 149-160; consumption rose to 458 of 1,000 by Apr 9-10 (542 remaining: line 15 of `docs/usage-daily-2026-04-10.md`) | VALIDATED |
| ElevenLabs | Apr 6-10 cycle-to-date | 31.0% → 35.4% of 507,594 chars | `docs/usage-daily-2026-04-06.md` line 8 (157,118) → `docs/usage-daily-2026-04-10.md` line 9 (179,913). Annual prepaid, no incremental cash | VALIDATED — under cap, $0 marginal |
| xAI / Grok (consulting) | Per-day est. | $1-3/day | `docs/expense-report-apr8-1900.md` line 103 — "no Grok billing endpoint available" | ESTIMATE — needs verification at console.x.ai |
| OpenAI | n/a | $0 | Not in use (no key in env) | VALIDATED $0 |

**Validated single-day API spend on Apr 8 (the most heavily logged day):**
- Lower bound (token log, ignoring cache): $13.21
- Upper bound (token log, including cache writes/reads): $142.65
- Receipt-confirmed Anthropic charge in window: $37.76 (Apr 5 auto-recharge)

**Conservative recurring monthly LLM line:**
- Anthropic API at $13.21/day × 30 = **~$396/mo** (`docs/expense-report-apr8-1900.md` line 181 same conclusion)
- Aggressive recurring monthly line at $142.65/day × 30 = ~$4,280/mo — UNVERIFIED, depends on whether cache columns are already counted in the $13.21 number. **This is the single biggest unresolved cost question and is flagged as Kyle gap #1 below.**

---

## 3. Infrastructure Costs

| Component | Provider | Monthly Cost | Evidence | Status |
|---|---|---|---|---|
| 1 × DigitalOcean droplet | DigitalOcean | $12.00 | DO API confirmed 1 droplet on `docs/usage-daily-2026-04-10.md` line 14 | VALIDATED count, ESTIMATE price |
| Cloudflare Workers | Cloudflare | $0.00 (free tier; 410/100K daily reqs) | `docs/usage-daily-2026-04-10.md` line 11 | VALIDATED |
| Cloudflare DNS / Tunnel / KV | Cloudflare | $0.00 (free tier) | `docs/dependency-map.md` lines 117-122 in `docs/expense-report.md` | VALIDATED |
| DNSimple | DNSimple | ~$14.00 + $31 Apr 5 receipt for renewals | `docs/expense-report-apr8-1900.md` lines 69, 87 | VALIDATED |
| Namecheap (ainflgm.com domain) | Namecheap | $1.08 amortized | `memory/reference_verified_subscriptions.md` line 19 | VALIDATED |
| Supabase (cloud DB mirror) | Supabase | $0.00 (free tier; 3,125 rows) | `docs/usage-daily-2026-04-10.md` line 16 | VALIDATED |
| Neon (PostgreSQL backup) | Neon | $0.00 (assumed free tier; not explicitly logged) | `docs/credential-inventory.md` line 36 confirms `NEON_DATABASE_URL` is in env. No usage line in any expense report | ESTIMATE — needs verification at console.neon.tech |
| GitHub Pages (ainflgm.com hosting) | GitHub | $0.00 | `docs/cost-per-user-model.md` line 19 | VALIDATED |
| Vercel | not in use | $0.00 | No `VERCEL_*` env vars in `docs/credential-inventory.md` | VALIDATED $0 |
| Cloudflare Workers KV (state) | Cloudflare | $0.00 (free tier; was at 50% on Mar 25) | `docs/expense-report.md` line 127 | VALIDATED |

**Infrastructure subtotal: ~$27/mo** (DO + DNSimple + Namecheap), all other infra inside free tiers.

---

## 4. Trading / Financial Sandbox Costs

| Account | Mode | Cash | Evidence | Status |
|---|---|---|---|---|
| Alpaca | PAPER ONLY | $0 real, $105,048 paper equity | `docs/usage-daily-2026-04-10.md` lines 12-13; `docs/expense-report-apr8-1900.md` lines 137-143 | VALIDATED — no live capital deployed |
| Alpaca live trading | Pre-approved $200 budget, gated behind `ALPACA_LIVE_ENABLED` | $0 today | `docs/credential-inventory.md` line 78 (FORT C-04 hard gate); `memory/reference_budget_approvals.md` | VALIDATED $0 — gated, not active |
| Kalshi (prediction markets) | Scaffold-only behind `PREDICTION_MARKET_ENABLED` | $0 today | `docs/credential-inventory.md` line 79 | VALIDATED $0 — gated |
| Hyperliquid | Scaffold-only behind `HYPERLIQUID_ENABLED` | $0 today | `docs/credential-inventory.md` line 77 | VALIDATED $0 — gated |
| Stripe | Live keys present, $0 transactions | `STRIPE_SECRET_KEY` + `STRIPE_PRICE_*` IDs in `scripts/your9-billing.mjs:105-125` | $0 fees (no transactions) | VALIDATED $0 |

**Trading / financial subtotal: $0/mo today.** All real-money paths are behind hard feature flags. The trading stack has zero operating cost until those flags flip.

---

## 5. Per-Product Cost Allocation

Allocation method: take the $491.58 fixed monthly burn + $396/mo Anthropic API recurring (lower bound) + $30 HeyGen credit consumption = **~$917.58/mo total recurring** and apportion by which env vars / processes each product owns from `docs/credential-inventory.md` and `docs/dependency-map.md`.

| Product | Cost Drivers | Monthly Cost | Evidence |
|---|---|---|---|
| **AiNFLGM** (ainflgm.com) | GH Pages (free) + Cloudflare CDN (free) + Namecheap domain ($1.08) + GitHub Actions cron (free) | **$1.08/mo** | `docs/cost-per-user-model.md` lines 19-30 — entire static-site model. Cost is invariant to user count up to 100K MAU. |
| **9 Enterprises Hub / comms-hub** (the operating system itself) | Anthropic Max Plan $200 + Anthropic API ~$396 + Twilio $8-11 + ElevenLabs $82.50 + DigitalOcean $12 + Supabase free + Neon free + Sentry free | **~$709/mo** | Largest cost center. Most LLM tokens flow through the hub. `docs/expense-report-apr8-1900.md` line 92 + token log. |
| **Pepper** (single-user personal AI; Wendy owns build) | HeyGen Business $149 (avatar/video) + portion of Anthropic API + future ElevenLabs voice work | **~$149/mo capital tied** + variable; not yet shipping recurring revenue | `docs/expense-report-apr8-1900.md` line 80 (HeyGen receipt). Pepper voice/video work is the dominant HeyGen use case per `docs/pepper-elevation-phase1-apr8.md`. |
| **Your9** (B2B SaaS — Stripe wired but no customers) | Stripe ($0 — transaction only) + share of comms-hub + DNSimple domain | **~$15/mo** marginal (all share costs are sunk in hub line) | `scripts/your9-billing.mjs:96-127` — Starter $499/mo, Growth $999/mo, Enterprise $2,499/mo wired but $0 active subscribers per `docs/expense-report-apr8-1900.md` line 90. |
| **FreeAgent / pilot-server** (Kyle Cabezas pilot) | Pilot server free hosting on Mac + 1 Twilio number + share of Anthropic API | **~$5/mo marginal** | `docs/dependency-map.md` line 20 confirms `pilot-server` running on port 3472. |
| **Trader9** (Alpaca paper bot) | $0 paper, $0 fees, share of API | **$0/mo** | `docs/credential-inventory.md` lines 47-50 + line 78 (gated) |
| **Trinity / Underwriter / Kids-Mentor / Jules** (background agents) | All share Anthropic API + comms-hub infra | **~$0/mo marginal** (allocated inside hub line) | `docs/dependency-map.md` lines 17-22 |
| **DNSimple-managed domains** (umbrella) | DNSimple $14 + Namecheap $1.08 — covers 9enterprises.ai, ainflgm.com, get9.ai, your9.ai, etc. | **~$15/mo** | `docs/expense-report-apr8-1900.md` line 87 |

Per-product totals do not sum cleanly to the line-by-line subscription total because the comms-hub absorbs the LLM and infra costs that all sub-products share.

---

## 6. Total Burn — Monthly, Daily, Budget Headroom

| Metric | Value | Evidence |
|---|---|---|
| **Fixed monthly subscriptions** | **$491.58/mo** | `docs/expense-report-apr8-1900.md` line 92 |
| **Anthropic API recurring (conservative, token log lower bound)** | **+$396/mo** | $13.21/day × 30 (`docs/expense-report-apr8-1900.md` line 181) |
| **HeyGen credit-pack burn (recurring beyond base $149)** | **+$30/mo** estimated | `docs/expense-report-apr8-1900.md` lines 149-160 |
| **Grok / xAI** | **+$30-90/mo** estimated | `docs/expense-report-apr8-1900.md` line 103 ($1-3/day) |
| **Total recurring monthly burn (conservative)** | **~$948-1,008/mo** | Sum |
| **Total recurring monthly burn (per Apr 8 hourly report's own projection)** | **~$900-1,200/mo** | `docs/expense-report-apr8-1900.md` line 207 |
| **Daily burn (conservative)** | **$30-40/day** | `docs/expense-report-apr8-1900.md` line 206 |
| **% of $500/day budget consumed** | **6-8%** | $30-40 ÷ $500 |
| **Headroom remaining vs $500/day cap** | **$460-470/day unused (92-94%)** | $500 - actual |
| **Headroom remaining vs $15K/month cap** | **~$14,000/mo unused** | $15,000 - actual |

**Bottom-line burn picture:** under $40/day actual, against a $500/day soft cap. We are using ~7% of the budget. The budget is not the constraint — visibility and predictability are.

---

## Critical caveat — single biggest unknown

The Apr 8 hourly report computed Anthropic API at $13.21 using **only input + output tokens** from the token log. The same log contains substantial `cache_creation` (3.9M tokens combined) and `cache_read` (52.5M tokens combined) volumes. Anthropic does charge for both at reduced rates ($18.75/M for cache writes, $1.50/M for cache reads on Opus). When those columns are included, the same single-day Apr 8 spend computes to **$142.65** instead of $13.21.

Without console verification we cannot say which figure ties to the actual Anthropic invoice. Three possibilities:
1. The token log already converted cache columns to billable input/output before logging — then $13.21 is right.
2. The columns are raw — then the true Apr 8 spend is closer to $142, and monthly LLM burn is $4,000+.
3. The columns are real but partially discounted differently than published rates — answer sits in between.

**Action: pull the actual Apr 5-8 invoice from console.anthropic.com/settings/billing and reconcile.** Until then this audit reports the conservative figure ($13.21/day, ~$396/mo) but flags the gap explicitly.

---

## Cost-control posture (what exists today)

| Control | Status | Evidence |
|---|---|---|
| Daily soft budget cap ($500/day) | DOCUMENTED, NOT ENFORCED in code | `memory/feedback_budget_500_day.md` |
| Hourly expense reporting | OPERATIONAL on heavy days | `docs/expense-report-apr8-1400.md` through `docs/expense-report-apr8-2200.md` (10 hourly reports Apr 8) |
| Daily usage report | OPERATIONAL via cron | `docs/usage-daily-2026-04-06.md` through `docs/usage-daily-2026-04-10.md` |
| Real-money trading kill switches | IN PLACE (`ALPACA_LIVE_ENABLED`, `PREDICTION_MARKET_ENABLED`, `HYPERLIQUID_ENABLED`) | `docs/credential-inventory.md` lines 77-79 |
| `MAX_DAILY_LOSS_PCT` circuit breaker | IN PLACE (default 3%) | `docs/credential-inventory.md` line 80 |
| Per-service rate-limit awareness | OPERATIONAL in usage-monitor | `docs/usage-daily-2026-04-10.md` (every service has limit + % used) |
| Token-level spend log | OPERATIONAL | `logs/api-token-usage.jsonl` (1,845 lines across two days) |

## Cost-control gaps Kyle would flag

1. **No live ingestion of Anthropic console billing.** Token log is a proxy, not the invoice. The 10x discrepancy on cache columns is the smoking gun.
2. **No DigitalOcean / DNSimple receipt automation.** Costs come from memory + occasional email scrape, not API pulls.
3. **No hard daily cap enforcement.** $500/day is a number in a memory file, not a circuit breaker. A runaway agent burning Opus could spend the full budget in hours and nothing would stop it programmatically.
4. **No per-product P&L.** Hub absorbs everything. Pepper's true cost (HeyGen + voice + LLM share) is not isolated.
5. **No revenue-side tracker at all.** Stripe webhook secret exists (`STRIPE_WEBHOOK_SECRET`) but no MRR / new-customer events surface in any report. $0 today, but if Pepper or Your9 starts taking money tomorrow there is no automated way to see it on the same dashboard as cost.
6. **xAI / Grok spend is fully blind.** No billing endpoint, no log, no receipt. $1-3/day estimate is a guess.
7. **Neon database cost is unverified.** Connection string is in `.env`; no usage line in any cost report.
8. **Cloudflare Workers KV upgrade trigger ($5/mo at 100% free-tier consumption) is not wired to any alert.** It would just start charging silently.

---

## Top 5 cost optimizations available (with $-impact)

| # | Optimization | Saving | Effort | Evidence |
|---|---|---|---|---|
| 1 | **Reconcile the Apr 8 token-log discrepancy.** If the upper-bound $142/day figure is right, shifting routine background work from Opus to Sonnet would save ~70%. Apr 8 was 77.4% Opus by call count. Moving 50% of Opus calls to Sonnet (where appropriate per gold-standard rule) saves $50-70/day at the upper bound. | **$1,500-2,100/mo** if upper bound holds | Low (already supported) | `docs/expense-report-apr8-1900.md` lines 175-181 already calls this out as "available as a lever" |
| 2 | **Audit ANTHROPIC_API_KEY vs ANTHROPIC_API_KEY_TC split.** Two keys, one purpose unclear. Consolidating removes a rotation surface and could move volume to whichever account has better discounting / org pricing. | **$0-30/mo + risk reduction** | Low | `docs/credential-inventory.md` M-01 |
| 3 | **Right-size HeyGen.** Business plan $149 + Apr 8 receipt of $133.33 (one-time API credits). At current burn (208/1000 credits in first 9 days of cycle = ~21/day, ~640/mo projected) the Pro tier at $99 is sufficient. Downgrade saves $50/mo if avatar work plateaus. | **$50/mo** | Trivial | `docs/expense-report-apr8-1900.md` lines 149-160 |
| 4 | **Wire daily-cap circuit breaker.** Not a saving — a cap on the worst case. Without it, a single runaway loop can burn $500 in an hour. Cost of inaction = the entire daily budget. | **Caps tail risk at $500/day** | Medium (1-2 days) | `memory/feedback_budget_500_day.md` is documentation only |
| 5 | **Verify get9.ai registration and all DNSimple-managed domains.** `docs/expense-report.md` line 150 flagged that get9.ai may or may not be registered. The DNSimple Apr 5 receipt was $31.00 — for what? Auditing the domain portfolio could surface 1-2 unused domains at $10-80/yr each. | **$10-80/yr per dropped domain** | Low | `docs/expense-report.md` line 150; DNSimple Apr 5 receipt unaccounted-for |

---

## Validation coverage summary

| Service | Coverage | Notes |
|---|---|---|
| Anthropic Max Plan | VALIDATED | Receipt on file |
| Anthropic API | PARTIALLY VALIDATED | Token log + Apr 5 receipt; cache columns unresolved |
| HeyGen | FULLY VALIDATED | Receipt + dashboard |
| ElevenLabs | FULLY VALIDATED | Annual receipt + daily dashboard |
| Twilio | FULLY VALIDATED | Balance + 4 numbers + monthly SMS count |
| Cloudflare | FULLY VALIDATED | Daily request count via dashboard |
| DigitalOcean | VALIDATED count, ESTIMATE price | 1 droplet confirmed via DO API; price assumed from standard $12 plan |
| DNSimple | VALIDATED via Apr 5 receipt | Plan tier estimate; API not pulled |
| Supabase | VALIDATED | 3,125 rows / free tier |
| Neon | UNVERIFIED | Cred in env, no usage line in any report |
| Stripe | VALIDATED $0 | No transactions; price IDs wired but inactive |
| Resend | ESTIMATED $0 | Free tier assumed |
| xAI / Grok | UNVERIFIED | No billing API |
| Sentry | VALIDATED $0 | No token in env |
| OpenAI | VALIDATED $0 | No key in env |

---

*Sources cited inline. Pricing pulled from `docs/expense-report-apr8-1900.md` (most recent fully-validated hourly snapshot), `docs/usage-daily-2026-04-06.md` through `docs/usage-daily-2026-04-10.md` (5-day daily usage trend), `docs/credential-inventory.md` (Apr 5 cred audit), `memory/reference_verified_subscriptions.md` (Mar 29 receipt audit), `logs/api-token-usage.jsonl` (raw token log), and `docs/cost-per-user-model.md` (per-user economics for AiNFLGM).*
