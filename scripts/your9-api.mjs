#!/usr/bin/env node
/**
 * your9-api.mjs — Public REST API Layer for Your9
 * Your9 by 9 Enterprises
 *
 * External-facing REST API. Turns Your9 into an extensible platform.
 * Every endpoint requires a valid API key. Keys are per-instance, hashed
 * (SHA-256), and stored in instances/{id}/config/api-keys.json.
 *
 * Rate limiting: 100 req/min per key (default). Configurable per tier.
 *
 * Port: 3494, bound to 127.0.0.1 only.
 *
 * Usage:
 *   node scripts/your9-api.mjs
 *   node scripts/your9-api.mjs --port 3494
 *
 * All responses use the envelope format:
 *   { ok: true, data: {} }
 *   { ok: false, error: "message" }
 */

import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';
import { request as httpRequest } from 'http';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOG_FILE = join(ROOT, 'logs', 'your9-api.log');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_PORT = parseInt(process.argv[2] === '--port' ? process.argv[3] : '3494') || 3494;
const API_HOST = '127.0.0.1';
const API_VERSION = 'v1';
const DEFAULT_RATE_LIMIT = 100; // requests per minute per key

// Per-tier rate limit overrides (requests/min)
const TIER_RATE_LIMITS = {
  starter:    100,
  growth:     300,
  enterprise: 1000,
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ensureLogDir() {
  const logsDir = join(ROOT, 'logs');
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] API: ${msg}`;
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
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv);
const PORT = ARGS.port ? parseInt(ARGS.port) : API_PORT;

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------

function loadEnvFile(envPath) {
  const env = {};
  if (!existsSync(envPath)) return env;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[key] = val;
  }
  return env;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter
// { keyHash: { count: N, windowStart: timestamp } }
// ---------------------------------------------------------------------------

const rateLimitWindows = new Map();

function checkRateLimit(keyHash, limitPerMin) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const window = rateLimitWindows.get(keyHash);

  if (!window || now - window.windowStart >= windowMs) {
    rateLimitWindows.set(keyHash, { count: 1, windowStart: now });
    return { allowed: true, remaining: limitPerMin - 1, resetAt: now + windowMs };
  }

  if (window.count >= limitPerMin) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: window.windowStart + windowMs,
    };
  }

  window.count++;
  return {
    allowed: true,
    remaining: limitPerMin - window.count,
    resetAt: window.windowStart + windowMs,
  };
}

// Cleanup stale windows every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [key, win] of rateLimitWindows.entries()) {
    if (win.windowStart < cutoff) rateLimitWindows.delete(key);
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// API key management
//
// Keys file: instances/{id}/config/api-keys.json
// Format:
// [
//   {
//     "keyHash": "sha256hex",
//     "label": "human label",
//     "tier": "starter",
//     "rateLimit": 100,
//     "createdAt": "ISO",
//     "lastUsedAt": "ISO|null",
//     "active": true
//   }
// ]
//
// The raw key (y9k_...) is never stored — only the hash.
// ---------------------------------------------------------------------------

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex');
}

function loadApiKeys(instanceDir) {
  const keysPath = join(instanceDir, 'config', 'api-keys.json');
  if (!existsSync(keysPath)) return [];
  try {
    return JSON.parse(readFileSync(keysPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveApiKeys(instanceDir, keys) {
  const keysPath = join(instanceDir, 'config', 'api-keys.json');
  mkdirSync(join(instanceDir, 'config'), { recursive: true });
  writeFileSync(keysPath, JSON.stringify(keys, null, 2));
}

/**
 * Generate a new API key for an instance.
 * Returns { rawKey, keyHash, record } — rawKey is shown ONCE then gone.
 */
function generateApiKey(instanceDir, label, tier) {
  const raw = 'y9k_' + randomBytes(32).toString('hex');
  const hash = hashKey(raw);
  const rateLimit = TIER_RATE_LIMITS[tier] || DEFAULT_RATE_LIMIT;

  const record = {
    keyHash: hash,
    label: (label || 'default').slice(0, 100),
    tier: tier || 'starter',
    rateLimit,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    active: true,
  };

  const keys = loadApiKeys(instanceDir);
  keys.push(record);
  saveApiKeys(instanceDir, keys);

  return { rawKey: raw, keyHash: hash, record };
}

/**
 * Validate an incoming API key. Returns { valid, keyRecord, instanceId, instanceDir } or { valid: false }.
 *
 * We scan all instances for the key hash. This allows a single API server
 * to serve all instances — each request is bound to exactly one instance.
 */
function validateApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith('y9k_')) {
    return { valid: false, reason: 'Invalid key format' };
  }

  const hash = hashKey(rawKey);

  if (!existsSync(INSTANCES_DIR)) return { valid: false, reason: 'No instances configured' };

  for (const instanceId of readdirSync(INSTANCES_DIR)) {
    const instanceDir = join(INSTANCES_DIR, instanceId);
    const keys = loadApiKeys(instanceDir);

    for (const record of keys) {
      if (record.keyHash === hash && record.active) {
        // Update lastUsedAt (best-effort, non-blocking)
        record.lastUsedAt = new Date().toISOString();
        try { saveApiKeys(instanceDir, keys); } catch {}

        return { valid: true, keyRecord: record, instanceId, instanceDir };
      }
    }
  }

  return { valid: false, reason: 'Unknown or inactive key' };
}

// ---------------------------------------------------------------------------
// Instance data readers — mirrors dashboard.mjs patterns
// ---------------------------------------------------------------------------

function readCustomerConfig(instanceDir) {
  try {
    return JSON.parse(readFileSync(join(instanceDir, 'config', 'customer.json'), 'utf-8'));
  } catch { return null; }
}

function readCeoConfig(instanceDir) {
  try {
    return JSON.parse(readFileSync(join(instanceDir, 'config', 'ceo.json'), 'utf-8'));
  } catch { return null; }
}

function readAgentConfigs(instanceDir) {
  const agentsDir = join(instanceDir, 'agents');
  const configs = {};
  if (!existsSync(agentsDir)) return configs;
  try {
    for (const agentId of readdirSync(agentsDir)) {
      const configPath = join(agentsDir, agentId, 'config.json');
      if (existsSync(configPath)) {
        try { configs[agentId] = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
      }
    }
  } catch {}
  return configs;
}

function readAgentStates(instanceDir) {
  const p = join(instanceDir, 'data', 'agent-states.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
}

function readTasks(instanceDir) {
  const taskDir = join(instanceDir, 'data', 'tasks');
  if (!existsSync(taskDir)) return [];
  try {
    return readdirSync(taskDir)
      .filter(f => f.endsWith('-task.json'))
      .sort()
      .reverse()
      .map(f => {
        try { return JSON.parse(readFileSync(join(taskDir, f), 'utf-8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

function readConversationHistory(instanceDir, limit = 50) {
  const histPath = join(instanceDir, 'data', 'conversations', 'history.jsonl');
  if (!existsSync(histPath)) return [];
  try {
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch { return []; }
}

function readUsageData(instanceDir) {
  const p = join(instanceDir, 'data', 'analytics', 'usage.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function readHealthData(instanceDir) {
  const p = join(instanceDir, 'data', 'success', 'health.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function readBillingData(instanceDir) {
  const p = join(instanceDir, 'data', 'billing.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Knowledge base reader — keyword search over the unencrypted index
// ---------------------------------------------------------------------------

function readKnowledgeIndex(instanceDir) {
  // your9-knowledge-base.mjs uses instances/{id}/data/knowledge/index.json
  const indexPath = join(instanceDir, 'data', 'knowledge', 'index.json');
  if (!existsSync(indexPath)) return [];
  try { return JSON.parse(readFileSync(indexPath, 'utf-8')); } catch { return []; }
}

// Also try the .index.json used by your9-knowledge-query.mjs
function readKnowledgeSummaries(instanceDir) {
  const indexPath = join(instanceDir, 'data', 'knowledge', '.index.json');
  if (!existsSync(indexPath)) return [];
  try { return JSON.parse(readFileSync(indexPath, 'utf-8')); } catch { return []; }
}

function searchKnowledge(instanceDir, query, limit = 10) {
  const q = (query || '').toLowerCase().trim();

  // Combine both index formats — deduplicate by id
  const byId = new Map();

  for (const entry of readKnowledgeIndex(instanceDir)) {
    if (entry.id) byId.set(entry.id, entry);
  }
  for (const entry of readKnowledgeSummaries(instanceDir)) {
    const key = entry.id || entry.file;
    if (key && !byId.has(key)) byId.set(key, entry);
  }

  const entries = [...byId.values()];

  if (!q) {
    // No query — return all, newest first, capped at limit
    return entries.slice(0, limit).map(sanitizeKnowledgeEntry);
  }

  // Simple keyword scoring: sum of matches in name + summary + tags
  const scored = entries
    .map(entry => {
      const text = [
        entry.name || '',
        entry.summary || '',
        (entry.tags || []).join(' '),
        entry.type || '',
      ].join(' ').toLowerCase();

      const words = q.split(/\s+/).filter(Boolean);
      let score = 0;
      for (const word of words) {
        const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = (text.match(re) || []).length;
        score += matches;
      }

      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => sanitizeKnowledgeEntry(entry));

  return scored;
}

function sanitizeKnowledgeEntry(entry) {
  // Never expose encrypted content or internal file paths
  return {
    id: entry.id || entry.file || null,
    name: entry.name || entry.title || null,
    type: entry.type || null,
    summary: entry.summary || null,
    tags: entry.tags || [],
    uploadedAt: entry.uploadedAt || entry.ingestedAt || null,
    sizeBytes: entry.sizeBytes || null,
  };
}

// ---------------------------------------------------------------------------
// Task writer — mirrors dashboard.mjs writeInstruction
// ---------------------------------------------------------------------------

function createTask(instanceDir, taskData) {
  const tasksDir = join(instanceDir, 'data', 'tasks');
  mkdirSync(tasksDir, { recursive: true });

  const ts = Date.now();
  const taskId = `${ts}-api`;
  const task = {
    id: taskId,
    type: 'api_task',
    agentId: taskData.agentId || 'ceo',
    task: (taskData.task || '').slice(0, 4000),
    priority: taskData.priority || 'normal',
    source: 'api',
    status: 'queued',
    loggedAt: new Date().toISOString(),
    metadata: taskData.metadata || {},
  };

  writeFileSync(join(tasksDir, `${taskId}-task.json`), JSON.stringify(task, null, 2));

  // Also write to shared context so the hub picks it up
  const ctxPath = join(instanceDir, 'data', 'shared-context.json');
  let ctx = { lastUpdated: null, entries: {} };
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf-8')); } catch {}
  }
  if (!ctx.entries) ctx.entries = {};
  ctx.entries[`api_task_${ts}`] = {
    value: `API task queued: ${(taskData.task || '').slice(0, 200)}`,
    writtenBy: 'api',
    writtenAt: new Date().toISOString(),
  };
  ctx.lastUpdated = new Date().toISOString();
  try { writeFileSync(ctxPath, JSON.stringify(ctx, null, 2)); } catch {}

  return task;
}

// ---------------------------------------------------------------------------
// Message writer — queues a message to the AI CEO
// ---------------------------------------------------------------------------

function createMessage(instanceDir, messageData) {
  const inboxDir = join(instanceDir, 'data', 'api-inbox');
  mkdirSync(inboxDir, { recursive: true });

  const ts = Date.now();
  const msgId = `${ts}-msg`;
  const entry = {
    id: msgId,
    role: 'user',
    content: (messageData.content || '').slice(0, 4000),
    source: 'api',
    channel: 'api',
    senderLabel: messageData.senderLabel || 'API caller',
    queuedAt: new Date().toISOString(),
    status: 'queued',
  };

  writeFileSync(join(inboxDir, `${msgId}.json`), JSON.stringify(entry, null, 2));

  // Write to shared context so hub can pick it up
  const ctxPath = join(instanceDir, 'data', 'shared-context.json');
  let ctx = { lastUpdated: null, entries: {} };
  if (existsSync(ctxPath)) {
    try { ctx = JSON.parse(readFileSync(ctxPath, 'utf-8')); } catch {}
  }
  if (!ctx.entries) ctx.entries = {};
  ctx.entries[`api_message_${ts}`] = {
    value: `API message queued: ${(messageData.content || '').slice(0, 200)}`,
    writtenBy: 'api',
    writtenAt: new Date().toISOString(),
  };
  ctx.lastUpdated = new Date().toISOString();
  try { writeFileSync(ctxPath, JSON.stringify(ctx, null, 2)); } catch {}

  return entry;
}

// ---------------------------------------------------------------------------
// Hub health probe
// ---------------------------------------------------------------------------

function readHubHealth(hubPort) {
  return new Promise(resolve => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port: hubPort, path: '/health', method: 'GET' },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function deriveHubPort(customerId, instanceEnv) {
  if (instanceEnv && instanceEnv.YOUR9_HUB_PORT &&
      !instanceEnv.YOUR9_HUB_PORT.startsWith('PLACEHOLDER_')) {
    return parseInt(instanceEnv.YOUR9_HUB_PORT);
  }
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return 4000 + (hash % 900);
}

// ---------------------------------------------------------------------------
// Metrics computation (mirrors dashboard ROI logic)
// ---------------------------------------------------------------------------

const COMPLEXITY_HOURS = { high: 2.5, medium: 0.75, low: 0.25 };
const HIGH_KEYWORDS = /research|draft|analyz|build|deploy|integrat|implement|creat|design|generat|report|plan|strat/i;
const MED_KEYWORDS  = /summar|respond|schedul|review|monitor|updat|send|follow|compil|prepar/i;

function inferComplexity(task) {
  if (!task) return 'low';
  if (HIGH_KEYWORDS.test(task)) return 'high';
  if (MED_KEYWORDS.test(task)) return 'medium';
  return 'low';
}

function computeMetrics(tasks, conversations, usageData) {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const completedAll = tasks.filter(t => t.status === 'completed');
  const completedToday = completedAll.filter(t => {
    const ts = t.completedAt || t.loggedAt;
    return ts && new Date(ts) >= todayStart;
  });
  const completedWeek = completedAll.filter(t => {
    const ts = t.completedAt || t.loggedAt;
    return ts && new Date(ts).getTime() >= weekAgo;
  });

  let timeSavedHoursToday = 0;
  for (const t of completedToday) {
    const c = t.complexity || inferComplexity(t.task);
    timeSavedHoursToday += COMPLEXITY_HOURS[c] || COMPLEXITY_HOURS.low;
  }

  const agentsUsed = new Set(tasks.map(t => t.agentId).filter(Boolean));
  const convoToday = conversations.filter(c => c.timestamp && new Date(c.timestamp) >= todayStart).length;

  // Velocity score (0-100)
  const velocityScore = Math.min(100,
    Math.min(40, completedToday.length * 10) +
    Math.min(30, completedWeek.length * 3) +
    Math.min(20, convoToday * 4) +
    Math.round((agentsUsed.size / Math.max(1, 3)) * 10)
  );

  return {
    tasks: {
      total: tasks.length,
      queued: tasks.filter(t => t.status === 'queued').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: completedAll.length,
      failed: tasks.filter(t => t.status === 'failed').length,
      cancelled: tasks.filter(t => t.status === 'cancelled').length,
      completedToday: completedToday.length,
      completedThisWeek: completedWeek.length,
    },
    timeSaved: {
      hoursToday: Math.round(timeSavedHoursToday * 10) / 10,
      hoursThisWeek: null, // could expand — not computed here for brevity
    },
    conversations: {
      total: conversations.length,
      today: convoToday,
    },
    agents: {
      uniqueUsed: agentsUsed.size,
    },
    velocityScore,
    usage: usageData ? {
      messagesSent: usageData.messagesSent || 0,
      tasksCompleted: usageData.tasksCompleted || 0,
      sessionCount: usageData.sessionCount || 0,
      lastActivity: usageData.lastActivity || null,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// HTTP response helpers
// ---------------------------------------------------------------------------

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Your9-API-Version': API_VERSION,
    ...extraHeaders,
  });
  res.end(payload);
}

function ok(res, data, statusCode = 200, extraHeaders = {}) {
  sendJson(res, statusCode, { ok: true, data }, extraHeaders);
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
      if (totalBytes > 64 * 1024) { // 64KB max body
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
// Auth middleware — call at the start of every authenticated handler
// Returns { ok, keyRecord, instanceId, instanceDir } or sends 401/429 and returns null.
// ---------------------------------------------------------------------------

function authenticate(req, res) {
  // Accept: Authorization: Bearer y9k_... or X-API-Key: y9k_...
  let rawKey = null;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7).trim();
  } else if (req.headers['x-api-key']) {
    rawKey = req.headers['x-api-key'].trim();
  }

  if (!rawKey) {
    err(res, 401, 'Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.', 'MISSING_KEY');
    return null;
  }

  const result = validateApiKey(rawKey);
  if (!result.valid) {
    err(res, 401, result.reason || 'Invalid API key.', 'INVALID_KEY');
    return null;
  }

  const rateLimit = result.keyRecord.rateLimit || DEFAULT_RATE_LIMIT;
  const rlResult = checkRateLimit(result.keyRecord.keyHash, rateLimit);

  const rlHeaders = {
    'X-RateLimit-Limit': String(rateLimit),
    'X-RateLimit-Remaining': String(rlResult.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rlResult.resetAt / 1000)),
  };

  if (!rlResult.allowed) {
    sendJson(res, 429, { ok: false, error: 'Rate limit exceeded.', code: 'RATE_LIMITED' }, rlHeaders);
    return null;
  }

  result._rlHeaders = rlHeaders;
  return result;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/status
 * Instance health and agent status.
 */
async function handleStatus(req, res, auth) {
  const { instanceId, instanceDir } = auth;

  const customer = readCustomerConfig(instanceDir);
  const ceo = readCeoConfig(instanceDir);
  const agentConfigs = readAgentConfigs(instanceDir);
  const agentStates = readAgentStates(instanceDir);
  const health = readHealthData(instanceDir);

  // Probe the hub
  const instanceEnv = loadEnvFile(join(instanceDir, 'config', '.env'));
  const hubPort = deriveHubPort(instanceId, instanceEnv);
  const hubHealth = await readHubHealth(hubPort);

  const agents = Object.entries(agentConfigs).map(([id, config]) => ({
    id,
    name: config.name || id,
    role: config.role || null,
    state: agentStates[id] || 'unknown',
    model: config.model || null,
  }));

  ok(res, {
    instanceId,
    businessName: customer?.name || null,
    status: customer?.status || 'unknown',
    tier: customer?.tier || null,
    ceo: ceo ? {
      name: ceo.name || null,
      model: ceo.model || null,
      active: !!hubHealth,
    } : null,
    hub: hubHealth ? {
      running: true,
      port: hubPort,
      uptime: hubHealth.uptime || null,
    } : { running: false, port: hubPort },
    agents,
    health: health ? { score: health.score } : null,
    timestamp: new Date().toISOString(),
  }, 200, auth._rlHeaders);
}

/**
 * GET /api/v1/tasks
 * List tasks with optional filters.
 * Query params: status, agentId, limit (default 50), offset (default 0)
 */
function handleGetTasks(req, res, auth, query) {
  const { instanceDir } = auth;

  const statusFilter = query.status || null;
  const agentFilter = query.agentId || null;
  const limit = Math.min(200, parseInt(query.limit) || 50);
  const offset = parseInt(query.offset) || 0;

  let tasks = readTasks(instanceDir);

  if (statusFilter) {
    tasks = tasks.filter(t => t.status === statusFilter);
  }
  if (agentFilter) {
    tasks = tasks.filter(t => t.agentId === agentFilter);
  }

  const total = tasks.length;
  const page = tasks.slice(offset, offset + limit);

  ok(res, {
    tasks: page.map(sanitizeTask),
    total,
    limit,
    offset,
  }, 200, auth._rlHeaders);
}

/**
 * POST /api/v1/tasks
 * Create a new task for the AI CEO or a specific agent.
 *
 * Body: { task: string, agentId?: string, priority?: "high"|"normal"|"low", metadata?: {} }
 */
async function handleCreateTask(req, res, auth) {
  const { instanceDir } = auth;

  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body || typeof body.task !== 'string' || !body.task.trim()) {
    return err(res, 400, 'Required field: task (string)', 'VALIDATION_ERROR');
  }

  const validPriorities = ['high', 'normal', 'low'];
  if (body.priority && !validPriorities.includes(body.priority)) {
    return err(res, 400, `priority must be one of: ${validPriorities.join(', ')}`, 'VALIDATION_ERROR');
  }

  const task = createTask(instanceDir, {
    task: body.task.trim(),
    agentId: body.agentId || 'ceo',
    priority: body.priority || 'normal',
    metadata: body.metadata || {},
  });

  log(`Task created via API: ${task.id} → instance ${auth.instanceId}`);

  ok(res, { task: sanitizeTask(task) }, 201, auth._rlHeaders);
}

/**
 * POST /api/v1/message
 * Send a message to the AI CEO. The hub picks it up from the api-inbox queue.
 *
 * Body: { content: string, senderLabel?: string }
 */
async function handleSendMessage(req, res, auth) {
  const { instanceDir } = auth;

  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body || typeof body.content !== 'string' || !body.content.trim()) {
    return err(res, 400, 'Required field: content (string)', 'VALIDATION_ERROR');
  }

  const msg = createMessage(instanceDir, {
    content: body.content.trim(),
    senderLabel: body.senderLabel || 'API caller',
  });

  log(`Message queued via API: ${msg.id} → instance ${auth.instanceId}`);

  ok(res, { message: sanitizeMessage(msg) }, 201, auth._rlHeaders);
}

/**
 * GET /api/v1/agents
 * List all agents for the instance with their current status.
 */
function handleGetAgents(req, res, auth) {
  const { instanceDir } = auth;

  const agentConfigs = readAgentConfigs(instanceDir);
  const agentStates = readAgentStates(instanceDir);

  // Compute per-agent task stats
  const tasks = readTasks(instanceDir);
  const agentTaskStats = {};
  for (const t of tasks) {
    if (!t.agentId) continue;
    if (!agentTaskStats[t.agentId]) {
      agentTaskStats[t.agentId] = { total: 0, completed: 0, queued: 0, failed: 0 };
    }
    agentTaskStats[t.agentId].total++;
    if (t.status === 'completed') agentTaskStats[t.agentId].completed++;
    if (t.status === 'queued') agentTaskStats[t.agentId].queued++;
    if (t.status === 'failed') agentTaskStats[t.agentId].failed++;
  }

  const agents = Object.entries(agentConfigs).map(([id, config]) => ({
    id,
    name: config.name || id,
    role: config.role || null,
    description: config.description || null,
    model: config.model || null,
    state: agentStates[id] || 'unknown',
    tasks: agentTaskStats[id] || { total: 0, completed: 0, queued: 0, failed: 0 },
  }));

  ok(res, { agents, total: agents.length }, 200, auth._rlHeaders);
}

/**
 * GET /api/v1/knowledge
 * Search the knowledge base. Returns matching documents (metadata only — no content).
 * Query params: q (search string), limit (default 10)
 */
function handleGetKnowledge(req, res, auth, query) {
  const { instanceDir } = auth;

  const q = query.q || '';
  const limit = Math.min(50, parseInt(query.limit) || 10);

  const results = searchKnowledge(instanceDir, q, limit);

  ok(res, {
    query: q || null,
    results,
    total: results.length,
  }, 200, auth._rlHeaders);
}

/**
 * GET /api/v1/metrics
 * Usage and ROI metrics for the instance.
 */
function handleGetMetrics(req, res, auth) {
  const { instanceDir } = auth;

  const tasks = readTasks(instanceDir);
  const conversations = readConversationHistory(instanceDir, 500);
  const usageData = readUsageData(instanceDir);
  const billing = readBillingData(instanceDir);
  const health = readHealthData(instanceDir);

  const metrics = computeMetrics(tasks, conversations, usageData);

  ok(res, {
    metrics,
    billing: billing ? {
      tier: billing.tier || null,
      callsUsed: billing.callsUsed || 0,
      callLimit: billing.callLimit || null,
      periodStart: billing.periodStart || null,
      periodEnd: billing.periodEnd || null,
    } : null,
    health: health ? {
      score: health.score,
      calculatedAt: health.calculatedAt || null,
    } : null,
  }, 200, auth._rlHeaders);
}

// ---------------------------------------------------------------------------
// Sanitizers — strip internal fields before sending to caller
// ---------------------------------------------------------------------------

function sanitizeTask(task) {
  return {
    id: task.id,
    type: task.type || null,
    agentId: task.agentId || null,
    task: task.task || null,
    priority: task.priority || null,
    status: task.status,
    source: task.source || null,
    loggedAt: task.loggedAt || null,
    completedAt: task.completedAt || null,
    result: task.result || null,
    metadata: task.metadata || {},
  };
}

function sanitizeMessage(msg) {
  return {
    id: msg.id,
    content: msg.content,
    senderLabel: msg.senderLabel || null,
    queuedAt: msg.queuedAt,
    status: msg.status,
  };
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
// Admin endpoints (no auth required — local only)
// These are management operations available on the same port.
// ---------------------------------------------------------------------------

/**
 * POST /admin/keys/generate
 * Body: { instanceId, label?, tier? }
 * Generates a new API key for the given instance.
 * Returns { rawKey, keyHash, record } — rawKey shown ONCE.
 */
async function handleGenerateKey(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body || !body.instanceId) {
    return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');
  }

  const instanceDir = join(INSTANCES_DIR, body.instanceId);
  if (!existsSync(instanceDir)) {
    return err(res, 404, `Instance not found: ${body.instanceId}`, 'NOT_FOUND');
  }

  try {
    const result = generateApiKey(instanceDir, body.label, body.tier);
    log(`API key generated for instance ${body.instanceId}: label="${body.label || 'default'}"`);
    ok(res, {
      rawKey: result.rawKey,
      keyHash: result.keyHash,
      record: result.record,
      warning: 'Store the rawKey securely. It will not be shown again.',
    }, 201);
  } catch (e) {
    err(res, 500, `Key generation failed: ${e.message}`, 'INTERNAL');
  }
}

/**
 * GET /admin/keys/list?instanceId=...
 * Lists all API keys for an instance (hashes only, never raw keys).
 */
function handleListKeys(req, res, query) {
  const instanceId = query.instanceId;
  if (!instanceId) return err(res, 400, 'Required: instanceId', 'VALIDATION_ERROR');

  const instanceDir = join(INSTANCES_DIR, instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${instanceId}`, 'NOT_FOUND');

  const keys = loadApiKeys(instanceDir).map(k => ({
    keyHash: k.keyHash,
    label: k.label,
    tier: k.tier,
    rateLimit: k.rateLimit,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    active: k.active,
  }));

  ok(res, { keys, total: keys.length });
}

/**
 * POST /admin/keys/revoke
 * Body: { instanceId, keyHash }
 * Deactivates a key.
 */
async function handleRevokeKey(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return err(res, 400, e.message, 'BAD_REQUEST');
  }

  if (!body || !body.instanceId || !body.keyHash) {
    return err(res, 400, 'Required: instanceId, keyHash', 'VALIDATION_ERROR');
  }

  const instanceDir = join(INSTANCES_DIR, body.instanceId);
  if (!existsSync(instanceDir)) return err(res, 404, `Instance not found: ${body.instanceId}`, 'NOT_FOUND');

  const keys = loadApiKeys(instanceDir);
  const key = keys.find(k => k.keyHash === body.keyHash);
  if (!key) return err(res, 404, 'Key not found', 'NOT_FOUND');

  key.active = false;
  key.revokedAt = new Date().toISOString();
  saveApiKeys(instanceDir, keys);

  log(`API key revoked: ${body.keyHash.slice(0, 8)}... for instance ${body.instanceId}`);
  ok(res, { revoked: true, keyHash: body.keyHash });
}

// ---------------------------------------------------------------------------
// Health endpoint (no auth)
// ---------------------------------------------------------------------------

function handleHealth(req, res) {
  ok(res, {
    service: 'your9-api',
    version: API_VERSION,
    port: PORT,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Main request router
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const query = parseQuery(url);
  const path = url.split('?')[0];

  log(`${method} ${path} — ${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local'}`);

  // CORS — localhost only, permissive for dashboard/dev use
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check — no auth
  if (path === '/health' && method === 'GET') {
    return handleHealth(req, res);
  }

  // Admin endpoints — no external auth (local only, no key required)
  if (path === '/admin/keys/generate' && method === 'POST') {
    return handleGenerateKey(req, res);
  }
  if (path === '/admin/keys/list' && method === 'GET') {
    return handleListKeys(req, res, query);
  }
  if (path === '/admin/keys/revoke' && method === 'POST') {
    return handleRevokeKey(req, res);
  }

  // Authenticated API routes
  const PREFIX = `/api/${API_VERSION}`;

  if (path.startsWith(PREFIX)) {
    const auth = authenticate(req, res);
    if (!auth) return; // authenticate() already sent the error response

    const route = path.slice(PREFIX.length);

    try {
      if (route === '/status' && method === 'GET') {
        return await handleStatus(req, res, auth);
      }
      if (route === '/tasks' && method === 'GET') {
        return handleGetTasks(req, res, auth, query);
      }
      if (route === '/tasks' && method === 'POST') {
        return await handleCreateTask(req, res, auth);
      }
      if (route === '/message' && method === 'POST') {
        return await handleSendMessage(req, res, auth);
      }
      if (route === '/agents' && method === 'GET') {
        return handleGetAgents(req, res, auth);
      }
      if (route === '/knowledge' && method === 'GET') {
        return handleGetKnowledge(req, res, auth, query);
      }
      if (route === '/metrics' && method === 'GET') {
        return handleGetMetrics(req, res, auth);
      }

      // No route matched
      err(res, 404, `Unknown endpoint: ${method} ${path}`, 'NOT_FOUND');
    } catch (e) {
      log(`Unhandled error on ${method} ${path}: ${e.message}`);
      err(res, 500, 'Internal server error', 'INTERNAL');
    }

    return;
  }

  // Catch-all 404
  err(res, 404, `Not found: ${path}`, 'NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

server.listen(PORT, API_HOST, () => {
  log(`your9-api running on http://${API_HOST}:${PORT}`);
  log(`API version: ${API_VERSION}`);
  log(`Serving instances from: ${INSTANCES_DIR}`);
  log(`Admin endpoints: http://${API_HOST}:${PORT}/admin/keys/generate|list|revoke`);
});

server.on('error', e => {
  log(`Server error: ${e.message}`);
  if (e.code === 'EADDRINUSE') {
    log(`Port ${PORT} already in use — is another instance running?`);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => { log('SIGTERM received — shutting down'); server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { log('SIGINT received — shutting down');  server.close(() => process.exit(0)); });
