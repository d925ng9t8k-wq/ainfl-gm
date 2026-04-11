#!/usr/bin/env node
/**
 * rotate-memory-db-key.mjs
 *
 * Memory DB encryption key rotation tool.
 * Policy: docs/memory-db-key-rotation.md
 *
 * Usage:
 *   node scripts/rotate-memory-db-key.mjs              # dry-run (default)
 *   node scripts/rotate-memory-db-key.mjs --apply      # actually rotate
 *   node scripts/rotate-memory-db-key.mjs --apply --db /path/to/other.db  # test copy
 *
 * Safety rules (hard):
 *   - Never prints the key value (old or new) to stdout or to any log.
 *   - Never deletes the old key. Old keys are preserved under versioned
 *     account names for >= 30 days (manual cleanup only).
 *   - Takes a byte-level snapshot BEFORE any rekey operation.
 *   - Updates the canonical Keychain pointer LAST, after verifying the
 *     rekey succeeded on a fresh DB handle.
 *   - Dry-run is the default. --apply is required to do real work.
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { copyFileSync, existsSync, appendFileSync, statSync, mkdirSync } from 'fs';
import { dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_DB = resolve(ROOT, 'data/9-memory.db');
const BACKUPS_DIR = resolve(ROOT, 'data/backups');
const LOG_FILE = resolve(ROOT, 'logs/key-rotation.log');

const KEYCHAIN_ACCOUNT = '9-enterprises';
const KEYCHAIN_SERVICE_CURRENT = 'SQLITE_ENCRYPTION_KEY';

// ─── Argv ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const dbFlagIdx = argv.indexOf('--db');
const DB_PATH = dbFlagIdx >= 0 && argv[dbFlagIdx + 1] ? resolve(argv[dbFlagIdx + 1]) : DEFAULT_DB;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toISOString();
}

function tsCompact() {
  // YYYYMMDD-HHMMSS
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function ymd() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function appendLog(entry) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error(`[rotate-key] WARN: failed to write rotation log: ${err.message}`);
  }
}

function logEvent(event, details = {}) {
  const entry = {
    timestamp: ts(),
    event,
    run_id: RUN_ID,
    mode: APPLY ? 'apply' : 'dry_run',
    db_path: DB_PATH,
    operator: process.env.USER || 'unknown',
    ...details,
  };
  // Hard safety: strip anything that looks like a raw key value.
  for (const k of Object.keys(entry)) {
    if (/^(new_key|old_key|key|password)$/i.test(k)) {
      entry[k] = '[REDACTED]';
    }
  }
  appendLog(entry);
  // Only print the event name + redacted details to stdout.
  const printable = { ...entry };
  console.log(`[rotate-key] ${event}`, JSON.stringify(printable));
}

function die(reason, extra = {}) {
  logEvent('rotate_failed', { reason, ...extra });
  console.error(`[rotate-key] FAILED: ${reason}`);
  process.exit(1);
}

function readCurrentKey() {
  try {
    return execSync(
      `security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE_CURRENT}" -w`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
      .toString()
      .trim();
  } catch (err) {
    die('Unable to read current encryption key from Keychain', { keychain_error: err.message });
  }
}

function writeKeychain(service, secret) {
  // -U = update if exists. The secret is passed on argv to `security` — that
  // is the documented mechanism for `security add-generic-password -w`. We
  // never log the value.
  try {
    execSync(
      `security add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${service}" -w ${shellEscape(secret)} -U`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    throw new Error(`Keychain write failed for service=${service}: ${err.message}`);
  }
}

function shellEscape(s) {
  // Single-quote escape for posix sh.
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function snapshotDb() {
  ensureDir(BACKUPS_DIR);
  const snapName = `pre-rekey-${tsCompact()}.db`;
  const snapPath = resolve(BACKUPS_DIR, snapName);
  copyFileSync(DB_PATH, snapPath);
  // Copy WAL / SHM sidecars if present.
  for (const ext of ['-wal', '-shm']) {
    const src = DB_PATH + ext;
    if (existsSync(src)) {
      copyFileSync(src, snapPath + ext);
    }
  }
  return snapPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const RUN_ID = `rek-${tsCompact()}`;

console.log(`[rotate-key] run_id=${RUN_ID} mode=${APPLY ? 'APPLY' : 'DRY-RUN'} db=${DB_PATH}`);

if (!existsSync(DB_PATH)) {
  die(`Database not found at ${DB_PATH}`);
}

// Load SQLCipher driver.
const require = createRequire(import.meta.url);
let Database;
try {
  Database = require('better-sqlite3-multiple-ciphers');
} catch (err) {
  die('better-sqlite3-multiple-ciphers is not installed — cannot rekey', { driver_error: err.message });
}

// Pre-flight: read current key from Keychain.
const OLD_KEY = readCurrentKey();
if (!OLD_KEY || OLD_KEY.length < 8) {
  die('Current Keychain key is empty or suspiciously short — aborting');
}

// Pre-flight: verify we can open the DB with the old key and run a probe.
let probeRowCount = null;
try {
  const probe = new Database(DB_PATH);
  probe.pragma(`key = ${shellEscape(OLD_KEY)}`);
  probe.pragma('cipher = sqlcipher');
  const row = probe.prepare('SELECT COUNT(*) AS c FROM messages').get();
  probeRowCount = row?.c ?? null;
  probe.prepare('SELECT 1').get();
  probe.close();
} catch (err) {
  die('Pre-flight probe failed — old key does not open the live DB', { probe_error: err.message });
}

const dbBytesBefore = statSync(DB_PATH).size;
const NEW_KEY_ID = `${KEYCHAIN_SERVICE_CURRENT}_v${ymd()}`;
const PREV_KEY_ID = `${KEYCHAIN_SERVICE_CURRENT}_prev_${ymd()}`;

logEvent('rotate_start', {
  messages_row_count: probeRowCount,
  db_bytes_before: dbBytesBefore,
  planned_new_key_id: NEW_KEY_ID,
  planned_prev_key_id: PREV_KEY_ID,
});

if (!APPLY) {
  // Dry-run: show the plan, do nothing.
  console.log('[rotate-key] DRY RUN — no files or Keychain entries will be modified.');
  console.log(`[rotate-key] Plan:`);
  console.log(`  1. Snapshot ${DB_PATH} → ${BACKUPS_DIR}/pre-rekey-<ts>.db`);
  console.log(`  2. Generate new 32-byte random key (base64 44 chars)`);
  console.log(`  3. PRAGMA rekey against live DB with old key open`);
  console.log(`  4. Close + re-open with new key, verify SELECT 1 and COUNT(messages)`);
  console.log(`  5. Write new key to Keychain service="${NEW_KEY_ID}"`);
  console.log(`  6. Write old key to Keychain service="${PREV_KEY_ID}" (preserve for rollback)`);
  console.log(`  7. Update canonical pointer service="${KEYCHAIN_SERVICE_CURRENT}" to new key`);
  console.log(`  8. Append rotate_success event to ${LOG_FILE}`);
  console.log(`  9. (Manual) Restart comms-hub and verify it opens the DB cleanly`);
  logEvent('dry_run', {
    messages_row_count: probeRowCount,
    db_bytes_before: dbBytesBefore,
  });
  process.exit(0);
}

// ═══ APPLY PATH ═══════════════════════════════════════════════════════════════

const startMs = Date.now();

// Step 1: Snapshot.
let snapshotPath;
try {
  snapshotPath = snapshotDb();
  console.log(`[rotate-key] snapshot written: ${basename(snapshotPath)}`);
} catch (err) {
  die(`Snapshot failed: ${err.message}`);
}

// Step 2: Generate new key.
const NEW_KEY = randomBytes(32).toString('base64');
if (NEW_KEY === OLD_KEY) {
  die('Generated key collided with old key — aborting (astronomically unlikely, but we check)');
}

// Step 3: Open with old key, run PRAGMA rekey, verify on same handle.
try {
  const db = new Database(DB_PATH);
  db.pragma(`key = ${shellEscape(OLD_KEY)}`);
  db.pragma('cipher = sqlcipher');
  // Confirm old-key open actually worked before rekeying.
  db.prepare('SELECT 1').get();
  db.pragma(`rekey = ${shellEscape(NEW_KEY)}`);
  // Verify on the same handle (same-handle verification).
  const row = db.prepare('SELECT COUNT(*) AS c FROM messages').get();
  if (row?.c == null) {
    db.close();
    die('Post-rekey same-handle verification returned null row');
  }
  db.prepare('SELECT 1').get();
  db.close();
  console.log(`[rotate-key] in-place rekey complete; same-handle COUNT=${row.c}`);
} catch (err) {
  die(`PRAGMA rekey failed: ${err.message}`, { snapshot_path: snapshotPath });
}

// Step 4: Re-open with the NEW key on a fresh handle. This proves the rekey
// actually persisted to disk and is not just cached in the old handle.
try {
  const db2 = new Database(DB_PATH);
  db2.pragma(`key = ${shellEscape(NEW_KEY)}`);
  db2.pragma('cipher = sqlcipher');
  const row = db2.prepare('SELECT COUNT(*) AS c FROM messages').get();
  db2.prepare('SELECT 1').get();
  db2.close();
  if (row?.c == null) {
    die('Fresh-handle verification with new key returned null row', { snapshot_path: snapshotPath });
  }
  if (probeRowCount != null && row.c !== probeRowCount) {
    die(
      `Row count mismatch after rekey: before=${probeRowCount} after=${row.c}`,
      { snapshot_path: snapshotPath }
    );
  }
  console.log(`[rotate-key] fresh-handle verification OK; COUNT=${row.c}`);
} catch (err) {
  die(`Fresh-handle new-key open failed: ${err.message}`, { snapshot_path: snapshotPath });
}

// Step 5 + 6: Write both the new key (versioned) and the old key (versioned
// under _prev_) BEFORE touching the canonical pointer. If either fails, the
// canonical pointer is still untouched and the hub keeps working.
try {
  writeKeychain(NEW_KEY_ID, NEW_KEY);
} catch (err) {
  die(
    `Failed to write new key to Keychain under "${NEW_KEY_ID}" — canonical pointer NOT updated`,
    { snapshot_path: snapshotPath, keychain_error: err.message }
  );
}

try {
  writeKeychain(PREV_KEY_ID, OLD_KEY);
} catch (err) {
  die(
    `Failed to preserve old key under "${PREV_KEY_ID}" — canonical pointer NOT updated`,
    { snapshot_path: snapshotPath, keychain_error: err.message }
  );
}

// Step 7: Update canonical pointer. This is the point-of-no-return for rollback
// without manual Keychain restoration.
try {
  writeKeychain(KEYCHAIN_SERVICE_CURRENT, NEW_KEY);
} catch (err) {
  die(
    `Failed to update canonical Keychain pointer "${KEYCHAIN_SERVICE_CURRENT}" — MANUAL ROLLBACK REQUIRED`,
    { snapshot_path: snapshotPath, keychain_error: err.message, prev_key_service: PREV_KEY_ID }
  );
}

// Step 8: Verify the canonical pointer now returns the new key (length-only
// check, never compare values or print them).
try {
  const current = execSync(
    `security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE_CURRENT}" -w`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
    .toString()
    .trim();
  if (current.length !== NEW_KEY.length) {
    die('Canonical pointer readback length mismatch after update', { snapshot_path: snapshotPath });
  }
} catch (err) {
  die(`Canonical pointer readback failed: ${err.message}`, { snapshot_path: snapshotPath });
}

const dbBytesAfter = statSync(DB_PATH).size;
const durationMs = Date.now() - startMs;

logEvent('rotate_success', {
  old_key_id: PREV_KEY_ID,
  new_key_id: NEW_KEY_ID,
  snapshot_path: snapshotPath,
  db_bytes_before: dbBytesBefore,
  db_bytes_after: dbBytesAfter,
  messages_row_count: probeRowCount,
  verification: `SELECT 1 OK; COUNT(messages)=${probeRowCount}`,
  duration_ms: durationMs,
  notes: 'Old key preserved under _prev_ for rollback. Do not delete for >= 30 days.',
});

console.log(`[rotate-key] SUCCESS in ${durationMs}ms`);
console.log(`[rotate-key] Next steps (manual):`);
console.log(`  1. Restart comms-hub: verify startup log shows "SQLCipher encryption active"`);
console.log(`  2. Confirm Telegram + hub health endpoints are green`);
console.log(`  3. Send Owner a rotation-complete notice on Telegram`);
console.log(`  4. Schedule old key cleanup for >= 30 days from now (NOT sooner)`);
