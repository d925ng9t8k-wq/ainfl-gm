# 9 Enterprises — 12-Month Financial Projections
**Date:** 2026-04-11
**Author:** MONEY (financial agent) + SCOUT (audit)
**Purpose:** Forward 12-month cost + revenue model. Pairs with `logs/scout-task-cost-audit-apr11.md` (current burn).
**Status:** READ-ONLY. Revenue scenarios are explicitly labeled "scenario" — they are not real income today.
**Anchor today:** $948-1,008/mo recurring burn, $0 recurring revenue, $500/day soft cap unused (~93% headroom).

---

## Month 1 (current) — real burn from Deliverable 1

| Bucket | Monthly | Source |
|---|---|---|
| Fixed SaaS subscriptions | $491.58 | `docs/expense-report-apr8-1900.md` line 92 |
| Anthropic API recurring (conservative — token log lower bound) | $396 | `docs/expense-report-apr8-1900.md` line 181 |
| HeyGen credit-pack burn beyond base | $30 | Apr 8 cycle pace |
| Grok / xAI | $30-90 | $1-3/day estimate |
| **Month 1 conservative total** | **$948-1,008/mo** | |
| **Month 1 daily** | **$30-40/day** | `docs/expense-report-apr8-1900.md` line 206 |
| **% of $500/day cap** | **6-8%** | |
| **Revenue** | **$0** | No live products taking money |

**Caveat (carries through every month below):** if the Anthropic token-log cache columns are real billables (see Deliverable 1 section "Critical caveat"), the monthly Anthropic line is closer to $4,280/mo and total burn is $4,800-5,000/mo instead of $948-1,008/mo. Both scenarios are projected below.

---

## Months 2-12 — Scenario A: current scale, no new product launches

Assumes the current process inventory keeps running unchanged. Anthropic Max Plan and HeyGen are price-fixed. ElevenLabs is annual-prepaid through Mar 23 2027 (no incremental cash until then). Anthropic API floats with usage but assumed flat at the Apr 8 pace.

| Month | Conservative ($948/mo) | Upper bound ($4,800/mo if cache columns are real) |
|---|---|---|
| Month 2 (May) | $948 | $4,800 |
| Month 3 (Jun) | $948 | $4,800 |
| Month 4 (Jul) | $948 | $4,800 |
| Month 5 (Aug) | $948 | $4,800 |
| Month 6 (Sep) | $948 | $4,800 |
| Month 7 (Oct) | $948 | $4,800 |
| Month 8 (Nov) | $948 | $4,800 |
| Month 9 (Dec) | $948 | $4,800 |
| Month 10 (Jan) | $948 | $4,800 |
| Month 11 (Feb) | $948 | $4,800 |
| Month 12 (Mar) | $948 + $990 ElevenLabs annual renewal = $1,938 (one month) | $4,800 + $990 = $5,790 (one month) |
| **12-month total (Scenario A)** | **~$11,400** | **~$57,600** |

The big lump in Month 12 is the ElevenLabs annual renewal ($990) hitting in March 2027.

---

## Months 2-12 — Scenario B: 1 new product launch per month

Assumes Wendy's roadmap ships at one launch per month: Pepper paid tier (Apr-May), Your9 GA (Jun), AI Underwriter (Jul), Hitchhiker's Guide (Aug), Agent9 real-estate (Sep), and so on. Each launch adds incremental cost.

Per-launch incremental cost assumptions (all ESTIMATES — needs verification before reporting to Owner as fact):
- New product = +$50/mo infra (additional droplet OR Cloudflare Pro OR Resend paid tier)
- New product = +$100-200/mo additional Anthropic API (background agents, customer-facing chats)
- New product = +$0-30/mo HeyGen credit burn if it has video assets

| Month | Products live | Cumulative monthly cost (conservative) | Cumulative monthly cost (upper bound) |
|---|---|---|---|
| Month 1 (Apr) | baseline | $948 | $4,800 |
| Month 2 (May) | + Pepper paid tier | $1,148 | $5,000 |
| Month 3 (Jun) | + Your9 GA | $1,348 | $5,200 |
| Month 4 (Jul) | + AI Underwriter | $1,548 | $5,400 |
| Month 5 (Aug) | + Hitchhiker's Guide | $1,748 | $5,600 |
| Month 6 (Sep) | + Agent9 | $1,948 | $5,800 |
| Month 7 (Oct) | + Product 7 | $2,148 | $6,000 |
| Month 8 (Nov) | + Product 8 | $2,348 | $6,200 |
| Month 9 (Dec) | + Product 9 | $2,548 | $6,400 |
| Month 10 (Jan) | + Product 10 | $2,748 | $6,600 |
| Month 11 (Feb) | + Product 11 | $2,948 | $6,800 |
| Month 12 (Mar) | + Product 12 + ElevenLabs renewal | $3,148 + $990 = $4,138 | $6,800 + $990 = $7,790 |
| **12-month total (Scenario B)** | **~$24,716** | **~$71,690** |

Even Scenario B's upper bound ($7,790 in the most expensive month) is **inside** the $15,000/mo budget cap. Headroom is ~$7,200/mo at the worst-case month.

---

## Revenue scenarios (currently $0 — these are forward modeling, not income)

### Scenario R0 — zero revenue (today's reality)
- AdSense: not yet approved (`docs/usage-daily-2026-04-10.md` doesn't list it; `docs/expense-report.md` line 24 confirms incomplete)
- Affiliates: not yet activated for the Apr 23-25 NFL Draft window (`docs/cost-per-user-model.md` line 117 marks this as the critical path)
- Stripe (Your9, Pepper): wired but no customers (`scripts/your9-billing.mjs:96-127` defines tiers; `docs/expense-report-apr8-1900.md` line 90 confirms $0)
- **Monthly revenue: $0**

### Scenario R1 — AiNFLGM AdSense at 100 / 1K / 10K DAU
Source: `docs/cost-per-user-model.md` lines 53-67 (revenue model with RPM $3-10).

| DAU | MAU equiv (5x) | Monthly AdSense (low: RPM $3) | Monthly AdSense (high: RPM $10) |
|---|---|---|---|
| 100 DAU | 500 MAU | ~$15 | ~$50 |
| 1,000 DAU | 5,000 MAU | ~$150 | ~$500 |
| 10,000 DAU | 50,000 MAU | ~$1,500 | ~$5,000 |

### Scenario R2 — Pepper Stripe revenue at 10 / 100 / 1,000 paying users
Source: Pepper is rebranded Jules — single-user personal AI. Pricing not yet set in code; using Your9 tiers from `scripts/your9-billing.mjs:96-127` as a proxy ($499 Starter / $999 Growth / $2,499 Enterprise) or a consumer-style $20-99/mo for Pepper specifically per `memory/project_pepper_product_spec.md`.

| Paying users | Pepper at $20/mo | Pepper at $99/mo | Mixed Your9 tier ($499 avg) |
|---|---|---|---|
| 10 | $200 | $990 | $4,990 |
| 100 | $2,000 | $9,900 | $49,900 |
| 1,000 | $20,000 | $99,000 | $499,000 |

### Scenario R3 — Affiliate windfall (NFL Draft Apr 23-25 only)
Source: `docs/cost-per-user-model.md` lines 70-83 (3-day window scenario).

| Tier | Conservative 3-day | Aggressive 3-day |
|---|---|---|
| AdSense | $75 | $225 |
| FanDuel CPA (1% conv, $150) | $750 | $22,500 |
| DraftKings CPA (0.5%, $100) | $250 | $7,500 |
| **Total 3-day windfall** | **$1,075** | **$30,225** |

This is one-shot, not recurring. Conservative ($1,075) covers ~5 weeks of conservative-burn 9 Enterprises operating cost. Aggressive ($30,225) covers nearly two years.

---

## Break-even analysis

**Conservative cost case ($948/mo):**

| Path | Threshold to cover $948/mo |
|---|---|
| AdSense alone | ~6,000 DAU at RPM $5 (`docs/cost-per-user-model.md` line 58 puts 1K MAU at $150-500, so ~5-7K MAU = ~1K-1.5K DAU at RPM $10) |
| Pepper alone at $20/mo | 48 paying customers |
| Pepper alone at $99/mo | 10 paying customers |
| Your9 Starter alone ($499/mo) | 2 paying customers |
| Your9 Growth alone ($999/mo) | 1 paying customer |
| Mixed AdSense + 1 affiliate | ~$300 AdSense + 5 FanDuel CPAs ($750) = covered |

**Upper-bound cost case ($4,800/mo if cache columns count):**

| Path | Threshold |
|---|---|
| AdSense alone | ~30K-50K DAU |
| Pepper at $20/mo | 240 customers |
| Pepper at $99/mo | 49 customers |
| Your9 Growth ($999/mo) | 5 customers |
| Your9 Enterprise ($2,499/mo) | 2 customers |

**Break-even is achievable:** Single-customer break-even on Your9 Growth in either cost case. Single Pepper $99 sale of 10 customers covers conservative case. The cost wall is not the obstacle — distribution and the Apr 23-25 affiliate window are.

---

## Runway calculation

**Conservative cost case ($948/mo, $0 revenue):**
- $500/day soft cap × 30 days = $15,000/mo budget
- Actual burn = $948/mo = ~6.3% of budget
- "Runway" against the budget cap = unbounded as long as Owner keeps funding the $15K cap monthly

**If we instead measure runway against a fixed pool of cash (e.g. the $300 resource budget per `memory/reference_budget_approvals.md`):**
- $300 ÷ $948/mo = ~9-10 days
- $300 ÷ $4,800/mo (upper bound) = ~2 days

**Reality check:** the $500/day cap is a soft policy from Owner and the actual operating budget is much larger. There is no fixed runway pool — this is operating expense funded by the Owner monthly. The relevant question is not "how many months of cash do we have" but "how many months until revenue covers the burn."

**Months to break-even at moderate Pepper traction:**
- 10 customers × $99 = $990/mo → covers conservative case → break-even at month 1 of Pepper sales
- 50 customers × $99 = $4,950/mo → covers upper-bound case → ~4-6 months of Pepper sales ramp post-launch

---

## Sensitivity analysis

### Sensitivity 1 — Anthropic API costs 2x
**Trigger:** A new Opus-heavy product launches OR the cache-column accounting question resolves to the upper bound.

| Bucket | Today | 2x scenario |
|---|---|---|
| Anthropic API recurring | $396/mo | $792/mo |
| Total burn | $948/mo | $1,344/mo |
| % of $500/day cap | 6% | 9% |
| Months until break-even at 14 Pepper customers @ $99 | breakeven now | breakeven now |

**Verdict:** comfortable. 2x Anthropic still leaves >90% of the daily cap unused.

### Sensitivity 2 — A paid LLM tier breaks the $500/day cap
**Trigger:** A runaway agent loop OR a malicious abuser hitting an unauthenticated endpoint OR a misconfigured prompt-cache that re-creates instead of reads.

| Scenario | Daily cost | Cap exceeded? |
|---|---|---|
| Apr 8 baseline (validated) | $13-30 | No — 6% of cap |
| 5x Apr 8 baseline | $65-150 | No — still 30% of cap |
| 20x Apr 8 baseline | $260-600 | YES — at upper bound |
| Worst-case runaway: 1 Opus call/sec for 24h ($75/M output × 8K tokens × 86,400 = $51,840) | $51,840 | YES — 100x over cap |

**Verdict:** The $500/day cap is meaningful only if it is enforced in code. Today it is documentation. The runaway-loop scenario is real and **uncapped**. This is the #1 financial risk in the universe right now.

### Sensitivity 3 — HeyGen cycle gets exhausted mid-month
**Trigger:** Pepper avatar work spikes; cycle credits run out; Owner buys top-up.

| Scenario | Cost |
|---|---|
| Today's pace (208 of 1,000 in 9 days = ~700/mo) | Within cycle |
| 2x pace | Cycle exhausted day 18; need ~$66 top-up |
| 5x pace | Cycle exhausted day 7; need ~$200/mo top-up |

**Verdict:** Bounded by Owner approval. HeyGen cannot run away — it requires manual top-up purchases.

### Sensitivity 4 — Live trading is enabled
**Trigger:** Owner flips `ALPACA_LIVE_ENABLED=true` and approves the $200 trading budget.

| Scenario | Cost |
|---|---|
| $200 budget, hits MAX_DAILY_LOSS_PCT (3%) every day | $6/day burn → $200 lost in ~33 days |
| $200 budget, profitable | Net positive |

**Verdict:** Bounded by `MAX_DAILY_LOSS_PCT` circuit breaker (`docs/credential-inventory.md` line 80) and the $200 cap. Cannot exceed the approved pool.

---

## Key projection takeaways

1. **The cost side is not the bottleneck.** Conservative burn is ~7% of the $500/day cap. Even an aggressive 12-product launch year ends Month 12 inside the cap.
2. **The single biggest unresolved cost question is the Anthropic cache-column accounting** (see Deliverable 1). The difference between $948/mo and $4,800/mo is whether `cache_creation` and `cache_read` rows in `logs/api-token-usage.jsonl` are billed separately or already converted in the token log.
3. **The single biggest financial risk is the absent runaway-loop circuit breaker.** The $500/day cap is policy, not code. A misconfigured Opus loop could burn the entire monthly budget in a weekend, undetected.
4. **Break-even is achievable on a single Your9 Growth sale.** $999/mo > $948/mo conservative burn. The constraint is not cost — it is closing the first paying customer.
5. **The Apr 23-25 NFL Draft affiliate window is the highest-leverage revenue event of the next 12 months.** Conservative case ($1,075) covers a month; aggressive case ($30,225) covers nearly two years. Activation of FanDuel/DraftKings affiliate accounts before Apr 17 is the critical path (`docs/cost-per-user-model.md` line 117).

---

*Inputs: `logs/scout-task-cost-audit-apr11.md`, `docs/expense-report-apr8-1900.md`, `docs/cost-per-user-model.md`, `docs/credential-inventory.md`, `memory/reference_verified_subscriptions.md`, `memory/feedback_budget_500_day.md`, `memory/reference_budget_approvals.md`, `scripts/your9-billing.mjs`. All scenario inputs are explicitly labeled scenario; no speculative number is presented as real income.*
