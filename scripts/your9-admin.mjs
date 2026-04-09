#!/usr/bin/env node
/**
 * your9-admin.mjs — Internal Admin Panel (9 Enterprises Operator View)
 * Your9 by 9 Enterprises
 *
 * Central control room for the entire Your9 fleet. Operator-only.
 * Reads from instances/ directory, polls hub health endpoints, exposes
 * provisioning, pause/resume/restart/delete controls, cross-customer
 * analytics, and an alert log.
 *
 * Usage:
 *   node scripts/your9-admin.mjs
 *
 * HTTP server on port 3491, bound to 127.0.0.1.
 * Token auth: set YOUR9_ADMIN_TOKEN in environment or .env (root).
 * If not set, a random token is printed at startup.
 *
 * Endpoints:
 *   GET  /                  — Admin dashboard UI
 *   GET  /api/fleet         — All instances + health (JSON)
 *   GET  /api/analytics     — Cross-customer aggregate stats (JSON)
 *   GET  /api/alerts        — Alert log (JSON)
 *   POST /api/instance/pause    — body: { instanceId }
 *   POST /api/instance/resume   — body: { instanceId }
 *   POST /api/instance/restart  — body: { instanceId }
 *   POST /api/instance/delete   — body: { instanceId, confirm: true }
 *   POST /api/provision         — Create new test instance
 *   GET  /health            — Service health (no auth)
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  rmSync, appendFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOGS_DIR = join(ROOT, 'logs');
const ADMIN_LOG = join(LOGS_DIR, 'your9-admin.log');
const ROOT_ENV_PATH = join(ROOT, '.env');
const PROVISION_SCRIPT = join(__dirname, 'your9-provision.mjs');
const NODE = '/opt/homebrew/bin/node';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ADMIN_PORT = 3491;
const HEALTH_TIMEOUT_MS = 4_000;
const MANAGER_PORT = 3490;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

mkdirSync(LOGS_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ADMIN: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(ADMIN_LOG, line + '\n'); } catch {}
}

// ---------------------------------------------------------------------------
// Alert log — in-process ring buffer (survives restart via ADMIN_LOG scan)
// ---------------------------------------------------------------------------

const MAX_ALERTS = 200;
const alerts = [];

function addAlert(level, instanceId, message) {
  const alert = {
    ts: new Date().toISOString(),
    level,       // 'error' | 'warn' | 'info'
    instanceId,
    message,
  };
  alerts.unshift(alert);
  if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
  log(`ALERT [${level.toUpperCase()}] [${instanceId}] ${message}`);
}

// ---------------------------------------------------------------------------
// .env loader — reads key=value without polluting process.env
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
// Auth token
// ---------------------------------------------------------------------------

const rootEnv = loadEnvFile(ROOT_ENV_PATH);
let ADMIN_TOKEN = process.env.YOUR9_ADMIN_TOKEN || rootEnv.YOUR9_ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  ADMIN_TOKEN = randomBytes(24).toString('hex');
  log(`No YOUR9_ADMIN_TOKEN found — generated ephemeral token: ${ADMIN_TOKEN}`);
  log(`Add YOUR9_ADMIN_TOKEN=${ADMIN_TOKEN} to .env to persist across restarts`);
}

function isAuthorized(req) {
  const header = req.headers['x-admin-token'] || '';
  const url = new URL(req.url || '/', `http://127.0.0.1:${ADMIN_PORT}`);
  const query = url.searchParams.get('token') || '';
  return header === ADMIN_TOKEN || query === ADMIN_TOKEN;
}

// ---------------------------------------------------------------------------
// Port derivation — mirrors your9-manager.mjs
// ---------------------------------------------------------------------------

function deriveHubPort(customerId) {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return 4000 + (hash % 900);
}

// ---------------------------------------------------------------------------
// Instance discovery
// ---------------------------------------------------------------------------

function discoverInstances() {
  if (!existsSync(INSTANCES_DIR)) return [];
  return readdirSync(INSTANCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const id = d.name;
      const instanceDir = join(INSTANCES_DIR, id);
      const configDir = join(instanceDir, 'config');
      const envPath = join(configDir, '.env');
      const customerPath = join(configDir, 'customer.json');
      const billingPath = join(instanceDir, 'data', 'billing.json');
      const tasksPath = join(instanceDir, 'data', 'tasks.json');

      const instanceEnv = loadEnvFile(envPath);

      let customer = null;
      try { customer = JSON.parse(readFileSync(customerPath, 'utf-8')); } catch {}

      let billing = null;
      try { billing = JSON.parse(readFileSync(billingPath, 'utf-8')); } catch {}

      let tasks = null;
      try { tasks = JSON.parse(readFileSync(tasksPath, 'utf-8')); } catch {}

      // Hub port
      let hubPort = deriveHubPort(id);
      if (instanceEnv.YOUR9_HUB_PORT && !instanceEnv.YOUR9_HUB_PORT.startsWith('PLACEHOLDER_')) {
        const parsed = parseInt(instanceEnv.YOUR9_HUB_PORT);
        if (!isNaN(parsed)) hubPort = parsed;
      }
      const dashPort = hubPort + 100;

      return {
        id,
        instanceDir,
        customer,
        billing,
        tasks,
        hubPort,
        dashPort,
        // Flattened convenience fields
        name: customer?.name || id,
        tier: customer?.tier || 'unknown',
        status: customer?.status || 'unknown',
        industry: customer?.industry || '',
        provisionedAt: customer?.provisionedAt || null,
      };
    });
}

// ---------------------------------------------------------------------------
// Health checks — polls individual hub health endpoints
// ---------------------------------------------------------------------------

// Map<instanceId, { status: 'green'|'yellow'|'red', lastCheck: Date|null, data: object|null, error: string|null }>
const healthCache = new Map();

async function checkInstanceHealth(instance) {
  const url = `http://127.0.0.1:${instance.hubPort}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const prior = healthCache.get(instance.id);
      if (prior && prior.status === 'red') {
        addAlert('info', instance.id, `Hub recovered — now healthy on port ${instance.hubPort}`);
      }
      healthCache.set(instance.id, {
        status: 'green',
        lastCheck: new Date(),
        data,
        error: null,
      });
      return;
    }
    // HTTP error
    const prev = healthCache.get(instance.id);
    if (!prev || prev.status === 'green') {
      addAlert('warn', instance.id, `Hub returned HTTP ${res.status} on port ${instance.hubPort}`);
    }
    healthCache.set(instance.id, {
      status: 'yellow',
      lastCheck: new Date(),
      data: null,
      error: `HTTP ${res.status}`,
    });
  } catch (err) {
    const prev = healthCache.get(instance.id);
    if (!prev || prev.status !== 'red') {
      addAlert('error', instance.id, `Hub unreachable on port ${instance.hubPort}: ${err.message}`);
    }
    healthCache.set(instance.id, {
      status: instance.status === 'paused' ? 'yellow' : 'red',
      lastCheck: new Date(),
      data: null,
      error: err.message,
    });
  }
}

async function pollAllHealth(instances) {
  await Promise.allSettled(instances.map(i => checkInstanceHealth(i)));
}

// ---------------------------------------------------------------------------
// Analytics aggregator
// ---------------------------------------------------------------------------

function buildAnalytics(instances) {
  let totalTasks = 0;
  let totalApiCalls = 0;
  let totalActiveAgents = 0;
  const byTier = {};
  const byStatus = {};
  let newestProvision = null;

  for (const inst of instances) {
    // Tasks
    if (inst.tasks?.tasks?.length) totalTasks += inst.tasks.tasks.length;
    // Billing usage
    if (inst.billing?.usage) {
      totalTasks += inst.billing.usage.tasksCompleted || 0;
      totalApiCalls += inst.billing.usage.apiCalls || 0;
      totalActiveAgents += inst.billing.usage.activeAgents || 0;
    }
    // Tier breakdown
    byTier[inst.tier] = (byTier[inst.tier] || 0) + 1;
    // Status breakdown
    byStatus[inst.status] = (byStatus[inst.status] || 0) + 1;
    // Newest provision
    if (inst.provisionedAt) {
      if (!newestProvision || inst.provisionedAt > newestProvision) {
        newestProvision = inst.provisionedAt;
      }
    }
  }

  const healthSummary = { green: 0, yellow: 0, red: 0, unknown: 0 };
  for (const inst of instances) {
    const h = healthCache.get(inst.id);
    if (!h) healthSummary.unknown++;
    else healthSummary[h.status] = (healthSummary[h.status] || 0) + 1;
  }

  return {
    totalInstances: instances.length,
    totalTasksCompleted: totalTasks,
    totalApiCalls,
    totalActiveAgents,
    newestProvision,
    byTier,
    byStatus,
    health: healthSummary,
  };
}

// ---------------------------------------------------------------------------
// Fleet data builder — used by /api/fleet and the dashboard HTML
// ---------------------------------------------------------------------------

function buildFleet(instances) {
  return instances.map(inst => {
    const health = healthCache.get(inst.id) || { status: 'unknown', lastCheck: null, data: null, error: null };
    return {
      id: inst.id,
      name: inst.name,
      tier: inst.tier,
      status: inst.status,
      industry: inst.industry,
      provisionedAt: inst.provisionedAt,
      hubPort: inst.hubPort,
      dashPort: inst.dashPort,
      health: health.status,
      healthLastCheck: health.lastCheck ? health.lastCheck.toISOString() : null,
      healthData: health.data,
      healthError: health.error,
      tasksCompleted: inst.billing?.usage?.tasksCompleted || 0,
      apiCalls: inst.billing?.usage?.apiCalls || 0,
      billingStatus: inst.billing?.status || 'unknown',
    };
  });
}

// ---------------------------------------------------------------------------
// Manager bridge — forwards control actions to your9-manager on port 3490
// ---------------------------------------------------------------------------

async function managerAction(action, instanceId) {
  try {
    const res = await fetch(`http://127.0.0.1:${MANAGER_PORT}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId }),
      signal: AbortSignal.timeout(8_000),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: `Manager unreachable: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Customer status writer — updates customer.json status field
// ---------------------------------------------------------------------------

function writeCustomerStatus(instanceDir, status) {
  const customerPath = join(instanceDir, 'config', 'customer.json');
  try {
    const c = JSON.parse(readFileSync(customerPath, 'utf-8'));
    c.status = status;
    c.statusUpdatedAt = new Date().toISOString();
    writeFileSync(customerPath, JSON.stringify(c, null, 2));
    return true;
  } catch (err) {
    log(`Error writing customer status: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Provision new test instance — shells out to your9-provision.mjs
// ---------------------------------------------------------------------------

function runProvision(name, industry, personality, tier) {
  return new Promise((resolve) => {
    const args = [
      PROVISION_SCRIPT,
      '--name', name,
      '--industry', industry || 'general',
      '--personality', personality || 'direct',
      '--tier', tier || 'starter',
    ];
    let stdout = '';
    let stderr = '';
    const child = spawn(NODE, args, { cwd: ROOT, env: process.env });
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
    // Safety timeout
    setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ code: -1, stdout, stderr: stderr + '\nTimeout after 30s' });
    }, 30_000);
  });
}

// ---------------------------------------------------------------------------
// HTML Dashboard
// ---------------------------------------------------------------------------

function buildHtml(token) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your9 Admin — 9 Enterprises</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #111118;
    --surface2: #18181f;
    --border: #2a2a38;
    --accent: #6c63ff;
    --accent2: #a78bfa;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --text: #e2e8f0;
    --muted: #64748b;
    --danger: #7f1d1d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 13px; }

  /* Layout */
  #app { display: flex; flex-direction: column; height: 100%; }
  #topbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  #topbar .logo { font-size: 15px; font-weight: 700; letter-spacing: 0.08em; color: var(--accent2); }
  #topbar .logo span { color: var(--muted); font-weight: 400; }
  #topbar .meta { color: var(--muted); font-size: 11px; display: flex; gap: 16px; align-items: center; }
  #topbar .meta .badge { background: var(--surface2); border: 1px solid var(--border); padding: 2px 8px; border-radius: 4px; }

  #main { display: flex; flex: 1; overflow: hidden; }
  #sidebar { width: 200px; background: var(--surface); border-right: 1px solid var(--border); flex-shrink: 0; padding: 16px 0; }
  #sidebar nav a { display: block; padding: 8px 20px; color: var(--muted); text-decoration: none; font-size: 12px; letter-spacing: 0.05em; border-left: 2px solid transparent; transition: all 0.15s; }
  #sidebar nav a:hover, #sidebar nav a.active { color: var(--text); border-left-color: var(--accent); background: rgba(108,99,255,0.08); }
  #sidebar .section-label { color: var(--muted); font-size: 10px; letter-spacing: 0.1em; padding: 12px 20px 4px; text-transform: uppercase; }

  #content { flex: 1; overflow-y: auto; padding: 24px; }

  /* Panels */
  .panel { display: none; }
  .panel.active { display: block; }

  /* Stat cards */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat-card .label { color: var(--muted); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  .stat-card .value { font-size: 24px; font-weight: 700; color: var(--text); line-height: 1; }
  .stat-card .sub { color: var(--muted); font-size: 11px; margin-top: 4px; }

  /* Table */
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: var(--surface2); color: var(--muted); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); font-weight: 600; }
  td { padding: 11px 14px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,0.02); }

  /* Health badges */
  .health { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; }
  .health.green { color: var(--green); background: rgba(34,197,94,0.1); }
  .health.yellow { color: var(--yellow); background: rgba(234,179,8,0.1); }
  .health.red { color: var(--red); background: rgba(239,68,68,0.1); }
  .health.unknown { color: var(--muted); background: rgba(100,116,139,0.1); }
  .health::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }

  /* Status pill */
  .pill { font-size: 10px; padding: 2px 7px; border-radius: 3px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .pill.active { color: var(--green); background: rgba(34,197,94,0.1); }
  .pill.paused { color: var(--yellow); background: rgba(234,179,8,0.1); }
  .pill.terminated { color: var(--red); background: rgba(239,68,68,0.1); }
  .pill.provisioned { color: var(--accent2); background: rgba(167,139,250,0.1); }
  .pill.unknown { color: var(--muted); background: rgba(100,116,139,0.1); }

  /* Tier badge */
  .tier { font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 600; text-transform: uppercase; }
  .tier.starter { color: #94a3b8; background: rgba(148,163,184,0.12); }
  .tier.growth { color: #60a5fa; background: rgba(96,165,250,0.12); }
  .tier.enterprise { color: var(--accent2); background: rgba(167,139,250,0.12); }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: 5px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); font-family: inherit; font-size: 11px; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
  .btn:hover { background: var(--border); }
  .btn.primary { border-color: var(--accent); background: rgba(108,99,255,0.15); color: var(--accent2); }
  .btn.primary:hover { background: rgba(108,99,255,0.3); }
  .btn.danger { border-color: var(--red); background: rgba(239,68,68,0.1); color: var(--red); }
  .btn.danger:hover { background: rgba(239,68,68,0.2); }
  .btn.sm { padding: 3px 8px; font-size: 10px; }
  .btn-group { display: flex; gap: 4px; flex-wrap: wrap; }

  /* Link */
  .link { color: var(--accent2); text-decoration: none; font-size: 11px; }
  .link:hover { text-decoration: underline; }

  /* Section header */
  .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .section-header h2 { font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: 0.04em; }
  .section-header .actions { display: flex; gap: 8px; align-items: center; }

  /* Alert log */
  .alert-log { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .alert-item { display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 11px; }
  .alert-item:last-child { border-bottom: none; }
  .alert-item .ts { color: var(--muted); white-space: nowrap; flex-shrink: 0; }
  .alert-item .inst { color: var(--muted); flex-shrink: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .alert-item .msg { color: var(--text); }
  .alert-item.error .indicator { color: var(--red); }
  .alert-item.warn .indicator { color: var(--yellow); }
  .alert-item.info .indicator { color: var(--green); }
  .alert-item .indicator { flex-shrink: 0; font-weight: 700; font-size: 10px; }
  .empty { color: var(--muted); text-align: center; padding: 32px; font-size: 12px; }

  /* Provision form */
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 560px; margin-bottom: 16px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 10px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
  .field input, .field select { background: var(--surface2); border: 1px solid var(--border); border-radius: 5px; padding: 7px 10px; color: var(--text); font-family: inherit; font-size: 12px; outline: none; transition: border-color 0.15s; }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .field select option { background: var(--surface2); }

  /* Provision output */
  #provision-output { background: #050508; border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; font-size: 11px; color: #a3e635; white-space: pre-wrap; max-height: 260px; overflow-y: auto; display: none; margin-top: 14px; font-family: 'SF Mono', 'Fira Code', monospace; }

  /* Detail drawer — instance expand */
  .detail { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 14px; margin-top: 4px; font-size: 11px; line-height: 1.7; }
  .detail .kv { display: flex; gap: 8px; }
  .detail .kv .k { color: var(--muted); min-width: 130px; }
  .detail .kv .v { color: var(--text); }

  /* Toast */
  #toast { position: fixed; bottom: 24px; right: 24px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 16px; font-size: 12px; color: var(--text); opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 999; max-width: 300px; }
  #toast.show { opacity: 1; }
  #toast.ok { border-color: var(--green); color: var(--green); }
  #toast.err { border-color: var(--red); color: var(--red); }

  /* Last refresh */
  #refresh-ts { color: var(--muted); font-size: 10px; }

  /* Responsive */
  @media (max-width: 768px) {
    #sidebar { display: none; }
    .form-grid { grid-template-columns: 1fr; }
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 480px) {
    #content { padding: 14px; }
    .stat-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>
<div id="app">

  <!-- Topbar -->
  <div id="topbar">
    <div class="logo">YOUR9 <span>/ Admin Control Room</span></div>
    <div class="meta">
      <span class="badge">9 Enterprises</span>
      <span id="refresh-ts">Loading...</span>
    </div>
  </div>

  <div id="main">
    <!-- Sidebar -->
    <div id="sidebar">
      <div class="section-label">Navigation</div>
      <nav>
        <a href="#" class="active" data-panel="fleet">Fleet</a>
        <a href="#" data-panel="analytics">Analytics</a>
        <a href="#" data-panel="alerts">Alert Log</a>
        <a href="#" data-panel="provision">Provision</a>
      </nav>
    </div>

    <!-- Content -->
    <div id="content">

      <!-- Fleet Panel -->
      <div class="panel active" id="panel-fleet">
        <div class="section-header">
          <h2>Instance Fleet</h2>
          <div class="actions">
            <button class="btn sm" onclick="refreshAll()">Refresh</button>
          </div>
        </div>
        <div id="fleet-table-wrap" class="table-wrap">
          <div class="empty">Loading fleet...</div>
        </div>
      </div>

      <!-- Analytics Panel -->
      <div class="panel" id="panel-analytics">
        <div class="section-header">
          <h2>Cross-Customer Analytics</h2>
          <button class="btn sm" onclick="refreshAll()">Refresh</button>
        </div>
        <div id="stat-grid" class="stat-grid"></div>
        <div class="section-header" style="margin-top:8px">
          <h2>Breakdown by Tier</h2>
        </div>
        <div id="tier-grid" class="stat-grid"></div>
        <div class="section-header" style="margin-top:8px">
          <h2>Breakdown by Status</h2>
        </div>
        <div id="status-grid" class="stat-grid"></div>
      </div>

      <!-- Alerts Panel -->
      <div class="panel" id="panel-alerts">
        <div class="section-header">
          <h2>Alert Log</h2>
          <button class="btn sm" onclick="refreshAll()">Refresh</button>
        </div>
        <div id="alert-log" class="alert-log">
          <div class="empty">No alerts yet.</div>
        </div>
      </div>

      <!-- Provision Panel -->
      <div class="panel" id="panel-provision">
        <div class="section-header">
          <h2>Provision New Test Instance</h2>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Business Name *</label>
            <input id="p-name" type="text" placeholder="e.g. Apex Lending" />
          </div>
          <div class="field">
            <label>Industry *</label>
            <input id="p-industry" type="text" placeholder="e.g. mortgage, real estate" />
          </div>
          <div class="field">
            <label>Personality</label>
            <select id="p-personality">
              <option value="direct">Direct</option>
              <option value="warm">Warm</option>
              <option value="analytical">Analytical</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div class="field">
            <label>Tier</label>
            <select id="p-tier">
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
        <button class="btn primary" onclick="doProvision()" id="provision-btn">Provision Instance</button>
        <pre id="provision-output"></pre>
      </div>

    </div><!-- /content -->
  </div><!-- /main -->

</div><!-- /app -->

<div id="toast"></div>

<script>
const TOKEN = '${token}';
const API = (path) => path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('#sidebar nav a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const panel = a.dataset.panel;
    document.querySelectorAll('#sidebar nav a').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    document.getElementById('panel-' + panel).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(API(path), opts);
    return await res.json();
  } catch (err) {
    console.error('API error:', err);
    return null;
  }
}

async function postAction(path, body) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': TOKEN },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
function healthBadge(status) {
  const labels = { green: 'Healthy', yellow: 'Degraded', red: 'Down', unknown: 'Unknown' };
  return '<span class="health ' + status + '">' + (labels[status] || status) + '</span>';
}

function statusPill(s) {
  return '<span class="pill ' + s + '">' + s + '</span>';
}

function tierBadge(t) {
  return '<span class="tier ' + t + '">' + t + '</span>';
}

function shortId(id) {
  return id.length > 20 ? '...' + id.slice(-12) : id;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function fmtUptime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

// ---------------------------------------------------------------------------
// Fleet render
// ---------------------------------------------------------------------------
let fleetData = [];

function renderFleet(instances) {
  fleetData = instances;
  const wrap = document.getElementById('fleet-table-wrap');
  if (!instances || instances.length === 0) {
    wrap.innerHTML = '<div class="empty">No instances found in instances/ directory.</div>';
    return;
  }

  const rows = instances.map((inst, idx) => {
    const dashLink = 'http://127.0.0.1:' + inst.dashPort;
    return '<tr>' +
      '<td><span title="' + inst.id + '" style="cursor:pointer;color:var(--accent2)" onclick="toggleDetail(' + idx + ')">' + shortId(inst.id) + '</span></td>' +
      '<td><strong>' + escHtml(inst.name) + '</strong></td>' +
      '<td>' + tierBadge(inst.tier) + '</td>' +
      '<td>' + statusPill(inst.status) + '</td>' +
      '<td>' + healthBadge(inst.health) + '</td>' +
      '<td style="color:var(--muted)">' + (inst.tasksCompleted || 0) + '</td>' +
      '<td style="color:var(--muted)">' + fmtUptime(inst.provisionedAt) + '</td>' +
      '<td><a class="link" href="' + dashLink + '" target="_blank">Dashboard &rarr;</a></td>' +
      '<td>' + actionButtons(inst) + '</td>' +
    '</tr>' +
    '<tr id="detail-' + idx + '" style="display:none"><td colspan="9" style="padding:0 14px 10px">' +
      '<div class="detail">' +
        '<div class="kv"><span class="k">Instance ID</span><span class="v">' + escHtml(inst.id) + '</span></div>' +
        '<div class="kv"><span class="k">Industry</span><span class="v">' + escHtml(inst.industry || '—') + '</span></div>' +
        '<div class="kv"><span class="k">Hub Port</span><span class="v">' + inst.hubPort + '</span></div>' +
        '<div class="kv"><span class="k">Dashboard Port</span><span class="v">' + inst.dashPort + '</span></div>' +
        '<div class="kv"><span class="k">Provisioned</span><span class="v">' + fmtDate(inst.provisionedAt) + '</span></div>' +
        '<div class="kv"><span class="k">Billing Status</span><span class="v">' + escHtml(inst.billingStatus) + '</span></div>' +
        '<div class="kv"><span class="k">API Calls</span><span class="v">' + (inst.apiCalls || 0) + '</span></div>' +
        '<div class="kv"><span class="k">Health Error</span><span class="v" style="color:var(--red)">' + escHtml(inst.healthError || '—') + '</span></div>' +
      '</div>' +
    '</td></tr>';
  }).join('');

  wrap.innerHTML = '<table><thead><tr>' +
    '<th>ID</th><th>Name</th><th>Tier</th><th>Status</th><th>Health</th>' +
    '<th>Tasks</th><th>Age</th><th>Dashboard</th><th>Controls</th>' +
  '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function toggleDetail(idx) {
  const row = document.getElementById('detail-' + idx);
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

function actionButtons(inst) {
  const id = inst.id;
  const isPaused = inst.status === 'paused';
  const isTerminated = inst.status === 'terminated';
  let html = '<div class="btn-group">';
  if (!isTerminated) {
    if (isPaused) {
      html += '<button class="btn sm primary" onclick="doResume(\'' + id + '\')">Resume</button>';
    } else {
      html += '<button class="btn sm" onclick="doPause(\'' + id + '\')">Pause</button>';
    }
    html += '<button class="btn sm" onclick="doRestart(\'' + id + '\')">Restart</button>';
  }
  html += '<button class="btn sm danger" onclick="doDelete(\'' + id + '\')">Delete</button>';
  html += '</div>';
  return html;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Analytics render
// ---------------------------------------------------------------------------
function renderAnalytics(analytics) {
  const g = document.getElementById('stat-grid');
  g.innerHTML = statCard('Total Instances', analytics.totalInstances) +
    statCard('Tasks Completed', analytics.totalTasksCompleted) +
    statCard('API Calls', analytics.totalApiCalls) +
    statCard('Active Agents', analytics.totalActiveAgents) +
    statCard('Healthy', analytics.health.green, 'green') +
    statCard('Degraded', analytics.health.yellow, 'yellow') +
    statCard('Down', analytics.health.red, 'red') +
    statCard('Unknown', analytics.health.unknown);

  const tg = document.getElementById('tier-grid');
  tg.innerHTML = Object.entries(analytics.byTier || {}).map(([t, c]) => statCard(t, c)).join('') || '<div class="empty">No data.</div>';

  const sg = document.getElementById('status-grid');
  sg.innerHTML = Object.entries(analytics.byStatus || {}).map(([s, c]) => statCard(s, c)).join('') || '<div class="empty">No data.</div>';
}

function statCard(label, value, colorClass) {
  const colorMap = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)' };
  const col = colorClass ? colorMap[colorClass] || 'var(--text)' : 'var(--text)';
  return '<div class="stat-card"><div class="label">' + escHtml(label) + '</div><div class="value" style="color:' + col + '">' + (value ?? '—') + '</div></div>';
}

// ---------------------------------------------------------------------------
// Alerts render
// ---------------------------------------------------------------------------
function renderAlerts(alertList) {
  const el = document.getElementById('alert-log');
  if (!alertList || alertList.length === 0) {
    el.innerHTML = '<div class="empty">No alerts. Fleet is clean.</div>';
    return;
  }
  el.innerHTML = alertList.map(a => {
    const ts = fmtDate(a.ts);
    return '<div class="alert-item ' + escHtml(a.level) + '">' +
      '<span class="indicator">' + a.level.toUpperCase() + '</span>' +
      '<span class="ts">' + ts + '</span>' +
      '<span class="inst" title="' + escHtml(a.instanceId) + '">' + shortId(a.instanceId) + '</span>' +
      '<span class="msg">' + escHtml(a.message) + '</span>' +
    '</div>';
  }).join('');
}

// ---------------------------------------------------------------------------
// Refresh all data
// ---------------------------------------------------------------------------
async function refreshAll() {
  const [fleet, analytics, alertData] = await Promise.all([
    apiFetch('/api/fleet'),
    apiFetch('/api/analytics'),
    apiFetch('/api/alerts'),
  ]);

  if (fleet && fleet.instances) renderFleet(fleet.instances);
  if (analytics) renderAnalytics(analytics);
  if (alertData && alertData.alerts) renderAlerts(alertData.alerts);

  document.getElementById('refresh-ts').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ---------------------------------------------------------------------------
// Control actions
// ---------------------------------------------------------------------------
async function doPause(instanceId) {
  if (!confirm('Pause instance ' + instanceId + '?')) return;
  const r = await postAction('/api/instance/pause', { instanceId });
  if (r && r.ok) { toast('Paused: ' + shortId(instanceId)); refreshAll(); }
  else toast('Error: ' + (r?.error || 'unknown'), 'err');
}

async function doResume(instanceId) {
  const r = await postAction('/api/instance/resume', { instanceId });
  if (r && r.ok) { toast('Resumed: ' + shortId(instanceId)); refreshAll(); }
  else toast('Error: ' + (r?.error || 'unknown'), 'err');
}

async function doRestart(instanceId) {
  if (!confirm('Restart instance ' + instanceId + '?')) return;
  const r = await postAction('/api/instance/restart', { instanceId });
  if (r && r.ok) { toast('Restart issued: ' + shortId(instanceId)); refreshAll(); }
  else toast('Error: ' + (r?.error || 'unknown'), 'err');
}

async function doDelete(instanceId) {
  if (!confirm('DELETE instance ' + instanceId + '?\\n\\nThis removes all files. Cannot be undone.')) return;
  if (!confirm('Second confirm: permanently delete ' + instanceId + '?')) return;
  const r = await postAction('/api/instance/delete', { instanceId, confirm: true });
  if (r && r.ok) { toast('Deleted: ' + shortId(instanceId)); refreshAll(); }
  else toast('Error: ' + (r?.error || 'unknown'), 'err');
}

// ---------------------------------------------------------------------------
// Provision
// ---------------------------------------------------------------------------
async function doProvision() {
  const name = document.getElementById('p-name').value.trim();
  const industry = document.getElementById('p-industry').value.trim();
  const personality = document.getElementById('p-personality').value;
  const tier = document.getElementById('p-tier').value;

  if (!name || !industry) { toast('Name and industry are required.', 'err'); return; }

  const out = document.getElementById('provision-output');
  out.style.display = 'block';
  out.textContent = 'Provisioning...';
  document.getElementById('provision-btn').disabled = true;

  const r = await postAction('/api/provision', { name, industry, personality, tier });
  document.getElementById('provision-btn').disabled = false;

  if (r && r.ok) {
    out.textContent = r.output || 'Done.';
    toast('Instance provisioned.', 'ok');
    refreshAll();
  } else {
    out.textContent = (r && r.output) ? r.output : ('Error: ' + (r?.error || 'unknown'));
    toast('Provision failed.', 'err');
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
refreshAll();
setInterval(refreshAll, 15000);
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

function startServer(instances) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${ADMIN_PORT}`);
    const path = url.pathname;

    // Health — no auth
    if (req.method === 'GET' && path === '/health') {
      json(res, 200, {
        service: 'your9-admin',
        status: 'ok',
        port: ADMIN_PORT,
        instances: instances.length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Auth gate — all other routes
    if (!isAuthorized(req)) {
      json(res, 401, { error: 'Unauthorized. Provide X-Admin-Token header or ?token= query param.' });
      return;
    }

    // Dashboard HTML
    if (req.method === 'GET' && path === '/') {
      const token = url.searchParams.get('token') || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buildHtml(token));
      return;
    }

    // GET /api/fleet
    if (req.method === 'GET' && path === '/api/fleet') {
      const freshInstances = discoverInstances();
      await pollAllHealth(freshInstances);
      json(res, 200, {
        timestamp: new Date().toISOString(),
        total: freshInstances.length,
        instances: buildFleet(freshInstances),
      });
      return;
    }

    // GET /api/analytics
    if (req.method === 'GET' && path === '/api/analytics') {
      const freshInstances = discoverInstances();
      json(res, 200, {
        timestamp: new Date().toISOString(),
        ...buildAnalytics(freshInstances),
      });
      return;
    }

    // GET /api/alerts
    if (req.method === 'GET' && path === '/api/alerts') {
      json(res, 200, { alerts });
      return;
    }

    // POST routes — read body first
    if (req.method === 'POST') {
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}

      // Provision
      if (path === '/api/provision') {
        const { name, industry, personality, tier } = parsed;
        if (!name || !industry) {
          json(res, 400, { error: 'name and industry required' });
          return;
        }
        log(`Provisioning new instance: name="${name}" industry="${industry}" tier="${tier || 'starter'}"`);
        addAlert('info', 'admin', `Provisioning new instance: ${name} (${industry}/${tier || 'starter'})`);
        const result = await runProvision(name, industry, personality, tier);
        if (result.code === 0) {
          json(res, 200, { ok: true, output: result.stdout });
        } else {
          json(res, 500, { ok: false, error: 'Provision failed', output: result.stdout + result.stderr });
        }
        return;
      }

      // Instance controls
      const { instanceId, confirm: confirmDelete } = parsed;
      if (!instanceId) {
        json(res, 400, { error: 'instanceId required' });
        return;
      }

      const freshInstances = discoverInstances();
      const inst = freshInstances.find(i => i.id === instanceId);
      if (!inst) {
        json(res, 404, { error: `Instance "${instanceId}" not found` });
        return;
      }

      if (path === '/api/instance/pause') {
        const written = writeCustomerStatus(inst.instanceDir, 'paused');
        const managerResult = await managerAction('stop', instanceId);
        addAlert('warn', instanceId, `Instance paused by admin`);
        log(`Admin paused ${instanceId}`);
        json(res, 200, { ok: written, action: 'pause', instanceId, manager: managerResult });
        return;
      }

      if (path === '/api/instance/resume') {
        const written = writeCustomerStatus(inst.instanceDir, 'active');
        const managerResult = await managerAction('start', instanceId);
        addAlert('info', instanceId, `Instance resumed by admin`);
        log(`Admin resumed ${instanceId}`);
        json(res, 200, { ok: written, action: 'resume', instanceId, manager: managerResult });
        return;
      }

      if (path === '/api/instance/restart') {
        const managerResult = await managerAction('restart', instanceId);
        addAlert('info', instanceId, `Instance restarted by admin`);
        log(`Admin restarted ${instanceId}`);
        json(res, 200, { ok: true, action: 'restart', instanceId, manager: managerResult });
        return;
      }

      if (path === '/api/instance/delete') {
        if (!confirmDelete) {
          json(res, 400, { error: 'confirm: true required for delete' });
          return;
        }
        // Stop via manager first
        await managerAction('stop', instanceId);
        // Remove directory
        try {
          rmSync(inst.instanceDir, { recursive: true, force: true });
          addAlert('warn', instanceId, `Instance DELETED by admin`);
          log(`Admin DELETED ${instanceId}`);
          json(res, 200, { ok: true, action: 'delete', instanceId });
        } catch (err) {
          log(`Delete error for ${instanceId}: ${err.message}`);
          json(res, 500, { ok: false, error: err.message });
        }
        return;
      }

      json(res, 404, { error: 'Unknown action' });
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      log(`FATAL: Port ${ADMIN_PORT} already in use.`);
      process.exit(1);
    }
    log(`Server error: ${err.message}`);
  });

  server.listen(ADMIN_PORT, '127.0.0.1', () => {
    log(`Your9 Admin Panel running on http://127.0.0.1:${ADMIN_PORT}/?token=${ADMIN_TOKEN}`);
    log(`Monitoring ${instances.length} instance(s)`);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function setupShutdown() {
  function shutdown(sig) {
    log(`Received ${sig} — shutting down`);
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('Your9 Admin Panel starting...');

  const instances = discoverInstances();
  log(`Discovered ${instances.length} instance(s): ${instances.map(i => i.id).join(', ') || 'none'}`);

  // Initial health poll
  if (instances.length > 0) {
    log('Running initial health poll...');
    await pollAllHealth(instances);
    const green = [...healthCache.values()].filter(h => h.status === 'green').length;
    log(`Initial health: ${green}/${instances.length} instances healthy`);
  }

  setupShutdown();
  startServer(instances);

  // Periodic health poll — re-discovers instances every cycle to catch new ones
  setInterval(async () => {
    const fresh = discoverInstances();
    await pollAllHealth(fresh);
  }, 30_000);
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
