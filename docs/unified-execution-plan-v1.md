# Unified Execution Plan v1.0

**Author:** Wendy, Super Consultant, 9 Enterprises
**Date:** April 6, 2026
**Sources:** Wendy 90-Day Plan v1.1, Grok v2.4 (Swarm Platform), Grok v2.5 (PlayAiGM spine), Owner directives April 5-6
**Status:** PROPOSED -- awaiting 9 + Owner approval

---

## What This Document Is

Three plans exist. Each got something right and something wrong:

- **Grok v2.4** got the architecture right: a Swarm Platform with vertical GMs, dedicated squads, formal intake pipeline, and a central dashboard. But it assumed 11 parallel launches on Day 1 against a 42.8/100 foundation. That is building an empire on sand.
- **Wendy v1.1** got the sequencing right: foundation to 70 before revenue, revenue before empire. But it was too conservative on budget ($1,500/30-day), too cautious on tooling (SQLite-only), and left Wendy as a planning artifact instead of a self-directing orchestrator.
- **Grok v2.5** got the stack constraint right: build with what we have (Claude Max, Cloudflare, SQLite). But it still proposed 6 parallel product launches from a broken foundation and projected revenue timelines disconnected from reality.

This plan takes the best of all three and throws out the rest.

---

## Ground Truth (April 6, 2026)

Lying to ourselves is what got us to 42.8. Here is what is actually true:

| Fact | Value |
|------|-------|
| Universe health score | 42.8/100 |
| Monthly recurring revenue | $0.00 |
| Live products with real users | 3 (AiNFLGM public, FreeAgent9 pilot, Pepper family) |
| Background agents running | 4 (comms-hub, trader9, trinity, jules/pepper) |
| VPS / off-Mac infrastructure | Does not exist |
| Cloud Worker failover | Code complete, never deployed |
| x9 distribution pipeline | Does not exist (CLI tool, no Twitter account) |
| Stripe checkout | Stub, no live flow |
| Automated tests | 0 |
| Error monitoring | None |
| Voice tunnel | Broken |
| Budget (Owner-approved) | $500/day ($15,000/month) |
| NFL Draft window | April 23-25 (17 days) |
| Approved new tooling | Pinecone (vector memory), Notion/Airtable (dashboards) |

---

## Governing Principles

1. **Foundation first is non-negotiable.** Owner burned this in on April 5. Universe health must reach 70 before empire work. No exceptions.
2. **Stop gatekeeping.** Owner said take a full run at it. $500/day is real. Pinecone and Notion are approved. Use them.
3. **The Draft is a real opportunity, not a distraction.** AiNFLGM is already live and functional. Monetizing the Draft window does not conflict with foundation work -- it IS foundation work (wiring AdSense, adding error monitoring, fixing the service worker).
4. **Pepper is Tier 1.** Custom-build-per-user model. Not a side project.
5. **Wendy orchestrates, not waits.** The Wendy gap in v1.1 was that Wendy existed as a plan author, not a self-directing executor. In this plan, Wendy owns the Swarm Platform layer and actively spawns, monitors, and kills squads.

---

## Architecture: Swarm Platform (from v2.4, adapted to reality)

v2.4's Swarm Platform is the right model. But 28-32 agents on Day 1 is not. We start with the structure and scale into it.

### Org Chart (Day 1)

```
Owner (Jasson) -- strategic direction only
  |
  9 (CEO) -- Owner liaison, <10 min SLA, comms priority
  |
  Wendy (Super Consultant / Platform Orchestrator)
  |
  +-- Infrastructure GM (Platform Layer)
  |     - Provisions squads, enforces QC, runs health checks
  |     - Owns: Pinecone setup, Notion dashboard, monitoring
  |
  +-- Product GM
  |     - AiNFLGM Squad (Builder + QC)
  |     - Pepper Squad (Builder + QC)
  |     - FreeAgent9 Squad (Builder + QC)
  |
  +-- Foundation GM (NEW -- does not exist in v2.4)
  |     - FORT (security + credentials)
  |     - WATCH (observability + health)
  |     - JUDGE (SDLC + ADRs + QC gates)
  |
  +-- Shared Pool
        - ORACLE (evolution methodology)
        - DOC (runbooks + DR)
```

**Day 1 agent count:** 12-15, not 28-32. We scale up as foundation stabilizes.

**Key difference from v2.4:** The Foundation GM exists as a first-class vertical. v2.4 assumed the foundation was ready and focused entirely on product launches. It is not ready. Foundation GM runs in parallel with Product GM from Day 1, but Foundation GM has priority on any shared resource conflicts.

### Platform Layer (real stack)

| Component | Tool | Why |
|-----------|------|-----|
| LLM inference | Claude Max (Opus for architecture, Sonnet for specialist work) | Owner-approved, flat rate, no token anxiety |
| Agent memory | SQLite (local) + Pinecone (vector, cloud) | SQLite is proven. Pinecone adds semantic search + cloud persistence. Owner-approved upgrade. |
| Task/state tracking | Notion (synced via Cloudflare Worker) | Replaces manual memory files for dashboard visibility. Owner-approved. |
| Orchestration | Cloudflare Workers + comms-hub | Already built. Workers handle squad provisioning and health. |
| Monitoring | Sentry (free tier) + custom health dashboard | First real error monitoring in the universe. |
| CI/CD | GitHub Actions (existing) | Already works for AiNFLGM. Extend to other products. |
| Failover | Cloud Worker (deploy Week 1) | Mac SPOF mitigation. |

**What we are NOT buying:** Groq, Fireworks, OpenTelemetry, self-healing VPS clusters, or anything else from v2.4's aspirational tools list. We add tools when the foundation earns them.

### Intake Pipeline (from v2.4, kept intact)

New product request enters a 48-hour cycle:
1. Impact scan (dependency map + security + unit economics)
2. Resource allocation (squad provisioned, Pinecone namespace, Notion board)
3. Sandbox testing (24hr blue environment)
4. CEO 9 gate + feature-flag activation
5. Observability hook into central dashboard

This is the right design. It ships in Week 3 after the foundation supports it.

---

## Execution Timeline

### Phase 1: Foundation + Draft Window (Days 1-21, April 6-26)

**Two tracks running in parallel. This is the key insight neither v1.1 nor v2.5 had: foundation hardening and Draft monetization are not in conflict. They are the same work.**

**Track A: Foundation (days 1-21, continuous)**

Week 1 (April 6-12):
- Deploy Cloud Worker to Cloudflare (eliminate Mac SPOF blackout path)
- Close all 6 critical credential flags (Dominos PCI, SQLite key colocation, hardcoded tokens, .env.example)
- Auth-gate exposed internal pages (owner.html, cockpit.html, grok-proposal.html)
- Deploy Sentry free tier on AiNFLGM + comms-hub + pilot-server
- Set up Pinecone namespace for agent memory (replaces stale-memory-file failure mode)
- Stand up Notion dashboard for universe-wide task/health visibility
- Fix voice tunnel routing
- Land Kyle RAM agent build (first Kyle-endorsed artifact)

Week 2 (April 13-19):
- Rotate all flagged credentials (Gmail, Supabase, Telegram token)
- Make HUB_API_SECRET required (remove optional bypass)
- Build automated daily SQLite backup (local + R2 encrypted)
- First 20 automated tests in CI (comms-hub health, pilot-server auth, trader9 circuit breaker)
- DR drill #1: run every scenario in disaster-recovery.md, log RTO/RPO
- Refactor pilot-server.mjs from hardcoded single-user to user-keyed config
- ADR template + first 5 ADRs published
- Comms-hub Supabase init self-test (kills 27-hour silent bug class)

Week 3 (April 20-26):
- WWKD dry-run on AiNFLGM (the Draft-ready product)
- Vulnerability scan (OWASP ZAP) on all exposed endpoints
- SLO table built: uptime/error/latency targets per component, wired to alerts
- Intake Pipeline v1 operational (first product can onboard through formal process)
- 14-day clean health-monitor run begins
- Phase 1 gate check: target 70/100

**Track B: Draft Monetization (days 1-17, deadline April 23)**

This is NOT empire work. This is proving the foundation can support revenue.

Week 1:
- Submit AdSense application (already in progress, 2-4 week review)
- Wire BetMGM/FanDuel affiliate banners on AiNFLGM (revenue that works regardless of AdSense timing)
- Fix service worker stale-content bug (users must see fresh Draft content)
- Add ToS/Privacy footer links (legal prerequisite for ad networks)

Week 2:
- Draft content pipeline: ensure data refresh runs reliably for draft picks/trades
- Umami analytics verified and reporting (we need to prove traffic to advertisers)
- If AdSense approves early, wire ad units with performance budget (do not blow the bundle past 1MB)

Week 3 (Draft week, April 23-25):
- Monitor traffic spike via dashboards (real-world stress test of foundation)
- Capture affiliate revenue from draft-day traffic
- Record all metrics: traffic, errors, revenue, latency. This is the first revenue proof point.

**Track C: Pepper Tier 1 (days 1-21, parallel)**

Owner classified Pepper as Tier 1 with custom-build-per-user. This runs its own squad from Day 1.

- Week 1: Define Pepper product architecture (what does custom-build-per-user mean technically? Per-user prompt? Per-user Pinecone namespace? Per-user Telegram bot?)
- Week 2: Build first custom Pepper instance beyond the current family deployment
- Week 3: Pepper onboarding flow documented and repeatable

**Phase 1 Exit Criteria (Day 21):**
- Universe health >= 70/100
- Zero P0/P1 infrastructure gaps open
- Zero critical credential flags
- Cloud Worker deployed and failover tested
- Sentry + health dashboard live
- >= 20 automated tests in CI
- DR drill completed with logged results
- At least one revenue event recorded (affiliate click, AdSense impression, anything)

---

### Phase 2: Revenue + Product (Days 22-50, April 27 - May 25)

Foundation is proven. Now we scale.

- **AiNFLGM post-Draft:** Analyze Draft window performance. Double down on what worked. Wire second revenue stream (paid tier? premium features? expanded affiliates?).
- **FreeAgent9 productization:** Multi-user refactor complete from Phase 1. Add Stripe checkout at $99/mo. Set pilot end date with Kyle Cabezas. Draft ToS.
- **Pepper expansion:** Second and third custom builds. Define pricing model. Validate willingness to pay.
- **Command Center Phase 1:** Dashboard + Chat + Tasks, deployed to Vercel with Supabase auth. Jasson operates the universe from his phone.
- **x9 distribution:** Jasson creates X account (human task). Wire Trinity-to-x9 posting pipeline. First organic posts.
- **Swarm Platform scale-up:** Add Revenue GM vertical. Spin up squads for Hitchhiker's Guide and Chaperone if Phase 1 revenue justifies it.
- **Pinecone fully operational:** All agent memory semantic-searchable. Stale memory files become a solved problem class.

**Phase 2 Exit Criteria (Day 50):**
- Universe health >= 80/100
- At least $1 in recorded, traced revenue
- FreeAgent9 multi-user + Stripe live
- Command Center deployed and used by Jasson
- Pepper has >= 2 custom deployments
- Notion dashboard is the single source of truth for all squad status

---

### Phase 3: Empire Scaffolding (Days 51-90, May 26 - July 4)

- **Kyle WWKD pass** on at least one flagship product
- **Second revenue stream** proven with 30-day trailing positive numbers
- **Command Center Phase 2:** Terminal + Memory + Audit tabs
- **SOC 2 Type II** auditor engaged, evidence collection structured
- **AI Underwriter** architecture session with Kyle (or formally shelved with written reason)
- **Intake Pipeline proven:** at least one new product onboarded through formal process
- **Full re-audit:** SCOUT runs gold standard audit again. Score compared against 42.8 baseline.

**Phase 3 Exit Criteria (Day 90):**
- Universe health >= 85/100
- >= 2 revenue streams with real money flowing
- Kyle WWKD Quick Test passed on flagship
- Command Center fully functional from phone
- SOC 2 Type II path visible
- Every Day-90 success criterion met or Owner-deferred with written reason

---

## Budget Allocation ($500/day)

| Category | Daily | Monthly | Notes |
|----------|-------|---------|-------|
| Claude Max (flat rate) | ~$6.67 | $200 | Existing subscription, Opus + Sonnet |
| Pinecone | ~$2.30 | $70 | Standard tier, 1 project |
| Notion | ~$0.33 | $10 | Team plan |
| Sentry | $0 | $0 | Free tier |
| Cloudflare Workers | ~$0.17 | $5 | Existing, minimal overage |
| VPS (when deployed) | ~$0.20 | $6 | Hetzner or equivalent |
| Specialist agent inference | ~$8 | $240 | Sub-agents on Sonnet for parallel work |
| Tooling/services buffer | ~$5 | $150 | Unexpected needs |
| **Unallocated reserve** | **~$477** | **~$14,319** | Available for scaling |

The honest truth: our actual burn is nowhere near $500/day. Claude Max is flat rate. Most of our tools are free tier or single-digit dollars. The reserve exists for when we need to burst (paid Sentry, additional VPS, premium API access for real-time sports data, HeyGen for Pepper video). Owner said stop being conservative. The budget is there when we need it. We do not need to spend it to prove we are working.

---

## The Wendy Gap (Self-Directing Orchestrator)

v1.1 had Wendy as a plan author. v2.4 had Wendy as a consulting team member waiting for CEO 9's approval. Neither is right.

**In this plan, Wendy is the Platform Orchestrator.** Concretely:

1. **Wendy spawns squads.** When a workstream needs execution, Wendy instantiates a specialist agent with a charter, success criteria, and deadline. No task queue waiting.
2. **Wendy monitors squads.** Daily health check on every active squad. Blocked? Wendy unblocks or kills and respawns. Behind schedule? Wendy reallocates.
3. **Wendy reports to 9.** Daily status pushed to 9 via comms-hub. 9 relays to Owner as needed. Wendy does not wait to be asked.
4. **Wendy owns the Intake Pipeline.** New ideas from Owner go through Wendy's 48-hour intake process. Nothing enters the active workstream without impact assessment.
5. **Wendy updates this plan.** This document is versioned. When reality changes (and it will), Wendy publishes v1.1, v1.2, etc. with a revision log.

The test of whether Wendy is working: if 9 has to manually assign tasks to specialists, Wendy has failed. If Owner has to ask for status updates, Wendy has failed. If a squad is blocked for more than 4 hours without escalation, Wendy has failed.

---

## Top 5 Risks

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Mac hardware failure before Cloud Worker deploys | Cloud Worker deployment is Day 1, Week 1. Literal first infrastructure task. |
| 2 | AdSense rejection before Draft window | Affiliate revenue (BetMGM/FanDuel) is wired independently. AdSense is not the only path. |
| 3 | Foundation work destabilizes live services | All changes gated through JUDGE + ADRs. Staging verification before any production change. |
| 4 | Kyle disengages before Phase 2 | RAM agent build is the trust-builder. Visible K-item progress tracked weekly. No outbound push until Phase 2 gate. |
| 5 | Scope creep from new Owner ideas during Phase 1 | Intake Pipeline enforced. Nothing enters Phase 1 without bumping something out. 48-hour assessment cycle. |

---

## What Happens Monday (April 7)

If this plan is approved, Wendy immediately:

1. Instantiates Foundation GM with FORT, WATCH, JUDGE assignments for Week 1
2. Instantiates AiNFLGM Squad with Draft monetization track
3. Instantiates Pepper Squad with architecture definition task
4. Sets up Pinecone project and first namespace
5. Creates Notion workspace with squad boards
6. Deploys Cloud Worker to Cloudflare
7. Pushes first daily status report to 9 by EOD

No waiting. No further approvals needed. Soul Code applies.

---

*This is the plan. It is honest about where we are, aggressive about where we are going, and specific about how we get there. Foundation first. Revenue alongside. Empire after.*

-- Wendy, Super Consultant & Platform Orchestrator, 9 Enterprises
