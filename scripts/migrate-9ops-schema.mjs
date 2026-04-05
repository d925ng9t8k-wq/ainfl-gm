/**
 * migrate-9ops-schema.mjs
 * One-time schema migration: adds 9-Ops tables to data/9-memory.db.
 *
 * Tables added:
 *   9ops_task_queue       — IPC between 9 and 9-Ops
 *   9ops_push_notifications — push channel from 9-Ops to 9
 *   owner_reply_lock       — single-row mutex ensuring only 9 speaks to Owner
 *
 * Idempotent — safe to run multiple times. Uses CREATE TABLE IF NOT EXISTS.
 *
 * Usage:
 *   node scripts/migrate-9ops-schema.mjs
 */

import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');
const DB_PATH   = path.join(PROJECT, 'data/9-memory.db');

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

// ─── Load encryption key (mirrors memory-db.mjs pattern) ─────────────────────
function loadEncryptionKey() {
  try {
    const key = execSync(
      'security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w',
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    if (key) return key;
  } catch {}
  return process.env.SQLITE_ENCRYPTION_KEY || null;
}

// ─── SQLite ──────────────────────────────────────────────────────────────────
const _require = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3-multiple-ciphers');
  console.log('[migrate] Using better-sqlite3-multiple-ciphers');
} catch {
  Database = _require('better-sqlite3');
  console.log('[migrate] Using better-sqlite3 (no cipher)');
}

const ENCRYPTION_KEY = loadEncryptionKey();

const db = new Database(DB_PATH);
if (ENCRYPTION_KEY) {
  db.pragma(`key = '${ENCRYPTION_KEY}'`);
  db.pragma('cipher = sqlcipher');
  console.log('[migrate] SQLCipher encryption applied');
}
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA_9OPS = `
  -- ──────────────────────────────────────────────────────────────────────────
  -- 9ops_task_queue
  -- IPC channel between 9 and 9-Ops.
  -- 9 writes rows with status='pending'. 9-Ops picks them up, sets
  -- status='in_progress', executes, then sets status='done' or 'failed'.
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS "9ops_task_queue" (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    status          TEXT    NOT NULL DEFAULT 'pending',
    -- status values: pending | in_progress | done | failed | cancelled
    priority        TEXT    NOT NULL DEFAULT 'medium',
    -- priority values: critical | high | medium | low
    model_hint      TEXT    NOT NULL DEFAULT 'sonnet',
    -- model_hint: 'opus' | 'sonnet' — 9-Ops selects actual model ID from this
    request_from    TEXT    NOT NULL DEFAULT '9',
    -- who queued it: always '9' in Phase 1
    title           TEXT    NOT NULL,
    request_payload TEXT    NOT NULL DEFAULT '{}',
    -- JSON: { task, context, files, constraints, ... }
    response_payload TEXT,
    -- JSON: { result, summary, files_changed, ... }
    error_detail    TEXT,
    -- populated on status='failed'
    picked_up_at    TEXT,
    -- timestamp when 9-Ops set status to in_progress
    completed_at    TEXT,
    -- timestamp when 9-Ops set status to done/failed
    session_id      TEXT
    -- 9-Ops session identifier for multi-turn task tracing
  );

  CREATE INDEX IF NOT EXISTS idx_9ops_queue_status     ON "9ops_task_queue"(status);
  CREATE INDEX IF NOT EXISTS idx_9ops_queue_created_at ON "9ops_task_queue"(created_at);
  CREATE INDEX IF NOT EXISTS idx_9ops_queue_priority   ON "9ops_task_queue"(priority);

  -- ──────────────────────────────────────────────────────────────────────────
  -- 9ops_push_notifications
  -- Push channel from 9-Ops to 9. 9-Ops writes; 9 reads via PostToolUse hook.
  -- Severity tags: BLOCKER | DECISION | MILESTONE | RISK | DONE | STATUS
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS "9ops_push_notifications" (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    severity            TEXT    NOT NULL DEFAULT 'STATUS',
    -- BLOCKER | DECISION | MILESTONE | RISK | DONE | STATUS
    tag                 TEXT    NOT NULL DEFAULT 'STATUS',
    task_id             INTEGER,
    -- FK to 9ops_task_queue.id (nullable — some pushes are not task-bound)
    message             TEXT    NOT NULL,
    -- full push notification text, pre-formatted for 9 to relay
    acknowledged_by_9   INTEGER NOT NULL DEFAULT 0,
    -- 0 = unread, 1 = 9 has seen and processed
    acknowledged_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_9ops_push_created_at    ON "9ops_push_notifications"(created_at);
  CREATE INDEX IF NOT EXISTS idx_9ops_push_acknowledged  ON "9ops_push_notifications"(acknowledged_by_9);
  CREATE INDEX IF NOT EXISTS idx_9ops_push_severity      ON "9ops_push_notifications"(severity);

  -- ──────────────────────────────────────────────────────────────────────────
  -- owner_reply_lock
  -- Single-row mutex. Only 9 acquires this before sending to Owner.
  -- 9-Ops NEVER acquires this lock. Enforced by SQLite transaction.
  -- ──────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS owner_reply_lock (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    -- exactly one row, always id=1
    locked_by   TEXT    NOT NULL DEFAULT 'none',
    -- '9' when locked, 'none' when free
    locked_at   TEXT,
    message_id  TEXT,
    -- the Owner message ID this lock covers (for audit)
    session_id  TEXT
    -- which 9 session holds the lock
  );

  -- Seed the single row if it doesn't exist
  INSERT OR IGNORE INTO owner_reply_lock (id, locked_by) VALUES (1, 'none');

  CREATE INDEX IF NOT EXISTS idx_owner_reply_lock_locked_by ON owner_reply_lock(locked_by);
`;

// ─── Execute ──────────────────────────────────────────────────────────────────
console.log('[migrate] Applying 9-Ops schema...');
db.exec(SCHEMA_9OPS);
console.log('[migrate] Schema applied successfully');

// ─── Verify ──────────────────────────────────────────────────────────────────
const tables = ['9ops_task_queue', '9ops_push_notifications', 'owner_reply_lock'];
for (const t of tables) {
  const row = db.prepare(`SELECT count(*) AS c FROM "${t}"`).get();
  console.log(`[migrate] Table "${t}" exists — ${row.c} row(s)`);
}

const lockRow = db.prepare('SELECT * FROM owner_reply_lock WHERE id=1').get();
console.log('[migrate] owner_reply_lock seed row:', lockRow);

db.close();
console.log('[migrate] Done. 9-Ops schema is live.');
