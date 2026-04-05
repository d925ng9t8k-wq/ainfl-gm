# ADR-0006: Foundation-first — Phase 1 exclusivity (burned forever)

- **Status:** Accepted
- **Date:** 2026-04-05
- **Author:** JUDGE (Quality Gate, 9 Enterprises)
- **Reviewers:** JUDGE, Wendy, 9 (CEO), Owner (authority)
- **Squad:** Strategy / Governance
- **Related ADRs:** ADR-0001, ADR-0005
- **Kyle K-items addressed:** K-08 (18-24 month timeline reality),
  K-11 (trust requires participation), K-16 (scope discipline),
  K-17 (SDLC), K-18 (qualified architecture)

## Context

On April 5, 2026, at 16:23 ET via Telegram, Owner issued a permanent
directive:

> *"Goal number one fix the foundation. Has to be perfect enterprise
> level Gold standard once we have that then we can get to work. I'm
> building the team and building the empire. How about we burn that
> one in forever deal?"*

9 accepted. Deal burned forever. Captured in
`memory/mission_goal_one_apr5.md`.

The reasoning: Owner had watched the April 4-5 pattern — crashes, OC
impersonation, reporting drift, split AdSense pub IDs, 6 critical
credential flags, dependency-map gaps Kyle had been asking for since
March 26, stale-memory incidents, and the general realization that
*the 9 universe is legitimate architecture concepts on top of
hobby-project execution maturity*. Owner will not build the empire on
that foundation and will not expose Kyle to it.

This is a strategic decision that governs every other strategic
decision for the next 60-90 days. It deserves a durable, auditable
artifact — hence this ADR.

## Decision

**Phase 1 of the 9 Enterprises 90-day plan is Foundation Lockdown,
exclusively.** No empire-building work — new products, new companies,
revenue-chasing marketing pushes, new ventures — executes in Phase 1
unless 9 explicitly overrides with a written justification that
references this ADR.

Phase 1 exit criteria (from `memory/mission_goal_one_apr5.md` and
Wendy's 90-day plan):

1. Composite universe health score ≥ **70/100** (SCOUT rubric;
   currently 42.8).
2. Zero P0 or P1 gaps open from the SCOUT top-20 fix list.
3. Zero CRITICAL credential flags open from Tee's credential inventory.
4. Mac is no longer a single point of failure (Cloud Worker live,
   failover tested end-to-end).
5. DR plan fully tested — every scenario in `docs/disaster-recovery.md`
   run at least once with results logged.
6. At least one Kyle WWKD Quick Test dry-run passed on a flagship
   product.
7. Comms/memory/health monitor have zero silent-failure events for
   14 consecutive days.

Phase 2 (revenue, product expansion, empire scaffolding) does **not**
unlock until Phase 1 exit criteria are met. The NFL Draft window
(April 23-25), the AI Underwriter, new company launches, and paid
marketing campaigns are all **side-bets** relative to foundation work —
they may happen in parallel only if they do not slow foundation work
and only if they do not introduce new foundation debt.

**Scope definition — "foundation" means:**

- Persistent memory layer: encrypted at rest (ADR-0004), audit-logged,
  backed up, point-in-time recoverable.
- Real-time health monitoring: every component, live alerts, no
  silent failures.
- Disaster recovery: documented, tested, RTO/RPO met.
- Security posture: zero credential leaks, Keychain/secret manager,
  audit log, no hardcoded tokens.
- Process: SDLC (ADR-0001), architecture-first, dependency maps,
  per-user cost models, WWKD checks (ADR-0005).
- Comms resilience: tunnel stability, Mac-down failover, zero gap on
  Owner comms.
- Agent hygiene: Sonnet minimum on quality roles (ADR-0002), no
  Haiku drift, OC locked down (ADR-0003).
- Docs: enterprise-grade public face, press kit, SOC 2 posture
  materials.

## Consequences

### Positive
- Every agent has a single, clear prioritization rule: foundation
  first. Decisions that would previously be judgment calls become
  policy.
- Eliminates scope creep and the "shiny new concept" drift pattern
  Kyle called out in K-16.
- Creates the conditions under which Kyle can be re-engaged with
  credibility (K-11).
- Aligns Wendy's 90-day plan, JUDGE's quality gate, UNO's research,
  FORT's security work, and WATCH's monitoring under a single
  strategic directive.
- Gives Owner a single success metric (composite score ≥ 70) to
  watch instead of 50 parallel status threads.

### Negative / Trade-offs
- **NFL Draft revenue is almost certainly sacrificed.** April 23-25 is
  18 days from plan start. Pushing a monetization stack through a
  42.8/100 foundation is exactly the speed-over-correctness move Kyle
  called out. Wendy's ruling: AdSense application goes in (zero cost,
  parallel), but paid acquisition and affiliate wiring wait for Phase 2.
- **AI Underwriter is on hard pause** until Kyle is at the design table
  (K-11, K-13, K-14, K-19). This is the largest single
  revenue-potential project on ice. Owner explicitly approved this
  pause.
- **Jasson's patience is a finite resource.** 30-60 days of pure
  foundation work with no revenue can feel like stagnation. The
  weekly scorecard exists to make progress visible and maintain
  momentum.
- **Hopper concepts and new Owner ideas must wait.** The 48-hour intake
  pipeline (per Wendy's change management process) queues them, but
  nothing new enters Phase 1 execution without bumping existing
  Phase 1 work.

### Follow-ups
- Wendy: every weekly review leads with composite-score delta and
  Phase 1 exit criteria burndown.
- JUDGE: reject any ADR that proposes empire-work during Phase 1
  without an explicit 9-signed override clause.
- 9: arbitrate any legitimate Phase 1 vs Phase 2 tension.
- Owner-facing: weekly summary of Phase 1 progress via Telegram on a
  fixed day (Wendy picks day).

## Alternatives Considered

1. **Foundation and empire in parallel at ~50/50 bandwidth.**
   Rejected by Owner: this is effectively the pre-April-5 state that
   produced the 42.8 score. Parallel investment meant neither track
   reached enterprise quality.
2. **Foundation first, but with a hard 30-day ceiling; flip to empire
   on Day 31 regardless of score.**
   Rejected: creates an incentive to cut corners on foundation to hit
   an arbitrary date. Score ≥70 is the gate, not the calendar.
3. **Foundation first, but allow NFL Draft monetization as a carved-out
   exception.**
   Considered and partially adopted: AdSense application (zero cost,
   no foundation-debt) is permitted in parallel. Paid/marketing/active
   monetization is not. Wendy's 90-day plan encodes this nuance.
4. **Declare foundation "done" at score ≥ 60.**
   Rejected: 60 is acceptable hygiene, not enterprise-grade. Kyle's
   benchmark demands higher. 70 is the negotiated floor.
5. **Skip foundation fix; sell the vision and raise capital.**
   Rejected by Owner. This is the path that burned companies before
   Kyle's critique landed. Owner explicitly chose the harder path.

## References

- `memory/mission_goal_one_apr5.md` — Owner's verbatim directive
- `memory/wendy_90day_plan_v1.md` — Phase 1 Week-by-Week execution
- `memory/reference_kyle_enterprise_benchmark.md` — the bar (via ADR-0005)
- `memory/feedback_kyle_call_march26.md` — Kyle's original critiques
- `memory/feedback_opus_for_important.md` — budget posture supporting
  foundation work
- ADR-0001 (we use ADRs), ADR-0002 (Sonnet min), ADR-0003 (OC lockdown),
  ADR-0004 (SQLCipher), ADR-0005 (Kyle benchmark authority)
- `docs/sdlc-scorecard-v1.md` — first SDLC measurement (companion
  deliverable to this ADR)
- SCOUT audit (composite score baseline 42.8)
- Telegram transcript, 2026-04-05 16:23 ET

## Kyle Impact

This ADR is the structural answer to K-12, K-17, and K-18 combined.
Kyle's core critique was that 9 Enterprises was trying to be a product
without an SDLC, without architecture, and without foundation. This
ADR inverts the priority: foundation *is* Phase 1, everything else
waits. When Kyle re-engages, he is told "we paused the empire to fix
the foundation, here is the scorecard" — the single sentence most
likely to earn his renewed attention.

— JUDGE, Quality Gate, 9 Enterprises
