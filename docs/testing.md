# Regression Test Suite

Scaffolding for the BengalOracle / 9 Enterprises regression suite.
Born Apr 11 2026 as the Phase 3 fix for P0 gap #3: "Zero automated regression
tests." Every test here locks in a load-bearing behavior or a kill from a
recent hunt so the same bug can't silently return.

## Quick start

```bash
# Run the full suite (auto-skips live-hub tests if comms-hub is down)
node scripts/run-regression-tests.mjs

# Skip destructive tests (ones that SIGKILL the hub)
node scripts/run-regression-tests.mjs --skip-destructive

# Run a subset by substring
node scripts/run-regression-tests.mjs --filter=wal
```

Exit code: `0` = all passed (or skipped), `1` = at least one failed,
`2` = runner itself errored.

The runner writes a structured JSON report at
`/tmp/regression-test-report-<timestamp>.json` and a stable-named copy at
`/tmp/regression-test-report-latest.json` on every run, regardless of
pass/fail. CI uploads the `*-<timestamp>.json` files as build artifacts.

## What each test covers

| File | Kill / Commit | Scope | Requires hub? |
| --- | --- | --- | --- |
| `scripts/test-memory-db.mjs` | SQLite memory layer smoke | Live DB, logs real rows | no |
| `scripts/test-telegram-load.mjs` | Track 3 (commit 302aef9) | 20 synthetic Telegram inbounds through the real `/test/inbound` path | **yes** |
| `scripts/test-crash-survival.mjs` | Track 4 / kill `wal-replay-missing` (commit 302aef9) | 3 cycles of inject → SIGKILL → restart → verify WAL replay | **yes (destructive — SIGKILLs hub)** |
| `scripts/test-wal-replay.mjs` | kill `wal-replay-missing` (commit 302aef9) | Source invariants + hermetic WAL format round-trip. Verifies `PENDING_WAL_REPLAY` exists, startup scan partitions fresh vs. stale (>1h), replay loop calls `sendTelegram` / `sendIMessage`, and replayed entries are marked `sent + replayed:true` | no |
| `scripts/test-imap-uid-dedup.mjs` | kill C (commit c7c1742) | Source invariants + hermetic dedup behavior. Verifies `checkNewEmails` uses `{ seen: false }` without marking, an un-acked UID is refetched on the next call, `ackEmailUidProcessed` filters it afterward, and 7-day TTL prune works | no |
| `scripts/test-bridge-protocol.mjs` | 9↔Ara never-miss-messages (commits 8208f3b + 58289b4) | Source invariants + hermetic protocol contract. Verifies `wrapProtocol` produces valid `[9-SEQ N]` + optional `ACK ARA-SEQ M` + `sha256:xxxxxx`; `recordLastSent` populates state with `ackAt:null` and `retryCount:0`; `markLastSentAcked` clears pending on a matching seq and is idempotent; and the OCR ACK detection regex tolerates variants (`ACK 9-SEQ 7`, `ACK [9-SEQ 7]`, `ACK9-SEQ7`, lowercase, embedded in body) without matching false positives (`ACK 9-SEQ 70`, different seq, missing `ACK`) | no |

## Scheduling rules

- Tests are discovered via `scripts/test-*.mjs` glob and the runner itself
  (`run-regression-tests.mjs`) is excluded.
- **Non-destructive tests run first**, sorted alphabetically.
- **Destructive tests run last and serialized.** Currently only
  `test-crash-survival.mjs` is tagged destructive because it SIGKILLs
  `comms-hub.mjs` mid-send.
- Parallel execution is deliberately **disabled**. Multiple tests share
  global state (`shared-state.json`, `logs/outbound-wal.jsonl`,
  `/tmp/9-incoming-message.jsonl`) and parallelism flakes.
- Tests tagged `REQUIRES_HUB` (`test-telegram-load.mjs`,
  `test-crash-survival.mjs`) are **auto-skipped when the hub is unreachable**.
  In CI they are skipped and the build still passes — the hermetic subset
  covers the same regressions at the source-invariant level.

## How to add a new test

1. Create `scripts/test-<name>.mjs`. It must:
   - Use `#!/usr/bin/env node` shebang
   - Exit `0` on pass, non-zero on fail
   - Be **idempotent**: running twice in a row produces the same result
   - **Clean up after itself**: no leftover WAL entries, no orphan UIDs, no
     pollution of `shared-state.json`, `data/ara-bridge-state.json`, or
     `/tmp/9-imap-processed-uids.json`
   - Prefer **hermetic** (temp files under `os.tmpdir()`) over live state
2. If it needs a running hub, add its filename to `REQUIRES_HUB` in
   `run-regression-tests.mjs`.
3. If it SIGKILLs the hub or mutates shared state in a way that can't run
   alongside other tests, add it to `DESTRUCTIVE`.
4. Add a row to the coverage table above and a line to the CI workflow's
   `Syntax check` step so `node --check` runs on it.
5. Run `node scripts/run-regression-tests.mjs --filter=<name>` and confirm
   PASS before committing.

## Local verification before pushing

```bash
# Syntax check
node --check scripts/run-regression-tests.mjs
node --check scripts/test-*.mjs

# Full suite
node scripts/run-regression-tests.mjs
```

If you don't want to bring up the hub, use `--skip-destructive` and the
runner will still exercise the hermetic subset.

## CI integration

`.github/workflows/test.yml` runs on every `push` and `pull_request` to
`main`:

1. `npm ci --legacy-peer-deps`
2. `node --check` on every new regression file
3. `node scripts/run-regression-tests.mjs --skip-destructive`
4. Upload `/tmp/regression-test-report-*.json` as a 30-day retention
   artifact named `regression-test-report`.

This workflow runs alongside the existing `ci.yml` (lint + build) and does
not replace it.

## Known gaps

- **No coverage for the consumed-ids dedup path** (kill item B, same commit
  as WAL replay). The `/inbox` vs. `check-messages.sh` dual-drain dedup relies
  on `/tmp/9-consumed-msg-ids.json`; we lock the WAL half and the inbound
  signal half but not the round-trip through both readers. Add a new test if
  a regression appears.
- **No coverage for Supabase DLQ auto-backfill** (commit 58289b4 Phase 3
  wave 1 #1). Needs a Supabase mock or a hermetic drift-replay harness.
- **No coverage for `emailMonitor` → `ackEmailUidProcessed` ordering**. We
  assert the source pattern exists, but not the full temporal ordering
  (fetch → addMessage → saveState → ack). A crash-injection test similar to
  `test-crash-survival.mjs` but for the email path would close this gap.
- **Voice server, pilot server, trader9-bot, trinity, jules-telegram** all
  have zero regression coverage. These are the next tests to write once the
  Phase 3 foundation is green.
- **Live Gmail IMAP loop** is only tested at the source-invariant level. A
  mock IMAP server (e.g. greenmail) would let us exercise the real
  `checkNewEmails()` function end-to-end.
- **Live hub tests** (`test-telegram-load`, `test-crash-survival`) only run
  on the Mac. They are not exercised in CI because the hub isn't available.
  The hermetic `test-wal-replay` partially compensates for the crash-survival
  gap but cannot catch integration-level breakage.
