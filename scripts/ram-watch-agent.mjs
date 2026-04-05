/**
 * ram-watch-agent.mjs
 * Continuous RAM and process profiler for the 9 universe.
 *
 * Per Kyle Shea's guidance (Apr 5 2026):
 * "we need to have 9 build a live-watch agent that can monitor PC resources over
 * a long period of time with standard ops running so he can evaluate and develop
 * a strategy for garbage collection, pruning, loading headers instead of full
 * context, more on-demand gets to sacrifice negligible speed for free memory, etc."
 *
 * - Samples every 30s
 * - Writes to SQLite table ram_samples
 * - Computes rolling 1m/5m/1hr trends and leak detection
 * - Identifies unterminated sessions (orphan node, zombie, headless bash)
 * - Logs human-readable analysis every 5 minutes
 * - Exposes /ram-watch/health on port 3459
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
let Database;
try {
  Database = _require('better-sqlite3-multiple-ciphers');
} catch {
  Database = _require('better-sqlite3');
}

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

// ─── Constants ────────────────────────────────────────────────────────────────
const DB_PATH         = path.join(PROJECT, 'data/9-memory.db');
const LOG_FILE        = path.join(PROJECT, 'logs/ram-watch.log');
const SAMPLE_INTERVAL = 30_000;   // 30s
const ANALYSIS_EVERY  = 10;       // log analysis every N samples (~5 minutes)
const TOP_PROCS       = 20;
const WATCH_PORT      = 3459;

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { process.stdout.write(line); } catch {}
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── SQLite ───────────────────────────────────────────────────────────────────
const ENCRYPTION_KEY = process.env.SQLITE_ENCRYPTION_KEY || null;
let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  if (ENCRYPTION_KEY) {
    _db.pragma(`key = '${ENCRYPTION_KEY}'`);
    _db.pragma('cipher = sqlcipher');
  }
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ram_samples (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp           TEXT    NOT NULL,
      process_name        TEXT    NOT NULL,
      pid                 INTEGER,
      rss_mb              REAL,
      vsz_mb              REAL,
      percent_mem         REAL,
      is_claude_subprocess INTEGER NOT NULL DEFAULT 0,
      notes               TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ram_samples_timestamp    ON ram_samples(timestamp);
    CREATE INDEX IF NOT EXISTS idx_ram_samples_process_name ON ram_samples(process_name);
    CREATE INDEX IF NOT EXISTS idx_ram_samples_pid          ON ram_samples(pid);
  `);
  return _db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeExec(cmd, timeoutMs = 8000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim();
  } catch {
    return '';
  }
}

function parseMb(str) {
  if (!str) return 0;
  const n = parseFloat(str);
  return isNaN(n) ? 0 : Math.round(n * 10) / 10;
}

// ─── Claude subprocess detection ─────────────────────────────────────────────
// Collect all PIDs of claude-related processes once per sample cycle
function getClaudePids() {
  const raw = safeExec('pgrep -f "claude" 2>/dev/null');
  const pids = new Set(raw.split('\n').filter(Boolean).map(Number));
  // Also include children of those processes
  for (const pid of [...pids]) {
    const kids = safeExec(`pgrep -P ${pid} 2>/dev/null`);
    kids.split('\n').filter(Boolean).forEach(p => pids.add(Number(p)));
  }
  return pids;
}

// ─── Process sampler ─────────────────────────────────────────────────────────
// Returns array of { process_name, pid, rss_mb, vsz_mb, percent_mem, notes }
function sampleTopProcesses() {
  // ps output: PID, RSS(KB), VSZ(KB), %MEM, COMMAND
  const raw = safeExec(
    `ps -ax -o pid=,rss=,vsz=,%mem=,comm= | sort -k2 -rn | head -${TOP_PROCS}`
  );
  if (!raw) return [];

  return raw.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/);
    const pid      = parseInt(parts[0]) || 0;
    const rss_mb   = parseMb((parseInt(parts[1]) / 1024).toFixed(1));
    const vsz_mb   = parseMb((parseInt(parts[2]) / 1024).toFixed(1));
    const pct      = parseMb(parts[3]);
    const comm     = parts.slice(4).join(' ') || 'unknown';
    // Shorten long command paths to basename
    const name     = comm.split('/').pop().slice(0, 80);
    return { pid, rss_mb, vsz_mb, percent_mem: pct, process_name: name, notes: null };
  });
}

// Named captures for specific processes of interest
function sampleNamedProcesses() {
  const targets = [
    { key: 'claude',    pattern: 'Claude',          label: 'Claude Code' },
    { key: 'node',      pattern: 'node\\b',         label: 'node (any)' },
    { key: 'terminal',  pattern: 'Terminal',        label: 'Terminal.app' },
    { key: 'safari',    pattern: 'Safari',          label: 'Safari/WebKit' },
    { key: 'teams',     pattern: 'Microsoft Teams', label: 'Teams' },
    { key: 'mail',      pattern: 'Mail$',           label: 'Mail.app' },
  ];

  const results = [];
  for (const t of targets) {
    const raw = safeExec(
      `ps -ax -o pid=,rss=,vsz=,%mem=,comm= | grep -i "${t.pattern}" | grep -v grep`
    );
    if (!raw) continue;
    let totalRss = 0, totalVsz = 0, totalPct = 0;
    const pids = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s+/);
      const pid  = parseInt(parts[0]) || 0;
      const rss  = parseMb((parseInt(parts[1]) / 1024).toFixed(1));
      const vsz  = parseMb((parseInt(parts[2]) / 1024).toFixed(1));
      const pct  = parseMb(parts[3]);
      totalRss += rss;
      totalVsz += vsz;
      totalPct += pct;
      pids.push(pid);
    }
    results.push({
      pid: pids[0] || 0,
      rss_mb: Math.round(totalRss * 10) / 10,
      vsz_mb: Math.round(totalVsz * 10) / 10,
      percent_mem: Math.round(totalPct * 10) / 10,
      process_name: t.label,
      notes: pids.length > 1 ? `${pids.length} procs: ${pids.slice(0, 5).join(',')}` : null,
    });
  }
  return results;
}

// System-wide totals row
function sampleSystemTotals() {
  try {
    const totalBytes = parseInt(safeExec('sysctl -n hw.memsize', 2000));
    const totalMb = Math.round(totalBytes / (1024 * 1024));

    const vmOut  = safeExec('vm_stat', 5000);
    const pageSize = parseInt(safeExec('sysctl -n hw.pagesize', 2000));
    const pages = {};
    for (const line of vmOut.split('\n')) {
      const m = line.match(/Pages\s+(.+?):\s+(\d+)/);
      if (m) pages[m[1].toLowerCase().trim()] = parseInt(m[2]);
    }
    const wiredMb  = Math.round((pages['wired down'] || 0) * pageSize / (1024 * 1024));
    const activeMb = Math.round((pages.active || 0) * pageSize / (1024 * 1024));
    const freeMb   = Math.round((pages.free || 0) * pageSize / (1024 * 1024));
    const inUseMb  = wiredMb + activeMb;

    // memory_pressure level
    const pressureOut = safeExec('memory_pressure 2>/dev/null | head -1', 5000);
    const pressure = pressureOut.toLowerCase().includes('critical') ? 'critical'
                   : pressureOut.toLowerCase().includes('warning') ? 'warning'
                   : 'normal';

    return {
      pid: 0,
      rss_mb:      inUseMb,
      vsz_mb:      totalMb,
      percent_mem: Math.round((inUseMb / totalMb) * 1000) / 10,
      process_name: '__system__',
      notes: `total=${totalMb}MB free=${freeMb}MB active=${activeMb}MB wired=${wiredMb}MB pressure=${pressure}`,
    };
  } catch {
    return null;
  }
}

// Node.js process count
function sampleNodeCount() {
  const raw = safeExec('pgrep -x node 2>/dev/null || pgrep -f "node " 2>/dev/null');
  const pids = raw.split('\n').filter(Boolean);
  return {
    pid: 0,
    rss_mb: 0,
    vsz_mb: 0,
    percent_mem: 0,
    process_name: '__node_count__',
    notes: `count=${pids.length} pids=${pids.slice(0, 10).join(',')}`,
  };
}

// ─── Orphan / unterminated session detection ─────────────────────────────────
function detectOrphans() {
  const suspects = [];

  // Node processes whose parent PID is 1 (adopted by launchd — potential orphans)
  const nodeOut = safeExec(
    `ps -ax -o pid=,ppid=,rss=,comm= | grep -E "\\bnode\\b" | grep -v grep`
  );
  for (const line of nodeOut.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid  = parseInt(parts[0]);
    const ppid = parseInt(parts[1]);
    const rss  = Math.round(parseInt(parts[2]) / 1024);
    const comm = parts.slice(3).join(' ');
    if (ppid === 1) {
      suspects.push({ pid, ppid, rss_mb: rss, reason: 'node-orphan', comm: comm.slice(0, 80) });
    }
  }

  // Zombie processes
  const zombieOut = safeExec(`ps -ax -o pid=,state=,comm= | grep -E "^\\s*\\d+\\s+Z"`);
  for (const line of zombieOut.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid  = parseInt(parts[0]);
    const comm = parts.slice(2).join(' ');
    suspects.push({ pid, ppid: null, rss_mb: 0, reason: 'zombie', comm: comm.slice(0, 80) });
  }

  // Bash subshells with no tty (headless — potential orphaned subshells)
  const bashOut = safeExec(
    `ps -ax -o pid=,ppid=,tty=,rss=,comm= | grep -E "\\bbash\\b|\\bzsh\\b" | grep -E "\\s\\?\\s" | grep -v grep`
  );
  for (const line of bashOut.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid  = parseInt(parts[0]);
    const ppid = parseInt(parts[1]);
    const rss  = Math.round(parseInt(parts[3]) / 1024);
    const comm = parts.slice(4).join(' ');
    suspects.push({ pid, ppid, rss_mb: rss, reason: 'headless-shell', comm: comm.slice(0, 80) });
  }

  return suspects;
}

// ─── Rolling stats ────────────────────────────────────────────────────────────
// Returns { trend_1m, trend_5m, trend_1hr } for a given process_name, in MB/min
function getRollingStats(processName) {
  try {
    const db = getDb();
    const now = new Date();

    function avgRss(minutesBack) {
      const since = new Date(now - minutesBack * 60_000).toISOString();
      const rows = db.prepare(`
        SELECT AVG(rss_mb) AS avg_rss
        FROM ram_samples
        WHERE process_name = ? AND timestamp >= ?
      `).get(processName, since);
      return rows?.avg_rss ?? null;
    }

    function firstLastSlope(minutesBack) {
      const since = new Date(now - minutesBack * 60_000).toISOString();
      const rows = db.prepare(`
        SELECT rss_mb, timestamp
        FROM ram_samples
        WHERE process_name = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `).all(processName, since);
      if (rows.length < 2) return null;
      const first = rows[0], last = rows[rows.length - 1];
      const dtMin = (new Date(last.timestamp) - new Date(first.timestamp)) / 60_000;
      if (dtMin < 0.1) return null;
      return Math.round(((last.rss_mb - first.rss_mb) / dtMin) * 100) / 100;
    }

    return {
      avg_1m:    avgRss(1),
      avg_5m:    avgRss(5),
      avg_1hr:   avgRss(60),
      trend_1m:  firstLastSlope(1),
      trend_5m:  firstLastSlope(5),
      trend_1hr: firstLastSlope(60),
    };
  } catch {
    return {};
  }
}

// ─── Leak detection ───────────────────────────────────────────────────────────
// A process is a "leak suspect" if it has grown >50MB over the last hour
// with no significant drops (never came back below 80% of peak)
function detectLeaks() {
  try {
    const db = getDb();
    const oneHrAgo = new Date(Date.now() - 3600_000).toISOString();

    const processes = db.prepare(`
      SELECT DISTINCT process_name FROM ram_samples
      WHERE timestamp >= ? AND process_name NOT IN ('__system__','__node_count__')
    `).all(oneHrAgo).map(r => r.process_name);

    const suspects = [];
    for (const name of processes) {
      const rows = db.prepare(`
        SELECT rss_mb, timestamp FROM ram_samples
        WHERE process_name = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `).all(name, oneHrAgo);
      if (rows.length < 4) continue;

      const first   = rows[0].rss_mb;
      const last    = rows[rows.length - 1].rss_mb;
      const peak    = Math.max(...rows.map(r => r.rss_mb));
      const growthMb = last - first;
      const minVal  = Math.min(...rows.map(r => r.rss_mb));

      // Heuristic: grew >50MB AND never dropped below 80% of peak
      const neverRetreated = minVal >= peak * 0.80;
      if (growthMb > 50 && neverRetreated) {
        suspects.push({ name, first_mb: first, last_mb: last, growth_mb: growthMb, peak_mb: peak });
      }
    }
    return suspects;
  } catch {
    return [];
  }
}

// ─── Sample cycle ─────────────────────────────────────────────────────────────
let sampleCount = 0;

async function takeSample() {
  sampleCount++;
  const ts  = new Date().toISOString();
  const db  = getDb();
  const claudePids = getClaudePids();

  const insert = db.prepare(`
    INSERT INTO ram_samples
      (timestamp, process_name, pid, rss_mb, vsz_mb, percent_mem, is_claude_subprocess, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(
        ts,
        r.process_name,
        r.pid || 0,
        r.rss_mb || 0,
        r.vsz_mb || 0,
        r.percent_mem || 0,
        claudePids.has(r.pid) ? 1 : 0,
        r.notes || null,
      );
    }
  });

  const rows = [];

  // System totals
  const sys = sampleSystemTotals();
  if (sys) rows.push(sys);

  // Node count
  rows.push(sampleNodeCount());

  // Named process groups
  rows.push(...sampleNamedProcesses());

  // Top 20 by RSS
  rows.push(...sampleTopProcesses());

  insertAll(rows);

  log(`[sample #${sampleCount}] ${rows.length} rows | sys: ${sys ? sys.rss_mb + 'MB / ' + sys.vsz_mb + 'MB' : 'n/a'}`);

  // Every ANALYSIS_EVERY samples (~5 min), write analysis to log
  if (sampleCount % ANALYSIS_EVERY === 0) {
    writeAnalysisLog();
  }
}

// ─── Analysis log ─────────────────────────────────────────────────────────────
function writeAnalysisLog() {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    // Latest system totals
    const sys = db.prepare(`
      SELECT rss_mb, vsz_mb, percent_mem, notes, timestamp
      FROM ram_samples WHERE process_name = '__system__'
      ORDER BY timestamp DESC LIMIT 1
    `).get();

    // Latest node count
    const nc = db.prepare(`
      SELECT notes FROM ram_samples WHERE process_name = '__node_count__'
      ORDER BY timestamp DESC LIMIT 1
    `).get();

    // Top 10 processes by latest RSS
    const topProcs = db.prepare(`
      SELECT process_name, pid, rss_mb, percent_mem, notes
      FROM ram_samples
      WHERE timestamp = (SELECT MAX(timestamp) FROM ram_samples)
        AND process_name NOT LIKE '__%__'
      ORDER BY rss_mb DESC LIMIT 10
    `).all();

    // Orphan detection
    const orphans = detectOrphans();

    // Leak suspects
    const leaks = detectLeaks();

    const lines = [
      `=== RAM ANALYSIS [${now}] ===`,
      '',
    ];

    if (sys) {
      lines.push(`SYSTEM: ${sys.rss_mb}MB in-use / ${sys.vsz_mb}MB total (${sys.percent_mem}%)`);
      lines.push(`        ${sys.notes || ''}`);
    }
    if (nc) {
      lines.push(`NODE:   ${nc.notes || 'no data'}`);
    }
    lines.push('');
    lines.push('TOP 10 PROCESSES BY RSS:');
    for (const p of topProcs) {
      const stats = getRollingStats(p.process_name);
      const trend = stats.trend_5m != null ? ` [5m drift: ${stats.trend_5m > 0 ? '+' : ''}${stats.trend_5m}MB/min]` : '';
      lines.push(`  ${p.rss_mb.toFixed(1).padStart(8)}MB  ${p.process_name.padEnd(40)} PID=${p.pid}${trend}`);
    }

    if (orphans.length > 0) {
      lines.push('');
      lines.push(`ORPHAN/SUSPECT SESSIONS (${orphans.length}):`);
      for (const o of orphans) {
        lines.push(`  PID=${o.pid} PPID=${o.ppid ?? '?'} RSS=${o.rss_mb}MB reason=${o.reason} cmd=${o.comm}`);
      }
    }

    if (leaks.length > 0) {
      lines.push('');
      lines.push(`LEAK SUSPECTS (grew >50MB/hr without retreating) (${leaks.length}):`);
      for (const l of leaks) {
        lines.push(`  ${l.name}: ${l.first_mb}MB -> ${l.last_mb}MB (+${l.growth_mb}MB) peak=${l.peak_mb}MB`);
      }
    }

    lines.push('');
    lines.push('=== END ANALYSIS ===');
    lines.push('');

    const block = lines.join('\n');
    appendFileSync(LOG_FILE, block);
    process.stdout.write(block);
  } catch (e) {
    log(`[analysis] error: ${e.message}`);
  }
}

// ─── HTTP health endpoint ─────────────────────────────────────────────────────
const server = createServer((req, res) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (req.url === '/health' || req.url === '/ram-watch/health') {
    res.writeHead(200, cors);
    res.end(JSON.stringify({
      status: 'running',
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      samples_taken: sampleCount,
      checked_at: new Date().toISOString(),
    }));
    return;
  }

  if (req.url === '/ram-watch/status') {
    try {
      const db  = getDb();
      const sys = db.prepare(
        `SELECT rss_mb, vsz_mb, percent_mem, notes, timestamp
         FROM ram_samples WHERE process_name = '__system__'
         ORDER BY timestamp DESC LIMIT 1`
      ).get();
      const orphans = detectOrphans();
      const leaks   = detectLeaks();
      res.writeHead(200, cors);
      res.end(JSON.stringify({ system: sys, orphan_count: orphans.length, leak_suspects: leaks.length, samples_taken: sampleCount }, null, 2));
    } catch (e) {
      res.writeHead(500, cors);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(WATCH_PORT, () => {
  log(`RAM watch health endpoint on port ${WATCH_PORT}`);
});
server.on('error', e => log(`HTTP server error: ${e.message}`));

// ─── Main loop ────────────────────────────────────────────────────────────────
async function sampleLoop() {
  try {
    await takeSample();
  } catch (e) {
    log(`[sample] error: ${e.message}`);
  }
  setTimeout(sampleLoop, SAMPLE_INTERVAL);
}

log('=== RAM Watch Agent starting ===');
log(`Sample interval: ${SAMPLE_INTERVAL / 1000}s | Analysis every ${ANALYSIS_EVERY} samples (~${(ANALYSIS_EVERY * SAMPLE_INTERVAL / 60000).toFixed(0)}m)`);
log(`SQLite: ${DB_PATH}`);

(async () => {
  // Create table on first run
  getDb();
  // Initial sample immediately
  await takeSample();
  // Then loop
  setTimeout(sampleLoop, SAMPLE_INTERVAL);
})();
