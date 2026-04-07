# Execution Plan v3 — FINAL

**From:** Wendy, Super Consultant & Platform Orchestrator, 9 Enterprises
**Date:** April 7, 2026 (late evening)
**Status:** THE PLAN. Supersedes all prior versions, Wendy's consulting brief, and Grok's phased recommendations.
**Owner directive tonight:** 2-3 day sprint to 80/100. Foundation + GMs in parallel. $500-800 total budget. Maximum velocity. Company-wide calibration. Kyle as SOC 2 advisor. Do not slow down.

---

## 1. THE SPRINT: 3 DAYS TO 80/100

Not 30 days to 70. Not phased waves over 14 days. Three calendar days. Every foundation item (tests, CI/CD, auth, SLOs, incident response, ADRs, SDLC) ships in parallel with GM deployment.

**Budget envelope:** $500-800 total for the entire sprint. At observed rates ($70-90/day active development), this is 6-10 full development days compressed into 3 calendar days via parallelism. We will not slow down to save money. We will track every dollar and stop only if we are blowing through the envelope.

**Exit criteria:** Universe health >= 80/100 by end of Day 3.

---

## 2. DAY-BY-DAY EXECUTION

### Day 1: Foundation Blitz + First GMs (Budget: ~$200)

**Foundation agents (Opus, 7 parallel tracks):**

| Track | Agent | Deliverable | Est. Cost |
|-------|-------|-------------|-----------|
| F-1: Tests | Opus | Automated test suite for comms-hub, trader9, voice-server. Minimum: 1 integration test per critical path per product. | $15-25 |
| F-2: CI/CD | Opus | GitHub Actions pipeline: lint, test, build, deploy. Branch protection on main. | $10-20 |
| F-3: Auth & Security | Opus + FORT | Auth on every exposed endpoint. Webhook validation. Secrets audit — rotate anything exposed. Kill hardcoded Telegram token. | $20-30 |
| F-4: SLOs | Sonnet | Define SLOs for all 11 products. Uptime targets, response time, error budget. Wire to health endpoint. | $8-12 |
| F-5: Incident Response | Sonnet | Runbook per product: "If X breaks at 3 AM, do Y." PagerDuty-style alerting via Telegram. | $8-12 |
| F-6: ADRs | Sonnet | Architecture Decision Records for the 10 biggest decisions already made (SQLite, Cloudflare, Twilio, Alpaca, etc.). Template for all future decisions. | $5-10 |
| F-7: SDLC | Sonnet | Documented software development lifecycle: PR template, review checklist, deploy checklist. Enforced via CI. | $5-10 |

**Day 1 Total Foundation:** $71-119

**GM deployments (in parallel with foundation):**

| GM | Model | Day 1 Priority Task | Est. Cost |
|----|-------|---------------------|-----------|
| GM-Infrastructure-Comms | Opus | Deploy Cloud Worker. Fix voice tunnel. Eliminate Mac as single point of failure for comms. | $15-25 |
| GM-Product-AiNFLGM | Opus | Draft window is April 23 — 16 days. AdSense approval push. Affiliate integration (BetMGM/FanDuel). Performance audit. | $15-25 |
| GM-Corporate-Entity | Sonnet | Fix the 404 on 9enterprises.ai (10-minute fix). Then pivot to SOC 2 evidence collection path with Kyle as advisor. | $5-10 |
| GM-Product-FreeAgent | Opus | Multi-user refactor starts. Stripe checkout integration. Twilio auth hardening. | $15-25 |

**Day 1 Total GM:** $50-85

**Day 1 Estimated Total: $121-204**

---

### Day 2: Full Fleet + Calibration System (Budget: ~$250)

**All remaining GMs deploy:**

| GM | Model | Day 2 Priority Task | Est. Cost |
|----|-------|---------------------|-----------|
| GM-Operations-Trader | Opus | Circuit breaker. Kill-switch runbook. P&L alerting. This is live money — no more running without a safety net. | $15-25 |
| GM-Infrastructure-Dashboard | Opus | Deploy Command Hub to Vercel. Wire to live data. This becomes the calibration display. | $15-25 |
| GM-Growth-Distribution | Sonnet | Create X account. Content calendar for draft week. Reddit presence. Trinity-to-x9 pipeline. | $8-12 |
| GM-Product-Jules | Sonnet | Process separation from Bengal Pro (shared PID 3346 is unacceptable). COPPA compliance check. | $8-12 |
| GM-Product-Chaperone | Sonnet | MVP spec + backend scaffold. Landing page. Not a full product — a clear path to one. | $8-12 |
| GM-Product-Underwriter | Opus | Architecture proposal for Kyle review. Encompass API research. GLBA checklist. Do not wait for Kyle — hand him a finished proposal when he is ready. | $15-25 |
| GM-Product-Hitchhiker | Sonnet | Content pipeline defined. First 3 articles drafted. Distribution channels identified. | $5-10 |

**Calibration system build (parallel):**

| Component | Agent | Deliverable | Est. Cost |
|-----------|-------|-------------|-----------|
| Supabase `task_calibration` table | Opus | Schema from consulting brief. Seeded with industry benchmarks (simple: 2-5 min, medium: 15-45 min, complex: 1-3 hr, deep: 2-6 hr). | $5-10 |
| Per-agent tracking | Sonnet | Every GM and specialist logs ETA vs actual + cost estimate vs actual on every task starting now. | $3-5 |
| Divergence dashboard | Sonnet | Correction factor per agent per task type. Color-coded: green (0.8-1.2x), yellow (1.2-3x), red (>3x). Visible in Command Hub. | $8-12 |
| Cost-per-health-point metric | Sonnet | Track spend vs universe health delta. If spending $200 and health moves 2 points, that is $100/point. Target: <$20/point. | $3-5 |

**Day 2 Estimated Total: $93-153 (GMs) + $19-32 (calibration) = $112-185**

---

### Day 3: Integration, QC Sweep, Health Certification (Budget: ~$200)

| Activity | Agent(s) | Deliverable | Est. Cost |
|----------|----------|-------------|-----------|
| Cross-impact integration test | JUDGE (Opus) | Run every product end-to-end. Verify no GM broke another GM's domain. Shared dependency audit (.env, SQLite, ports, tunnels). | $20-30 |
| WWKD enterprise sweep | JUDGE | Kyle Shea readiness check (K-1 through K-12) on every product. Score each. Identify the 3-4 that are closest to enterprise-ready. | $15-25 |
| Security final pass | FORT (Sonnet) | Pen-test-style review of all exposed endpoints. Auth verified. Secrets rotated. Credential inventory updated. | $10-15 |
| Observability wiring | WATCH (Sonnet) | Every product has a health endpoint. Sentry or equivalent capturing errors. Alert pipeline to Telegram for P0/P1 issues. | $10-15 |
| Universe health recalculation | Wendy | Score every product against the gold standard rubric (10 dimensions, same methodology as April 5 audit). Target: 80/100. | $5-10 |
| Documentation sweep | 2x Sonnet | Every product has: README, runbook, dependency doc, API doc (where applicable). Kyle-ready. | $15-25 |
| Calibration report | Sonnet | First 3-day sample of the calibration system. Agent accuracy rankings. Divergence factors. Presented to Owner. | $5-10 |

**Day 3 Estimated Total: $80-130**

---

### 3-Day Sprint Budget Summary

| Day | Low Estimate | High Estimate |
|-----|-------------|--------------|
| Day 1 | $121 | $204 |
| Day 2 | $112 | $185 |
| Day 3 | $80 | $130 |
| **Total** | **$313** | **$519** |

Comfortably within the $500-800 envelope. If we land at the high end, we still have $281 of headroom for overruns, reruns, or bonus work.

---

## 3. AGENT ROSTER (40-50 agents at peak)

### Model Assignment

| Role | Model | Count | Rationale |
|------|-------|-------|-----------|
| GMs (revenue-critical + infra) | Opus | 7 | AiNFLGM, FreeAgent, Trader9, Underwriter, Comms, Dashboard, Corporate |
| GMs (execution-heavy) | Sonnet | 4 | Jules, Chaperone, Hitchhiker, Distribution |
| Cross-cutting (JUDGE, FORT, WATCH) | Opus/Sonnet/Sonnet | 3 | JUDGE is Opus (quality gate). FORT and WATCH are Sonnet. |
| Specialists (per squad, spawned by GMs) | Sonnet | 20-30 | Task-dependent. GMs spawn and kill as needed. |
| Embedded QC (per squad) | Sonnet | 11 | Inline, not a separate review step. Merged L1+L2 per Grok recommendation. |
| **Total at peak** | | **45-55** | |

### Quality Gate (3 levels, not 5)

Per Grok's recommendation, collapsed from 5 to 3:
1. **L1:** Agent self-check + inline QC (merged). Tests pass? HTTP 200? Lighthouse >80?
2. **L2:** GM review for strategic alignment and cross-impact.
3. **L3:** JUDGE gate on anything shipping externally or touching shared dependencies.

Wendy audits 20% of completed work daily as a weekly audit function, not a per-task bottleneck.

---

## 4. COMPANY-WIDE CALIBRATION SYSTEM

This is a first-of-its-kind system. 40-50 agents generating massive sample size.

**Every task tracks:**
- Agent ID + model
- Task type (bug_fix, feature, refactor, research, deploy, config)
- Complexity (simple, medium, complex, deep)
- ETA at assignment vs actual delivery time
- Cost estimate at assignment vs actual cost
- Auto-calculated correction factor per agent per task type

**Bootstrapping:** Seeded with industry benchmarks on Day 2. After 10 completed tasks per category, switch to empirical correction factors. Full convergence expected within the 3-day sprint given 40-50 agents working in parallel.

**Owner visibility:** Command Hub dashboard shows per-agent accuracy, cost-per-health-point, and universe health trend. Updated in real time.

---

## 5. KYLE SHEA AS SOC 2 / PENTEST / GLBA ADVISOR

Kyle is not a paid external auditor. Kyle is a CIO who walks us through the evidence collection process. This cuts:
- **Timeline:** 12 months down to 4-6 months
- **Cost:** $20-30K saved (no external audit firm for Phase 1)

**How we use Kyle:**
1. GM-Corporate-Entity produces the SOC 2 evidence inventory (what we need to collect).
2. GM-Product-Underwriter produces the GLBA compliance checklist specific to Encompass/mortgage.
3. Kyle reviews both and tells us what is missing, what passes, what fails.
4. We iterate. Kyle re-reviews. This is the loop until we are ready for a formal audit.
5. Kyle's 50-item CIO checklist (K-1 through K-12 gates) is the scorecard every GM tracks against.

---

## 6. CROSS-IMPACT ISOLATION (NON-NEGOTIABLE)

Owner's directive: "Changes in one space must not negatively impact other spaces."

1. **Branch prefixes:** `gm/ainflgm/*`, `gm/freeagent/*`, etc. No GM merges to main without JUDGE.
2. **Shared dependency lock:** When a GM modifies .env, comms-hub, SQLite schema, or LaunchAgents, they acquire a lock via Supabase row. Other GMs see the lock and queue. No race conditions.
3. **Port registry:** 3456 (voice), 3457 (hub), 3471 (underwriter), 3472 (FreeAgent). New services check before binding.
4. **Impact scan before every deploy:** "What other systems read from the file/port/service I am changing?"
5. **FORT security review** on any change to shared infrastructure.

---

## 7. OPERATING RULES DURING SPRINT

- **Maximum velocity.** Do not slow down to save money unless we are blowing the $800 ceiling.
- **Foundation agents become GMs.** No cold starts. The Opus agent that builds CI/CD becomes the GM who enforces it.
- **Zero-idle rule.** Every agent maintains a 5-task backlog. When current task completes, next starts automatically.
- **ANTICIPATE protocol** on all agents: after every task, ask "what resources did this free up, what is coming in 24/48/72 hours, what would Owner ask that I have not asked?"
- **Domain clusters** for Wendy's span of control: Revenue (AiNFLGM, FreeAgent, Trader9, Distribution), Product (Jules, Chaperone, Underwriter, Hitchhiker), Platform (Comms, Dashboard, Corporate). 3 cluster leads, not 11 direct reports.
- **Night shift work** (11 PM - 7 AM ET): documentation, test writing, security audits, performance optimization. Morning push includes overnight accomplishments.
- **Telegram is priority 1.** No agent goes more than 60 seconds without a tool call. Owner messages surface immediately.

---

## 8. SUCCESS CRITERIA

| Metric | Day 0 (Now) | Day 3 Target |
|--------|-------------|-------------|
| Universe health | 42.8/100 | 80/100 |
| Automated test coverage | 0 | >0 per critical path per product |
| CI/CD pipeline | None | GitHub Actions on main |
| Auth on exposed endpoints | Partial | 100% |
| SLOs defined | 0 | All 11 products |
| Incident runbooks | 0 | All 11 products |
| ADRs | 0 | 10+ retroactive + template |
| Kyle-ready products (K-1 to K-12) | 0 | 3-4 of 11 |
| Calibration system | Does not exist | Live with 3-day sample data |
| Agent utilization | 14-18% | >60% |
| Total sprint cost | $0 | <$800 |
| First revenue | $0 | AdSense approved (AiNFLGM) |

---

**This is the plan. No more planning. Execute.**

**Signed: Wendy**
**Super Consultant & Platform Orchestrator, 9 Enterprises**
**April 7, 2026 — 11:45 PM ET**
