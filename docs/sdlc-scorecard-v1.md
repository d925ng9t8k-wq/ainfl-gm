# SDLC Scorecard v1.0 — 9 Enterprises

- **Version:** 1.0 (baseline)
- **Date:** 2026-04-05
- **Author:** JUDGE (Quality Gate, 9 Enterprises)
- **Authority:** This is the first formal SDLC measurement of the 9
  Enterprises universe. It is the baseline against which every future
  scorecard is measured.
- **Phase 1 exit target:** ≥ 60/100
- **Phase 3 (Day 90) target:** ≥ 75/100
- **Long-term target:** ≥ 85/100 (Kyle-readiness bar)

## Scope

Measures the *process* maturity of the 9 Enterprises software development
lifecycle, not the *product* quality of any single build. Grounded in:

- Kyle Shea K-items (especially K-11, K-12, K-17, K-18)
- NIST SSDF (Secure Software Development Framework) SP 800-218
- ISO/IEC 12207 SDLC standard
- SOC 2 CC7 / CC8 (Change Management)
- ThoughtWorks Technology Radar guidance on lightweight ADRs
- Microsoft Azure DevOps SDLC reference

Scoring is deliberately pessimistic on first pass. A 42/100 baseline is
*expected* for a universe that has never had a formal SDLC. The goal is
not to feel good today; it is to have a measurable trend line week over
week.

## Scoring method

Each of 10 dimensions scored **0-10** with concrete evidence cited.
Total is **/100**.

- **0-2** — absent or actively broken
- **3-4** — partial, informal, inconsistent
- **5-6** — formally documented and sometimes followed
- **7-8** — formally documented and consistently followed
- **9-10** — formally documented, consistently followed, automatically
  enforced, with a trend of continuous improvement

JUDGE scores honestly. If a dimension is at 2, it is at 2. Kyle can
read this.

---

## Dimension scores

### 1. Requirements & Design (Architecture-first) — **2/10**

**Evidence:**
- No design documents exist for the vast majority of shipped components.
- Kyle K-18 explicitly open: *"There is no replacement for a properly
  designed high-level all-system strategy by an actually qualified
  professional."* Status: still open as of Apr 5.
- Kyle K-11: *"I can never build on an abstraction layer I didn't create"*
  — no external architect has been engaged.
- Partial credit: `docs/9-enterprises-architecture.md` exists but is a
  narrative overview, not a formal design document.
- Partial credit: `docs/dependency-map.md` and `.json` shipped April 5
  (PRESS + Tee), covering comms infrastructure. This is the first
  architecture artifact Kyle asked for (K-01).
- WWKD Dry-Run #001 on the Kyle RAM agent (see `docs/wwkd-reviews/001-kyle-ram-agent.md`)
  — L1 "Architecture design step before code" = FAIL. The most Kyle-endorsed
  technical artifact in the universe was built without a design step.

**Score: 2/10.** The scattered architecture docs raise this from 0. The
absence of a design gate on any real build keeps it below 3.

---

### 2. Code Review Process — **1/10**

**Evidence:**
- No git pull-request review process exists. Most commits go directly to
  `main`. Recent `git log` shows single-author commits with no
  review trail.
- No codeowners file (`CODEOWNERS`) defining who reviews what.
- No branch protection on `main` (to be verified by FORT).
- JUDGE was instantiated April 5 — this is the *first* formal review
  role in 9 Enterprises history, and only one review (`docs/wwkd-reviews/001-kyle-ram-agent.md`)
  has been performed.
- Kyle K-12 flagged SDLC skipping as a core critique. Code review is the
  most load-bearing missing SDLC artifact.

**Score: 1/10.** JUDGE's first review is the evidence of a nascent
process, nothing more.

---

### 3. Testing (Unit, Integration, E2E) — **1/10**

**Evidence:**
- `tests/` directory does not exist.
- No test files (`*.test.mjs`, `*.test.js`, `*_test.py`) anywhere in
  the repo outside `node_modules/`.
- `package.json` test script: either absent or `"test": "echo \\\"Error: no test specified\\\" && exit 1"`
  (default placeholder).
- Manual verification is the universal pattern. Every "it works" claim
  relies on curl output, log inspection, or live Telegram reply.
- Wendy 90-day plan Week 3 target: "≥20 tests passing in CI." This is
  the first explicit test goal.

**Score: 1/10.** Partial credit for manual verification discipline (the
`memory/feedback_verify_before_assert.md` rule is enforced, producing
artifacts). But no automated test = effectively zero.

---

### 4. CI/CD — **3/10**

**Evidence:**
- `.github/workflows/data-refresh.yml` — exists. Data refresh scheduled.
- `.github/workflows/deploy.yml` — exists. Deploy pipeline present.
- No test step in either workflow (nothing to run — see Dimension 3).
- No staging environment enforcement.
- Most comms/agent deploys happen via `nohup` or LaunchAgent restart
  on the developer Mac — not CI-driven.
- Ainflgm.com deploys via Cloudflare Pages automatic builds (good).
- Cloud worker deploys via `cloud-worker/deploy.sh` shell script — works,
  but no verification gate.

**Score: 3/10.** CI exists for a slice of the universe. CD is partial
and human-triggered for most components.

---

### 5. Security Review — **4/10**

**Evidence:**
- FORT instantiated as a permanent squad role on April 5. First real
  security review function in 9 Enterprises.
- `docs/credential-inventory.md` shipped Apr 5 — 6 critical flags
  enumerated (C-01 Dominos card, C-02 Supabase key, C-03 SQLCipher key
  co-location, C-04 Alpaca keys, C-05 hardcoded Telegram token, C-06
  rotation status). Several closed same day.
- ADR-0004 (SQLCipher) shipped — encryption-at-rest policy now formal.
- ADR-0003 (OC lockdown) shipped — identity-spoof defense formal.
- BUT: WWKD Dry-Run #001 found an unauthed 0.0.0.0 binding on port
  3459 shipped to production without FORT review on the same day.
  Security review is not a mandatory gate yet.
- No automated security scanning (no `npm audit` in CI, no Snyk, no
  Dependabot, no OWASP ZAP).
- No penetration test ever performed.
- SOC 2: not started (see Kyle K-05, Gap-2 in UNO benchmark).

**Score: 4/10.** The inventory and the encryption work are real and
recent. The absence of automated scanning and the continued slip of
raw ports into production keep this below 5.

---

### 6. Documentation — **5/10**

**Evidence:**
- Extensive documentation in `docs/` — 220+ markdown files as of Apr 5.
- Strong memory hygiene: `memory/` directory with ~80 files covering
  identity, user profile, feedback, protocols, projects, contacts.
- New on Apr 5: dependency-map.md + .json, disaster-recovery.md,
  credential-inventory.md, cost-per-user-model.md, Kyle benchmark,
  command-center-design.md, kyle-ram-guidance-apr5.md.
- ADR directory created Apr 5 — ADR-0001..ADR-0006 landed today.
- WWKD Quick Test v1 landed today.
- Weakness: no runbook directory (`docs/runbooks/` does not exist).
  Start/stop/diagnose procedures are scattered in CLAUDE.md and memory
  files.
- Weakness: no incident post-mortem directory (`docs/incidents/`).
  The March 31 OC impersonation incident is captured in
  `memory/feedback_oc_impersonation_march31.md` but not as a formal
  post-mortem with timeline, root cause, contributing factors,
  preventive actions.
- Weakness: no OpenAPI / machine-readable API docs for any HTTP
  endpoint. Kyle D-03 open.

**Score: 5/10.** Volume is high, structure is improving fast (ADR
directory today marks the inflection), but runbooks and incident
post-mortems are gaps.

---

### 7. Change Management — **3/10**

**Evidence:**
- `memory/protocol_change_management.md` exists: Search → Simulate →
  Reconcile → Implement → Test → Commit.
- `memory/protocol_completed_actions.md` exists to prevent duplicate
  sends / deploys across crashes.
- 48-hour intake pipeline for new Owner directives (per Wendy charter,
  Week 1 mandate).
- BUT: in practice, changes land without the ADR/review gate Kyle K-17
  demands. The Kyle RAM agent build is the canonical recent example
  (documented in WWKD Dry-Run #001).
- No formal change advisory board or peer review step.
- No scheduled change windows; deploys happen when ready.
- JUDGE's non-bypassable blocking authority (per charter) is the
  structural fix but has only been exercised once (today).

**Score: 3/10.** The policies exist on paper; enforcement starts today.

---

### 8. Deployment / Rollback — **4/10**

**Evidence:**
- LaunchAgent auto-restart for critical components (comms-hub,
  ram-watch-agent, orphan-cleaner, memory-autocommit, health-monitor) —
  real durability layer.
- Cloud worker deploy via `cloud-worker/deploy.sh` — works.
- Ainflgm.com via Cloudflare Pages — works with automatic
  production/preview branches.
- `data/9-memory.db.pre-sqlcipher-backup` — rollback snapshot preserved
  for the April 5 encryption migration. Good instinct.
- Weakness: no documented rollback procedure for most components.
  "Rollback" typically means `git revert && restart LaunchAgent`.
- Weakness: no blue/green or canary patterns. Deploys are live-replace.
- Weakness: no post-deploy verification gate. Deploy → hope.
- Disaster recovery plan exists (`docs/disaster-recovery.md`) but has
  not been tested end-to-end (scheduled for Apr 9 per Wendy Week 1 plan).

**Score: 4/10.** LaunchAgent + Cloudflare Pages carry real weight.
Everything manual pulls it back down.

---

### 9. Monitoring / Observability — **6/10**

**Evidence:**
- `scripts/health-monitor.mjs` — component-level healthcheck polling,
  Telegram/iMessage/email alerting on failure, 15-minute dedup.
- `scripts/comms-hub.mjs` — extensive self-checks on startup, reboot
  detection, log rotation, API health probing, FDA watchdog.
- Structured log files across most components (`logs/*.log`).
- SQLite-based event history (`data/9-memory.db` with ram_samples,
  messages, actions, decisions, authority, tasks tables).
- Kyle RAM watch agent live since Apr 5 — 1040 samples in first hour,
  detected 1 leak suspect and 15 orphan processes.
- Supabase cloud sync every 60s for state replication.
- Weakness: no centralized dashboard. Health status lives in
  `/state`, `/health`, and various ad-hoc endpoints — not unified.
  (Wendy Week 3 target: real-time dashboard.)
- Weakness: no distributed tracing. Request IDs do not propagate across
  components.
- Weakness: no SLO/SLA thresholds defined per component. Alerts fire
  on up/down, not on degradation.
- Weakness: health-monitor was itself DOWN during SCOUT's Apr 5 audit
  — watchdog-the-watchdog pattern scheduled Apr 6 per Wendy Week 1.

**Score: 6/10.** This is the 9 Enterprises strongest SDLC dimension.
The monitor-the-monitor gap is the one that must close first.

---

### 10. Post-Incident Review — **2/10**

**Evidence:**
- March 31 OC impersonation: captured in
  `memory/feedback_oc_impersonation_march31.md`. This is a feedback
  note, not a formal post-mortem (no timeline, no contributing factors,
  no blameless framing, no action items with owners and dates).
- March 27 45-minute freeze: captured in
  `memory/feedback_freeze_lesson_march27.md`. Same caveat — lesson
  capture, not formal post-mortem.
- April 5 Supabase stale-memory incident: captured inline in
  `memory/feedback_verify_before_assert.md`. Same caveat.
- No `docs/incidents/` directory exists.
- No post-mortem template.
- No scheduled review cadence.
- Positive: the *lessons* from each incident are being burned into
  memory files and protocols, which is a real form of learning — just
  not the formal SOC 2 / SRE post-mortem format Kyle would recognize.

**Score: 2/10.** Informal learning is happening; formal review is not.

---

## Aggregate baseline

| # | Dimension | Score | Max |
|---|-----------|-------|-----|
| 1 | Requirements & Design | 2 | 10 |
| 2 | Code Review | 1 | 10 |
| 3 | Testing | 1 | 10 |
| 4 | CI/CD | 3 | 10 |
| 5 | Security Review | 4 | 10 |
| 6 | Documentation | 5 | 10 |
| 7 | Change Management | 3 | 10 |
| 8 | Deployment / Rollback | 4 | 10 |
| 9 | Monitoring / Observability | 6 | 10 |
| 10 | Post-Incident Review | 2 | 10 |
| | **TOTAL** | **31** | **100** |

**Baseline: 31/100.**

## Interpretation

31/100 is a *pre-SDLC* score. It measures a universe that shipped real
products, accumulated real users, and built real infrastructure — all
while skipping the formal lifecycle artifacts that Kyle K-12, K-17, and
K-18 demand. That Kyle-critique-to-letter-grade map is intentional:

- Observability (9) and Documentation (6) are the strengths — 9
  Enterprises documents obsessively and monitors aggressively.
- Testing (3), Code Review (2), and Post-Incident Review (10) are the
  weakness cluster — no tests, no PR reviews, no formal post-mortems.
- Requirements & Design (1) is the single most Kyle-damaging
  dimension. Fixing it requires a process change, not a sprint.

**Phase 1 exit target: ≥ 60/100.** To get from 31 → 60 in ~30 days,
Wendy's 90-day plan has the following multipliers queued:

| Dimension | Week 1 action | Est. +points |
|---|---|---|
| 1. Req & Design | ADRs 0001-0006 today + every flagship change gets an ADR | +3 → 5 |
| 2. Code Review | JUDGE pre-merge review mandatory Apr 7+ | +2 → 3 |
| 3. Testing | Tee: ≥20 tests in CI by Week 3 | +4 → 5 |
| 4. CI/CD | Tee: add test step to workflows, staging gate | +2 → 5 |
| 5. Security Review | FORT: credential flags closed, ADR-0004 encryption, OWASP ZAP in Week 3 | +2 → 6 |
| 6. Documentation | Runbook directory, incident post-mortems, OpenAPI | +2 → 7 |
| 7. Change Management | JUDGE enforcement + 48hr intake pipeline | +3 → 6 |
| 8. Deployment / Rollback | DR drill Apr 9, documented rollback procedures | +2 → 6 |
| 9. Monitoring | Monitor-the-monitor, dashboard, SLOs | +2 → 8 |
| 10. Post-Incident Review | Create `docs/incidents/`, backfill 3 post-mortems | +4 → 6 |
| | **Projected Phase 1 exit** | **31 → 57** |

57/100 projected is 3 points short of the Phase 1 exit target.
Wendy will need to land additional wins in testing or code review to
cross 60. JUDGE recommends prioritizing the test-suite sprint (Tee's
Week 3 target) because it compounds with CI/CD and Code Review on the
same trajectory.

## Trend line commitments

- **Weekly re-score on Mondays.** JUDGE publishes updated scorecard to
  `docs/sdlc-scorecard-v1.md` in place, with a changelog at the bottom.
- **Evidence-first changes.** A score cannot move up without a cited
  artifact — verify-before-assert hard rule.
- **Kyle-readable.** Every update should read cleanly to Kyle on a
  cold read.

## Appendix A — Links to related artifacts

- `memory/agent_judge_charter.md`
- `memory/mission_goal_one_apr5.md`
- `memory/wendy_90day_plan_v1.md`
- `memory/reference_kyle_enterprise_benchmark.md`
- `docs/adr/README.md`
- `docs/adr/0001-we-use-adrs.md` through `docs/adr/0006-foundation-first-phase-1.md`
- `docs/wwkd-quick-test-v1.md`
- `docs/wwkd-reviews/001-kyle-ram-agent.md`
- `docs/dependency-map.md`
- `docs/disaster-recovery.md`
- `docs/credential-inventory.md`

## Appendix B — Changelog

- **2026-04-05** v1.0 — initial baseline score 31/100. Authored by
  JUDGE as part of Day-1 mission.

— JUDGE, Quality Gate, 9 Enterprises
