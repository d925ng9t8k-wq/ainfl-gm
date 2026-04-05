/**
 * backup-memory.mjs
 * Daily cold backup of 9-memory.db to local archive + Supabase Storage.
 *
 * Run schedule: daily at 03:00 ET via LaunchAgent com.9.memory-backup
 *
 * What it does:
 *   1. Exports the live SQLite DB via better-sqlite3-multiple-ciphers (handles SQLCipher encryption)
 *   2. Compresses the dump with gzip
 *   3. Saves to data/backups/ with date-stamped filename
 *   4. Uploads to Supabase Storage bucket "9-backups" via @supabase/supabase-js client
 *   5. Prunes local backups older than 30 days
 *   6. Logs result + sends Telegram alert if anything fails
 *
 * Dependencies: better-sqlite3-multiple-ciphers, @supabase/supabase-js (already installed)
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(PROJECT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      if (key && !key.startsWith('#')) process.env[key] = val;
    }
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
const DB_PATH          = path.join(PROJECT, 'data/9-memory.db');
const BACKUP_DIR       = path.join(PROJECT, 'data/backups');
const LOG_FILE         = path.join(PROJECT, 'logs/backup-memory.log');
const MAX_LOCAL_DAYS   = 30;
const SUPABASE_URL     = process.env.SUPABASE_URL;
// FORT C-02: Service key is justified here — Storage.createBucket + upload require admin scope.
// This is a legitimate use of service key. All other scripts must use anon key only.
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_BUCKET  = '9-backups';
const HUB_URL          = 'http://localhost:3457';
const ENCRYPTION_KEY   = process.env.SQLITE_ENCRYPTION_KEY || null;

// Ensure dirs exist
mkdirSync(BACKUP_DIR, { recursive: true });
mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    // Append log, keep it to ~1MB
    const logPath = LOG_FILE;
    let existing = '';
    try { existing = readFileSync(logPath, 'utf-8'); } catch {}
    const combined = existing + line;
    // Trim to last 50KB if too large
    const trimmed = combined.length > 1024 * 1024 ? combined.slice(-50 * 1024) : combined;
    writeFileSync(logPath, trimmed);
  } catch {}
}

// ─── Telegram Alert (fire-and-forget) ────────────────────────────────────────
async function alertTelegram(message) {
  try {
    await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Hub may be down — silent fail, backup still attempted
  }
}

// ─── Step 1: SQLite export via better-sqlite3-multiple-ciphers ───────────────
// Uses the same cipher library the rest of the stack uses.
// Exports all tables as SQL INSERT statements — portable, human-readable, restorable.
async function dumpDatabase(outputPath) {
  // Dynamic import — same pattern as memory-db.mjs
  let Database;
  try {
    const mod = await import('better-sqlite3-multiple-ciphers');
    Database = mod.default;
    log('Using better-sqlite3-multiple-ciphers for dump');
  } catch {
    const mod = await import('better-sqlite3');
    Database = mod.default;
    log('Fallback: using better-sqlite3 (unencrypted)');
  }

  const db = new Database(DB_PATH);
  if (ENCRYPTION_KEY) {
    db.pragma(`key = '${ENCRYPTION_KEY}'`);
    db.pragma('cipher = sqlcipher');
  }

  // Build a SQL dump: schema + data
  const lines = [];
  lines.push('-- 9 memory DB backup');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('PRAGMA journal_mode = WAL;');
  lines.push('BEGIN TRANSACTION;');

  // Schema
  const schemaRows = db.prepare(
    "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type DESC, name"
  ).all();
  for (const row of schemaRows) {
    lines.push(row.sql + ';');
  }

  // Data — iterate all tables
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);

  let totalRows = 0;
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]).map(c => `"${c}"`).join(', ');
    for (const row of rows) {
      const vals = Object.values(row).map(v => {
        if (v === null) return 'NULL';
        if (typeof v === 'number') return String(v);
        // Escape single quotes in strings
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(', ');
      lines.push(`INSERT OR IGNORE INTO "${table}" (${cols}) VALUES (${vals});`);
      totalRows++;
    }
  }

  lines.push('COMMIT;');
  db.close();

  writeFileSync(outputPath, lines.join('\n') + '\n', 'utf-8');
  log(`SQLite dump written: ${outputPath} (${totalRows} rows across ${tables.length} tables)`);
  return totalRows;
}

// ─── Step 2: Compress ────────────────────────────────────────────────────────
async function compressFile(inputPath, outputPath) {
  const data = readFileSync(inputPath);
  const compressed = gzipSync(data, { level: 9 });
  writeFileSync(outputPath, compressed);
  const inputSizeKb  = Math.round(data.length / 1024);
  const outputSizeKb = Math.round(compressed.length / 1024);
  log(`Compressed ${inputSizeKb}KB → ${outputSizeKb}KB (${outputPath})`);
  return compressed;
}

// ─── Step 3: Upload to Supabase Storage ──────────────────────────────────────
// Uses @supabase/supabase-js client — handles both legacy JWT and new sb_ key formats.
async function uploadToSupabase(filename, compressedData) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set — skipping cloud upload');
    return { ok: false, reason: 'no supabase credentials' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Ensure bucket exists
    const { error: bucketErr } = await supabase.storage.createBucket(SUPABASE_BUCKET, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });
    // "already exists" error is fine — anything else is a warning
    if (bucketErr && !bucketErr.message?.includes('already exists') && !bucketErr.message?.includes('duplicate')) {
      log(`Bucket create warning: ${bucketErr.message}`);
    }

    // Upload — upsert so re-runs on the same day overwrite cleanly
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(filename, compressedData, {
        contentType: 'application/gzip',
        upsert: true,
      });

    if (error) {
      log(`Supabase upload FAILED: ${error.message}`);
      return { ok: false, reason: error.message };
    }

    log(`Supabase upload OK: ${SUPABASE_BUCKET}/${filename} (path: ${data?.path || filename})`);
    return { ok: true, path: data?.path || filename };
  } catch (e) {
    log(`Supabase upload error: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

// ─── Step 4: Prune old local backups ─────────────────────────────────────────
function pruneLocalBackups() {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('9-memory-') && (f.endsWith('.sql.gz') || f.endsWith('.db.gz') || f.endsWith('.db')))
      .map(f => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const cutoff = new Date(Date.now() - MAX_LOCAL_DAYS * 24 * 60 * 60 * 1000);
    let pruned = 0;

    // Always keep at least 7 backups regardless of age
    const toDelete = files.slice(7).filter(f => f.mtime < cutoff);
    for (const f of toDelete) {
      unlinkSync(f.path);
      pruned++;
      log(`Pruned old backup: ${f.name}`);
    }

    log(`Local backups: ${files.length} total, ${pruned} pruned, ${Math.max(0, files.length - pruned)} retained`);
  } catch (e) {
    log(`Prune error: ${e.message}`);
  }
}

// ─── Step 5: Create symlink to latest backup ─────────────────────────────────
function updateLatestSymlink(backupPath) {
  const latestPath = path.join(BACKUP_DIR, '9-memory-LATEST.db.gz');
  try {
    // Remove old symlink if exists
    try { unlinkSync(latestPath); } catch {}
    // Create symlink pointing to the new backup
    execSync(`ln -s "${backupPath}" "${latestPath}"`);
    log(`Updated LATEST symlink → ${path.basename(backupPath)}`);
  } catch (e) {
    // Symlink failed — copy instead
    try {
      execSync(`cp "${backupPath}" "${latestPath}"`);
      log(`Updated LATEST copy (symlink failed: ${e.message})`);
    } catch {}
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  const dateStr   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr   = new Date().toISOString().slice(11, 19).replace(/:/g, ''); // HHMMSS
  const dumpFile  = path.join(BACKUP_DIR, `9-memory-${dateStr}-${timeStr}.sql`);
  const gzFile    = path.join(BACKUP_DIR, `9-memory-${dateStr}-${timeStr}.sql.gz`);

  log('=== backup-memory.mjs starting ===');
  log(`Source: ${DB_PATH}`);
  log(`Backup dir: ${BACKUP_DIR}`);

  // Verify DB exists
  if (!existsSync(DB_PATH)) {
    const msg = `ERROR: Database not found at ${DB_PATH} — backup aborted`;
    log(msg);
    await alertTelegram(`[backup] CRITICAL: ${msg}`);
    process.exit(1);
  }

  let success = true;
  let cloudResult = { ok: false, reason: 'not attempted' };

  try {
    // Step 1: Dump
    log('Step 1: Dumping SQLite database...');
    await dumpDatabase(dumpFile);

    // Step 2: Compress
    log('Step 2: Compressing...');
    const compressed = await compressFile(dumpFile, gzFile);

    // Step 3: Upload to Supabase
    log('Step 3: Uploading to Supabase Storage...');
    const filename = path.basename(gzFile);
    cloudResult = await uploadToSupabase(filename, compressed);

    // Step 4: Update LATEST symlink
    updateLatestSymlink(gzFile);

    // Step 5: Prune old backups
    log('Step 4: Pruning old backups...');
    pruneLocalBackups();

    // Clean up the uncompressed dump
    try { unlinkSync(dumpFile); } catch {}

  } catch (e) {
    success = false;
    log(`BACKUP FAILED: ${e.message}`);
    await alertTelegram(`[backup] CRITICAL: backup-memory.mjs failed — ${e.message}`);
    process.exit(1);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const cloudStatus = cloudResult.ok
    ? `cloud upload OK (${SUPABASE_BUCKET})`
    : `cloud upload FAILED: ${cloudResult.reason}`;

  const summary = `[backup] Daily backup complete in ${elapsed}s. Local: ${path.basename(gzFile)} | Cloud: ${cloudStatus}`;
  log(summary);

  // Only alert on cloud failure — success is routine
  if (!cloudResult.ok) {
    await alertTelegram(`[backup] WARNING: Local backup saved but Supabase upload failed — ${cloudResult.reason}. Data is still safe locally.`);
  }

  log('=== backup-memory.mjs complete ===');
  process.exit(0);
}

main().catch(e => {
  log(`Unhandled error: ${e.message}`);
  process.exit(1);
});
