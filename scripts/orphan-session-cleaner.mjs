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
  'kids-mentor.mjs',
  'family-chat.mjs',
  'portfolio-notify.mjs',
  'underwriter-api.mjs',
  // Apr 10 hunt — added these legit agents to stop the 3am cleaner from killing
  // them and forcing LaunchAgent restarts every morning. The agents are PPID=1
  // because launchd adopts them, which is the intended design.
  'wendy-agent.mjs',
  'fort-agent.mjs',
  'tee-agent.mjs',
  'scout-agent.mjs',
  'agent-watchdog.mjs',
  'usage-monitor.mjs',
  'session-handoff.mjs',
  'tick-engine.mjs',
  'grok-recovery.mjs',
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

// 4. Orphan Claude CLI processes
// Apr 10 hunt — kill F: zombie Claude daily cleaner (named enemy from origin hunt).
// A Claude CLI is an orphan if it's NOT the hub-tracked active PID AND it's not
// a child of any live Terminal.app / iTerm process. Tonight's incident: PID 11407
// lingered on tty s001 after the terminal watchdog opened a new session; it held
// a stale session token and I had to kill it manually. This catches the same class.
import { readFileSync as _rfs } from 'node:fs';
function findOrphanClaudeCLIs() {
  let activePid = null;
  try { activePid = parseInt(_rfs('/tmp/9-terminal-pid', 'utf-8').trim()) || null; } catch {}
  // Get list of live Terminal.app / iTerm PIDs — their children are legitimately attached
  const terminalPids = new Set();
  const terms = safeExec(`ps -ax -o pid=,comm= | grep -E "(Terminal|iTerm2)$" | grep -v grep`);
  for (const line of terms.split('\n').filter(Boolean)) {
    const pid = parseInt(line.trim().split(/\s+/)[0]);
    if (pid > 0) terminalPids.add(pid);
  }
  function isDescendantOfTerminal(pid, depth = 0) {
    if (depth > 6 || pid <= 1) return false;
    if (terminalPids.has(pid)) return true;
    const ppid = parseInt(safeExec(`ps -o ppid= -p ${pid} 2>/dev/null`).trim()) || 0;
    if (!ppid || ppid <= 1) return false;
    return isDescendantOfTerminal(ppid, depth + 1);
  }
  // Use pgrep -x claude to find processes whose COMMAND NAME (not full path) equals 'claude'.
  // This excludes Claude.app (the Anthropic desktop app), Safari Web Apps that reference
  // Claude in their bundle path, and claude-watchdog. Only the Claude Code CLI matches.
  const pgrepOut = safeExec(`pgrep -x claude 2>/dev/null`);
  const claudePids = pgrepOut.split('\n').map(s => parseInt(s)).filter(n => n > 10);
  const candidates = [];
  for (const pid of claudePids) {
    if (pid === process.pid) continue;
    if (activePid && pid === activePid) continue; // the hub-tracked active session
    // Gather ppid/rss/args for this pid
    const info = safeExec(`ps -o ppid=,rss=,args= -p ${pid} 2>/dev/null`).trim();
    if (!info) continue;
    const parts = info.split(/\s+/);
    const ppid = parseInt(parts[0]) || 0;
    const rss = Math.round((parseInt(parts[1]) || 0) / 1024);
    const args = parts.slice(2).join(' ');
    // Safety: skip if it's still attached to a live Terminal/iTerm process tree
    if (isDescendantOfTerminal(ppid)) continue;
    // Only flag if running >5 min (avoid killing newly spawned sessions mid-claim)
    const etimeOut = safeExec(`ps -p ${pid} -o etime= 2>/dev/null`).trim();
    let ageSeconds = 0;
    const etimeParts = etimeOut.split(':');
    if (etimeParts.length === 2) ageSeconds = parseInt(etimeParts[0]) * 60 + parseInt(etimeParts[1]);
    else if (etimeParts.length === 3) ageSeconds = parseInt(etimeParts[0]) * 3600 + parseInt(etimeParts[1]) * 60 + parseInt(etimeParts[2]);
    if (ageSeconds < 300) continue;
    candidates.push({
      pid, ppid, rss_mb: rss,
      cmd: args.slice(0, 120),
      reason: `orphan Claude CLI (not hub-active PID, not descendant of Terminal, age ${Math.round(ageSeconds/60)}m)`,
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

  const orphanNodes   = findOrphanNodes();
  const zombies       = findZombies();
  const headless      = findHeadlessShells();
  const orphanClaudes = findOrphanClaudeCLIs();

  const allCandidates = [...orphanNodes, ...zombies, ...headless, ...orphanClaudes];

  log(`Found: ${orphanNodes.length} orphan nodes, ${zombies.length} zombies, ${headless.length} headless shells, ${orphanClaudes.length} orphan Claude CLIs`);
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
