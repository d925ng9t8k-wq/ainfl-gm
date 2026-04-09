#!/usr/bin/env node
/**
 * your9-manager.mjs — Instance Manager / Orchestrator
 * Your9 by 9 Enterprises
 *
 * Central orchestrator that manages all Your9 customer instances as a fleet.
 * Spawns and monitors hub + dashboard processes per instance, auto-recovers
 * failures, exposes unified status + fleet endpoints.
 *
 * Usage:
 *   node scripts/your9-manager.mjs --start-all
 *   node scripts/your9-manager.mjs --stop-all
 *   node scripts/your9-manager.mjs --status
 *   node scripts/your9-manager.mjs --instance <id> --start
 *   node scripts/your9-manager.mjs --instance <id> --stop
 *   node scripts/your9-manager.mjs --instance <id> --restart
 *
 * Manager HTTP endpoints (port 3490):
 *   GET /health    — manager health
 *   GET /status    — all instances with health, uptime, last activity
 *   GET /fleet     — JSON fleet summary
 *   POST /start    — body: { instanceId } — start one instance
 *   POST /stop     — body: { instanceId } — stop one instance
 *   POST /restart  — body: { instanceId } — restart one instance
 */

import {
  existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createServer } from 'http';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INSTANCES_DIR = join(ROOT, 'instances');
const LOGS_DIR = join(ROOT, 'logs');
const MANAGER_LOG = join(LOGS_DIR, 'your9-manager.log');
const NODE = '/opt/homebrew/bin/node';
const HUB_SCRIPT = join(__dirname, 'your9-hub.mjs');
const DASH_SCRIPT = join(__dirname, 'your9-dashboard.mjs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MANAGER_PORT = 3490;
const HEALTH_INTERVAL_MS = 30_000;   // 30s between health polls
const HEALTH_TIMEOUT_MS = 5_000;     // 5s per health check
const MAX_RESTARTS = 3;              // Max auto-restarts before alerting
const RESTART_COOLDOWN_MS = 10_000; // Wait before restart attempt

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

mkdirSync(LOGS_DIR, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] MANAGER: ${msg}`;
  try { process.stdout.write(line + '\n'); } catch {}
  try { appendFileSync(MANAGER_LOG, line + '\n'); } catch {}
}

// ---------------------------------------------------------------------------
// .env loader — does not pollute process.env
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
// Port derivation — mirrors your9-hub.mjs exactly
// ---------------------------------------------------------------------------

function deriveHubPort(customerId) {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    hash = (hash * 31 + customerId.charCodeAt(i)) >>> 0;
  }
  return 4000 + (hash % 900);
}

function deriveDashPort(hubPort) {
  return hubPort + 100;
}

// ---------------------------------------------------------------------------
// Instance discovery — scans instances/ directory
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

      const instanceEnv = loadEnvFile(envPath);
      let customerName = id;
      let status = 'active';
      let tier = 'starter';

      if (existsSync(customerPath)) {
        try {
          const c = JSON.parse(readFileSync(customerPath, 'utf-8'));
          customerName = c.name || id;
          status = c.status || 'active';
          tier = c.tier || 'starter';
        } catch {}
      }

      // Determine hub port
      let hubPort = deriveHubPort(id);
      if (
        instanceEnv.YOUR9_HUB_PORT &&
        !instanceEnv.YOUR9_HUB_PORT.startsWith('PLACEHOLDER_')
      ) {
        const parsed = parseInt(instanceEnv.YOUR9_HUB_PORT);
        if (!isNaN(parsed)) hubPort = parsed;
      }

      const dashPort = deriveDashPort(hubPort);

      return { id, instanceDir, customerName, status, tier, hubPort, dashPort };
    });
}

// ---------------------------------------------------------------------------
// Process registry — tracks running hub/dashboard processes per instance
// ---------------------------------------------------------------------------

// Map<instanceId, { hub: ChildProcess|null, dash: ChildProcess|null, startedAt: Date, restarts: number, lastRestartAt: Date|null, healthy: boolean, lastHealthAt: Date|null }>
const registry = new Map();

function getEntry(instanceId) {
  if (!registry.has(instanceId)) {
    registry.set(instanceId, {
      hub: null,
      dash: null,
      startedAt: null,
      restarts: 0,
      lastRestartAt: null,
      healthy: false,
      lastHealthAt: null,
    });
  }
  return registry.get(instanceId);
}

// ---------------------------------------------------------------------------
// Instance log directory — each instance logs to its own directory
// ---------------------------------------------------------------------------

function instanceLogDir(instanceDir) {
  const d = join(instanceDir, 'logs');
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

function spawnHub(instance) {
  const logDir = instanceLogDir(instance.instanceDir);
  const logPath = join(logDir, 'hub.log');
  const entry = getEntry(instance.id);

  if (entry.hub && !entry.hub.killed) {
    log(`[${instance.id}] Hub already running (PID ${entry.hub.pid}) — skip spawn`);
    return;
  }

  log(`[${instance.id}] Spawning hub on port ${instance.hubPort}`);

  const child = spawn(NODE, [HUB_SCRIPT, '--instance', instance.id], {
    cwd: ROOT,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stdout.on('data', chunk => {
    try { appendFileSync(logPath, chunk); } catch {}
  });
  child.stderr.on('data', chunk => {
    try { appendFileSync(logPath, chunk); } catch {}
  });

  child.on('exit', (code, signal) => {
    log(`[${instance.id}] Hub exited (code=${code}, signal=${signal})`);
    entry.hub = null;
    entry.healthy = false;
    // Auto-recovery handled by health monitor
  });

  entry.hub = child;
  entry.startedAt = new Date();
  log(`[${instance.id}] Hub spawned PID ${child.pid}`);
}

function spawnDash(instance) {
  const logDir = instanceLogDir(instance.instanceDir);
  const logPath = join(logDir, 'dashboard.log');
  const entry = getEntry(instance.id);

  if (entry.dash && !entry.dash.killed) {
    log(`[${instance.id}] Dashboard already running (PID ${entry.dash.pid}) — skip spawn`);
    return;
  }

  log(`[${instance.id}] Spawning dashboard on port ${instance.dashPort}`);

  const child = spawn(NODE, [DASH_SCRIPT, '--instance', instance.id], {
    cwd: ROOT,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stdout.on('data', chunk => {
    try { appendFileSync(logPath, chunk); } catch {}
  });
  child.stderr.on('data', chunk => {
    try { appendFileSync(logPath, chunk); } catch {}
  });

  child.on('exit', (code, signal) => {
    log(`[${instance.id}] Dashboard exited (code=${code}, signal=${signal})`);
    entry.dash = null;
  });

  entry.dash = child;
  log(`[${instance.id}] Dashboard spawned PID ${child.pid}`);
}

// ---------------------------------------------------------------------------
// Start / stop / restart
// ---------------------------------------------------------------------------

function startInstance(instance) {
  if (instance.status !== 'active') {
    log(`[${instance.id}] Skipping — status is "${instance.status}"`);
    return;
  }
  spawnHub(instance);
  spawnDash(instance);
}

function stopInstance(instance) {
  const entry = getEntry(instance.id);
  if (entry.hub && !entry.hub.killed) {
    log(`[${instance.id}] Stopping hub PID ${entry.hub.pid}`);
    entry.hub.kill('SIGTERM');
  }
  if (entry.dash && !entry.dash.killed) {
    log(`[${instance.id}] Stopping dashboard PID ${entry.dash.pid}`);
    entry.dash.kill('SIGTERM');
  }
}

async function restartInstance(instance) {
  stopInstance(instance);
  await sleep(RESTART_COOLDOWN_MS);
  startInstance(instance);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Health check — polls hub /health endpoint
// ---------------------------------------------------------------------------

async function checkHealth(instance) {
  const entry = getEntry(instance.id);
  const url = `http://127.0.0.1:${instance.hubPort}/health`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (res.ok) {
      entry.healthy = true;
      entry.lastHealthAt = new Date();
      return true;
    }
  } catch {
    // fall through
  }

  entry.healthy = false;
  return false;
}

// ---------------------------------------------------------------------------
// Health monitor loop — runs every 30s per active instance
// Auto-recovers downed hubs up to MAX_RESTARTS times
// ---------------------------------------------------------------------------

async function runHealthMonitor(instances) {
  for (const instance of instances) {
    if (instance.status !== 'active') continue;

    const entry = getEntry(instance.id);

    // Only monitor instances we started
    if (!entry.hub && !entry.startedAt) continue;

    const isUp = await checkHealth(instance);

    if (!isUp) {
      log(`[${instance.id}] Health check failed`);

      if (entry.hub && !entry.hub.killed) {
        // Hub process still running but health endpoint unreachable — not dead yet
        log(`[${instance.id}] Hub process alive but unhealthy — waiting for next cycle`);
        continue;
      }

      // Hub process is gone
      if (entry.restarts >= MAX_RESTARTS) {
        log(`[${instance.id}] ALERT: Hub down after ${entry.restarts} restarts — manual intervention required`);
        continue;
      }

      entry.restarts++;
      entry.lastRestartAt = new Date();
      log(`[${instance.id}] Auto-recovering hub (attempt ${entry.restarts}/${MAX_RESTARTS})`);
      startInstance(instance);
    } else {
      // Healthy — reset restart counter on sustained uptime
      if (entry.restarts > 0) {
        log(`[${instance.id}] Hub healthy again — resetting restart counter`);
        entry.restarts = 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Status helpers — used by HTTP endpoints and CLI --status
// ---------------------------------------------------------------------------

function buildStatus(instances) {
  return instances.map(inst => {
    const entry = registry.get(inst.id) || {};
    return {
      instanceId: inst.id,
      customerName: inst.customerName,
      tier: inst.tier,
      status: inst.status,
      hubPort: inst.hubPort,
      dashPort: inst.dashPort,
      hubPid: entry.hub?.pid || null,
      dashPid: entry.dash?.pid || null,
      hubAlive: !!(entry.hub && !entry.hub.killed),
      dashAlive: !!(entry.dash && !entry.dash.killed),
      healthy: entry.healthy || false,
      startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
      lastHealthAt: entry.lastHealthAt ? entry.lastHealthAt.toISOString() : null,
      restarts: entry.restarts || 0,
      lastRestartAt: entry.lastRestartAt ? entry.lastRestartAt.toISOString() : null,
    };
  });
}

// ---------------------------------------------------------------------------
// HTTP server — port 3490
// ---------------------------------------------------------------------------

function startManagerServer(instances) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${MANAGER_PORT}`);

    const send = (statusCode, body) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
      res.writeHead(statusCode, {
        'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
        'Cache-Control': 'no-cache',
      });
      res.end(payload);
    };

    // --- GET /health ---
    if (req.method === 'GET' && url.pathname === '/health') {
      const running = [...registry.values()].filter(e => e.hub && !e.hub.killed).length;
      send(200, {
        service: 'your9-manager',
        status: 'ok',
        port: MANAGER_PORT,
        managedInstances: instances.length,
        runningHubs: running,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // --- GET /status ---
    if (req.method === 'GET' && url.pathname === '/status') {
      send(200, {
        manager: {
          port: MANAGER_PORT,
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
        instances: buildStatus(instances),
      });
      return;
    }

    // --- GET /fleet ---
    if (req.method === 'GET' && url.pathname === '/fleet') {
      const statuses = buildStatus(instances);
      const running = statuses.filter(s => s.hubAlive).length;
      const healthy = statuses.filter(s => s.healthy).length;
      send(200, {
        fleet: {
          total: instances.length,
          running,
          healthy,
          degraded: running - healthy,
          stopped: instances.length - running,
        },
        instances: statuses,
      });
      return;
    }

    // --- POST /start | /stop | /restart ---
    if (req.method === 'POST' && ['/start', '/stop', '/restart'].includes(url.pathname)) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch {}

        const { instanceId } = parsed;
        if (!instanceId) {
          send(400, { error: 'instanceId required' });
          return;
        }

        const inst = instances.find(i => i.id === instanceId);
        if (!inst) {
          send(404, { error: `Instance "${instanceId}" not found` });
          return;
        }

        if (url.pathname === '/start') {
          startInstance(inst);
          send(200, { ok: true, action: 'start', instanceId });
        } else if (url.pathname === '/stop') {
          stopInstance(inst);
          send(200, { ok: true, action: 'stop', instanceId });
        } else if (url.pathname === '/restart') {
          restartInstance(inst).catch(e => log(`Restart error: ${e.message}`));
          send(200, { ok: true, action: 'restart', instanceId });
        }
      });
      return;
    }

    send(404, { error: 'Not found' });
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      log(`FATAL: Port ${MANAGER_PORT} already in use. Is the manager already running?`);
      process.exit(1);
    }
    log(`Server error: ${err.message}`);
  });

  server.listen(MANAGER_PORT, '127.0.0.1', () => {
    log(`Manager HTTP server listening on http://127.0.0.1:${MANAGER_PORT}`);
    log(`Endpoints: /health /status /fleet /start /stop /restart`);
  });
}

// ---------------------------------------------------------------------------
// CLI — parse args and run one-shot commands or start the manager daemon
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

function printStatus(instances) {
  const rows = buildStatus(instances);
  console.log('\n=== Your9 Fleet Status ===\n');
  if (rows.length === 0) {
    console.log('No instances found in instances/ directory.');
    return;
  }
  for (const r of rows) {
    const hubStatus = r.hubAlive ? (r.healthy ? 'HEALTHY' : 'RUNNING (unhealthy)') : 'STOPPED';
    const dashStatus = r.dashAlive ? 'UP' : 'DOWN';
    console.log(`[${r.instanceId}]`);
    console.log(`  Name:       ${r.customerName} (${r.tier})`);
    console.log(`  Hub:        port ${r.hubPort}  — ${hubStatus}  PID=${r.hubPid || '-'}`);
    console.log(`  Dashboard:  port ${r.dashPort}  — ${dashStatus}  PID=${r.dashPid || '-'}`);
    if (r.startedAt) console.log(`  Started:    ${r.startedAt}`);
    if (r.restarts > 0) console.log(`  Restarts:   ${r.restarts}`);
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function setupShutdown(instances) {
  function shutdown(signal) {
    log(`Received ${signal} — stopping all instances`);
    for (const inst of instances) {
      stopInstance(inst);
    }
    // Give processes a moment to exit, then quit
    setTimeout(() => {
      log('Manager shutdown complete');
      process.exit(0);
    }, 3000);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // Discover all instances
  const allInstances = discoverInstances();
  log(`Discovered ${allInstances.length} instance(s): ${allInstances.map(i => i.id).join(', ') || 'none'}`);

  // Determine target instances
  const targetId = args.instance;
  const targets = targetId
    ? allInstances.filter(i => i.id === targetId)
    : allInstances;

  if (targetId && targets.length === 0) {
    console.error(`Error: Instance "${targetId}" not found in instances/ directory.`);
    process.exit(1);
  }

  // --- One-shot: --status ---
  if (args.status) {
    printStatus(allInstances);
    process.exit(0);
  }

  // --- One-shot: --stop-all ---
  if (args['stop-all']) {
    console.log('Sending stop signal to all instances via manager API...');
    for (const inst of allInstances) {
      try {
        const res = await fetch(`http://127.0.0.1:${MANAGER_PORT}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId: inst.id }),
          signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        console.log(`  ${inst.id}: ${json.ok ? 'stopped' : json.error}`);
      } catch {
        console.log(`  ${inst.id}: manager not reachable — skipping`);
      }
    }
    process.exit(0);
  }

  // --- Instance-scoped one-shot commands (require running manager) ---
  if (args.start && targetId) {
    try {
      const res = await fetch(`http://127.0.0.1:${MANAGER_PORT}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: targetId }),
        signal: AbortSignal.timeout(5000),
      });
      const json = await res.json();
      console.log(json.ok ? `Started ${targetId}` : `Error: ${json.error}`);
    } catch {
      console.error('Manager not running. Start the manager first: node scripts/your9-manager.mjs --start-all');
    }
    process.exit(0);
  }

  if (args.stop && targetId) {
    try {
      const res = await fetch(`http://127.0.0.1:${MANAGER_PORT}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: targetId }),
        signal: AbortSignal.timeout(5000),
      });
      const json = await res.json();
      console.log(json.ok ? `Stopped ${targetId}` : `Error: ${json.error}`);
    } catch {
      console.error('Manager not running. Start the manager first: node scripts/your9-manager.mjs --start-all');
    }
    process.exit(0);
  }

  if (args.restart && targetId) {
    try {
      const res = await fetch(`http://127.0.0.1:${MANAGER_PORT}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: targetId }),
        signal: AbortSignal.timeout(5000),
      });
      const json = await res.json();
      console.log(json.ok ? `Restarting ${targetId}` : `Error: ${json.error}`);
    } catch {
      console.error('Manager not running. Start the manager first: node scripts/your9-manager.mjs --start-all');
    }
    process.exit(0);
  }

  // --- Daemon mode: --start-all (or no flag — default is daemon) ---
  // This is the primary mode: start manager server + all active instances + health loop
  if (args['start-all'] || (!args.status && !args['stop-all'] && !args.start && !args.stop && !args.restart)) {
    log('Starting Your9 Manager daemon');

    setupShutdown(allInstances);
    startManagerServer(allInstances);

    // Start all active instances
    for (const inst of targets) {
      startInstance(inst);
      await sleep(500); // Stagger startup to avoid port collisions on slow systems
    }

    // Health monitor loop
    log(`Health monitor active — polling every ${HEALTH_INTERVAL_MS / 1000}s`);
    setInterval(async () => {
      await runHealthMonitor(allInstances);
    }, HEALTH_INTERVAL_MS);

    // Initial health check after 5s (let hubs start up first)
    setTimeout(async () => {
      await runHealthMonitor(allInstances);
    }, 5000);

    log('Manager ready. Use Ctrl+C or SIGTERM to stop.');
  }
}

main().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
