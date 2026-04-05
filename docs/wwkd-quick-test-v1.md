# WWKD Quick Test v1 — "What Would Kyle Do?"

**Version:** 1.0
**Effective:** 2026-04-05
**Owner:** JUDGE (Quality Gate, 9 Enterprises)
**Authority:** JUDGE may issue WWKD BLOCK on any change that FAILS this test. Only
Wendy can override, and only with a written justification recorded in the relevant
ADR.

---

## Purpose

Every flagship-product change in the 9 Enterprises universe must pass the WWKD
Quick Test before JUDGE approves it. The test codifies Kyle Shea's enterprise
gold-standard bar (derived from his 20 documented K-items and UNO's 50-item
CIO benchmark in `memory/reference_kyle_enterprise_benchmark.md`) into a
reproducible rubric.

Passing WWKD does **not** make a build "Kyle-approved" — only Kyle can grant
that. Passing WWKD means the build would not immediately fail Kyle's cold-read
on any load-bearing dimension. Failing WWKD means the build is definitely
not ready for Kyle.

## Scope

Applies to every "flagship-product change":
- New production service or script that runs on its own LaunchAgent.
- Any change that touches credentials, auth, secrets, or data persistence.
- Any change affecting user-facing endpoints (public web, API, webhook).
- Any change to a system Kyle has directly mentioned (RAM agent, AI Underwriter,
  9E comms, 9E dependency map, etc.).
- Any change Wendy explicitly sends to the quality gate.

Does **not** apply to: documentation-only changes, single-character typos,
agent memory-file updates, or private scratch scripts with no LaunchAgent.

## Rubric structure

Seven sections, each with 5–10 yes/no questions. Every question is scored:

- **PASS** (1 point) — evidence is concrete, verifiable, and available now.
- **FAIL** (0 points) — no evidence or negative evidence.
- **N/A** — legitimately does not apply; must be justified in one sentence. N/A
  counts as a pass for scoring but is flagged for JUDGE review.

Each section has a **Pass threshold**. A section below threshold auto-fails
unless the failing items are trivially fixable (see Verdict section).

**Evidence is mandatory.** A yes-answer without a file path, log line, commit
SHA, or HTTP response counts as FAIL. This is the verify-before-assert hard
rule (`memory/feedback_verify_before_assert.md`).

---

## Section 1 — Reliability (threshold: 4/6)

Kyle K-items: K-06 (can't replicate without dedicated hardware). Benchmark:
SOC 2 Availability TSC, NIST CSF 2.0 RC.

| # | Question | Pass evidence |
|---|----------|---------------|
| R1 | Does the component auto-restart on crash? | LaunchAgent plist with `KeepAlive=true`, or systemd `Restart=always`, or supervisor equivalent. Cite the file path. |
| R2 | Is there a healthcheck endpoint or equivalent signal? | HTTP `/health` returning 200 + JSON, or a heartbeat file updated on a known interval. Cite URL or path. |
| R3 | Is the healthcheck monitored by something that alerts on failure? | `health-monitor.mjs` polls it and pages Telegram/iMessage/email on failure. Cite the integration. |
| R4 | If this component fails, does the system degrade gracefully (not hard-crash)? | Documented fallback behavior or a tested fault path. Cite the code path. |
| R5 | Is there a documented restart / rebuild procedure? | Runbook entry in `docs/runbooks/` or a README section. Cite the path. |
| R6 | Has it survived a 24-hour soak with no manual intervention? | Log output or uptime count. Cite the evidence. |

**Kyle-fail triggers in this section:** any component that requires manual
terminal intervention to recover (K-07: terminal exposure).

## Section 2 — Security (threshold: 6/8)

Kyle K-items: K-02 (autonomous OS control red flag), K-05 (no SOC 2/SSO/audit
log/multi-tenant). Benchmark: SOC 2 CC6, NIST SP 800-53, OWASP Top 10.

| # | Question | Pass evidence |
|---|----------|---------------|
| S1 | Are all secrets loaded from env or a secret manager — never hardcoded in source? | Grep the file for `key=`, `token=`, `password=`. No literal strings. Cite verification. |
| S2 | Is the secret source separated from the encrypted asset (no key co-located with lock)? | SQLite encryption key not in `.env` next to the DB, OR documented exception with FORT review. |
| S3 | Is every HTTP endpoint either authed or has a written public justification in an ADR? | List endpoints; match each to auth middleware or an ADR entry. |
| S4 | Does the HTTP server bind to localhost (127.0.0.1) unless public is explicitly required? | `.listen(PORT, '127.0.0.1')` call or equivalent. Cite the line. |
| S5 | Does the change avoid introducing new attack surface (new public ports, new credentials, new third-party deps without review)? | Diff review. FORT sign-off if any new dep or port. |
| S6 | If this component runs with elevated privileges (sudo, keychain, FDA), is the privilege scope minimized and documented? | Written scope + principle-of-least-privilege statement. |
| S7 | If this component can kill processes, modify files outside its scope, or execute shell commands, is there a protected-list / dry-run default / audit log? | Source review — PROTECTED_PATTERNS array, `--kill` flag default off, log file for every action. |
| S8 | Does this change pass a cursory OWASP Top 10 review (injection, auth, XXE, deserialization, etc.)? | JUDGE's own 60-second review noted. |

**Kyle-fail triggers in this section:** plaintext secrets, unauthed public
endpoints without justification, any component that can mutate the host
without an audit log.

## Section 3 — Observability (threshold: 4/6)

Kyle K-items: K-09 (AI can't architect what it can't see). Benchmark: SOC 2
CC7, OpenTelemetry, CIO.com observability framework.

| # | Question | Pass evidence |
|---|----------|---------------|
| O1 | Does the component emit structured logs (timestamps, level, context)? | Sample log lines with ISO 8601 timestamps. Cite the log file. |
| O2 | Are logs written to a centralized location (not just stdout)? | Log file path in `logs/` or equivalent. Cite it. |
| O3 | Are errors captured with enough context to diagnose (stack trace, inputs)? | Sample error line. |
| O4 | Can operational metrics (uptime, sample count, error count) be queried? | Healthcheck endpoint returning structured data, or `/status` endpoint. |
| O5 | Does it integrate with the universe health monitor? | `health-monitor.mjs` has a component entry for it. |
| O6 | Is there a way to diff today's behavior against yesterday's? | SQLite table or log aggregation with timestamp index. |

## Section 4 — Documentation (threshold: 3/5)

Kyle K-items: K-01 (dependency map), K-11 (abstraction-layer trust). Benchmark:
Microsoft Learn, Salesforce Trailhead standard.

| # | Question | Pass evidence |
|---|----------|---------------|
| D1 | Is there a top-of-file header explaining what the component does and why? | First 20 lines of source — Kyle's message, charter, author, date. |
| D2 | Is there an ADR for this component or for the decision to ship it this way? | ADR file path. |
| D3 | Is the dependency map (`docs/dependency-map.md` / `.json`) updated to include this? | Diff or grep for the component name. |
| D4 | Is there a runbook / operator guide for start/stop/diagnose? | `docs/runbooks/` entry or README section. |
| D5 | Is there a Kyle-readable one-page explanation of why this exists? | `docs/kyle-*.md` or equivalent. |

## Section 5 — SDLC (threshold: 4/6)

Kyle K-items: K-12 (AI speed ≠ SDLC), K-17 (don't let speed fool you), K-18
(qualified human architecture). Benchmark: Microsoft 3-gate review,
ThoughtWorks ADR pattern.

| # | Question | Pass evidence |
|---|----------|---------------|
| L1 | Was there an architecture design step *before* code was written? | ADR or design note predating the first commit. |
| L2 | Are there automated tests for the non-trivial logic? | Test file paths + a recent passing run. |
| L3 | Was manual verification performed with an artifact logged? | Screenshot, log line, HTTP 200 curl output. |
| L4 | Is the change reviewable by a staff engineer who is not the author? | Diff size < ~800 lines, single-purpose, readable. |
| L5 | Was JUDGE involved before merge (not after)? | ADR review timestamp prior to deploy. |
| L6 | If this supersedes prior work, is the prior work retired (deprecated scripts, killed LaunchAgents, archived memory files)? | Explicit retirement evidence. |

## Section 6 — Cost (threshold: 2/4)

Kyle K-items: K-04 (per-user cost model). Benchmark: Azure cost calculator,
Salesforce per-seat pricing.

| # | Question | Pass evidence |
|---|----------|---------------|
| C1 | Is the component's operating cost knowable (API calls, compute, storage)? | Rough monthly $ estimate documented. |
| C2 | If usage scales with users, is the per-user cost derivable? | Formula or cost-per-user line. |
| C3 | Does it avoid introducing new paid third-party dependencies without Wendy budget sign-off? | Budget approval citation or no new deps. |
| C4 | Is there a cost ceiling / alert for runaway usage? | API-key rate limit, budget alarm, or equivalent. |

## Section 7 — Kyle-Persona Judgment (threshold: 3/5)

This is JUDGE wearing Kyle's mental model from
`memory/reference_kyle_enterprise_benchmark.md` Part 3.

| # | Question | Pass evidence |
|---|----------|---------------|
| K1 | Would Kyle understand what this is and why in under 5 minutes of reading? | JUDGE's honest read. |
| K2 | Does this avoid hype-without-depth language? | Source, docs, and commit messages reviewed. |
| K3 | If this is Rapid-facing, is the stack aligned with SQL Server / Azure / Encompass? | Stack verification, or explicitly labeled as non-Rapid. |
| K4 | Would Kyle be able to defend this decision in a meeting without embarrassment? | JUDGE's honest read. |
| K5 | Does this avoid people-pleasing framing (over-claiming, "Kyle approved" without approval, marketing tone)? | Source, docs, and commit messages reviewed. |

---

## Verdict

After scoring, JUDGE issues one of three verdicts.

### PASS
All 7 sections meet or exceed threshold. No Kyle-fail triggers tripped. Evidence
is concrete and verifiable. The build ships with a JUDGE signature on the ADR.

### CONDITIONAL
- One or two sections are below threshold, but every failing item is
  trivially fixable (under 2 hours of work).
- OR, a single Kyle-fail trigger tripped that can be mitigated without a
  rewrite.
- JUDGE issues a written fix list with owners and a deadline. The build
  must re-enter the gate after fixes. No ship until re-scored PASS.

### FAIL
- Three or more sections below threshold.
- OR, multiple Kyle-fail triggers.
- OR, any foundation item in `memory/mission_goal_one_apr5.md` is violated.
- JUDGE issues a WWKD BLOCK with rework scope. The build does not ship.
  Only Wendy can override, and the override becomes part of the ADR log
  with Wendy's written reason.

---

## Scoring example — hypothetical "Bengal Oracle Comms Webhook"

To show how the rubric runs, here is a worked example on a hypothetical
build: a webhook endpoint that receives NFL play-by-play events and fans
them out to Telegram subscribers.

**Component:** `scripts/nfl-webhook.mjs` — hypothetical.

| Section | Score | Notes |
|---|---|---|
| Reliability | 5/6 | LaunchAgent: PASS. `/health`: PASS. Monitor: PASS. Graceful degrade on Telegram timeout: PASS. Runbook: FAIL (not written). 24h soak: PASS. **Above threshold (4/6). SECTION PASS.** |
| Security | 4/8 | Env secrets: PASS. Key separated: PASS. Webhook auth via shared secret header: PASS. Binds 0.0.0.0 without justification: FAIL. No new attack surface review: FAIL. Privilege scope: PASS. No process mutation: N/A (pass). OWASP review: FAIL (input validation missing). **Below threshold (6/8). SECTION FAIL.** |
| Observability | 5/6 | Logs PASS, centralized PASS, error context PASS, metrics PASS, health-monitor integration PASS, diff-able FAIL (no timestamp index on event table). **Above threshold. SECTION PASS.** |
| Documentation | 2/5 | Header: PASS. ADR: FAIL. Dependency map updated: FAIL. Runbook: FAIL. Kyle one-pager: PASS. **Below threshold (3/5). SECTION FAIL.** |
| SDLC | 2/6 | Design before code: FAIL. Tests: FAIL. Manual verification logged: PASS. Reviewable size: PASS. JUDGE pre-merge: FAIL. Prior work retired: N/A pass. **Below threshold (4/6). SECTION FAIL.** |
| Cost | 3/4 | Cost knowable: PASS. Per-user derivable: PASS. No new paid deps: PASS. Runaway alert: FAIL (no rate limit on outbound Telegram). **Above threshold. SECTION PASS.** |
| Kyle-Persona | 3/5 | Understandable: PASS. No hype: PASS. Rapid stack alignment: N/A (not Rapid-facing, pass). Defensible: FAIL (no tests). People-pleasing: PASS. **Above threshold. SECTION PASS.** |

**Sections failed:** Security, Documentation, SDLC (3 failures).
**Verdict: FAIL.**

**Rework scope:**
1. Bind server to 127.0.0.1 or add a written public-justification ADR.
2. Add input validation per OWASP guidelines.
3. Write the ADR explaining the webhook architecture decision.
4. Update `docs/dependency-map.md` to include the new webhook.
5. Write a runbook for start/stop/diagnose.
6. Add an architecture design note predating any rewrite.
7. Write at least 3 automated tests: happy path, malformed payload, auth
   failure.
8. Re-submit for WWKD re-scoring.

**Estimated rework time:** 6–8 hours.

---

## Kyle-fail triggers (auto-fail regardless of section scores)

Any one of these in a change = FAIL, no matter what else passes:

1. **Plaintext secret** in source or committed config.
2. **Public unauthenticated endpoint** without an explicit ADR justifying it.
3. **Terminal-required interface** claimed as user-facing.
4. **POC built on wrong stack** claimed as Rapid-ready (K-13: Vercel/Neon
   for a SQL Server/Azure target).
5. **"Kyle-approved" framing** when Kyle has not actually approved it.
6. **Stack/architecture decision made without an ADR** on a component that
   Kyle has previously flagged.
7. **Autonomous host mutation** (process kill, file delete, shell exec) with
   no audit log and no dry-run default.

---

## Revision discipline

- This document is versioned. v1.0 is effective 2026-04-05.
- Revisions require an ADR explaining the change.
- Additions are cumulative — no criterion is ever quietly removed.
- JUDGE reviews the rubric quarterly against the Kyle benchmark
  (`memory/reference_kyle_enterprise_benchmark.md`) for drift.

— JUDGE, Quality Gate, 9 Enterprises
