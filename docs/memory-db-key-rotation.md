# Memory DB Encryption Key Rotation Policy

**Owner:** 9 (9 Enterprises AI partner)
**Scope:** `data/9-memory.db` (SQLCipher-encrypted via `better-sqlite3-multiple-ciphers`)
**Status:** Policy + tooling in place. First scheduled rotation: TBD with Owner in the loop.
**Related:** FORT C-03 (key/db separation), `scripts/memory-db.mjs`, `scripts/rotate-memory-db-key.mjs`

---

## 1. Purpose

`data/9-memory.db` is the authoritative source of truth for messages, actions, authority matrix, memory entries, tasks, decisions, health events, audit log, and usage events. It is encrypted at rest with SQLCipher. The encryption key lives in the macOS Keychain under `service="9-enterprises"` `account="SQLITE_ENCRYPTION_KEY"`, separated from the database file on disk (FORT C-03).

Before this policy, there was **no rotation mechanism**. If the key ever leaked, the only remediation was to destroy and rebuild the database — which is not acceptable for a crash-proof, enterprise-grade system.

This policy defines:

- Cadence under which the key is rotated by default.
- Triggers that force an off-cycle rotation.
- Exact procedure that rotates the key in place without data loss.
- Rollback path if rekey fails mid-operation.
- Audit trail every rotation must produce.

Minimum-acceptable-standard bar: a rotation must be safe to run during a live session with zero message loss and must be fully reversible until the new key is verified.

---

## 2. Cadence

**Default: every 90 days.**

Rationale: SQLCipher uses PBKDF2 key derivation with a high iteration count, so key rotation is not compensation for weak crypto. Ninety days is the industry midpoint for at-rest DB encryption keys (NIST SP 800-57 recommends 1-2 years for symmetric DEKs; Salesforce Shield defaults to annual; financial sector SOC 2 auditors commonly accept 90-180 days). Ninety days strikes the balance between audit-friendliness and churn.

**Triggers that force an immediate off-cycle rotation (any one is sufficient):**

1. Suspected or confirmed key leak (file checkin, screenshot, logs, memory dump, stolen laptop).
2. Any team member / agent / contractor with read access to the Keychain entry departs or is deauthorized.
3. Mac replacement or major OS reinstall.
4. Any Keychain integrity event (e.g. Keychain corruption, lost, force-reset).
5. Any compliance event that requires fresh key material.
6. Any time Owner directs a rotation.

**Hard rule:** the rotation date window is calendar-based, not session-based. The scheduler (future Phase 3 work) will surface a Telegram alert at T-7, T-3, and T-0 days before the rotation is due. Missing a rotation window by more than 30 days is a Gold Standard audit finding.

---

## 3. Procedure

All steps are implemented by `scripts/rotate-memory-db-key.mjs`. This section documents what the script does so the policy is auditable even if the script is inspected later.

### Pre-flight

1. **Confirm hub is not actively writing.** The rekey runs while the SQLite file is closed from the hub's perspective. Recommended: run during a terminal session with Owner aware, or stop `comms-hub.mjs` cleanly first (SIGTERM — hub flushes pending writes and closes DB on graceful shutdown).
2. **Confirm current Keychain entry is readable.**
   ```
   security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w
   ```
   If this fails, rotation is aborted before any file is touched.
3. **Confirm `better-sqlite3-multiple-ciphers` is installed.** Plain `better-sqlite3` cannot perform a rekey.
4. **Confirm ≥ 500 MB free disk space** (for snapshot).

### Snapshot

5. Copy `data/9-memory.db` to `data/backups/pre-rekey-<ISO_TS>.db`. SQLCipher databases snapshot cleanly with a byte-level copy — no dump required.
6. Also copy WAL + SHM sidecars if they exist (`9-memory.db-wal`, `9-memory.db-shm`).

### Rekey

7. Generate a new key: `crypto.randomBytes(32).toString('base64')` → 44-character base64 string. This never touches disk except the Keychain.
8. Open the live DB with the **old** key (`PRAGMA key = 'OLD'`).
9. Execute `PRAGMA rekey = 'NEW'`. SQLCipher rewrites every page in place, still in the same file.
10. Run a verification query: `SELECT COUNT(*) FROM messages; SELECT 1;`. If either throws, the rekey is considered failed — proceed to Rollback.
11. Close the database.
12. Re-open the database with the **new** key and run the same verification queries. This proves the new key actually decrypts the file on a fresh handle, not just the already-open handle.

### Keychain update (the "version pointer" strategy)

The design keeps the **old** key around under a versioned account name, and flips a single pointer. This way the hub's startup code (which reads `account="SQLITE_ENCRYPTION_KEY"`) does not change — it always reads the "current" pointer — but the historical keys remain recoverable.

13. Write the new key to Keychain under a versioned name:
    ```
    security add-generic-password -a "9-enterprises" \
      -s "SQLITE_ENCRYPTION_KEY_v<YYYYMMDD>" -w '<NEW_KEY>' -U
    ```
14. Write the **current** key to Keychain under the old versioned name for the key we're rotating out (so it is preserved before we overwrite the main pointer):
    ```
    security add-generic-password -a "9-enterprises" \
      -s "SQLITE_ENCRYPTION_KEY_prev_<YYYYMMDD>" -w '<OLD_KEY>' -U
    ```
15. Update the **canonical pointer** (`account="9-enterprises"` `service="SQLITE_ENCRYPTION_KEY"`) to the new key value:
    ```
    security add-generic-password -a "9-enterprises" \
      -s "SQLITE_ENCRYPTION_KEY" -w '<NEW_KEY>' -U
    ```
16. Verify `security find-generic-password` returns the new key.

### Post-flight

17. Append rotation event to `logs/key-rotation.log` (see Audit).
18. Log a `decisions` row in the DB itself via the existing `MemoryDB.logDecision()` API: `"Rotated memory-db encryption key to v<YYYYMMDD>"` with context = run-id.
19. Restart `comms-hub.mjs` and watch the startup log for the `FORT C-03 compliant` line + `SQLCipher encryption active`. If the hub fails to open the DB, proceed immediately to Rollback.
20. Send Telegram confirmation to Owner: `"Key rotation v<YYYYMMDD> complete. Hub reopened cleanly. Old key preserved for N days."`

---

## 4. Rollback

If any verification step fails (steps 10, 12, or 19 above):

1. **Close all DB handles immediately.**
2. **Restore the snapshot** from `data/backups/pre-rekey-<ISO_TS>.db` → `data/9-memory.db`. Also restore WAL/SHM sidecars if they existed.
3. **Do NOT overwrite the canonical Keychain pointer** — the rotation script only updates the canonical pointer as the last Keychain step (step 15) after all in-place verifications pass. If the script aborts before step 15, the canonical pointer still points at the old key and no action is needed.
4. If the canonical pointer was already updated (i.e. failure was at step 19, hub startup), restore it manually from the `SQLITE_ENCRYPTION_KEY_prev_<YYYYMMDD>` entry created in step 14:
   ```
   OLD=$(security find-generic-password -a "9-enterprises" \
     -s "SQLITE_ENCRYPTION_KEY_prev_<YYYYMMDD>" -w)
   security add-generic-password -a "9-enterprises" \
     -s "SQLITE_ENCRYPTION_KEY" -w "$OLD" -U
   ```
5. Restart `comms-hub.mjs` and verify DB opens.
6. Append a `ROLLBACK` event to `logs/key-rotation.log`.
7. Page Owner via Telegram with the failure reason.

**Hard rule:** the old key is retained in Keychain under its versioned name for **≥ 30 days** after a successful rotation. It must not be deleted before that window, in case a late-discovered corruption forces a rollback. Deletion happens in a separate, manually-run cleanup step — never by the rotation script.

---

## 5. Audit

Every rotation attempt (success, failure, or dry-run) appends a single JSON line to `logs/key-rotation.log`. Format:

```json
{
  "timestamp": "2026-04-10T18:00:00.000Z",
  "event": "rotate_success",
  "run_id": "rek-20260410-180000",
  "mode": "apply",
  "old_key_id": "SQLITE_ENCRYPTION_KEY_prev_20260410",
  "new_key_id": "SQLITE_ENCRYPTION_KEY_v20260410",
  "snapshot_path": "data/backups/pre-rekey-20260410-180000.db",
  "db_bytes_before": 12345678,
  "db_bytes_after": 12345678,
  "verification": "SELECT 1 OK; COUNT(messages)=48213",
  "duration_ms": 2140,
  "operator": "9",
  "notes": ""
}
```

`event` is one of: `dry_run`, `rotate_start`, `rotate_success`, `rotate_failed`, `rollback`.

Every event is **also** written to the `decisions` table inside the DB itself (after the rotation succeeds) and to the `audit_log` table via the existing MemoryDB `_emitAudit` hook, so the record lives in both the plaintext append-only log file and inside the encrypted DB.

The log file **never** contains the key value itself, old or new. Any code that writes a key value to this file is a Gold Standard audit failure.

---

## 6. Test plan

Before the first production rotation, the following tests must pass against a **copy** of the DB (never the live one):

1. **Happy path.** Run `scripts/rotate-memory-db-key.mjs --apply --db data/9-memory.db.testcopy`. Verify:
   - `logs/key-rotation.log` gains a `rotate_success` line.
   - A snapshot file exists in `data/backups/`.
   - Re-running the script with the new key works (idempotent behavior).
   - Hub pointed at the test copy opens cleanly on restart.
2. **Dry-run mode.** Run without `--apply`. Verify:
   - No Keychain write occurs.
   - No DB modification occurs.
   - A `dry_run` log line is appended.
   - The script prints the planned new key ID (never the key value itself).
3. **Interrupted mid-rekey.** Start the rekey and SIGKILL the script between steps 9 and 10. Verify:
   - Snapshot is still intact.
   - Restoring the snapshot produces a working DB with the OLD key.
   - Canonical Keychain pointer is unchanged (still points at old key).
4. **Corrupted DB after rekey.** Simulate by truncating the DB file after the rekey. Verify the script detects the failure at step 10 or 12 and triggers rollback.
5. **Keychain write failure.** Simulate with a bogus `security` binary in PATH. Verify script aborts before the canonical pointer is updated.
6. **Log schema validation.** Verify every line in `logs/key-rotation.log` is parseable JSON and contains the required fields.
7. **No-key-in-logs audit.** `grep` the entire log file and the snapshot file paths for base64 key material and confirm zero matches other than legitimate Keychain account names.

All test results go into a one-time `docs/memory-db-key-rotation-test-report.md` before the first production rotation.

---

## 7. Non-goals

- This policy does not cover **key escrow** (splitting the key across multiple custodians). That is Phase 4 enterprise work. For now, Owner is the sole custodian via the Mac's Keychain.
- This policy does not cover **hardware security modules** (YubiKey, Secure Enclave wrapping). Phase 4.
- This policy does not cover **remote DB replicas** (Supabase mirror). The Supabase mirror uses its own encryption at rest managed by Supabase — rotation there is separate and not part of this document.
- This policy does not define an automated cron schedule. The first several rotations are run with Owner in the loop. Automation comes after the manual runs prove the procedure is solid.

---

**Last updated:** April 10, 2026 — initial version (Phase 2, sub-agent #7).
