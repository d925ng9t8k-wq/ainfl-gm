/**
 * memory-db.mjs
 * Crash-proof persistent memory for the 9 agent system.
 * Uses better-sqlite3 (synchronous, WAL mode) for reliable concurrent access.
 *
 * Database: /Users/jassonfishback/Projects/BengalOracle/data/9-memory.db
 *
 * Tables: messages, actions, authority, memory, tasks
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/9-memory.db');

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// ─── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL,
    channel   TEXT    NOT NULL,
    direction TEXT    NOT NULL,
    text      TEXT,
    read      INTEGER NOT NULL DEFAULT 0,
    metadata  TEXT    NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_channel   ON messages(channel);
  CREATE INDEX IF NOT EXISTS idx_messages_read      ON messages(read);

  CREATE TABLE IF NOT EXISTS actions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    TEXT    NOT NULL,
    action_type  TEXT    NOT NULL,
    description  TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'completed',
    metadata     TEXT    NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_actions_timestamp   ON actions(timestamp);
  CREATE INDEX IF NOT EXISTS idx_actions_action_type ON actions(action_type);
  CREATE INDEX IF NOT EXISTS idx_actions_status      ON actions(status);

  CREATE TABLE IF NOT EXISTS authority (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    permission       TEXT    NOT NULL UNIQUE,
    description      TEXT,
    granted_date     TEXT    NOT NULL,
    granted_context  TEXT,
    status           TEXT    NOT NULL DEFAULT 'active',
    last_verified    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_authority_permission ON authority(permission);
  CREATE INDEX IF NOT EXISTS idx_authority_status     ON authority(status);

  CREATE TABLE IF NOT EXISTS memory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    type        TEXT    NOT NULL,
    description TEXT,
    content     TEXT,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memory_name ON memory(name);
  CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    description  TEXT,
    status       TEXT    NOT NULL DEFAULT 'queued',
    assigned_to  TEXT    NOT NULL DEFAULT 'unassigned',
    priority     TEXT    NOT NULL DEFAULT 'medium',
    project      TEXT,
    created_at   TEXT    NOT NULL,
    started_at   TEXT,
    completed_at TEXT,
    result       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority    ON tasks(priority);

  CREATE TABLE IF NOT EXISTS decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    decision    TEXT    NOT NULL,
    context     TEXT,
    outcome     TEXT,
    session_id  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp);
`;

// ─── MemoryDB class ──────────────────────────────────────────────────────────

export class MemoryDB {
  constructor(dbPath = DB_PATH) {
    try {
      this._db = new Database(dbPath);
      this._db.exec(SCHEMA);
      this._prepareStatements();
    } catch (err) {
      console.error('[MemoryDB] Failed to initialize database:', err.message);
      throw err;
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _now() {
    return new Date().toISOString();
  }

  _safeJson(obj) {
    try {
      return JSON.stringify(obj);
    } catch {
      return '{}';
    }
  }

  _run(stmt, params = []) {
    try {
      return stmt.run(...params);
    } catch (err) {
      console.error('[MemoryDB] Run error:', err.message);
      return null;
    }
  }

  _get(stmt, params = []) {
    try {
      return stmt.get(...params);
    } catch (err) {
      console.error('[MemoryDB] Get error:', err.message);
      return null;
    }
  }

  _all(stmt, params = []) {
    try {
      return stmt.all(...params);
    } catch (err) {
      console.error('[MemoryDB] All error:', err.message);
      return [];
    }
  }

  _prepareStatements() {
    const db = this._db;

    // Messages
    this._stmts = {
      insertMessage: db.prepare(
        `INSERT INTO messages (timestamp, channel, direction, text, read, metadata)
         VALUES (?, ?, ?, ?, 0, ?)`
      ),
      getRecentMessages: db.prepare(
        `SELECT * FROM messages
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp ASC`
      ),
      getRecentMessagesByChannel: db.prepare(
        `SELECT * FROM messages
         WHERE timestamp >= datetime('now', ?)
           AND channel = ?
         ORDER BY timestamp ASC`
      ),
      getUnreadMessages: db.prepare(
        `SELECT * FROM messages WHERE read = 0 ORDER BY timestamp ASC`
      ),
      markRead: db.prepare(
        `UPDATE messages SET read = 1 WHERE id = ?`
      ),

      // Actions
      insertAction: db.prepare(
        `INSERT INTO actions (timestamp, action_type, description, status, metadata)
         VALUES (?, ?, ?, ?, ?)`
      ),
      getRecentActions: db.prepare(
        `SELECT * FROM actions
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp ASC`
      ),
      wasActionCompleted: db.prepare(
        `SELECT id FROM actions
         WHERE description = ? AND status = 'completed'
         LIMIT 1`
      ),

      // Authority
      insertAuthority: db.prepare(
        `INSERT INTO authority (permission, description, granted_date, granted_context, status, last_verified)
         VALUES (?, ?, ?, ?, 'active', ?)
         ON CONFLICT(permission) DO UPDATE SET
           description     = excluded.description,
           granted_date    = excluded.granted_date,
           granted_context = excluded.granted_context,
           status          = 'active',
           last_verified   = excluded.last_verified`
      ),
      checkAuthority: db.prepare(
        `SELECT * FROM authority WHERE permission = ? LIMIT 1`
      ),
      listAuthorities: db.prepare(
        `SELECT * FROM authority ORDER BY granted_date ASC`
      ),
      revokeAuthority: db.prepare(
        `UPDATE authority SET status = 'revoked' WHERE permission = ?`
      ),

      // Memory
      upsertMemory: db.prepare(
        `INSERT INTO memory (name, type, description, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           type        = excluded.type,
           description = excluded.description,
           content     = excluded.content,
           updated_at  = excluded.updated_at`
      ),
      getMemory: db.prepare(
        `SELECT * FROM memory WHERE name = ? LIMIT 1`
      ),
      searchMemory: db.prepare(
        `SELECT * FROM memory
         WHERE name        LIKE '%' || ? || '%'
            OR description LIKE '%' || ? || '%'
            OR content     LIKE '%' || ? || '%'
         ORDER BY updated_at DESC`
      ),
      listMemories: db.prepare(
        `SELECT * FROM memory ORDER BY updated_at DESC`
      ),
      listMemoriesByType: db.prepare(
        `SELECT * FROM memory WHERE type = ? ORDER BY updated_at DESC`
      ),
      deleteMemory: db.prepare(
        `DELETE FROM memory WHERE name = ?`
      ),

      // Tasks
      insertTask: db.prepare(
        `INSERT INTO tasks (title, description, status, assigned_to, priority, project, created_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?)`
      ),
      getTasksByStatus: db.prepare(
        `SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC`
      ),
      getTasksByAssignee: db.prepare(
        `SELECT * FROM tasks WHERE assigned_to = ? ORDER BY created_at ASC`
      ),
      getActiveTasks: db.prepare(
        `SELECT * FROM tasks
         WHERE status IN ('queued', 'in_progress', 'blocked')
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 1
             WHEN 'high'     THEN 2
             WHEN 'medium'   THEN 3
             WHEN 'low'      THEN 4
             ELSE 5
           END,
           created_at ASC`
      ),
      completeTask: db.prepare(
        `UPDATE tasks
         SET status = 'completed', completed_at = ?, result = ?
         WHERE id = ?`
      ),
      updateTaskStatus: db.prepare(
        `UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`
      ),

      // Decisions
      insertDecision: db.prepare(
        `INSERT INTO decisions (timestamp, decision, context, outcome, session_id)
         VALUES (?, ?, ?, ?, ?)`
      ),
      getRecentDecisions: db.prepare(
        `SELECT * FROM decisions
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp DESC`
      ),
      searchDecisions: db.prepare(
        `SELECT * FROM decisions
         WHERE decision LIKE '%' || ? || '%'
            OR context  LIKE '%' || ? || '%'
         ORDER BY timestamp DESC`
      ),

      // Context rebuild
      getRecentMessagesForContext: db.prepare(
        `SELECT * FROM messages
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp ASC`
      ),
      getRecentActionsForContext: db.prepare(
        `SELECT * FROM actions
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp ASC`
      ),
      getAllActiveAuthority: db.prepare(
        `SELECT * FROM authority WHERE status = 'active' ORDER BY granted_date ASC`
      ),
    };
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  /**
   * Log an inbound or outbound message.
   * @param {string} channel - telegram | imessage | email | voice
   * @param {string} direction - in | out
   * @param {string} text
   * @param {object} metadata
   * @returns {number|null} inserted row id
   */
  logMessage(channel, direction, text, metadata = {}) {
    const result = this._run(this._stmts.insertMessage, [
      this._now(),
      channel,
      direction,
      text,
      this._safeJson(metadata),
    ]);
    return result?.lastInsertRowid ?? null;
  }

  /**
   * Get messages from the last N hours, optionally filtered by channel.
   * @param {number} hours
   * @param {string|null} channel
   * @returns {object[]}
   */
  getRecentMessages(hours = 24, channel = null) {
    const interval = `-${hours} hours`;
    if (channel) {
      return this._all(this._stmts.getRecentMessagesByChannel, [interval, channel]);
    }
    return this._all(this._stmts.getRecentMessages, [interval]);
  }

  /**
   * Get all unread messages.
   * @returns {object[]}
   */
  getUnreadMessages() {
    return this._all(this._stmts.getUnreadMessages);
  }

  /**
   * Mark a message as read.
   * @param {number} id
   */
  markRead(id) {
    this._run(this._stmts.markRead, [id]);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Log a completed (or attempted) action.
   * @param {string} action_type - send | deploy | purchase | config | etc.
   * @param {string} description - human-readable description (used for dedup)
   * @param {string} status - completed | failed | pending
   * @param {object} metadata
   * @returns {number|null} inserted row id
   */
  logAction(action_type, description, status = 'completed', metadata = {}) {
    const result = this._run(this._stmts.insertAction, [
      this._now(),
      action_type,
      description,
      status,
      this._safeJson(metadata),
    ]);
    return result?.lastInsertRowid ?? null;
  }

  /**
   * Get actions from the last N hours.
   * @param {number} hours
   * @returns {object[]}
   */
  getRecentActions(hours = 24) {
    const interval = `-${hours} hours`;
    return this._all(this._stmts.getRecentActions, [interval]);
  }

  /**
   * Check whether an action with this exact description was already completed.
   * Use this before sending messages or deploying to prevent duplicates across crashes.
   * @param {string} description
   * @returns {boolean}
   */
  wasActionCompleted(description) {
    const row = this._get(this._stmts.wasActionCompleted, [description]);
    return row !== null && row !== undefined;
  }

  // ── Authority ──────────────────────────────────────────────────────────────

  /**
   * Grant (or re-grant) an authority permission.
   * Uses upsert — safe to call multiple times for the same permission.
   * @param {string} permission - e.g. "deploy_without_asking"
   * @param {string} description - what this permission covers
   * @param {string} context - conversation excerpt or note about when it was granted
   */
  grantAuthority(permission, description, context = '') {
    const now = this._now();
    this._run(this._stmts.insertAuthority, [
      permission,
      description,
      now,
      context,
      now,
    ]);
  }

  /**
   * Check whether a permission is currently active.
   * @param {string} permission
   * @returns {{ authorized: boolean, details: string }}
   */
  checkAuthority(permission) {
    const row = this._get(this._stmts.checkAuthority, [permission]);
    if (!row) {
      return { authorized: false, details: `No record found for permission: ${permission}` };
    }
    if (row.status !== 'active') {
      return { authorized: false, details: `Permission "${permission}" is ${row.status} (was: ${row.description})` };
    }
    return {
      authorized: true,
      details: `Active since ${row.granted_date}. ${row.description}`,
    };
  }

  /**
   * List all authority records.
   * @returns {object[]}
   */
  listAuthorities() {
    return this._all(this._stmts.listAuthorities);
  }

  /**
   * Revoke an authority permission.
   * @param {string} permission
   */
  revokeAuthority(permission) {
    this._run(this._stmts.revokeAuthority, [permission]);
  }

  // ── Memory ─────────────────────────────────────────────────────────────────

  /**
   * Save or update a named memory entry.
   * @param {string} name - unique key
   * @param {string} type - user | feedback | project | reference | contact
   * @param {string} description - one-line summary
   * @param {string} content - full content
   */
  saveMemory(name, type, description, content) {
    const now = this._now();
    this._run(this._stmts.upsertMemory, [name, type, description, content, now, now]);
  }

  /**
   * Retrieve a memory entry by name.
   * @param {string} name
   * @returns {object|null}
   */
  getMemory(name) {
    return this._get(this._stmts.getMemory, [name]);
  }

  /**
   * Full-text search across name, description, and content fields.
   * @param {string} query
   * @returns {object[]}
   */
  searchMemory(query) {
    return this._all(this._stmts.searchMemory, [query, query, query]);
  }

  /**
   * List all memory entries, optionally filtered by type.
   * @param {string|null} type
   * @returns {object[]}
   */
  listMemories(type = null) {
    if (type) {
      return this._all(this._stmts.listMemoriesByType, [type]);
    }
    return this._all(this._stmts.listMemories);
  }

  /**
   * Delete a memory entry by name.
   * @param {string} name
   */
  deleteMemory(name) {
    this._run(this._stmts.deleteMemory, [name]);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  /**
   * Create a new task.
   * @param {string} title
   * @param {string} description
   * @param {string} assignedTo - 9 | UNO | Tee | Money | Trinity | unassigned
   * @param {string} priority - critical | high | medium | low
   * @param {string} project - which company/initiative
   * @returns {number|null} inserted row id
   */
  createTask(title, description, assignedTo = 'unassigned', priority = 'medium', project = '') {
    const result = this._run(this._stmts.insertTask, [
      title,
      description,
      assignedTo,
      priority,
      project,
      this._now(),
    ]);
    return result?.lastInsertRowid ?? null;
  }

  /**
   * Update arbitrary fields on a task.
   * Only updates fields present in the `updates` object.
   * Allowed fields: title, description, status, assigned_to, priority, project, started_at, result
   * @param {number} id
   * @param {object} updates
   */
  updateTask(id, updates) {
    const allowed = ['title', 'description', 'status', 'assigned_to', 'priority', 'project', 'started_at', 'result'];
    const fields = Object.keys(updates).filter(k => allowed.includes(k));
    if (fields.length === 0) return;

    // If setting status to in_progress and no started_at, auto-set it
    if (updates.status === 'in_progress' && !updates.started_at) {
      if (!fields.includes('started_at')) {
        fields.push('started_at');
        updates.started_at = this._now();
      }
    }

    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);

    try {
      const stmt = this._db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`);
      stmt.run(...values);
    } catch (err) {
      console.error('[MemoryDB] updateTask error:', err.message);
    }
  }

  /**
   * Get tasks by status.
   * @param {string} status - queued | in_progress | completed | failed | blocked
   * @returns {object[]}
   */
  getTasksByStatus(status) {
    return this._all(this._stmts.getTasksByStatus, [status]);
  }

  /**
   * Get tasks by assignee.
   * @param {string} assignee
   * @returns {object[]}
   */
  getTasksByAssignee(assignee) {
    return this._all(this._stmts.getTasksByAssignee, [assignee]);
  }

  /**
   * Get all active tasks (queued, in_progress, blocked), sorted by priority.
   * @returns {object[]}
   */
  getActiveTasks() {
    return this._all(this._stmts.getActiveTasks);
  }

  /**
   * Mark a task complete with an optional result summary.
   * @param {number} id
   * @param {string} result
   */
  completeTask(id, result = '') {
    this._run(this._stmts.completeTask, [this._now(), result, id]);
  }

  // ── Decisions ──────────────────────────────────────────────────────────────

  /**
   * Log a decision made by the agent (alias matches Pillar 1 spec).
   * @param {string} decision - what was decided
   * @param {string} context - why, what info was available
   * @param {string} outcome - result, if known at log time
   * @param {string} sessionId - optional session identifier
   * @returns {number|null} inserted row id
   */
  logDecision(decision, context = '', outcome = '', sessionId = '') {
    const result = this._run(this._stmts.insertDecision, [
      this._now(),
      decision,
      context,
      outcome,
      sessionId,
    ]);
    return result?.lastInsertRowid ?? null;
  }

  /**
   * Alias: logConversation maps to logMessage.
   * Matches the Pillar 1 spec interface.
   * @param {string} message
   * @param {string} direction - in | out
   * @param {string} channel - telegram | imessage | email | voice
   * @param {object} metadata
   * @returns {number|null} inserted row id
   */
  logConversation(message, direction, channel, metadata = {}) {
    return this.logMessage(channel, direction, message, metadata);
  }

  /**
   * Alias: getAuthorityRule maps to checkAuthority.
   * Matches the Pillar 1 spec interface.
   * @param {string} action - the action type to check
   * @returns {{ authorized: boolean, details: string }}
   */
  getAuthorityRule(action) {
    return this.checkAuthority(action);
  }

  // ── Context rebuild ────────────────────────────────────────────────────────

  /**
   * Build a full context snapshot for session startup.
   * Returns recent messages, recent actions, active authorities, and active tasks.
   * @param {number} hours - how far back to look for messages and actions
   * @returns {object}
   */
  rebuildContext(hours = 24) {
    const interval = `-${hours} hours`;
    try {
      return {
        generated_at: this._now(),
        window_hours: hours,
        messages: this._all(this._stmts.getRecentMessagesForContext, [interval]),
        actions: this._all(this._stmts.getRecentActionsForContext, [interval]),
        authorities: this._all(this._stmts.getAllActiveAuthority),
        active_tasks: this._all(this._stmts.getActiveTasks),
      };
    } catch (err) {
      console.error('[MemoryDB] rebuildContext error:', err.message);
      return {
        generated_at: this._now(),
        window_hours: hours,
        messages: [],
        actions: [],
        authorities: [],
        active_tasks: [],
        error: err.message,
      };
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Close the database connection. Call this on graceful shutdown.
   */
  close() {
    try {
      this._db.close();
    } catch (err) {
      console.error('[MemoryDB] Close error:', err.message);
    }
  }
}

// Singleton — import this throughout the system
export const db = new MemoryDB();
