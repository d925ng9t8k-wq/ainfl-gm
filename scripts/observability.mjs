/**
 * 9 — Structured Observability Layer
 *
 * Replaces flat text logging with structured JSON events.
 * Drop-in module — no dependencies beyond Node.js builtins.
 * Log file: logs/structured-events.jsonl (append-only, one JSON object per line)
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = path.join(PROJECT, 'logs', 'structured-events.jsonl');

const VALID_CATEGORIES = new Set([
  'telegram', 'imessage', 'email', 'voice', 'agent', 'system', 'error'
]);

// ─── Session state (in-memory, resets on process restart) ────────────────────

const SESSION_START = Date.now();
const _events = []; // circular buffer — last 1000 events
const MAX_BUFFER = 1000;

let _totalEvents = 0;
let _totalErrors = 0;
let _totalDurationMs = 0;
let _durationCount = 0;

// ─── Ensure log directory exists ─────────────────────────────────────────────

const logsDir = path.join(PROJECT, 'logs');
if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * logEvent(category, action, data)
 *
 * Writes a structured JSON log entry and updates session metrics.
 *
 * @param {string} category  - One of: telegram|imessage|email|voice|agent|system|error
 * @param {string} action    - Short descriptor (e.g. 'message_received', 'send_failed')
 * @param {object} data      - Optional payload: { outcome, durationMs, ...extra }
 *                             outcome: 'success' | 'error' | 'skipped' (default: 'success')
 *                             durationMs: number (ms elapsed for the operation)
 */
export function logEvent(category, action, data = {}) {
  const { outcome = 'success', durationMs, ...extra } = data;

  if (!VALID_CATEGORIES.has(category)) {
    // Still log it but flag the unknown category
    extra._unknownCategory = category;
  }

  const entry = {
    ts: new Date().toISOString(),
    category,
    action,
    outcome,
    ...(durationMs !== undefined && { durationMs }),
    ...(Object.keys(extra).length > 0 && { data: extra }),
  };

  // Persist to disk
  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Silently absorb write errors — never let observability crash the hub
    process.stderr.write(`[observability] write error: ${err.message}\n`);
  }

  // Update in-memory metrics
  _totalEvents++;
  if (outcome === 'error' || category === 'error') _totalErrors++;
  if (typeof durationMs === 'number' && durationMs >= 0) {
    _totalDurationMs += durationMs;
    _durationCount++;
  }

  // Update circular buffer
  if (_events.length >= MAX_BUFFER) _events.shift();
  _events.push(entry);

  return entry;
}

/**
 * getMetrics()
 *
 * Returns current session metrics snapshot.
 */
export function getMetrics() {
  return {
    uptimeMs: Date.now() - SESSION_START,
    totalEvents: _totalEvents,
    totalErrors: _totalErrors,
    errorRate: _totalEvents > 0 ? (_totalErrors / _totalEvents) : 0,
    avgResponseMs: _durationCount > 0 ? Math.round(_totalDurationMs / _durationCount) : null,
    bufferedEvents: _events.length,
  };
}

/**
 * getRecentEvents(n)
 *
 * Returns the last N events from the in-memory buffer (most recent last).
 * Capped at MAX_BUFFER (1000).
 */
export function getRecentEvents(n = 10) {
  const count = Math.min(Math.max(0, n), _events.length);
  return _events.slice(_events.length - count);
}
