/**
 * memory-archive.mjs
 * Daily archival of old health_events and audit_log rows.
 * Hot retention: 90 days in data/9-memory.db (encrypted)
 * Cold retention: indefinite in data/9-memory-cold.db (plain, no encryption — future hardening)
 *
 * Usage:
 *   node scripts/memory-archive.mjs            # 90-day cutoff (production)
 *   node scripts/memory-archive.mjs --days=1   # 1-day cutoff (testing)
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOT_DB_PATH  = resolve(__dirname, '../data/9-memory.db');
const COLD_DB_PATH = resolve(__dirname, '../data/9-memory-cold.db');

// DOC fix: Load encryption key from macOS Keychain first (same as memory-db.mjs).
// LaunchAgent context lacks .env, so env-only loading caused SQLITE_NOTADB errors.
function loadEncryptionKey() {
  try {
    const key = execSync(
      'security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w',
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    if (key) {
      console.log('[archive] Encryption key loaded from macOS Keychain');
      return key;
    }
  } catch {
    // Keychain not available — fall through to env var
  }
  const envKey = process.env.SQLITE_ENCRYPTION_KEY || null;
  if (envKey) console.log('[archive] Encryption key loaded from env var (Keychain fallback)');
  return envKey;
}

const ENCRYPTION_KEY = loadEncryptionKey();

// Parse --days flag
const daysArg = process.argv.find(a => a.startsWith('--days='));
const RETENTION_DAYS = daysArg ? parseInt(daysArg.split('=')[1]) : 90;

const require = createRequire(import.meta.url);
let Database;
try {
  Database = require('better-sqlite3-multiple-ciphers');
} catch {
  Database = require('better-sqlite3');
  console.log('[archive] better-sqlite3-multiple-ciphers not available — falling back to plain better-sqlite3');
}

const TABLES_TO_ARCHIVE = ['health_events', 'audit_log'];

console.log(`=== Memory Archive (retention=${RETENTION_DAYS} days) ===`);
console.log(`Hot DB:  ${HOT_DB_PATH}`);
console.log(`Cold DB: ${COLD_DB_PATH}`);
console.log(`Cutoff:  rows older than ${RETENTION_DAYS} days`);

// ─── Open hot DB (encrypted) ─────────────────────────────────────────────────
const hotDb = new Database(HOT_DB_PATH);
if (ENCRYPTION_KEY) {
  hotDb.pragma(`key = '${ENCRYPTION_KEY}'`);
  hotDb.pragma('cipher = sqlcipher');
}

// ─── Open/create cold DB (plain — cold archive, encryption is a future hardening) ─
const coldDb = new Database(COLD_DB_PATH);
coldDb.pragma('journal_mode = WAL');

// Ensure cold DB has the same schema for archived tables
coldDb.exec(`
  CREATE TABLE IF NOT EXISTS health_events (
    id            INTEGER PRIMARY KEY,
    timestamp     TEXT    NOT NULL,
    component     TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    metric_name   TEXT    NOT NULL,
    metric_value  TEXT,
    severity      TEXT    NOT NULL DEFAULT 'info',
    message       TEXT,
    signature     TEXT    NOT NULL,
    event_count   INTEGER NOT NULL DEFAULT 1,
    last_seen     TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY,
    timestamp    TEXT    NOT NULL,
    actor        TEXT    NOT NULL,
    action       TEXT    NOT NULL,
    table_name   TEXT    NOT NULL,
    record_id    TEXT,
    details_json TEXT    NOT NULL DEFAULT '{}',
    session_id   TEXT
  );
`);

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
const cutoffISO = cutoffDate.toISOString();

let totalArchived = 0;
let totalDeleted = 0;

for (const table of TABLES_TO_ARCHIVE) {
  // Check the table exists in hot DB (audit_log may not exist on older installs)
  const tableExists = hotDb.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table);
  if (!tableExists) {
    console.log(`  ${table}: table not found in hot DB — skipping`);
    continue;
  }

  // Get rows older than retention cutoff
  const oldRows = hotDb.prepare(
    `SELECT * FROM ${table} WHERE timestamp < ? ORDER BY timestamp ASC`
  ).all(cutoffISO);

  if (oldRows.length === 0) {
    console.log(`  ${table}: 0 rows older than ${RETENTION_DAYS} days — nothing to archive`);
    continue;
  }

  console.log(`  ${table}: archiving ${oldRows.length} rows...`);

  // Get columns for INSERT
  const cols = Object.keys(oldRows[0]);
  const placeholders = cols.map(() => '?').join(', ');
  const insertCold = coldDb.prepare(
    `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
  );

  // Archive to cold DB in one transaction
  const archiveTxn = coldDb.transaction((rows) => {
    for (const row of rows) {
      insertCold.run(...cols.map(c => row[c]));
    }
  });
  archiveTxn(oldRows);

  // Verify cold DB received them
  const coldCount = coldDb.prepare(`SELECT count(*) as c FROM ${table} WHERE timestamp < ?`).get(cutoffISO).c;
  console.log(`  ${table}: ${coldCount}/${oldRows.length} rows confirmed in cold DB`);

  if (coldCount === oldRows.length) {
    // Safe to delete from hot DB
    const deleteTxn = hotDb.transaction(() => {
      hotDb.prepare(`DELETE FROM ${table} WHERE timestamp < ?`).run(cutoffISO);
    });
    deleteTxn();
    const afterCount = hotDb.prepare(`SELECT count(*) as c FROM ${table}`).get().c;
    console.log(`  ${table}: deleted from hot DB. Remaining: ${afterCount} rows`);
    totalArchived += oldRows.length;
    totalDeleted += oldRows.length;
  } else {
    console.error(`  ${table}: MISMATCH — cold has ${coldCount}, expected ${oldRows.length}. Hot DB NOT modified.`);
  }
}

hotDb.close();
coldDb.close();

console.log(`=== Archive complete ===`);
console.log(`Total archived: ${totalArchived} rows`);
console.log(`Total deleted from hot: ${totalDeleted} rows`);
console.log(`Cold DB: ${COLD_DB_PATH}`);
