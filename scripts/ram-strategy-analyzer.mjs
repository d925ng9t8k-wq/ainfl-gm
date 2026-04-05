/**
 * ram-strategy-analyzer.mjs
 * Nightly 24-hour RAM profile analysis and strategy reporter.
 *
 * Per Kyle Shea's guidance (Apr 5 2026):
 * Reads last 24h of ram_samples and produces a daily report at
 * docs/ram-profile-daily.md. Sections: top memory hogs, growth leaders,
 * leak suspects, per-process recommendations, estimated recoverable memory.
 * Sends summary to Telegram via hub /send.
 *
 * Intended to be run via LaunchAgent nightly, or manually on demand.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
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
const DB_PATH    = path.join(PROJECT, 'data/9-memory.db');
const REPORT_DIR = path.join(PROJECT, 'docs');
const REPORT_OUT = path.join(REPORT_DIR, 'ram-profile-daily.md');
const HUB_URL    = 'http://localhost:3457';

mkdirSync(REPORT_DIR, { recursive: true });

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
  return _db;
}

// ─── Telegram send ────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  try {
    const res = await fetch(`${HUB_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telegram', message }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`Telegram send failed: ${res.status}`);
    else console.log('Telegram summary sent.');
  } catch (e) {
    console.error(`Telegram send error: ${e.message}`);
  }
}

// ─── Analysis helpers ─────────────────────────────────────────────────────────

function topHogsLast24h(db) {
  // Max RSS per process in the last 24h
  const since = new Date(Date.now() - 86400_000).toISOString();
  return db.prepare(`
    SELECT
      process_name,
      ROUND(MAX(rss_mb), 1) AS peak_rss,
      ROUND(AVG(rss_mb), 1) AS avg_rss,
      COUNT(*)               AS sample_count
    FROM ram_samples
    WHERE timestamp >= ?
      AND process_name NOT IN ('__system__', '__node_count__')
    GROUP BY process_name
    ORDER BY peak_rss DESC
    LIMIT 20
  `).all(since);
}

function systemTimeSeries(db) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  return db.prepare(`
    SELECT timestamp, rss_mb, percent_mem, notes
    FROM ram_samples
    WHERE process_name = '__system__' AND timestamp >= ?
    ORDER BY timestamp ASC
  `).all(since);
}

function growthLeaders(db) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const processes = db.prepare(`
    SELECT DISTINCT process_name FROM ram_samples
    WHERE timestamp >= ?
      AND process_name NOT IN ('__system__', '__node_count__')
  `).all(since).map(r => r.process_name);

  const results = [];
  for (const name of processes) {
    const rows = db.prepare(`
      SELECT rss_mb, timestamp FROM ram_samples
      WHERE process_name = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `).all(name, since);
    if (rows.length < 3) continue;
    const first  = rows[0].rss_mb;
    const last   = rows[rows.length - 1].rss_mb;
    const growth = last - first;
    if (growth > 5) {
      const dtHr = (new Date(rows[rows.length - 1].timestamp) - new Date(rows[0].timestamp)) / 3600_000;
      const rateMbHr = dtHr > 0 ? Math.round((growth / dtHr) * 10) / 10 : 0;
      results.push({ name, first_mb: first, last_mb: last, growth_mb: Math.round(growth * 10) / 10, rate_mb_per_hr: rateMbHr });
    }
  }
  return results.sort((a, b) => b.growth_mb - a.growth_mb).slice(0, 10);
}

function leakSuspects(db) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const processes = db.prepare(`
    SELECT DISTINCT process_name FROM ram_samples
    WHERE timestamp >= ?
      AND process_name NOT IN ('__system__', '__node_count__')
  `).all(since).map(r => r.process_name);

  const suspects = [];
  for (const name of processes) {
    const rows = db.prepare(`
      SELECT rss_mb, timestamp FROM ram_samples
      WHERE process_name = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `).all(name, since);
    if (rows.length < 6) continue;
    const first  = rows[0].rss_mb;
    const last   = rows[rows.length - 1].rss_mb;
    const peak   = Math.max(...rows.map(r => r.rss_mb));
    const minVal = Math.min(...rows.map(r => r.rss_mb));
    const growth = last - first;
    const neverRetreated = minVal >= peak * 0.75;
    if (growth > 30 && neverRetreated) {
      suspects.push({ name, first_mb: first, last_mb: last, peak_mb: peak, growth_mb: Math.round(growth * 10) / 10, min_mb: minVal });
    }
  }
  return suspects.sort((a, b) => b.growth_mb - a.growth_mb);
}

function orphanCount() {
  try {
    let total = 0;
    // Node orphans (ppid=1)
    const nodeOut = execSync(
      `ps -ax -o pid=,ppid=,comm= | grep -E "\\bnode\\b" | awk '$2==1'`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    total += nodeOut.split('\n').filter(Boolean).length;
    // Zombie processes
    const zombies = execSync(
      `ps -ax -o pid=,state= | awk '$2~/Z/'`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    total += zombies.split('\n').filter(Boolean).length;
    return total;
  } catch {
    return 0;
  }
}

// ─── Per-process recommendations ─────────────────────────────────────────────
function makeRecommendations(hogs, leaders, leaks) {
  const recs = [];

  for (const p of leaks) {
    recs.push({
      process: p.name,
      type: 'GC / leak fix',
      detail: `Grew ${p.growth_mb}MB over 24h without releasing memory. Investigate reference retention, event listener leaks, or unbounded caches.`,
      est_recoverable_mb: Math.round(p.growth_mb * 0.7),
    });
  }

  for (const p of leaders.slice(0, 5)) {
    if (leaks.find(l => l.name === p.name)) continue; // already covered
    recs.push({
      process: p.name,
      type: 'On-demand / header-only load',
      detail: `Growing at ${p.rate_mb_per_hr} MB/hr. Consider switching to header-only fetches where full context isn't required, or paginating large data loads.`,
      est_recoverable_mb: Math.round(p.growth_mb * 0.4),
    });
  }

  // Claude Code specific
  const claude = hogs.find(h => h.process_name.toLowerCase().includes('claude'));
  if (claude && claude.peak_rss > 800) {
    recs.push({
      process: 'Claude Code',
      type: 'Context pruning / compaction',
      detail: `Peak RSS ${claude.peak_rss}MB. Long sessions accumulate conversation context. Use /compact proactively at 60% context fill. Each compaction recovers ~200-400MB.`,
      est_recoverable_mb: 300,
    });
  }

  // Node processes
  const nodePeak = hogs.find(h => h.process_name.toLowerCase().includes('node'));
  if (nodePeak && nodePeak.peak_rss > 500) {
    recs.push({
      process: 'node.js processes',
      type: 'Session pruning',
      detail: `Node RSS peak ${nodePeak.peak_rss}MB. Kill unterminated sessions with orphan-session-cleaner.mjs. Each orphaned session typically holds 50-200MB.`,
      est_recoverable_mb: 150,
    });
  }

  return recs;
}

// ─── Report builder ───────────────────────────────────────────────────────────
async function buildReport() {
  const db   = getDb();
  const now  = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  console.log('[analyzer] Querying last 24h of ram_samples...');

  const totalSamples = db.prepare(
    `SELECT COUNT(*) AS n FROM ram_samples WHERE timestamp >= ?`
  ).get(new Date(now - 86400_000).toISOString())?.n || 0;

  if (totalSamples === 0) {
    console.log('[analyzer] No samples found in last 24h. Run ram-watch-agent first.');
    process.exit(0);
  }

  const hogs    = topHogsLast24h(db);
  const sysSeries = systemTimeSeries(db);
  const leaders = growthLeaders(db);
  const leaks   = leakSuspects(db);
  const orphans = orphanCount();
  const recs    = makeRecommendations(hogs, leaders, leaks);

  const sysFirst = sysSeries[0];
  const sysLast  = sysSeries[sysSeries.length - 1];
  const sysPeakRow = sysSeries.reduce((max, r) => r.rss_mb > max.rss_mb ? r : max, sysSeries[0] || { rss_mb: 0 });
  const totalRecoverable = recs.reduce((sum, r) => sum + (r.est_recoverable_mb || 0), 0);

  const lines = [
    `# RAM Profile Daily Report — ${dateStr}`,
    '',
    `**Generated:** ${now.toISOString()}`,
    `**Samples analyzed:** ${totalSamples} (last 24h)`,
    `**Orphaned/unterminated sessions detected:** ${orphans}`,
    '',
    '---',
    '',
    '## System Memory Overview',
    '',
  ];

  if (sysFirst && sysLast) {
    lines.push(`| Metric | Start of period | End of period | Peak |`);
    lines.push(`|--------|----------------|---------------|------|`);
    lines.push(`| In-use RAM | ${sysFirst.rss_mb}MB | ${sysLast.rss_mb}MB | ${sysPeakRow.rss_mb}MB |`);
    lines.push(`| % of total | ${sysFirst.percent_mem}% | ${sysLast.percent_mem}% | — |`);
    if (sysLast.notes) lines.push(``, `**Latest:** ${sysLast.notes}`);
  } else {
    lines.push('_No system samples available._');
  }

  lines.push('', '---', '', '## Top Memory Hogs (24h peak RSS)', '');
  lines.push('| Process | Peak RSS | Avg RSS | Samples |');
  lines.push('|---------|----------|---------|---------|');
  for (const p of hogs) {
    lines.push(`| ${p.process_name} | ${p.peak_rss}MB | ${p.avg_rss}MB | ${p.sample_count} |`);
  }

  lines.push('', '---', '', '## Growth Leaders (processes gaining RAM over 24h)', '');
  if (leaders.length === 0) {
    lines.push('_No significant growers detected._');
  } else {
    lines.push('| Process | Start | End | Growth | Rate |');
    lines.push('|---------|-------|-----|--------|------|');
    for (const l of leaders) {
      lines.push(`| ${l.name} | ${l.first_mb}MB | ${l.last_mb}MB | +${l.growth_mb}MB | ${l.rate_mb_per_hr}MB/hr |`);
    }
  }

  lines.push('', '---', '', '## Leak Suspects', '');
  lines.push('_A process is flagged if it grew >30MB in 24h without ever retreating below 75% of its peak._');
  lines.push('');
  if (leaks.length === 0) {
    lines.push('_No leak suspects detected._');
  } else {
    lines.push('| Process | Start | Peak | End | Growth |');
    lines.push('|---------|-------|------|-----|--------|');
    for (const l of leaks) {
      lines.push(`| ${l.name} | ${l.first_mb}MB | ${l.peak_mb}MB | ${l.last_mb}MB | +${l.growth_mb}MB |`);
    }
  }

  lines.push('', '---', '', '## Per-Process Recommendations', '');
  if (recs.length === 0) {
    lines.push('_No actionable recommendations at this time._');
  } else {
    for (const r of recs) {
      lines.push(`### ${r.process}`);
      lines.push(`**Strategy:** ${r.type}`);
      lines.push(`**Analysis:** ${r.detail}`);
      lines.push(`**Estimated recoverable:** ~${r.est_recoverable_mb}MB`);
      lines.push('');
    }
  }

  lines.push('---', '', '## Estimated Recoverable Memory', '');
  lines.push(`If all recommended strategies above are applied, estimated recoverable RAM: **~${totalRecoverable}MB**.`);
  lines.push('');
  lines.push('| Strategy | Target | Est. Recovery |');
  lines.push('|----------|--------|---------------|');
  for (const r of recs) {
    lines.push(`| ${r.type} | ${r.process} | ~${r.est_recoverable_mb}MB |`);
  }
  lines.push(`| **TOTAL** | | **~${totalRecoverable}MB** |`);

  lines.push('', '---', '', '## Orphaned / Unterminated Sessions', '');
  lines.push(`Detected at report time: **${orphans}** suspect processes (node orphans + zombies).`);
  lines.push('Run `node scripts/orphan-session-cleaner.mjs` to safely clean these.');

  lines.push('', '---', '', `_Report generated by ram-strategy-analyzer.mjs per Kyle Shea's architecture guidance (Apr 5 2026)._`);

  const report = lines.join('\n');
  writeFileSync(REPORT_OUT, report, 'utf-8');
  console.log(`[analyzer] Report written to ${REPORT_OUT}`);

  // Telegram summary (concise)
  const telegramMsg = [
    `[RAM Daily Report ${dateStr}]`,
    `Samples: ${totalSamples} | Orphans: ${orphans}`,
    sysLast ? `RAM in-use: ${sysLast.rss_mb}MB (${sysLast.percent_mem}%)` : '',
    leaks.length > 0 ? `Leak suspects: ${leaks.map(l => l.name + ' +' + l.growth_mb + 'MB').join(', ')}` : 'No leaks',
    `Est. recoverable: ~${totalRecoverable}MB`,
    `Full report: docs/ram-profile-daily.md`,
  ].filter(Boolean).join('\n');

  await sendTelegram(telegramMsg);
  console.log('[analyzer] Done.');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
buildReport().catch(e => {
  console.error('[analyzer] Fatal:', e.message);
  process.exit(1);
});
