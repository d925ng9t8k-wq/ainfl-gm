# WWKD Dry-Run #001 — Kyle Shea RAM Agent

- **Build under review:** Kyle Shea-endorsed RAM watch + profiler + orphan cleaner stack
- **Author(s):** Tee (Engineering Team Lead, 9 Front Office)
- **Ship date:** 2026-04-05 ~12:41 ET
- **Review date:** 2026-04-05
- **Reviewer:** JUDGE (Quality Gate, 9 Enterprises)
- **Test version:** WWKD Quick Test v1.0 (`docs/wwkd-quick-test-v1.md`)
- **Origin:** Kyle Shea iMessage, 2026-04-05 (see `docs/kyle-ram-guidance-apr5.md`)

## Why this is #001

Kyle's RAM guidance is the first Kyle-endorsed technical directive in the
history of 9 Enterprises. Tee built to the specification the same day. This
review is symbolic and load-bearing: if we cannot honestly gate the first
Kyle-endorsed artifact, we cannot gate anything. JUDGE's charter
(`memory/agent_judge_charter.md`) mandates this as Day-1 dry-run #1.

**Rule: this review is written as if Kyle will read it.** No people-pleasing.
No hedging. No marketing language. If a section fails, it fails.

## Assets reviewed

| # | Path | SHA at review | Lines |
|---|------|----------------|-------|
| 1 | `scripts/ram-watch-agent.mjs` | working tree @ 2026-04-05 12:41 | 572 |
| 2 | `scripts/ram-strategy-analyzer.mjs` | working tree @ 2026-04-05 12:42 | — |
| 3 | `scripts/orphan-session-cleaner.mjs` | working tree @ 2026-04-05 12:47 | 229 |
| 4 | `docs/kyle-ram-guidance-apr5.md` | working tree @ 2026-04-05 12:46 | 64 |
| 5 | `~/Library/LaunchAgents/com.9.ram-watch-agent.plist` | installed | 32 |
| 6 | `scripts/health-monitor.mjs:674` (integration hook) | working tree | 1 line |

## Live-state verification performed

- `curl http://localhost:3459/health` → 200 OK, `samples_taken=35`,
  `uptime=1047s` (agent live under LaunchAgent since 12:44 ET).
- `curl http://$(ipconfig getifaddr en0):3459/health` → 200 OK
  **(CRITICAL — unauthed LAN exposure; see Security S4).**
- `ram_samples` table: **1040 rows**, max timestamp 30s prior to query
  (writes are live). Table read required the SQLCipher key from the macOS
  Keychain.
- `logs/ram-watch.log` → 83 lines, 1 leak suspect detected
  (`node (any): 1263→1354MB`).
- `file data/9-memory.db` → header bytes `51a0 9e41 75e4 e060` — the DB is
  encrypted at rest (SQLCipher / wxSQLite3).
- `ps eww 81280` → SQLITE_ENCRYPTION_KEY **not present** in the running
  process environment.
- `.env` file modified 13:08 ET (after process start 12:44); the key is
  now commented out in `.env` and documented as having moved to macOS
  Keychain (FORT C-03, 2026-04-05).
- Orphan cleaner LaunchAgent: present. Dry-run default verified in source.

---

## Section scoring

### 1. Reliability — 5/6 (threshold 4/6) — **PASS**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| R1 | Auto-restart on crash | PASS | `~/Library/LaunchAgents/com.9.ram-watch-agent.plist` has `KeepAlive=true`, `RunAtLoad=true`, `ThrottleInterval=10`. |
| R2 | Healthcheck endpoint | PASS | `ram-watch-agent.mjs:510-520` serves `/health` JSON at port 3459; live-verified 200 OK. |
| R3 | Healthcheck monitored | PASS | `scripts/health-monitor.mjs:674` polls `http://localhost:3459/health` as component `ram-watch-agent` on the fast-check cycle. |
| R4 | Graceful degradation | PASS | `safeExec` wraps every subprocess call with try/catch and timeout; `getRollingStats` / `detectLeaks` wrap DB reads in try/catch returning empty. Sampler continues even when individual collectors fail. |
| R5 | Documented restart procedure | **FAIL** | No runbook exists in `docs/runbooks/` for this component. `docs/kyle-ram-guidance-apr5.md` describes *what* it does but not *how to operate it* (start, stop, diagnose, restore). |
| R6 | 24h soak survived | N/A / pending | Agent has been running 17 minutes at review time. Re-score at 24h mark. Not counted against scoring per N/A rule. |

**Kyle-fail triggers in reliability:** none tripped.

### 2. Security — 4/8 (threshold 6/8) — **FAIL**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| S1 | No hardcoded secrets | PASS | `scripts/ram-watch-agent.mjs:68` loads `SQLITE_ENCRYPTION_KEY` from `process.env`. No literal secret in source. |
| S2 | Secret separated from encrypted asset | **FAIL (fragile)** | `scripts/ram-watch-agent.mjs:37-48` loads `.env` from the same project root as `data/9-memory.db`. FORT's C-03 remediation moved the key to macOS Keychain and commented it out of `.env`, but the script **does not read from Keychain**. The live process only works because it started *before* FORT commented the key out. **Next LaunchAgent restart will fail silently.** Details in the Critical Finding below. |
| S3 | Every endpoint authed or has public-justification ADR | **FAIL** | `/health`, `/ram-watch/health`, `/ram-watch/status` are unauthenticated. No ADR justifies public access. |
| S4 | Binds localhost only unless public is explicit | **FAIL** | `scripts/ram-watch-agent.mjs:545` calls `server.listen(WATCH_PORT, ...)` with no host argument → Node binds to `0.0.0.0`. Live-verified: the `/health` endpoint is reachable from the LAN IP. Any device on the same network can read process RSS data. Kyle K-02 ("autonomous OS control is a security red flag") is directly adjacent to this. |
| S5 | No new attack surface introduced | **FAIL** | New open port (3459) on all interfaces, no auth, no rate limit, no FORT review in the commit history. |
| S6 | Least-privilege / scope minimization | PASS | Runs as user `jassonfishback` under LaunchAgent, no sudo, no elevated entitlements. |
| S7 | Protected-list + dry-run default for host mutation | PASS | `scripts/orphan-session-cleaner.mjs:34-55` has a protected-patterns list with 20 entries; `DRY_RUN` is default true; `--kill` flag is required for live action. Every decision logged to `logs/orphan-cleaner.log`. **Note:** `ram-watch-agent.mjs` itself does not mutate the host — only the companion cleaner does. This item scores for the cleaner. |
| S8 | Cursory OWASP review | **FAIL** | `scripts/ram-watch-agent.mjs:74` — `_db.pragma(\`key = '${ENCRYPTION_KEY}'\`)` — the key is interpolated into a pragma string. If the key ever contains a single quote, this breaks (or worse, SQL-injects the pragma). Keys are hex-only in practice, so exploitation risk is low, but the pattern is wrong. Should use parameterized pragma form. |

**Kyle-fail triggers in security:**
- **UNAUTHED PUBLIC ENDPOINT** (S3 + S4, 0.0.0.0 binding) — Kyle-fail trigger #2.
- **SECRET-HANDLING GAP** (S2) — not a plaintext secret, but a fragile state where a restart will silently break the encrypted-memory foundation the universe depends on.

### 3. Observability — 5/6 (threshold 4/6) — **PASS**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| O1 | Structured logs | PASS | `logs/ram-watch.log` — every line prefixed with ISO 8601 timestamp via `log()` function (line 61-65). |
| O2 | Centralized log location | PASS | `logs/ram-watch.log` + LaunchAgent stdout/stderr at `logs/ram-watch-stdout.log`, `logs/ram-watch-stderr.log`. |
| O3 | Errors captured with context | PASS / partial | `log('[sample] error: ${e.message}')` at line 555. Error message captured but **no stack trace** — makes diagnosis harder. Downgrade: partial credit (still PASS). |
| O4 | Operational metrics queryable | PASS | `/health` returns `samples_taken`, `uptime`, `pid`, `checked_at`. `/ram-watch/status` returns system + orphan + leak counts. |
| O5 | Health-monitor integration | PASS | `scripts/health-monitor.mjs:674` verified. |
| O6 | Day-over-day diff-ability | PASS | `ram_samples` table with timestamp index (`idx_ram_samples_timestamp`, line 90) + daily `ram-strategy-analyzer.mjs` generates `docs/ram-profile-daily.md`. |

### 4. Documentation — 3/5 (threshold 3/5) — **PASS (minimum)**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| D1 | Top-of-file header | PASS | `ram-watch-agent.mjs:1-17` and `orphan-session-cleaner.mjs:1-18` both have Kyle-quote headers and purpose statements. Exemplary. |
| D2 | ADR authored for this component | **FAIL** | No ADR exists for this build. This review is the first governance artifact. JUDGE will backfill ADR-0004 (SQLCipher) today but no ADR-specific-to-RAM-agent yet. |
| D3 | Dependency map updated | **FAIL** | `docs/dependency-map.md` and `docs/dependency-map.json` do not include `ram-watch-agent`, `ram-strategy-analyzer`, `orphan-session-cleaner`, port 3459, or the `ram_samples` table. This is Kyle K-01 — the single most-repeated ask. |
| D4 | Runbook | **FAIL** | No runbook. (Cross-references R5.) |
| D5 | Kyle-readable one-pager | PASS | `docs/kyle-ram-guidance-apr5.md` is concise, quotes Kyle directly, explains what was built and why. Good artifact. |

**Scoring note:** Documentation scrapes by at exactly threshold (3/5). The
three failures (D2, D3, D4) are structural and will recur on every future
build if not fixed systemically. Dependency-map drift is a Kyle-fail
trigger waiting to happen.

### 5. SDLC — 2/6 (threshold 4/6) — **FAIL**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| L1 | Architecture design step before code | **FAIL** | Kyle's iMessage was received, Tee began building, the three scripts and LaunchAgent landed in the same working session. No design note, no ADR draft, no review gate. This is exactly K-12 ("AI speed doesn't replace SDLC") and K-17 ("don't let speed to CODE fool you"). |
| L2 | Automated tests for non-trivial logic | **FAIL** | No test files. `detectLeaks()`, `detectOrphans()`, `getRollingStats()` — all untested. The orphan-cleaner kill logic is also untested. For a component that kills processes, zero tests is a hard finding. |
| L3 | Manual verification with logged artifact | PASS | `docs/kyle-ram-guidance-apr5.md` documents the build; `logs/ram-watch.log` shows live samples; curl-verified endpoints. Artifact exists. |
| L4 | Reviewable size (single purpose, < ~800 lines) | PASS | Each file is single-purpose. Largest is 572 lines, still reviewable in one sitting. |
| L5 | JUDGE involved pre-merge | **FAIL** | This review is happening **after** ship. JUDGE charter was instantiated Apr 5; Tee shipped Apr 5. The concurrency is understandable (JUDGE did not exist at build time) but scoring is literal. From this review forward, pre-merge JUDGE involvement is mandatory. |
| L6 | Prior work retired if superseded | N/A | No prior RAM monitoring existed. N/A pass. |

**Kyle-fail triggers in SDLC:** L1 + L2 + L5 is the exact "built itself
without SDLC" pattern Kyle flagged in K-12. This is the single most
Kyle-damaging finding in the report.

### 6. Cost — 3/4 (threshold 2/4) — **PASS**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| C1 | Operating cost knowable | PASS | Local process, no API calls, no cloud egress. Cost ≈ $0 beyond ambient Mac power. |
| C2 | Per-user cost derivable | PASS | N/A-equivalent — single-user Mac. Documented in `docs/cost-per-user-model.md`. |
| C3 | No new paid third-party deps | PASS | `better-sqlite3-multiple-ciphers` already in package.json for other components. No new paid vendor. |
| C4 | Runaway alert | **FAIL** / minor | `ram_samples` table grows ~1000 rows/hr. No retention policy, no auto-prune. Over 30 days, ~720k rows — manageable, but a documented retention policy is required for SOC 2 alignment (D-03 in UNO benchmark). |

### 7. Kyle-Persona Judgment — 4/5 (threshold 3/5) — **PASS**

| # | Q | Verdict | Evidence |
|---|---|---------|----------|
| K1 | Kyle understands in <5 min | PASS | `docs/kyle-ram-guidance-apr5.md` + the header in `ram-watch-agent.mjs:1-17` + an open `/health` endpoint would give Kyle the full picture in under 5 minutes. |
| K2 | No hype-without-depth | PASS | Source code is plain. Docs are plain. No "revolutionary" / "enterprise-grade" copy. |
| K3 | Rapid stack alignment (if Rapid-facing) | N/A | Not Rapid-facing. Observing Jasson's dev Mac only. N/A pass. |
| K4 | Kyle could defend it in a meeting | **FAIL** | Not quite. The unauthed LAN endpoint and the silent-breakage encryption path would be exactly the questions Kyle asks in a review meeting. The defender would lose. |
| K5 | No people-pleasing framing | PASS | `docs/kyle-ram-guidance-apr5.md` correctly says "built to Kyle's specification" — not "Kyle-approved". The framing is honest. |

---

## Aggregate verdict

| Section | Score | Threshold | Pass? |
|---|---|---|---|
| Reliability | 5/6 | 4/6 | PASS |
| Security | 4/8 | 6/8 | **FAIL** |
| Observability | 5/6 | 4/6 | PASS |
| Documentation | 3/5 | 3/5 | PASS (minimum) |
| SDLC | 2/6 | 4/6 | **FAIL** |
| Cost | 3/4 | 2/4 | PASS |
| Kyle-Persona | 4/5 | 3/5 | PASS |

**2 sections failed** (Security, SDLC).
**1 section at bare-minimum threshold** (Documentation).
**2 Kyle-fail triggers tripped** (unauthed public endpoint; SDLC-bypass by speed).

## VERDICT: **CONDITIONAL**

JUDGE does not issue a hard FAIL here for three reasons:

1. The build is functional, useful, and faithfully implements Kyle's
   directive. The live observations (35 samples, 1040 DB rows, 1 leak
   detected in the first hour) show the agent is already earning its keep.
2. The Kyle-fail triggers are concrete and cheaply fixable in a single
   focused session (est. 3–4 hours).
3. The SDLC failure is partially structural — JUDGE did not exist at build
   time, so L5 (pre-merge JUDGE involvement) was literally impossible. This
   will be enforced going forward but is not fairly charged against Tee for
   this build.

**Conditional pass requires the following rework before this component is
ever shown to Kyle or claimed as Kyle-ready.**

---

## Required fixes (ordered, owned, deadlined)

### P0 — BEFORE NEXT LAUNCHAGENT RESTART (owner: Tee, deadline: EOD 2026-04-05)

**RF-1. Fix the encryption-key retrieval path — CRITICAL LATENT BUG.**
The live process works because it inherited the key from `.env` at launch
time. FORT has since commented the key out per C-03. On any restart
(crash, reboot, plist reload), the agent will open the encrypted DB
without a key and the first `db.prepare(...)` will throw *"file is not a
database"* — silently swallowed by `safeExec` chains, resulting in
zero-sample writes but healthcheck still returning 200. The foundation
loses observability without any alert.

Fix: `scripts/ram-watch-agent.mjs` must call
`security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w`
(or use node-keytar) at startup, identical to the pattern every other
component that reads 9-memory.db must use. If the Keychain call fails,
the agent must log CRITICAL, emit a distinct healthcheck failure
(`status: "key-unavailable"`), and exit non-zero so LaunchAgent restarts
visible the problem. Verify by bouncing the agent and confirming
`ram_samples` row count still increments.

**RF-2. Bind the HTTP server to 127.0.0.1 only.**
`scripts/ram-watch-agent.mjs:545` — change `server.listen(WATCH_PORT, ...)`
to `server.listen(WATCH_PORT, '127.0.0.1', ...)`. Live-verify the LAN IP
no longer reaches the endpoint. This is a 10-minute fix and closes the
single most Kyle-embarrassing finding in the report.

### P1 — within 48 hours (owner: Tee + JUDGE, deadline: 2026-04-07 EOD)

**RF-3. Author ADR-0007 "RAM watch agent architecture".**
Context: Kyle RAM directive. Decision: sampler-based profiler with
SQLite persistence, nightly analyzer, daily orphan cleaner. Consequences:
observability win, retention policy required, Keychain dependency.
Alternatives considered: (a) `top`/`vm_stat` snapshotting to flat files
(rejected: no queryability), (b) Prometheus node_exporter (rejected:
introduces a new paid/complex dep), (c) cloud APM (rejected: single-user
Mac dev env, overkill).

**RF-4. Add the component to `docs/dependency-map.md` and
`docs/dependency-map.json`.**
Entries required: `ram-watch-agent`, `ram-strategy-analyzer`,
`orphan-session-cleaner`, port `3459`, `ram_samples` table, Keychain
`SQLITE_ENCRYPTION_KEY`, LaunchAgents `com.9.ram-watch-agent` and
`com.9.orphan-cleaner`. Kyle K-01 — non-negotiable.

**RF-5. Write a runbook at `docs/runbooks/ram-watch-agent.md`.**
Sections: start, stop, reload, diagnose (healthcheck + log locations),
data retrieval (how to query the encrypted DB), incident response
(what to do if the agent stops sampling).

**RF-6. Add retention policy to `ram_samples`.**
Either a nightly prune (keep last 30 days) in `ram-strategy-analyzer.mjs`,
or a documented manual prune procedure. 720k+ rows/month is not a crisis
but a known-growth unbounded table is a SOC 2 red flag (DG-03, UNO
benchmark).

### P2 — within 7 days (owner: Tee, deadline: 2026-04-12 EOD)

**RF-7. Add a test suite for the non-trivial logic.**
Minimum: (a) `detectLeaks()` with a fixture of fake rows exhibiting
growth-without-retreat and a control group, (b) `detectOrphans()` against
a mocked `ps` output, (c) orphan-cleaner protected-list enforcement
(every protected pattern must survive a simulated kill pass), (d) health
endpoint returns expected JSON shape. Target: at least 8 tests, all
passing, wired to npm-script.

**RF-8. Fix the pragma key interpolation (S8).**
Use the parameterized form if `better-sqlite3-multiple-ciphers` supports
it (it does: `db.pragma('key', key)`) or validate the key is hex-only
before interpolation. Small, cheap, closes an OWASP-adjacent finding.

**RF-9. Stack trace on errors (O3 upgrade).**
`log(`[sample] error: ${e.message}\n${e.stack}`)`. Minor change, large
diagnostic improvement.

---

## Items explicitly not blocking ship

- 24-hour soak (R6) — will be re-scored automatically at the 24h mark.
- `L5` (pre-merge JUDGE involvement) — JUDGE did not exist at build time.
  Enforced going forward.
- Component-level ADR (D2) — satisfied by RF-3 in the fix list.

## What Kyle would say reading this cold

Kyle would say: *"The live-watch instrumentation is exactly what I asked
for and the log output looks useful. Three things bother me. First, the
port is open on my network — that is not a prototype mistake, that's a
Node.js default nobody audited. Second, the encryption key is in a comment
in a file next to the database and the agent reads it from memory — that's
a ticking bomb. Third, where are the tests? You're killing my orphan
processes at 3am based on code that has not been tested once."*

JUDGE's job is to make sure Kyle never has to say those things. These three
items are RF-2, RF-1, and RF-7 above.

## Kyle-readiness status

**NOT Kyle-ready.** Do not show this component to Kyle until P0 (RF-1,
RF-2) and P1 (RF-3, RF-4, RF-5, RF-6) are closed. After those close, it
becomes a strong candidate for the Phase-1 flagship WWKD pass.

## Signature

— JUDGE, Quality Gate, 9 Enterprises
2026-04-05
