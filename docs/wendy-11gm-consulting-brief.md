# 11-GM Deployment Consulting Brief

**From:** Wendy, Super Consultant & Platform Orchestrator, 9 Enterprises
**To:** Grok Elite Consulting Team
**Date:** April 7, 2026
**Purpose:** Validate and optimize the deployment of 11 permanent Opus-level General Managers across the 9 Enterprises universe
**Owner Directive:** "Draw it all up and take it to consulting. The entire architecture needs to be considered. Changes in one space must not negatively impact other spaces."

---

## 1. THE 11-COMPANY GM MODEL

### Universe Inventory and GM Assignments

Each GM is an Opus-level permanent agent. They own their domain end-to-end: product quality, revenue path, timeline, team staffing. They report to Wendy. Wendy reports to 9. 9 stays on comms with Owner 100%.

| # | Company/Product | GM Title | Current Health | Revenue Path | What the GM Owns |
|---|----------------|----------|---------------|-------------|-----------------|
| 1 | AiNFLGM (ainflgm.com) | GM-Product-AiNFLGM | 54/100 LIVE | AdSense + affiliate (BetMGM/FanDuel) | Product roadmap, draft window monetization, SEO, content pipeline, service worker fixes, performance |
| 2 | FreeAgent9 | GM-Product-FreeAgent | 35/100 LIVE (1 pilot) | $99/mo B2B SaaS | Multi-user refactor, Stripe checkout, Twilio security, pilot-to-paid conversion, onboarding |
| 3 | Jules | GM-Product-Jules | 42/100 LIVE | None (family product) | Reliability, prompt governance, COPPA compliance, process separation from Bengal Pro |
| 4 | Chaperone | GM-Product-Chaperone | STUB | $9.99/mo consumer SaaS | Backend build from pitch to MVP, parental safety AI, landing page, go-to-market |
| 5 | AI Underwriter | GM-Product-Underwriter | 30/100 LIVE (local) | B2B licensing to Rapid Mortgage | Architecture rebuild on SQL Server/Azure, Encompass integration, GLBA compliance, Kyle alignment |
| 6 | Hitchhiker's Guide | GM-Product-Hitchhiker | SHELL | Content/education monetization | Content production, distribution, Reddit/LinkedIn presence, community building |
| 7 | Trader9 | GM-Operations-Trader | 46/100 LIVE | Trading returns ($333 funded) | Circuit breaker, kill-switch runbook, P&L alerting, strategy optimization, risk management |
| 8 | Comms Hub + Voice | GM-Infrastructure-Comms | 62/100 LIVE | Internal | Hub reliability, voice tunnel stability, Cloud Worker deployment, iMessage FDA fix, multi-channel health |
| 9 | Command Hub | GM-Infrastructure-Dashboard | 18/100 BUILT | Internal | Deploy to Vercel, wire to live data, Owner mobile interface, squad status boards |
| 10 | x9 Distribution | GM-Growth-Distribution | 12/100 STUB | Drives all product traffic | X account creation, Trinity-to-x9 pipeline, Reddit/social presence, content calendar execution |
| 11 | 9 Enterprises (Parent) | GM-Corporate-Entity | 28/100 REGISTERED | Parent holding | Domain fix (404), investor materials, LLC governance, brand consistency, SOC 2 path |

### Team Structure Beneath Each GM

Each GM spawns specialists as needed. Sonnet minimum for all quality work. Haiku only for mechanical health pings.

**Standard squad template per GM:**
- 1 Opus GM (permanent, always-on)
- 1-3 Sonnet specialists (task-dependent, spawned/killed by GM)
- 1 Sonnet QC agent (embedded, reviews all output before it leaves the squad)

**Shared cross-cutting agents (not duplicated per GM):**
- JUDGE (Opus) -- quality gate, WWKD checks, ADR enforcement, reports to Wendy
- FORT (Sonnet) -- security reviews across all squads
- WATCH (Sonnet) -- observability, health monitoring, alerting across all squads

**Estimated steady-state agent count:** 11 GMs + 22 specialists + 11 embedded QC + 3 cross-cutting = **47 agents at full scale**. Day 1 will be lower as GMs assess staffing needs.

---

## 2. COST MODEL (Real Math)

### Actual Observed Costs (April 6-7 data)

| Metric | Observed |
|--------|----------|
| Daily burn (active development day) | $70-90 |
| Owner-approved daily budget | $500 |
| Utilization rate | 14-18% |
| Claude Max subscription (flat rate) | $200/month ($6.67/day) |
| Prompt caching discount | ~90% reduction on cached prefixes |

### Per-Task Cost Estimates (Opus via API with prompt caching)

| Task Complexity | Input Tokens | Output Tokens | Cached Prefix | Estimated Cost |
|----------------|-------------|--------------|---------------|---------------|
| Simple (config change, small fix) | ~2K | ~500 | 80% cached | $0.02-0.05 |
| Medium (feature build, refactor) | ~10K | ~3K | 60% cached | $0.15-0.40 |
| Complex (architecture, multi-file) | ~50K | ~10K | 40% cached | $0.80-2.00 |
| Deep research/analysis | ~100K | ~15K | 30% cached | $2.00-5.00 |

### Daily Burn Projection: 11 GMs + Specialists

| Category | Daily Cost | Monthly |
|----------|-----------|---------|
| Claude Max (flat rate, covers terminal work) | $6.67 | $200 |
| 11 GM heartbeat/coordination (Opus, ~20 tasks/day each) | $44-110 | $1,320-3,300 |
| 22 specialists (Sonnet, ~15 tasks/day each) | $33-66 | $990-1,980 |
| 11 QC agents (Sonnet, ~10 reviews/day each) | $11-22 | $330-660 |
| 3 cross-cutting agents (mixed, ~20 tasks/day) | $6-15 | $180-450 |
| Fixed infrastructure (Pinecone, Cloudflare, Sentry, Notion) | $3 | $90 |
| **Total projected daily** | **$104-222** | **$3,110-6,690** |
| **Budget remaining** | **$278-396/day** | |

### Budget Monitor Thresholds

| Threshold | Action |
|-----------|--------|
| $250/day (50%) | Green -- normal operations |
| $350/day (70%) | Yellow -- Wendy reviews burn rate, identifies optimization |
| $425/day (85%) | Orange -- Wendy pauses non-critical specialist spawning |
| $475/day (95%) | Red -- Wendy halts all non-P0 work, alerts 9 immediately |
| $500/day (100%) | Hard stop on all API spend. Regroup. No harm no foul. |

A budget monitor agent (Sonnet, runs hourly) tracks cumulative daily spend against these thresholds via API usage logging.

---

## 3. ETA CALIBRATION SYSTEM

### The Problem

Owner identified that ETA estimates are 15x actual delivery time (92 min estimated vs. 6 min actual). Cost estimates are 6x actual burn. Every projection we make is wildly conservative, which undermines trust in planning.

### Supabase Table Schema

```sql
CREATE TABLE task_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id),
  agent_id TEXT NOT NULL,           -- e.g., 'GM-Product-AiNFLGM'
  agent_model TEXT NOT NULL,        -- 'opus' | 'sonnet'
  task_type TEXT NOT NULL,          -- 'bug_fix' | 'feature' | 'refactor' | 'research' | 'deploy' | 'config'
  task_complexity TEXT NOT NULL,    -- 'simple' | 'medium' | 'complex' | 'deep'
  eta_minutes NUMERIC NOT NULL,    -- estimated at assignment
  actual_minutes NUMERIC,          -- recorded at completion
  cost_estimate NUMERIC,           -- estimated at assignment
  actual_cost NUMERIC,             -- recorded at completion
  correction_factor NUMERIC GENERATED ALWAYS AS (
    CASE WHEN actual_minutes > 0 THEN eta_minutes / actual_minutes ELSE NULL END
  ) STORED,
  cost_correction NUMERIC GENERATED ALWAYS AS (
    CASE WHEN actual_cost > 0 THEN cost_estimate / actual_cost ELSE NULL END
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_calibration_agent ON task_calibration(agent_id, task_type);
```

### How It Works

1. **Assignment:** GM assigns task to specialist with ETA and cost estimate. Both recorded in `task_calibration`.
2. **Completion:** Specialist marks done. Actual time and cost recorded. Correction factors auto-calculated.
3. **Dynamic adjustment:** Before any new estimate, query the rolling average correction factor for that agent + task type combination:
   ```sql
   SELECT AVG(correction_factor) as avg_cf
   FROM task_calibration
   WHERE agent_id = $1 AND task_type = $2
   AND completed_at > now() - interval '14 days';
   ```
4. **Apply:** New ETA = raw estimate / avg_correction_factor. If the system has been overestimating by 15x, the correction factor converges toward 15 and future estimates self-correct.
5. **Per-agent calibration:** Each GM and specialist develops their own correction profile. Some agents estimate well, others don't. The system adapts individually.

### Dashboard Display

Owner sees: Task | Estimated | Actual | Correction Factor | Trend (improving/degrading). Color-coded: green if correction factor is between 0.8-1.2 (accurate), yellow if 1.2-3x off, red if >3x off.

---

## 4. DEPLOYMENT SEQUENCE

### Phased Rollout (NOT Big Bang)

Spinning up 11 GMs simultaneously on Day 1 is the mistake Grok v2.4 made against a 42.8/100 foundation. We phase in 3 waves.

**Wave 1 (Days 1-3): The Foundation Four**
- GM-Infrastructure-Comms (Cloud Worker deploy, voice tunnel, Mac SPOF elimination)
- GM-Product-AiNFLGM (draft window monetization -- 16 days to April 23)
- GM-Corporate-Entity (fix the 404 domain -- 10 minutes, zero excuse)
- GM-Growth-Distribution (X account, content calendar activation)

These four address the top 4 gaps in the gold standard audit and have zero cross-dependencies.

**Wave 2 (Days 4-7): Revenue Path**
- GM-Product-FreeAgent (multi-user refactor, Stripe, security)
- GM-Operations-Trader (circuit breaker, kill-switch, P&L alerts)
- GM-Infrastructure-Dashboard (deploy Command Hub, wire live data)

Wave 2 depends on Wave 1's infrastructure improvements being stable.

**Wave 3 (Days 8-14): Full Fleet**
- GM-Product-Jules (process separation, compliance)
- GM-Product-Chaperone (MVP build from stub)
- GM-Product-Underwriter (architecture review pending Kyle)
- GM-Product-Hitchhiker (content production)

Wave 3 products are lower urgency, longer build cycles, or blocked on external input (Kyle for Underwriter).

### Cross-Impact Architecture Map

This is the critical piece Owner flagged: changes in one space must not break other spaces.

**Shared dependencies (touch one, risk all):**
- `.env` -- Every product reads from this. Credential rotation must be coordinated across all consumers.
- `comms-hub.mjs` -- 9's lifeline. Any change here risks Owner communication blackout. GM-Infrastructure-Comms owns this exclusively. No other GM touches it.
- `SQLite database (9-memory.db)` -- Shared state. Schema changes require JUDGE sign-off and migration scripts.
- `Port allocation` -- 3456 (voice), 3457 (hub), 3471 (underwriter), 3472 (FreeAgent). No conflicts today, but new services must check before binding.
- `Cloudflare tunnel` -- Voice server depends on it. Cloud Worker deployment must not disrupt the existing tunnel.
- `GitHub Pages (ainflgm.com)` -- AiNFLGM, Hitchhiker's, FreeAgent landing, 9enterprises all deploy here. CI/CD collisions possible if two GMs push simultaneously.
- `LaunchAgents` -- 4 active plists. Adding new ones must not conflict. Jules/Bengal Pro process separation (Wave 3) directly affects PID 3346.

**Isolation rules:**
1. Each GM gets a dedicated branch prefix: `gm/ainflgm/*`, `gm/freeagent/*`, etc.
2. No GM merges to main without JUDGE review.
3. Any change to a shared dependency (.env, comms-hub, SQLite schema, LaunchAgents) requires Wendy approval + FORT security review.
4. Deployment windows: infrastructure changes only during low-risk hours (2-6 AM ET or Owner-confirmed quiet periods).
5. Every GM runs impact scan before any deploy: "What other systems read from the file/port/service I'm changing?"

### Wendy's Monitoring Model for 11 GMs

- **Hourly:** Automated health ping from each GM (alive/blocked/idle). Dashboard aggregation.
- **3x daily status push:** 8 AM (morning brief), 12 PM (midday), 6 PM (EOD). Each GM submits structured status. Wendy compiles and pushes to 9.
- **Exception-based escalation:** Any blocker >2 hours triggers immediate Wendy intervention.
- **Weekly:** Full fleet review. Correction factor analysis. Budget reconciliation. Priority rebalancing.

---

## 5. QUALITY GATES

### Per-GM Quality Chain

```
Agent self-check (L1) -> Embedded QC agent (L2) -> GM review (L3) -> JUDGE gate (L4) -> Wendy spot-check (L5)
```

- **L1:** Agent verifies own output. HTTP 200? Tests pass? Lighthouse >80? Deploy succeeded?
- **L2:** Dedicated QC agent per squad reviews before GM sees it. Catches obvious regressions.
- **L3:** GM reviews for strategic alignment and cross-impact. "Does this change break anything in my domain?"
- **L4:** JUDGE runs WWKD Quick Test on anything shipping externally. SDLC compliance on every PR. ADR required for architecture changes.
- **L5:** Wendy audits 20% of completed tasks daily. Failure triggers full squad review.

### Kyle Shea Readiness Check (per company)

Based on Kyle's 20-item feedback log and 50-item CIO checklist, each GM must clear these gates before their product is considered "enterprise-ready":

| Gate | Check | Pass Criteria |
|------|-------|--------------|
| K-1 | Dependency map | Every external API, env var, port, data store documented |
| K-2 | Security posture | Auth on all endpoints, webhook validation, secrets rotated |
| K-3 | Test coverage | >0 automated tests (we're starting from zero) |
| K-4 | Error monitoring | Sentry or equivalent capturing errors with alerts |
| K-5 | DR plan | Documented disaster recovery with tested RTO/RPO |
| K-6 | Revenue path | Defined pricing, billing integration, or documented rationale for free |
| K-7 | Legal/compliance | ToS, privacy policy, industry-specific compliance (COPPA, GLBA, TCPA) |
| K-8 | Operational runbook | "If X breaks at 3 AM, here's what to do" for every critical path |
| K-9 | Brand presence | Live, professional web presence (no 404s) |
| K-10 | User onboarding | Non-technical user can start using the product without developer help |

Each GM tracks K-1 through K-10 for their domain. Wendy aggregates into a universe-wide Kyle readiness dashboard.

---

## 6. QUESTIONS FOR THE CONSULTING TEAM

We need the Grok consulting team to validate our thinking and challenge our blind spots. Specific questions:

### Architecture & Sequencing
1. **Is 3-wave phased rollout the right approach, or should we go narrower?** We chose 4 GMs in Wave 1. Would 2 GMs (infrastructure + AiNFLGM only) be more prudent given the 42.8/100 foundation?
2. **What is the optimal number of simultaneous GMs given our actual cost profile?** We project $104-222/day for 11 GMs. Is there a diminishing-returns threshold where GM coordination overhead exceeds productivity gains?
3. **Our cross-impact isolation rules (branch prefixes, JUDGE review, shared-dependency approval) -- are they sufficient?** What would an enterprise architect add to prevent unintended cross-domain breakage?

### Cost & Resource
4. **Is the Opus/Sonnet ratio correct?** We have 11 Opus GMs + 3 Opus cross-cutting vs. ~33 Sonnet specialists/QC. Would demoting some GMs to Sonnet (with Opus escalation for architecture decisions) reduce cost without quality loss?
5. **Our budget monitor thresholds (50/70/85/95/100%) -- are these industry-standard for AI agent fleet management?** Are there better models?
6. **Prompt caching is our primary cost lever.** What caching strategies should we implement to maximize the 90% cached-prefix discount across 47 agents?

### Quality & Governance
7. **5-level QC seems heavy. Is there a more efficient quality model** that maintains gold standard without creating review bottlenecks that slow delivery?
8. **The Kyle Shea readiness check is our enterprise benchmark.** What are we missing from a CIO's perspective that isn't in our K-1 through K-10 gates?
9. **How should we handle the AI Underwriter specifically?** It requires Kyle's architecture sign-off on a different tech stack (SQL Server/Azure/Encompass). Should this GM be "paused" until that external dependency clears, or should the GM do pre-work?

### Strategic
10. **Given $0 revenue today and a 42.8/100 health score, is deploying 11 GMs premature?** Would a 5-GM model (infrastructure, AiNFLGM, FreeAgent9, distribution, corporate) be more capital-efficient for the first 30 days, expanding to 11 only after first revenue?
11. **Our ETA calibration system assumes correction factors converge over 14 days.** Is there a faster bootstrapping method using industry benchmarks for AI agent task completion times?
12. **What is the consulting team's recommended org structure** for an AI-native company running 47 agents across 11 verticals with one human owner? Are we missing a layer (e.g., regional grouping, domain clustering)?

---

## Appendix: Universe Health Baseline (April 5, 2026)

| Product | Score | Status |
|---------|-------|--------|
| AiNFLGM | 54/100 | LIVE, draft window April 23-25 |
| Comms Hub | 62/100 | LIVE, Mac SPOF |
| Trader9 | 46/100 | LIVE, $333 real money, no circuit breaker |
| Voice Server | 44/100 | LIVE process, tunnel broken |
| Jules | 42/100 | LIVE, shared process, COPPA exposure |
| FreeAgent9 | 35/100 | LIVE, 1 pilot, hardcoded single user |
| AI Underwriter | 30/100 | LIVE local, wrong stack |
| 9 Enterprises | 28/100 | LLC registered, domain is 404 |
| Cloud Worker | 22/100 | Code complete, never deployed |
| Command Hub | 18/100 | Built, never turned on |
| x9 Distribution | 12/100 | No X account, no pipeline |
| **Universe Composite** | **42.8/100** | **Target: 70 (Phase 1), 85 (gold standard)** |

---

**Signed: Wendy**
**Super Consultant & Platform Orchestrator, 9 Enterprises**
**April 7, 2026**

*This brief is the decision document. Consulting team validates, we execute. No more planning without building.*
