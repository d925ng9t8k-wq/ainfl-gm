# 9 Enterprises — Cost Transparency Brief
**Prepared for:** Kyle Shea, CIO, Rapid Mortgage
**Prepared by:** 9 Enterprises (SCOUT + MONEY)
**Date:** 2026-04-11
**Companion documents:** `logs/scout-task-cost-audit-apr11.md` (full audit), `logs/money-task-projections-apr11.md` (12-month model)

---

## Executive Summary

9 Enterprises operates a multi-product AI organization (AiNFLGM, comms-hub, Pepper, Your9, FreeAgent pilot, Trader9 paper bot, plus background agents) at a current recurring monthly burn of approximately **$948-1,008/month** against a soft daily budget cap of **$500/day (~$15,000/month)**. The organization is operating at roughly **6-8% of its budget cap**, leaving $14,000+/month of headroom. Current revenue is **$0** — no live products are charging customers today, though Stripe is wired into Your9 (`scripts/your9-billing.mjs:96-127`) with three plan tiers ($499 / $999 / $2,499 per month) ready to invoice on first signup.

The cost picture is **observable but not yet defensible at the standard you would expect from an enterprise CFO**. We have hourly expense reports (`docs/expense-report-apr8-1900.md` is the cleanest example), validated daily usage pulls (5 consecutive days in `docs/usage-daily-2026-04-06.md` through `docs/usage-daily-2026-04-10.md`), a token-level API spend log (`logs/api-token-usage.jsonl`), and email-receipt audit trails for the four largest line items. Where this brief stops short of enterprise-grade is in three places: (a) one unresolved methodology question on Anthropic API cache-column accounting that creates a 10x range in our LLM cost estimate, (b) a soft-not-hard daily budget cap that is documented but not enforced in code, and (c) no automated revenue-side reporting since revenue is still $0. The first two are tracked in this document and have remediation owners assigned in the optimization table.

---

## Cost categories table

| Category | Monthly | Confidence | Single largest line |
|---|---|---|---|
| AI / LLM (Anthropic Max + API + xAI) | **$626 - $716** | Validated subscription, conservative API estimate | Anthropic Max Plan $200 (validated receipt) |
| Subscription SaaS (HeyGen, ElevenLabs, X Premium, etc.) | **$252.50** | Fully validated via receipts | HeyGen Business $149 (Apr 8 receipt) |
| Infrastructure (DigitalOcean, DNSimple, Namecheap, Cloudflare, Supabase, Neon) | **$27 - $32** | Mostly validated; Neon unverified | DigitalOcean droplet $12 |
| Telephony (Twilio voice + SMS + 4 numbers) | **$8 - $11** | Validated balance, base estimated | Twilio base $8 |
| Trading / financial sandboxes (Alpaca, Kalshi, Hyperliquid, Stripe) | **$0** | Fully validated $0 | All gated behind feature flags |
| **Total recurring monthly burn** | **~$948 - $1,008/mo** | Mixed | Anthropic API ~$396/mo (recurring, conservative) |
| **Daily equivalent** | **~$30 - $40/day** | | |
| **% of $500/day soft cap** | **~6 - 8%** | | |
| **Headroom against $15K/mo cap** | **~$14,000/mo (~93%)** | | |

---

## Cost-per-user / cost-per-product table

| Product | Status | Monthly cost | Cost per active user | Evidence |
|---|---|---|---|---|
| **AiNFLGM** (ainflgm.com) | LIVE | $1.08 (domain only — static site on GH Pages + Cloudflare CDN, both free) | $0.00001 - $0.01 per MAU at any scale up to 100K MAU | `docs/cost-per-user-model.md` lines 36-50 |
| **9 Enterprises Hub / comms-hub** | LIVE 24/7 | ~$709 (absorbs Anthropic Max + API + Twilio + ElevenLabs + DO + Supabase + Neon) | n/a — internal operating system | `docs/dependency-map.md` |
| **Pepper** (single-user personal AI; build phase) | BUILD | ~$149 (HeyGen Business — primary avatar/video user) + share of API | n/a — pre-revenue | `docs/expense-report-apr8-1900.md` line 70 |
| **Your9** (B2B SaaS) | WIRED, $0 customers | ~$15 marginal (DNSimple share + Stripe transaction) | $0 today; Starter $499/mo, Growth $999/mo, Enterprise $2,499/mo when active | `scripts/your9-billing.mjs:96-127` |
| **FreeAgent / pilot-server** (Kyle Cabezas pilot) | LIVE pilot | ~$5 marginal (1 Twilio number + share of API) | 1 user today | `docs/dependency-map.md` line 20 |
| **Trader9** (Alpaca paper bot) | LIVE paper | $0 (no fees on paper account; live trading gated) | n/a | `docs/credential-inventory.md` lines 47-50, 78 |
| **Trinity / Underwriter / Kids-Mentor / Jules** | LIVE background agents | $0 marginal (share Anthropic API + Mac infra) | n/a | `docs/dependency-map.md` lines 17-22 |

**Headline:** AiNFLGM unit economics are **best-in-class for a static B2C product** — ~$0.0001 per MAU at 10K MAU, no per-request compute cost, scales freely up to 100K MAU before Cloudflare Pro becomes recommended. The B2B Your9 line economics break even on a single Growth-tier sale.

---

## Cost trend — last 30 days

We have validated data only for the most recent ~12 days (Apr 1-11). The trend over that window:

| Date | Anthropic API (validated) | HeyGen credits remaining | ElevenLabs % cycle used | Twilio balance | Daily total (where available) |
|---|---|---|---|---|---|
| Apr 6 | n/a (no token log this day) | 1,008 / 1,000 | 31.0% | $41.23 | n/a |
| Apr 7 | n/a | 852 / 1,000 | 31.8% | $40.98 | n/a |
| Apr 8 | **$13.21** (validated, 922 calls; 714 Opus / 208 Sonnet) | 974 / 1,000 (post Apr 8 top-up) | 31.8% | $40.93 | **$30 - $32 (validated mixed)** |
| Apr 9 | n/a | 542 / 1,000 (heavy day — 432 credits used) | 33.4% | $40.88 | n/a |
| Apr 10 | n/a | 542 / 1,000 (no consumption) | 35.4% | $36.36 | n/a |
| Apr 11 | n/a (audit day) | n/a | n/a | n/a | (this report) |

**Pre-April baseline:** the Mar 28 expense report (`docs/expense-report.md`) projected $290-393/mo at sprint pace. Apr 8 actuals ($948-1,008/mo recurring) are roughly 2.5-3x the March projection, driven primarily by the HeyGen Business upgrade ($149 vs $99) and a higher steady-state Anthropic API line ($396 vs $165).

**Trend direction:** burn is trending up modestly month-over-month as Pepper video work and Wendy's squad deployments come online. None of the increases have approached the $500/day soft cap.

---

## Cost controls in place

| Control | Status | Evidence |
|---|---|---|
| Daily soft budget cap ($500/day) | DOCUMENTED policy | `memory/feedback_budget_500_day.md` |
| Hourly expense reporting on heavy days | OPERATIONAL | 10 hourly reports on Apr 8 alone (`docs/expense-report-apr8-1400.md` through `-2200.md`) |
| Daily usage report via cron | OPERATIONAL | `docs/usage-daily-2026-04-06.md` through `-04-10.md` (5 consecutive days) |
| Token-level API spend log | OPERATIONAL | `logs/api-token-usage.jsonl` (1,845 entries across two days) |
| Real-money trading kill switches | IN PLACE | `ALPACA_LIVE_ENABLED`, `PREDICTION_MARKET_ENABLED`, `HYPERLIQUID_ENABLED` (`docs/credential-inventory.md` lines 77-79) |
| Trading drawdown circuit breaker | IN PLACE (3% default) | `MAX_DAILY_LOSS_PCT` (`docs/credential-inventory.md` line 80) |
| Per-service rate-limit awareness | OPERATIONAL | Every service in `docs/usage-daily-2026-04-10.md` shows current vs limit |
| Email receipt audit trail | OPERATIONAL via DOC | `docs/expense-report-apr8-1900.md` lines 64-71 (Apr 5-8 receipts $202.09 validated) |
| Service health endpoints | OPERATIONAL | `/supabase-health`, `/fda-health`, etc. |
| Dependency-map drift validator | OPERATIONAL | `git log` commit `d447cf8` — drift safety net regression test |
| Credential-inventory drift validator | OPERATIONAL | `git log` commit `ec4e445` — closes 43 cred-doc drift cases |

---

## Cost controls missing — the gaps Kyle would flag

| # | Gap | Risk | Severity |
|---|---|---|---|
| K-01 | **No live ingestion of the Anthropic console invoice.** Token log is a proxy. Cache-column accounting question creates a 10x range ($948/mo vs $4,800/mo) in our LLM cost estimate. | Cannot defend the LLM line in an audit. Could be under-reporting by $3,800/mo. | **CRITICAL** |
| K-02 | **The $500/day cap is documentation, not code.** A runaway Opus loop could burn the full $15K monthly budget in a weekend with no automated stop. | Tail risk = full monthly budget in 48 hours. | **CRITICAL** |
| K-03 | **No per-product P&L.** comms-hub absorbs all shared LLM and infra costs. Pepper, Your9, and FreeAgent cannot be evaluated as standalone P&L units. | Cannot answer "is product X profitable" — exactly the question Kyle would ask. | **HIGH** |
| K-04 | **No automated revenue-side reporting.** Stripe webhook secret exists but no MRR / churn / new-customer events surface in any report. Today $0; tomorrow when Pepper sells, no dashboard sees it. | Will be invisible to Owner the moment money starts flowing. | **HIGH** |
| K-05 | **xAI / Grok spend is fully blind** — no billing API, $1-3/day estimate is a guess. | Small absolute number today (~$30-90/mo) but zero visibility = no defensibility. | **MEDIUM** |
| K-06 | **Neon (PostgreSQL backup) cost unverified.** `NEON_DATABASE_URL` is in `.env` (`docs/credential-inventory.md` line 36) but no usage line in any cost report. Assumed free tier. | Could be a silent $20-50/mo line. | **MEDIUM** |
| K-07 | **Cloudflare Workers KV upgrade alert not wired.** Free-tier ceiling triggers $5/mo upgrade silently. | Small ($5/mo) but a precedent for silent upgrades on other services. | **LOW** |
| K-08 | **DigitalOcean / DNSimple / Namecheap receipts not API-ingested.** Costs come from memory + occasional email scrape. | Drift risk. The Apr 5 DNSimple receipt of $31.00 has no breakdown of which domains it covered. | **LOW** |

---

## Top 5 cost optimizations available

| # | Optimization | Estimated $-impact | Effort | Owner | Evidence |
|---|---|---|---|---|---|
| 1 | **Reconcile Anthropic console invoice against `logs/api-token-usage.jsonl` cache columns.** Resolve K-01 gap. If upper bound is real, immediately rebalance Opus → Sonnet for routine background work (currently 77.4% Opus on Apr 8). | **$1,500-2,100/mo** if upper bound holds; **$0 if lower bound holds (still closes the K-01 audit gap)** | LOW | MONEY | `docs/expense-report-apr8-1900.md` lines 175-181 |
| 2 | **Wire a hard daily-cap circuit breaker** at the comms-hub layer. Convert `memory/feedback_budget_500_day.md` from policy to code. Trip at $400/day (80% of cap), kill all background agents, alert Owner. | **Caps tail risk at $500/day instead of $15K/mo** | MEDIUM (1-2 days) | DOC + Tee | `memory/feedback_budget_500_day.md` is text-only |
| 3 | **Right-size HeyGen.** At Apr 8 cycle pace (~21 credits/day = 640/mo), HeyGen Pro at $99 covers it. Business at $149 has ~360 credits/mo of headroom currently going unused. | **$50/mo** | TRIVIAL (downgrade button) | MONEY | `docs/expense-report-apr8-1900.md` lines 149-160 |
| 4 | **Audit DNSimple-managed domain portfolio.** Apr 5 receipt was $31.00 with no per-domain breakdown. `docs/expense-report.md` line 150 flagged that get9.ai may or may not be registered. Drop unused domains. | **$10-80/yr per dropped domain** (estimate 2-3 domains = $50-200/yr) | LOW | DOC | `docs/expense-report-apr8-1900.md` line 87 |
| 5 | **Build a per-product P&L line in `usage-daily-*.md`** by tagging Anthropic API calls with `agent` field (already in `logs/api-token-usage.jsonl`) and rolling up by product. Closes K-03 gap. | **$0 direct savings** but unlocks "is product X profitable" decisions | MEDIUM | MONEY + SCOUT | `logs/api-token-usage.jsonl` already has `agent` tag per row |

---

## What we are confident about

- **Validated:** Anthropic Max Plan $200/mo, HeyGen Business $149/mo, ElevenLabs Pro Annual $990/yr, X Premium Plus $20/mo, DigitalOcean 1 droplet active, DNSimple Apr 5 $31 receipt, Twilio balance $36-41 / 4 numbers active, Cloudflare 0.4% of free tier (no charge), Supabase 3,125 rows / free tier, Stripe $0 transactions, Alpaca paper-only $0, all real-money trading paths gated.
- **Internally re-derivable:** Anthropic API at $13.21 for Apr 8 from `logs/api-token-usage.jsonl` matches the hourly expense report's calculation independently.

## What we are not yet confident about

- **The Anthropic API monthly run-rate.** Lower bound $396/mo (token log without cache columns), upper bound $4,280/mo (token log with cache columns at published cache pricing). **The truth is in the Anthropic console invoice and we have not yet pulled it.** Optimization #1 above resolves this.
- **xAI / Grok monthly spend.** $1-3/day estimate, no validation source.
- **Neon database monthly cost.** Connection string in env, no usage line in any report.

---

## Recommendation to Kyle

> The cost picture at 9 Enterprises is **observable but not yet defensible**. Three remediation items take it to enterprise-grade in under two weeks:
>
> 1. Pull the Anthropic console invoice for Apr 5-11 and reconcile against `logs/api-token-usage.jsonl`. This closes the single biggest unknown — the cache-column question — and either confirms the conservative ~$948/mo total or revises it to ~$4,800/mo. Either answer is defensible; the gap is not.
> 2. Wire the $500/day soft cap into code as a hard circuit breaker at the comms-hub layer. Today it is policy, not enforcement. The runaway-loop tail risk is the worst-case financial exposure in the universe and it is currently uncapped.
> 3. Tag Anthropic API calls by product in the token log (the `agent` field already exists in `logs/api-token-usage.jsonl`) and roll up daily into the `docs/usage-daily-*.md` reports. This produces per-product P&L — exactly the "is product X profitable" question a CIO would ask.
>
> Once those three are done, the rest of the gaps (Neon verification, Grok visibility, DNSimple domain audit) are all under-$50/mo line items that can be cleaned up at the next monthly close.

---

*Companion documents: `logs/scout-task-cost-audit-apr11.md` (full source data + per-line evidence), `logs/money-task-projections-apr11.md` (12-month forward model with sensitivity scenarios). All numbers in this brief are sourced inline; nothing is presented as fact unless cited.*
