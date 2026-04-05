/**
 * migrate-db-to-sqlcipher.mjs
 * One-shot migration: encrypts data/9-memory.db with SQLCipher.
 * Run once. Backs up original to data/9-memory.db.pre-sqlcipher-backup
 * Usage: node scripts/migrate-db-to-sqlcipher.mjs
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { copyFileSync, chmodSync, existsSync, renameSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/9-memory.db');
const BACKUP_PATH = resolve(__dirname, '../data/9-memory.db.pre-sqlcipher-backup');
const ENCRYPTED_PATH = resolve(__dirname, '../data/9-memory.db.encrypted-tmp');
const ENCRYPTION_KEY = process.env.SQLITE_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.error('ERROR: SQLITE_ENCRYPTION_KEY not set in .env');
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error(`ERROR: Database not found at ${DB_PATH}`);
  process.exit(1);
}

// Dynamic imports — after npm install these should be available
const { default: BetterSqlite3 } = await import('better-sqlite3');
const { default: CipherSqlite3 } = await import('better-sqlite3-multiple-ciphers');

console.log('=== SQLCipher Migration ===');

// 1. Open the original unencrypted DB and count all rows
const srcDb = new BetterSqlite3(DB_PATH, { readonly: true });
const tables = srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
const beforeCounts = {};
for (const t of tables) {
  try { beforeCounts[t] = srcDb.prepare(`SELECT count(*) as c FROM ${t}`).get().c; }
  catch { beforeCounts[t] = 0; }
}
console.log('Source row counts:', JSON.stringify(beforeCounts, null, 2));

// 2. Dump all data to SQL text
console.log('Dumping source database to SQL...');
const sqlDump = [];

// Get schema
const schemaRows = srcDb.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type DESC, name").all();
for (const row of schemaRows) {
  sqlDump.push(row.sql + ';');
}

// Get data
for (const table of tables) {
  const rows = srcDb.prepare(`SELECT * FROM ${table}`).all();
  for (const row of rows) {
    const cols = Object.keys(row);
    const vals = cols.map(c => {
      const v = row[c];
      if (v === null) return 'NULL';
      if (typeof v === 'number') return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    sqlDump.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
  }
  if (rows.length > 0) console.log(`  ${table}: ${rows.length} rows dumped`);
}
srcDb.close();

// 3. Create new encrypted DB — must be a FRESH file (delete if exists from prior failed run)
if (existsSync(ENCRYPTED_PATH)) {
  console.log(`Removing stale temp file ${ENCRYPTED_PATH}...`);
  const { unlinkSync } = await import('fs');
  unlinkSync(ENCRYPTED_PATH);
  for (const ext of ['-shm', '-wal']) {
    try { (await import('fs')).unlinkSync(ENCRYPTED_PATH + ext); } catch {}
  }
}
console.log(`Creating encrypted database at ${ENCRYPTED_PATH}...`);
const encDb = new CipherSqlite3(ENCRYPTED_PATH);
encDb.pragma(`key = '${ENCRYPTION_KEY}'`);
encDb.pragma('cipher = sqlcipher');
encDb.pragma('journal_mode = WAL');

// Execute all SQL
encDb.exec('BEGIN;');
for (const sql of sqlDump) {
  try { encDb.exec(sql); } catch (e) {
    // Skip duplicate index creation etc
    if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
      console.warn(`  SQL warning: ${e.message.slice(0, 100)} — sql: ${sql.slice(0, 80)}`);
    }
  }
}
encDb.exec('COMMIT;');

// 4. Verify row counts match exactly
console.log('Verifying row counts in encrypted DB...');
const afterCounts = {};
for (const t of tables) {
  try { afterCounts[t] = encDb.prepare(`SELECT count(*) as c FROM ${t}`).get().c; }
  catch { afterCounts[t] = 0; }
}
console.log('Encrypted row counts:', JSON.stringify(afterCounts, null, 2));

encDb.close();

// Compare — exclude sqlite_sequence (SQLite internal autoincrement tracker;
// count differs because encrypted DB initializes entries for all AUTOINCREMENT tables)
const EXCLUDE_FROM_CHECK = new Set(['sqlite_sequence']);
let allMatch = true;
for (const t of tables) {
  if (EXCLUDE_FROM_CHECK.has(t)) {
    console.log(`  ${t}: skipped (SQLite internal — count difference expected)`);
    continue;
  }
  if (beforeCounts[t] !== afterCounts[t]) {
    console.error(`MISMATCH: ${t} — before=${beforeCounts[t]}, after=${afterCounts[t]}`);
    allMatch = false;
  }
}
if (!allMatch) {
  console.error('Row count mismatch — aborting swap. Check manually.');
  process.exit(1);
}
console.log('All row counts match.');

// 5. Swap files — backup original, move encrypted to production path
console.log(`Backing up original to ${BACKUP_PATH}...`);
copyFileSync(DB_PATH, BACKUP_PATH);
chmodSync(BACKUP_PATH, 0o600); // chmod 600 — owner-only

console.log(`Swapping encrypted DB into place...`);
renameSync(ENCRYPTED_PATH, DB_PATH);

// Also rename WAL/SHM if they exist (they won't matter after swap but clean up)
for (const ext of ['-shm', '-wal']) {
  const encExtra = ENCRYPTED_PATH + ext;
  const dbExtra = DB_PATH + ext;
  if (existsSync(encExtra)) {
    try { renameSync(encExtra, dbExtra); } catch {}
  }
}

console.log('=== Migration complete ===');
console.log(`Original backed up to: ${BACKUP_PATH} (chmod 600)`);
console.log(`Encrypted DB in place: ${DB_PATH}`);
console.log('Next: restart comms-hub and health-monitor to pick up the new DB handle.');
