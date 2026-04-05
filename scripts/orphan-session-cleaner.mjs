/**
 * orphan-session-cleaner.mjs
 * Identifies and kills stale orphaned sessions and subshells.
 *
 * Per Kyle Shea's guidance (Apr 5 2026):
 * Target: unterminated node sessions, zombie processes, headless bash/zsh subshells
 * that are no longer attached to active work.
 *
 * SAFETY RULES:
 * 1. Never kills a process that is a known production agent (listed in PROTECTED_PATTERNS).
 * 2. Never kills processes with PID <= 10 (system processes).
 * 3. Logs every kill decision with justification before executing.
 * 4. Dry-run by default — pass --kill to actually kill.
 * 5. Never kills the current process (self).
 *
 * Run daily via LaunchAgent com.9.orphan-cleaner.
 * Run manually: node scripts/orphan-session-cleaner.mjs [--kill]
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');
const LOG_FILE  = path.join(PROJECT, 'logs/orphan-cleaner.log');
const DRY_RUN   = !process.argv.includes('--kill');

mkdirSync(path.join(PROJECT, 'logs'), { recursive: true });

// ─── Protected process patterns — NEVER kill these ──────────────────────────
// Any process whose command line matches one of these is immune.
const PROTECTED_PATTERNS = [
  'comms-hub.mjs',
  'health-monitor.mjs',
  'voice-server.mjs',
  'trader9-bot.mjs',
  'trinity-agent.mjs',
  'jules-telegram.mjs',
  'pilot-server.mjs',
  'memory-autocommit.mjs',
  'backup-memory.mjs',
  'ram-watch-agent.mjs',
  'orphan-session-cleaner.mjs', // self
  'claude',
  'Claude',
  'open-terminal.mjs',
  'freeze-watchdog',
  'claude-watchdog',
];

// ─── Logging ──────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeExec(cmd, timeoutMs = 8000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim();
  } catch {
    return '';
  }
}

function isProtected(cmd) {
  if (!cmd) return false;
  return PROTECTED_PATTERNS.some(p => cmd.includes(p));
}

// ─── Candidate collectors ─────────────────────────────────────────────────────

// 1. Orphan node processes (PPID = 1, adopted by launchd, not a known agent)
function findOrphanNodes() {
  const out = safeExec(`ps -ax -o pid=,ppid=,rss=,comm=,args= | grep -E "\\bnode\\b" | grep -v grep`);
  const candidates = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid   = parseInt(parts[0]);
    const ppid  = parseInt(parts[1]);
    const rss   = Math.round(parseInt(parts[2]) / 1024);
    const comm  = parts.slice(3).join(' ');
    if (pid === process.pid) continue;
    if (pid <= 10) continue;
    if (ppid !== 1) continue;
    if (isProtected(comm)) continue;
    candidates.push({
      pid, ppid, rss_mb: rss,
      cmd: comm.slice(0, 120),
      reason: 'orphan node process (PPID=1, not a known agent)',
    });
  }
  return candidates;
}

// 2. Zombie processes (state Z — already dead, just need parent to reap)
function findZombies() {
  const out = safeExec(`ps -ax -o pid=,state=,comm= | awk '$2 ~ /Z/'`);
  const candidates = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid   = parseInt(parts[0]);
    const comm  = parts.slice(2).join(' ');
    if (pid <= 10) continue;
    candidates.push({
      pid, ppid: null, rss_mb: 0,
      cmd: comm.slice(0, 80),
      reason: 'zombie process (state=Z)',
    });
  }
  return candidates;
}

// 3. Headless bash/zsh with no TTY and no known active child
// These are subshells spawned by scripts that were never cleaned up.
function findHeadlessShells() {
  // Get all node/agent PIDs so we don't kill their shells
  const agentPids = new Set();
  for (const pattern of PROTECTED_PATTERNS) {
    const pids = safeExec(`pgrep -f "${pattern}" 2>/dev/null`);
    pids.split('\n').filter(Boolean).forEach(p => agentPids.add(parseInt(p)));
  }

  const out = safeExec(`ps -ax -o pid=,ppid=,tty=,rss=,comm=,args= | grep -E "\\b(bash|zsh)\\b" | grep -v grep`);
  const candidates = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const pid   = parseInt(parts[0]);
    const ppid  = parseInt(parts[1]);
    const tty   = parts[2];
    const rss   = Math.round(parseInt(parts[3]) / 1024);
    const args  = parts.slice(5).join(' ');

    if (pid === process.pid) continue;
    if (pid <= 10) continue;
    if (tty !== '?') continue; // has a TTY — skip
    if (agentPids.has(ppid)) continue; // parent is a known agent
    if (isProtected(args)) continue;

    // Check if this shell has any live children
    const children = safeExec(`pgrep -P ${pid} 2>/dev/null`).split('\n').filter(Boolean);
    if (children.length > 0) continue; // has active children — skip

    // Only flag if it's been running for more than 2 minutes (avoids killing newly spawned shells)
    const etimeOut = safeExec(`ps -p ${pid} -o etime= 2>/dev/null`).trim();
    // etime format: [[DD-]HH:]MM:SS
    let ageSeconds = 0;
    const etimeParts = etimeOut.split(':');
    if (etimeParts.length === 2) {
      ageSeconds = parseInt(etimeParts[0]) * 60 + parseInt(etimeParts[1]);
    } else if (etimeParts.length === 3) {
      ageSeconds = parseInt(etimeParts[0]) * 3600 + parseInt(etimeParts[1]) * 60 + parseInt(etimeParts[2]);
    }
    if (ageSeconds < 120) continue; // too young — skip

    candidates.push({
      pid, ppid, rss_mb: rss,
      cmd: args.slice(0, 100) || 'bash/zsh',
      reason: `headless shell (no TTY, no children, age ${Math.round(ageSeconds / 60)}m)`,
    });
  }
  return candidates;
}

// ─── Kill (or dry-run) ────────────────────────────────────────────────────────
function killProcess(pid, reason, cmd) {
  if (DRY_RUN) {
    log(`[DRY-RUN] Would kill PID=${pid} | reason: ${reason} | cmd: ${cmd}`);
    return false;
  }
  try {
    execSync(`kill ${pid}`, { timeout: 3000 });
    log(`[KILLED] PID=${pid} | reason: ${reason} | cmd: ${cmd}`);
    return true;
  } catch (e) {
    log(`[KILL FAILED] PID=${pid} | ${e.message} | cmd: ${cmd}`);
    return false;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  log(`=== Orphan Session Cleaner starting (mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE KILL'}) ===`);

  const orphanNodes = findOrphanNodes();
  const zombies     = findZombies();
  const headless    = findHeadlessShells();

  const allCandidates = [...orphanNodes, ...zombies, ...headless];

  log(`Found: ${orphanNodes.length} orphan nodes, ${zombies.length} zombies, ${headless.length} headless shells`);
  log(`Total candidates: ${allCandidates.length}`);

  if (allCandidates.length === 0) {
    log('Nothing to clean. System looks tidy.');
    return;
  }

  let killed = 0;
  for (const c of allCandidates) {
    log(`CANDIDATE: PID=${c.pid} RSS=${c.rss_mb}MB reason="${c.reason}" cmd="${c.cmd}"`);
    const ok = killProcess(c.pid, c.reason, c.cmd);
    if (ok) killed++;
  }

  const totalRssRecovered = allCandidates.reduce((sum, c) => sum + (c.rss_mb || 0), 0);

  if (DRY_RUN) {
    log(`[DRY-RUN COMPLETE] Would have killed ${allCandidates.length} processes (~${totalRssRecovered}MB RSS)`);
    log('Pass --kill to execute for real.');
  } else {
    log(`[COMPLETE] Killed ${killed}/${allCandidates.length} processes (~${totalRssRecovered}MB RSS recovered)`);
  }

  log('=== Done ===');
}

run().catch(e => {
  console.error('[orphan-cleaner] Fatal:', e.message);
  process.exit(1);
});
