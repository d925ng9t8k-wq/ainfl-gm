#!/usr/bin/env node
/**
 * your9-webhooks.mjs — Webhook & Event System (External Integration Layer)
 * Your9 by 9 Enterprises
 *
 * Turns Your9 into a true platform. External tools subscribe to Your9 events
 * via webhooks. When something happens inside Your9, all subscribed endpoints
 * receive a signed HTTP POST in real time.
 *
 * Storage layout:
 *   instances/{id}/config/webhooks.json    — Webhook registry
 *   instances/{id}/data/events/            — Event history (one file per event)
 *     {timestamp}-{eventId}.json
 *
 * Webhook payload format:
 *   {
 *     "id":          "evt_...",
 *     "event":       "task_completed",
 *     "instanceId":  "customer-abc",
 *     "occurredAt":  "ISO",
 *     "payload":     { ...event-specific data }
 *   }
 *
 * HMAC signing:
 *   X-Your9-Signature: sha256=<hex>
 *   Signed over: raw JSON body bytes
 *   Key: the webhook's per-subscription secret
 *
 * Retry policy:
 *   Attempt 1: immediate
 *   Attempt 2: 1 second delay
 *   Attempt 3: 5 second delay
 *   Attempt 4: 30 second delay
 *   After 4 failures: webhook marked as failed, status recorded in history
 *
 * Port: 3495 (webhook management API)
 *
 * Usage:
 *   node scripts/your9-webhooks.mjs
 *   node scripts/your9-webhooks.mjs --instance <customer-id>
 *   node scripts/your9-webhooks.mjs --instance <id> --list
 *   node scripts/your9-webhooks.mjs --instance <id> --history [--limit 20]
 *
 * Exports (for use by other Your9 scripts):
 *   emitEvent(instanceDir, eventType, payload)   — Fire an event
 *   registerWebhook(instanceDir, options)         — Add a new webhook
 *   listWebhooks(instanceDir)                     — Get all webhooks
 *   getEventHistory(instanceDir, opts)            — Query event history
 */

import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, appendFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHmac, createHash, randomBytes } from 'crypto';
import { createServer } from 'http';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOG_FILE = join(ROOT, 'logs', 'your9-webhooks.log');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEBHOOK_PORT = 3495;
const WEBHOOK_HOST = '127.0.0.1';
const API_VERSION = 'v1';

/** All valid event types. */
const VALID_EVENTS = new Set([
  'task_completed',
  'task_delegated',
  'decision_made',
  'email_sent',
  'research_completed',
  'social_posted',
  'goal_achieved',
  'agent_added',
  'briefing_sent',
  'initiative_proposed',
]);

/** Retry delay schedule in milliseconds. */
const RETRY_DELAYS_MS = [0, 1000, 5000, 30000];

/** Max events returned from history by default. */
const DEFAULT_HISTORY_LIMIT = 50;

/** Max HTTP response body to read from webhook target (bytes). */
const MAX_RESPONSE_BODY = 4096;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ensureLogDir() {
  const dir = join(ROOT, 'logs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] WEBHOOKS: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Instance directory resolver
// ---------------------------------------------------------------------------

function resolveInstanceDir(instanceId) {
  return join(INSTANCES_DIR, instanceId);
}

function ensureInstanceDir(instanceDir) {
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  mkdirSync(join(instanceDir, 'data', 'events'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Webhook registry
//
// File: instances/{id}/config/webhooks.json
// [
//   {
//     "id":         "wh_...",
//     "url":        "https://...",
//     "secret":     "whsec_...",     // used for HMAC signing
//     "events":     ["task_completed", ...],   // subscribed events, or ["*"]
//     "active":     true,
//     "label":      "My Zapier hook",
//     "createdAt":  "ISO",
//     "lastFiredAt": "ISO|null",
//     "successCount": 0,
//     "failureCount": 0
//   }
// ]
// ---------------------------------------------------------------------------

function webhooksPath(instanceDir) {
  return join(instanceDir, 'config', 'webhooks.json');
}

function loadWebhooks(instanceDir) {
  const p = webhooksPath(instanceDir);
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return []; }
}

function saveWebhooks(instanceDir, webhooks) {
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  writeFileSync(webhooksPath(instanceDir), JSON.stringify(webhooks, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

/**
 * Sign a payload string/Buffer with a webhook secret.
 * Returns: "sha256=<hex>"
 */
function signPayload(secret, bodyStr) {
  const mac = createHmac('sha256', secret).update(bodyStr, 'utf-8').digest('hex');
  return `sha256=${mac}`;
}

// ---------------------------------------------------------------------------
// Event ID generation
// ---------------------------------------------------------------------------

function generateEventId() {
  return 'evt_' + randomBytes(16).toString('hex');
}

function generateWebhookId() {
  return 'wh_' + randomBytes(12).toString('hex');
}

function generateWebhookSecret() {
  return 'whsec_' + randomBytes(24).toString('hex');
}

// ---------------------------------------------------------------------------
// Event history
//
// Directory: instances/{id}/data/events/
// Each file: {ISO-timestamp}-{eventId}.json
// Content: full event record with delivery log
// ---------------------------------------------------------------------------

function eventsDir(instanceDir) {
  return join(instanceDir, 'data', 'events');
}

function writeEventRecord(instanceDir, record) {
  const dir = eventsDir(instanceDir);
  mkdirSync(dir, { recursive: true });
  // Filename: sortable by time, unique by id
  const ts = record.occurredAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `${ts}-${record.id}.json`;
  writeFileSync(join(dir, filename), JSON.stringify(record, null, 2), 'utf-8');
}

function updateEventRecord(instanceDir, record) {
  // Find and overwrite the file for this event (match by id suffix)
  const dir = eventsDir(instanceDir);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter(f => f.endsWith(`-${record.id}.json`));
  if (files.length > 0) {
    writeFileSync(join(dir, files[0]), JSON.stringify(record, null, 2), 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// HTTP dispatch — sends a signed POST to a webhook URL
// Returns: { ok, statusCode, body, durationMs }
// ---------------------------------------------------------------------------

function dispatchHttp(url, bodyStr, signature) {
  return new Promise(resolve => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const requester = isHttps ? httpsRequest : httpRequest;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf-8'),
        'X-Your9-Signature': signature,
        'X-Your9-Event': 'webhook-dispatch',
        'User-Agent': 'Your9-Webhooks/1.0',
      },
    };

    const startTime = Date.now();

    const req = requester(options, res => {
      const chunks = [];
      let totalBytes = 0;

      res.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes <= MAX_RESPONSE_BODY) chunks.push(chunk);
      });

      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode || 0;
        const body = Buffer.concat(chunks).toString('utf-8').slice(0, MAX_RESPONSE_BODY);
        resolve({ ok: statusCode >= 200 && statusCode < 300, statusCode, body, durationMs });
      });
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, body: 'Request timed out after 15s', durationMs: Date.now() - startTime });
    });

    req.on('error', e => {
      resolve({ ok: false, statusCode: 0, body: e.message, durationMs: Date.now() - startTime });
    });

    req.write(bodyStr, 'utf-8');
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core: emitEvent
//
// Fires an event. Finds all active, subscribed webhooks for this instance,
// dispatches each with retry logic, records delivery status in event history.
//
// This is intentionally async — it does NOT block the caller. Fire-and-forget
// with full retry is handled internally.
//
// eventType: one of VALID_EVENTS
// payload:   arbitrary object — event-specific data
//
// Returns: { id, occurredAt } immediately. Delivery is async.
// ---------------------------------------------------------------------------

async function emitEvent(instanceDir, eventType, payload) {
  if (!VALID_EVENTS.has(eventType)) {
    throw new Error(`Unknown event type: ${eventType}. Valid types: ${[...VALID_EVENTS].join(', ')}`);
  }

  const eventId = generateEventId();
  const occurredAt = new Date().toISOString();

  // Derive instanceId from path
  const instanceId = instanceDir.split('/').filter(Boolean).pop();

  const envelope = {
    id: eventId,
    event: eventType,
    instanceId,
    occurredAt,
    payload: payload || {},
  };

  const bodyStr = JSON.stringify(envelope);

  // Find subscribed webhooks
  const webhooks = loadWebhooks(instanceDir).filter(wh => {
    if (!wh.active) return false;
    if (!wh.events || wh.events.length === 0) return false;
    if (wh.events.includes('*')) return true;
    return wh.events.includes(eventType);
  });

  // Build event record
  const record = {
    ...envelope,
    deliveries: webhooks.map(wh => ({
      webhookId: wh.id,
      url: wh.url,
      status: 'pending',
      attempts: [],
      finalStatus: null,
    })),
  };

  writeEventRecord(instanceDir, record);

  log(`Event ${eventId} (${eventType}) — dispatching to ${webhooks.length} webhook(s)`);

  // Dispatch to each webhook asynchronously (non-blocking for caller)
  setImmediate(async () => {
    for (let i = 0; i < webhooks.length; i++) {
      const wh = webhooks[i];
      const delivery = record.deliveries[i];
      const signature = signPayload(wh.secret, bodyStr);

      let delivered = false;

      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
        if (RETRY_DELAYS_MS[attempt] > 0) {
          await sleep(RETRY_DELAYS_MS[attempt]);
        }

        const result = await dispatchHttp(wh.url, bodyStr, signature);
        const attemptRecord = {
          attempt: attempt + 1,
          at: new Date().toISOString(),
          statusCode: result.statusCode,
          durationMs: result.durationMs,
          ok: result.ok,
          responseBody: result.body.slice(0, 200),
        };

        delivery.attempts.push(attemptRecord);

        log(`  ${wh.id} attempt ${attempt + 1}: HTTP ${result.statusCode} (${result.durationMs}ms) — ${result.ok ? 'OK' : 'FAIL'}`);

        if (result.ok) {
          delivered = true;
          delivery.status = 'delivered';
          delivery.finalStatus = 'delivered';
          delivery.deliveredAt = new Date().toISOString();
          break;
        }
      }

      if (!delivered) {
        delivery.status = 'failed';
        delivery.finalStatus = 'failed';
        delivery.failedAt = new Date().toISOString();
        log(`  ${wh.id} — all retries exhausted, marking failed`);
      }

      // Update webhook stats
      const allWebhooks = loadWebhooks(instanceDir);
      const whRecord = allWebhooks.find(w => w.id === wh.id);
      if (whRecord) {
        whRecord.lastFiredAt = occurredAt;
        if (delivered) {
          whRecord.successCount = (whRecord.successCount || 0) + 1;
        } else {
          whRecord.failureCount = (whRecord.failureCount || 0) + 1;
        }
        saveWebhooks(instanceDir, allWebhooks);
      }
    }

    // Persist final delivery state
    updateEventRecord(instanceDir, record);
    log(`Event ${eventId} dispatch complete`);
  });

  return { id: eventId, occurredAt };
}

// ---------------------------------------------------------------------------
// Core: registerWebhook
//
// options:
//   url:     string (required) — HTTPS endpoint
//   events:  string[]         — event types to subscribe, or ["*"] for all
//   label:   string           — human label
//   secret:  string           — optional custom secret; auto-generated if omitted
//   active:  boolean          — default true
//
// Returns the full webhook record (including generated secret if not provided).
// ---------------------------------------------------------------------------

function registerWebhook(instanceDir, options) {
  const { url, events, label, secret, active = true } = options || {};

  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('url must start with http:// or https://');
  }

  // Validate events list
  const eventsArr = Array.isArray(events) ? events : (events ? [events] : ['*']);
  for (const e of eventsArr) {
    if (e !== '*' && !VALID_EVENTS.has(e)) {
      throw new Error(`Unknown event type: ${e}. Valid: ${[...VALID_EVENTS].join(', ')}`);
    }
  }

  const webhookSecret = (typeof secret === 'string' && secret.length >= 16)
    ? secret
    : generateWebhookSecret();

  const record = {
    id: generateWebhookId(),
    url: url.trim(),
    secret: webhookSecret,
    events: eventsArr,
    active: Boolean(active),
    label: (label || 'Webhook').slice(0, 100),
    createdAt: new Date().toISOString(),
    lastFiredAt: null,
    successCount: 0,
    failureCount: 0,
  };

  ensureInstanceDir(instanceDir);
  const webhooks = loadWebhooks(instanceDir);
  webhooks.push(record);
  saveWebhooks(instanceDir, webhooks);

  log(`Webhook registered: ${record.id} → ${url} (events: ${eventsArr.join(',')})`);

  return record;
}

// ---------------------------------------------------------------------------
// Core: listWebhooks
// ---------------------------------------------------------------------------

function listWebhooks(instanceDir) {
  return loadWebhooks(instanceDir);
}

// ---------------------------------------------------------------------------
// Core: deleteWebhook
// ---------------------------------------------------------------------------

function deleteWebhook(instanceDir, webhookId) {
  const webhooks = loadWebhooks(instanceDir);
  const idx = webhooks.findIndex(w => w.id === webhookId);
  if (idx === -1) throw new Error(`Webhook not found: ${webhookId}`);
  const removed = webhooks.splice(idx, 1)[0];
  saveWebhooks(instanceDir, webhooks);
  log(`Webhook deleted: ${webhookId}`);
  return removed;
}

// ---------------------------------------------------------------------------
// Core: updateWebhook
// ---------------------------------------------------------------------------

function updateWebhook(instanceDir, webhookId, updates) {
  const webhooks = loadWebhooks(instanceDir);
  const wh = webhooks.find(w => w.id === webhookId);
  if (!wh) throw new Error(`Webhook not found: ${webhookId}`);

  if (updates.active !== undefined) wh.active = Boolean(updates.active);
  if (updates.label !== undefined) wh.label = String(updates.label).slice(0, 100);
  if (updates.url !== undefined) {
    if (!updates.url.startsWith('http://') && !updates.url.startsWith('https://')) {
      throw new Error('url must start with http:// or https://');
    }
    wh.url = updates.url.trim();
  }
  if (updates.events !== undefined) {
    const eventsArr = Array.isArray(updates.events) ? updates.events : [updates.events];
    for (const e of eventsArr) {
      if (e !== '*' && !VALID_EVENTS.has(e)) throw new Error(`Unknown event type: ${e}`);
    }
    wh.events = eventsArr;
  }
  if (updates.secret !== undefined && typeof updates.secret === 'string' && updates.secret.length >= 16) {
    wh.secret = updates.secret;
  }

  saveWebhooks(instanceDir, webhooks);
  log(`Webhook updated: ${webhookId}`);
  return wh;
}

// ---------------------------------------------------------------------------
// Core: getEventHistory
//
// opts: { limit, offset, eventType, webhookId }
// Returns: { events, total }
// ---------------------------------------------------------------------------

function getEventHistory(instanceDir, opts = {}) {
  const dir = eventsDir(instanceDir);
  if (!existsSync(dir)) return { events: [], total: 0 };

  const limit = Math.min(200, parseInt(opts.limit) || DEFAULT_HISTORY_LIMIT);
  const offset = parseInt(opts.offset) || 0;

  let files;
  try {
    files = readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // newest first
  } catch { return { events: [], total: 0 }; }

  const allEvents = files
    .map(f => {
      try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')); } catch { return null; }
    })
    .filter(Boolean)
    .filter(e => {
      if (opts.eventType && e.event !== opts.eventType) return false;
      if (opts.webhookId) {
        const found = (e.deliveries || []).some(d => d.webhookId === opts.webhookId);
        if (!found) return false;
      }
      return true;
    });

  return {
    events: allEvents.slice(offset, offset + limit),
    total: allEvents.length,
  };
}

// ---------------------------------------------------------------------------
// Dashboard panel builder
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build data for the dashboard webhook panel.
 */
function buildWebhookPanelData(instanceDir) {
  const webhooks = loadWebhooks(instanceDir);
  const { events, total } = getEventHistory(instanceDir, { limit: 20 });

  // Compute delivery success rate per webhook
  const statsMap = {};
  for (const wh of webhooks) {
    const totalFired = (wh.successCount || 0) + (wh.failureCount || 0);
    const rate = totalFired > 0 ? Math.round((wh.successCount / totalFired) * 100) : null;
    statsMap[wh.id] = { totalFired, rate };
  }

  return { webhooks, recentEvents: events, totalEvents: total, statsMap };
}

/**
 * Render the webhook panel as an HTML string for embedding in the dashboard.
 * Follows the card pattern used throughout your9-dashboard.mjs.
 */
function renderWebhookPanel(panelData, instanceId) {
  const { webhooks, recentEvents, totalEvents, statsMap } = panelData;

  // Webhook rows
  const webhookRows = webhooks.length === 0
    ? `<div style="padding:16px;color:var(--text-dim);font-size:13px;">
        No webhooks configured yet. Add one below.
       </div>`
    : webhooks.map(wh => {
        const stats = statsMap[wh.id] || {};
        const rateStr = stats.rate !== null ? `${stats.rate}%` : 'N/A';
        const statusColor = wh.active ? '#2ecc71' : '#95a5a6';
        const statusLabel = wh.active ? 'Active' : 'Paused';
        const lastFired = wh.lastFiredAt
          ? new Date(wh.lastFiredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : 'Never';
        const eventsLabel = (wh.events || []).includes('*') ? 'All events' : (wh.events || []).join(', ');
        const shortUrl = wh.url.length > 40 ? wh.url.slice(0, 37) + '...' : wh.url;

        return `
<div class="wh-row" data-wh-id="${escapeHtml(wh.id)}">
  <div class="wh-info">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
      <span class="wh-label">${escapeHtml(wh.label)}</span>
      <span class="badge" style="background:${statusColor}22;color:${statusColor};font-size:10px;">${statusLabel}</span>
    </div>
    <div class="wh-url" title="${escapeHtml(wh.url)}">${escapeHtml(shortUrl)}</div>
    <div class="wh-meta">Events: ${escapeHtml(eventsLabel)}</div>
    <div class="wh-meta">Last fired: ${escapeHtml(lastFired)} &middot; Success rate: ${rateStr} &middot; ${stats.totalFired || 0} deliveries</div>
  </div>
  <div class="wh-actions">
    <button onclick="whToggle('${escapeHtml(wh.id)}', ${!wh.active})" class="wh-btn" title="${wh.active ? 'Pause' : 'Resume'} webhook">
      ${wh.active ? 'Pause' : 'Resume'}
    </button>
    <button onclick="whDelete('${escapeHtml(wh.id)}', '${escapeHtml(wh.label)}')" class="wh-btn wh-btn-danger" title="Delete webhook">
      Delete
    </button>
  </div>
</div>`;
      }).join('');

  // Recent event rows
  const eventRows = recentEvents.length === 0
    ? `<div style="padding:12px 16px;color:var(--text-dim);font-size:12px;">No events dispatched yet.</div>`
    : recentEvents.slice(0, 10).map(ev => {
        const deliveryCount = (ev.deliveries || []).length;
        const delivered = (ev.deliveries || []).filter(d => d.finalStatus === 'delivered').length;
        const failed = (ev.deliveries || []).filter(d => d.finalStatus === 'failed').length;
        const pending = deliveryCount - delivered - failed;
        const ts = ev.occurredAt
          ? new Date(ev.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '?';
        const statusColor = failed > 0 ? '#e74c3c' : (pending > 0 ? '#f39c12' : '#2ecc71');
        const statusText = failed > 0 ? `${failed} failed` : (pending > 0 ? 'pending' : 'delivered');

        return `
<div class="wh-event-row">
  <div style="flex:1;min-width:0;">
    <span class="badge" style="background:var(--surface2);color:var(--text-muted);font-size:10px;margin-right:6px;">${escapeHtml(ev.event)}</span>
    <span style="font-size:11px;color:var(--text-dim);">${escapeHtml(ts)}</span>
    <span style="font-size:11px;color:var(--text-dim);margin-left:8px;">${deliveryCount} webhook${deliveryCount !== 1 ? 's' : ''}</span>
  </div>
  <span style="font-size:11px;color:${statusColor};font-weight:600;">${escapeHtml(statusText)}</span>
</div>`;
      }).join('');

  return `
<div class="card" id="webhooks-panel">
  <div class="card-header">
    <span class="card-title">Webhooks</span>
    <span class="badge" style="background:var(--surface2);color:var(--text-muted);">${webhooks.length} configured &middot; ${totalEvents} events</span>
  </div>

  <style>
    .wh-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .wh-row:last-child { border-bottom: none; }
    .wh-info { flex: 1; min-width: 0; }
    .wh-label { font-weight: 600; font-size: 13px; }
    .wh-url { font-size: 11px; color: var(--accent); font-family: monospace; margin-bottom: 3px; word-break: break-all; }
    .wh-meta { font-size: 11px; color: var(--text-dim); margin-bottom: 2px; }
    .wh-actions { display: flex; flex-direction: column; gap: 5px; flex-shrink: 0; }
    .wh-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--text-dim);
      border-radius: 5px;
      padding: 3px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .wh-btn:hover { border-color: var(--accent); color: var(--accent); }
    .wh-btn-danger:hover { border-color: #e74c3c !important; color: #e74c3c !important; }
    .wh-event-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .wh-event-row:last-child { border-bottom: none; }
    .wh-add-form {
      padding: 16px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .wh-input {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      padding: 7px 12px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .wh-input:focus { border-color: var(--accent); }
    .wh-input-row { display: flex; gap: 8px; }
    .wh-submit-btn {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .wh-submit-btn:hover { opacity: 0.88; }
    #wh-form-status { font-size: 12px; color: var(--text-dim); min-height: 16px; }
    .wh-section-header {
      padding: 10px 16px 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
    }
    .wh-secret-reveal {
      font-family: monospace;
      font-size: 11px;
      word-break: break-all;
      color: var(--accent);
      padding: 8px 12px;
      background: var(--surface2);
      border-radius: 5px;
      margin-top: 4px;
      display: none;
    }
  </style>

  <!-- Configured webhooks -->
  <div class="wh-section-header">Configured Webhooks</div>
  <div class="card-body scroll" style="max-height:260px;">
    ${webhookRows}
  </div>

  <!-- Recent events -->
  <div class="wh-section-header" style="margin-top:4px;">Recent Events</div>
  <div style="max-height:180px;overflow-y:auto;">
    ${eventRows}
  </div>

  <!-- Add webhook form -->
  <div class="wh-add-form">
    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px;">Add Webhook</div>
    <input class="wh-input" id="wh-url" type="url" placeholder="https://your-endpoint.com/webhook" />
    <div class="wh-input-row">
      <input class="wh-input" id="wh-label" type="text" placeholder="Label (e.g. Zapier)" style="flex:1;" />
      <select class="wh-input" id="wh-events" style="flex:1;">
        <option value="*">All events</option>
        <option value="task_completed">task_completed</option>
        <option value="task_delegated">task_delegated</option>
        <option value="decision_made">decision_made</option>
        <option value="email_sent">email_sent</option>
        <option value="research_completed">research_completed</option>
        <option value="social_posted">social_posted</option>
        <option value="goal_achieved">goal_achieved</option>
        <option value="agent_added">agent_added</option>
        <option value="briefing_sent">briefing_sent</option>
        <option value="initiative_proposed">initiative_proposed</option>
      </select>
    </div>
    <div class="wh-input-row">
      <button class="wh-submit-btn" onclick="whAddWebhook()">Add Webhook</button>
      <div id="wh-form-status" style="display:flex;align-items:center;flex:1;padding-left:8px;"></div>
    </div>
    <div id="wh-secret-reveal" class="wh-secret-reveal"></div>
  </div>
</div>

<script>
(function() {
  const WHQ_BASE = 'http://127.0.0.1:3495/api/v1';
  const WH_INSTANCE = ${JSON.stringify(instanceId)};

  function whSetStatus(msg, isError) {
    const el = document.getElementById('wh-form-status');
    if (!el) return;
    el.style.color = isError ? '#e74c3c' : 'var(--text-dim)';
    el.textContent = msg;
  }

  window.whAddWebhook = async function() {
    const url = (document.getElementById('wh-url')?.value || '').trim();
    const label = (document.getElementById('wh-label')?.value || '').trim() || 'Webhook';
    const events = document.getElementById('wh-events')?.value || '*';

    if (!url) { whSetStatus('URL is required.', true); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      whSetStatus('URL must start with http:// or https://', true);
      return;
    }

    whSetStatus('Adding...');
    try {
      const res = await fetch(WHQ_BASE + '/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: WH_INSTANCE, url, label, events: [events] }),
      });
      const data = await res.json();
      if (!data.ok) { whSetStatus('Error: ' + data.error, true); return; }

      // Show secret one time
      const secretEl = document.getElementById('wh-secret-reveal');
      if (secretEl && data.data?.secret) {
        secretEl.style.display = 'block';
        secretEl.textContent = 'Secret (save this — shown once): ' + data.data.secret;
      }

      whSetStatus('Webhook added! Refreshing...');
      document.getElementById('wh-url').value = '';
      document.getElementById('wh-label').value = '';
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      whSetStatus('Request failed: ' + e.message, true);
    }
  };

  window.whToggle = async function(webhookId, active) {
    try {
      const res = await fetch(WHQ_BASE + '/webhooks/' + webhookId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: WH_INSTANCE, active }),
      });
      const data = await res.json();
      if (!data.ok) { alert('Error: ' + data.error); return; }
      location.reload();
    } catch (e) {
      alert('Request failed: ' + e.message);
    }
  };

  window.whDelete = async function(webhookId, label) {
    if (!confirm('Delete webhook "' + label + '"? This cannot be undone.')) return;
    try {
      const res = await fetch(WHQ_BASE + '/webhooks/' + webhookId, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: WH_INSTANCE }),
      });
      const data = await res.json();
      if (!data.ok) { alert('Error: ' + data.error); return; }
      location.reload();
    } catch (e) {
      alert('Request failed: ' + e.message);
    }
  };
})();
</script>`;
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Your9-Service': 'webhooks',
  });
  res.end(payload);
}

function ok(res, data, statusCode = 200) {
  sendJson(res, statusCode, { ok: true, data });
}

function err(res, statusCode, message, code = null) {
  const body = { ok: false, error: message };
  if (code) body.code = code;
  sendJson(res, statusCode, body);
}

// ---------------------------------------------------------------------------
// Request body reader
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > 64 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Query string parser
// ---------------------------------------------------------------------------

function parseQuery(urlStr) {
  const q = {};
  const idx = urlStr.indexOf('?');
  if (idx === -1) return q;
  const params = new URLSearchParams(urlStr.slice(idx + 1));
  for (const [k, v] of params.entries()) q[k] = v;
  return q;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /health
 */
function handleHealth(req, res) {
  ok(res, {
    service: 'your9-webhooks',
    version: API_VERSION,
    port: WEBHOOK_PORT,
    uptime: process.uptime(),
    validEventTypes: [...VALID_EVENTS],
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/v1/webhooks?instanceId=...
 * List all webhooks for an instance.
 */
function handleListWebhooks(req, res, query) {
  const { instanceId } = query;
  if (!instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${instanceId}`, 'NOT_FOUND');

  const webhooks = listWebhooks(instanceDir).map(wh => ({
    id: wh.id,
    url: wh.url,
    label: wh.label,
    events: wh.events,
    active: wh.active,
    createdAt: wh.createdAt,
    lastFiredAt: wh.lastFiredAt,
    successCount: wh.successCount,
    failureCount: wh.failureCount,
    // Never expose secret in list endpoint
  }));

  ok(res, { webhooks, total: webhooks.length });
}

/**
 * POST /api/v1/webhooks
 * Register a new webhook.
 * Body: { instanceId, url, events, label, secret? }
 */
async function handleRegisterWebhook(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body?.instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(body.instanceId);
  if (!existsSync(INSTANCES_DIR) || !existsSync(instanceDir)) {
    return err(res, 404, `Instance not found: ${body.instanceId}`, 'NOT_FOUND');
  }

  try {
    const record = registerWebhook(instanceDir, {
      url: body.url,
      events: body.events,
      label: body.label,
      secret: body.secret,
      active: body.active !== undefined ? body.active : true,
    });

    // Return the secret in the creation response (shown once)
    ok(res, {
      id: record.id,
      url: record.url,
      label: record.label,
      events: record.events,
      active: record.active,
      createdAt: record.createdAt,
      secret: record.secret, // shown once at creation
      warning: 'Store the secret securely. It will not be returned again.',
    }, 201);
  } catch (e) {
    err(res, 400, e.message, 'VALIDATION_ERROR');
  }
}

/**
 * PATCH /api/v1/webhooks/{id}
 * Update a webhook (toggle active, change label/url/events).
 * Body: { instanceId, ...updates }
 */
async function handleUpdateWebhook(req, res, webhookId) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body?.instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(body.instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${body.instanceId}`, 'NOT_FOUND');

  try {
    const { instanceId, ...updates } = body;
    const updated = updateWebhook(instanceDir, webhookId, updates);
    ok(res, {
      id: updated.id,
      url: updated.url,
      label: updated.label,
      events: updated.events,
      active: updated.active,
    });
  } catch (e) {
    err(res, 404, e.message, 'NOT_FOUND');
  }
}

/**
 * DELETE /api/v1/webhooks/{id}
 * Delete a webhook.
 * Body: { instanceId }
 */
async function handleDeleteWebhook(req, res, webhookId) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body?.instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(body.instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${body.instanceId}`, 'NOT_FOUND');

  try {
    const removed = deleteWebhook(instanceDir, webhookId);
    ok(res, { deleted: true, id: removed.id, label: removed.label });
  } catch (e) {
    err(res, 404, e.message, 'NOT_FOUND');
  }
}

/**
 * POST /api/v1/events/emit
 * Fire an event for an instance.
 * Body: { instanceId, eventType, payload }
 */
async function handleEmitEvent(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body?.instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');
  if (!body?.eventType) return err(res, 400, 'Required: eventType', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(body.instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${body.instanceId}`, 'NOT_FOUND');

  try {
    const result = await emitEvent(instanceDir, body.eventType, body.payload || {});
    ok(res, { ...result, dispatching: true }, 202);
  } catch (e) {
    err(res, 400, e.message, 'VALIDATION_ERROR');
  }
}

/**
 * GET /api/v1/events?instanceId=...&eventType=...&limit=...&offset=...
 * Query event history for an instance.
 */
function handleGetEvents(req, res, query) {
  const { instanceId } = query;
  if (!instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${instanceId}`, 'NOT_FOUND');

  const { events, total } = getEventHistory(instanceDir, {
    limit: query.limit,
    offset: query.offset,
    eventType: query.eventType,
    webhookId: query.webhookId,
  });

  ok(res, { events, total, limit: parseInt(query.limit) || DEFAULT_HISTORY_LIMIT });
}

/**
 * GET /api/v1/events/types
 * Return all valid event types.
 */
function handleGetEventTypes(req, res) {
  ok(res, { eventTypes: [...VALID_EVENTS] });
}

/**
 * GET /api/v1/panel?instanceId=...
 * Return dashboard panel HTML.
 */
function handleGetPanel(req, res, query) {
  const { instanceId } = query;
  if (!instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = resolveInstanceDir(instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${instanceId}`, 'NOT_FOUND');

  const panelData = buildWebhookPanelData(instanceDir);
  const html = renderWebhookPanel(panelData, instanceId);

  const payload = html;
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------------------
// Main request router
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const query = parseQuery(url);
  const path = url.split('?')[0];

  log(`${method} ${path}`);

  // CORS — localhost only
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health — no auth
  if (path === '/health' && method === 'GET') {
    return handleHealth(req, res);
  }

  const PREFIX = `/api/${API_VERSION}`;
  if (!path.startsWith(PREFIX)) {
    return err(res, 404, `Not found: ${path}`, 'NOT_FOUND');
  }

  const route = path.slice(PREFIX.length);

  try {
    // Webhook management
    if (route === '/webhooks' && method === 'GET') {
      return handleListWebhooks(req, res, query);
    }
    if (route === '/webhooks' && method === 'POST') {
      return await handleRegisterWebhook(req, res);
    }

    // Match /webhooks/{id}
    const webhookMatch = route.match(/^\/webhooks\/([^/]+)$/);
    if (webhookMatch) {
      const webhookId = webhookMatch[1];
      if (method === 'PATCH') return await handleUpdateWebhook(req, res, webhookId);
      if (method === 'DELETE') return await handleDeleteWebhook(req, res, webhookId);
    }

    // Event emission
    if (route === '/events/emit' && method === 'POST') {
      return await handleEmitEvent(req, res);
    }

    // Event history
    if (route === '/events' && method === 'GET') {
      return handleGetEvents(req, res, query);
    }

    // Event types
    if (route === '/events/types' && method === 'GET') {
      return handleGetEventTypes(req, res);
    }

    // Dashboard panel HTML
    if (route === '/panel' && method === 'GET') {
      return handleGetPanel(req, res, query);
    }

    err(res, 404, `Unknown endpoint: ${method} ${path}`, 'NOT_FOUND');
  } catch (e) {
    log(`Unhandled error on ${method} ${path}: ${e.message}`);
    err(res, 500, 'Internal server error', 'INTERNAL');
  }
});

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function runCli(args) {
  const instanceId = args.instance;
  if (!instanceId) {
    console.error('Usage: node scripts/your9-webhooks.mjs --instance <customer-id> [--list | --history | --emit <eventType> | --register <url>]');
    process.exit(1);
  }

  const instanceDir = resolveInstanceDir(instanceId);
  if (!existsSync(instanceDir)) {
    console.error(`Instance not found: ${instanceId} (expected at ${instanceDir})`);
    process.exit(1);
  }

  if (args.list) {
    const webhooks = listWebhooks(instanceDir);
    console.log(`\nWebhooks for instance: ${instanceId} (${webhooks.length} total)\n`);
    for (const wh of webhooks) {
      const stats = `${wh.successCount || 0} delivered / ${wh.failureCount || 0} failed`;
      console.log(`  ${wh.id}  [${wh.active ? 'ACTIVE' : 'PAUSED'}]  ${wh.label}`);
      console.log(`    URL: ${wh.url}`);
      console.log(`    Events: ${(wh.events || []).join(', ')}`);
      console.log(`    Stats: ${stats}  |  Last fired: ${wh.lastFiredAt || 'never'}`);
      console.log('');
    }
    return;
  }

  if (args.history) {
    const limit = parseInt(args.limit) || 20;
    const { events, total } = getEventHistory(instanceDir, { limit });
    console.log(`\nEvent history for instance: ${instanceId} (${total} total, showing ${events.length})\n`);
    for (const ev of events) {
      const deliveryCount = (ev.deliveries || []).length;
      const delivered = (ev.deliveries || []).filter(d => d.finalStatus === 'delivered').length;
      console.log(`  ${ev.id}  ${ev.event}  ${ev.occurredAt}`);
      console.log(`    Deliveries: ${delivered}/${deliveryCount} succeeded`);
    }
    return;
  }

  if (args.emit) {
    const eventType = args.emit;
    let payload = {};
    if (args.payload) {
      try { payload = JSON.parse(args.payload); } catch { console.warn('Warning: could not parse --payload JSON'); }
    }
    console.log(`Emitting event: ${eventType} for instance ${instanceId}`);
    const result = await emitEvent(instanceDir, eventType, payload);
    console.log(`Event queued: ${result.id} at ${result.occurredAt}`);
    // Wait briefly to let async dispatch start
    await new Promise(r => setTimeout(r, 500));
    return;
  }

  if (args.register) {
    const url = args.register;
    const events = args.events ? args.events.split(',').map(e => e.trim()) : ['*'];
    const label = args.label || 'CLI Registration';
    const record = registerWebhook(instanceDir, { url, events, label });
    console.log(`\nWebhook registered:`);
    console.log(`  ID:     ${record.id}`);
    console.log(`  URL:    ${record.url}`);
    console.log(`  Events: ${record.events.join(', ')}`);
    console.log(`  Secret: ${record.secret}  <-- save this, shown once`);
    return;
  }

  // Default: print usage
  console.log(`your9-webhooks — Webhook & Event System`);
  console.log(`Instance: ${instanceId}`);
  console.log('');
  console.log('Commands:');
  console.log('  --list                        List all webhooks');
  console.log('  --history [--limit N]         Show event history');
  console.log('  --emit <eventType>            Emit an event (async)');
  console.log('  --register <url>              Register a new webhook');
  console.log('    --events task_completed,... Event filter (default: all)');
  console.log('    --label "My Hook"           Label for the webhook');
  console.log('');
  console.log('Valid event types:');
  console.log(' ', [...VALID_EVENTS].join(', '));
}

// ---------------------------------------------------------------------------
// Startup — either HTTP server or CLI
// ---------------------------------------------------------------------------

const ARGS = parseArgs(process.argv);

if (ARGS.instance && (ARGS.list || ARGS.history || ARGS.emit || ARGS.register || Object.keys(ARGS).length === 1)) {
  // CLI mode
  runCli(ARGS).catch(e => { console.error(e.message); process.exit(1); });
} else {
  // HTTP server mode
  const PORT = ARGS.port ? parseInt(ARGS.port) : WEBHOOK_PORT;

  server.listen(PORT, WEBHOOK_HOST, () => {
    log(`your9-webhooks running on http://${WEBHOOK_HOST}:${PORT}`);
    log(`API version: ${API_VERSION}`);
    log(`Serving instances from: ${INSTANCES_DIR}`);
    log(`Valid event types: ${[...VALID_EVENTS].join(', ')}`);
  });

  server.on('error', e => {
    log(`Server error: ${e.message}`);
    if (e.code === 'EADDRINUSE') {
      log(`Port ${PORT} already in use — is another instance running?`);
      process.exit(1);
    }
  });

  process.on('SIGTERM', () => { log('SIGTERM received — shutting down'); server.close(() => process.exit(0)); });
  process.on('SIGINT',  () => { log('SIGINT received — shutting down');  server.close(() => process.exit(0)); });
}

// ---------------------------------------------------------------------------
// Exports — for use by other Your9 scripts
// ---------------------------------------------------------------------------

export { emitEvent, registerWebhook, listWebhooks, deleteWebhook, updateWebhook, getEventHistory, buildWebhookPanelData, renderWebhookPanel, VALID_EVENTS };
