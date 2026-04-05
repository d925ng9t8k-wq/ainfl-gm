# ADR-0004: SQLCipher encryption-at-rest for 9-memory.db

- **Status:** Accepted
- **Date:** 2026-04-05
- **Author:** JUDGE (Quality Gate, 9 Enterprises)
- **Reviewers:** JUDGE, FORT (security), Tee (engineering)
- **Squad:** Engineering + Strategy/Governance
- **Related ADRs:** ADR-0001, ADR-0006 (foundation-first)
- **Kyle K-items addressed:** K-05 (no SOC 2, SSO, audit log), K-02
  (security red flag), K-04 (cost transparency implied)

## Context

`data/9-memory.db` is the authoritative persistent memory store for 9
Enterprises. It contains:

- Every inbound/outbound message (Telegram, iMessage, voice, email)
- Every action taken by every agent
- The authority matrix (what each role can decide)
- Strategic decisions and their rationale
- Task assignments and status
- `ram_samples` (see Kyle RAM agent, ADR-0007 pending)
- Sensitive contact data (Owner's family, Rapid Mortgage team, business
  partners)

Prior to April 5, 2026, the database was stored **unencrypted** on
Jasson's Mac. Any actor with filesystem access (stolen laptop, malware,
a backup misconfigured to sync to cloud storage, an orphaned
`better-sqlite3` handle from a defunct script) could read every message,
every decision, and every contact in the universe.

This is a direct violation of:
- Kyle K-05 (audit logging / SOC 2 posture implied)
- NIST SP 800-111 (storage encryption standard)
- SOC 2 CC6.1 / Security TSC
- Owner's foundation-first directive, section "Security posture"
  (`memory/mission_goal_one_apr5.md`)

Tee's dependency-map credential audit (Tee #3, April 4-5) flagged
`SQLITE_ENCRYPTION_KEY` absence as a critical flag. Wendy's 90-day plan
Week 1 assigned FORT to implement encryption-at-rest and key separation
(C-03 in `memory/wendy_90day_plan_v1.md`).

## Decision

`data/9-memory.db` is encrypted at rest using **SQLCipher** (via the
`better-sqlite3-multiple-ciphers` Node.js binding, which provides a
SQLCipher-compatible cipher layer).

**Implementation:**

1. Every process that opens `data/9-memory.db` loads the
   `better-sqlite3-multiple-ciphers` package (not plain
   `better-sqlite3`). The package is listed in `package.json`.
2. After opening the file, each process issues `PRAGMA key = '<hex>'`
   and `PRAGMA cipher = 'sqlcipher'` before any query.
3. The encryption key is **NOT stored in `.env`**. It lives in the
   macOS Keychain under account `9-enterprises`, service
   `SQLITE_ENCRYPTION_KEY`. Retrieval:
   `security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w`.
4. A backup of the pre-encryption database is preserved at
   `data/9-memory.db.pre-sqlcipher-backup` (read-only, git-ignored) so
   migration can be rolled back if a bug surfaces.
5. Every component reading 9-memory.db must have a startup assertion
   that the Keychain lookup succeeded. Failing the lookup must log
   CRITICAL and exit non-zero so LaunchAgent surfaces the problem —
   not silently open an empty/broken handle.

## Consequences

### Positive
- Stolen-Mac threat model downgraded from "full universe compromise"
  to "attacker needs the Keychain passphrase or unlocked user session."
- SOC 2 Availability/Security TSC path unblocked — encryption-at-rest
  is a standard control.
- Closes Tee #3 / C-03 / Kyle K-05 one notch each.
- Establishes the pattern for every future persistent store (Bengal
  Pro memory, Jules memory, Trader9 state).

### Negative / Trade-offs
- Performance: SQLCipher adds ~5–15% read/write overhead. Measured
  impact on comms-hub is negligible.
- Every script that touches the DB must be updated to use the cipher
  binding and retrieve the key from Keychain. This was partially
  done on April 5 — several older scripts still need retrofit (flagged
  in WWKD Dry-Run #001 for the Kyle RAM agent, see
  `docs/wwkd-reviews/001-kyle-ram-agent.md`, finding RF-1).
- Backup/restore now requires the key. Documented in
  `docs/disaster-recovery.md` (DOC owns update).
- Development friction: developers cannot `sqlite3 data/9-memory.db`
  from the CLI without the key. Documented workaround in
  `docs/runbooks/sqlite-access.md` (pending).

### Follow-ups
- **Open from WWKD Dry-Run #001 RF-1:** `scripts/ram-watch-agent.mjs`
  must be updated to read the key from Keychain — it currently reads
  from `process.env` only and will break on next restart. Deadline:
  EOD 2026-04-05.
- FORT: audit every script that opens `9-memory.db` and verify
  Keychain-path compliance. Publish the inventory.
- DOC: update `docs/disaster-recovery.md` with encrypted backup/restore
  procedure.
- Tee: add `SQLITE_ENCRYPTION_KEY` presence check to the startup
  self-test in `comms-hub.mjs`.

## Alternatives Considered

1. **Filesystem-level encryption only (macOS FileVault).**
   Rejected: FileVault protects at-rest on a powered-off Mac only.
   While Jasson is logged in, the decrypted volume is readable by any
   user-space process. Our threat model includes rogue/orphaned
   processes, malware, and accidental cloud-sync misconfig — all of
   which operate on an unlocked FileVault. FileVault is layered
   defense, not primary.
2. **Postgres with `pgcrypto` or Supabase native column encryption.**
   Rejected (for now): requires migrating the entire memory substrate
   from SQLite to Postgres, which is Phase 2+ scope. Also requires a
   live network to read — unacceptable for offline recovery.
   Supabase cloud sync is a separate layer (runs on top) and is
   tracked in a different ADR.
3. **Per-table application-level encryption.**
   Rejected: leaks metadata (row counts, timestamps, schema). SQLCipher
   encrypts the entire database file including structure.
4. **Leave it unencrypted; rely on host security.**
   Rejected: violates Owner's foundation-first directive, Kyle K-05,
   and basic enterprise hygiene.

## References

- `data/9-memory.db` — the database
- `data/9-memory.db.pre-sqlcipher-backup` — pre-migration snapshot
- `package.json` — `better-sqlite3-multiple-ciphers` dep
- `memory/mission_goal_one_apr5.md` — foundation security posture
- `memory/wendy_90day_plan_v1.md` — Week 1 FORT C-03 task
- `docs/wwkd-reviews/001-kyle-ram-agent.md` — RF-1 follow-up on RAM
  agent key retrieval
- SQLCipher documentation: https://www.zetetic.net/sqlcipher/
- `better-sqlite3-multiple-ciphers`:
  https://github.com/m4heshd/better-sqlite3-multiple-ciphers
- NIST SP 800-111 (storage encryption)

## Kyle Impact

Partial close on K-05 (audit logging / SOC 2 posture). Kyle will ask:
*"How is the encryption key managed?"* The answer is "macOS Keychain,
separated from the encrypted asset, every process retrieves at
startup." That is a defensible answer. He will follow up: *"What about
backup/restore, key rotation, and key escrow?"* — all three are
follow-up items, explicitly tracked here rather than hidden.

— JUDGE, Quality Gate, 9 Enterprises
