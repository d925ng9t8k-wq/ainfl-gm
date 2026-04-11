#!/usr/bin/env node
// run-regression-tests.mjs — Phase 3 regression test runner (Apr 11, 2026)
//
// Discovers all scripts/test-*.mjs, runs them, captures stdout/stderr,
// reports PASS/FAIL per exit code, writes a structured JSON report to
// /tmp/regression-test-report-<ts>.json, and exits 0/1 based on results.
//
// Scheduling rules:
//   - Tests tagged "destructive" (i.e. test-crash-survival.mjs) run LAST and
//     serialized, because they SIGKILL comms-hub.mjs mid-flight.
//   - All other tests run sequentially in the order discovered. Parallel mode
//     is deliberately disabled for now — too many tests share global state
//     (shared-state.json, WAL, signal file) and parallelism would flake.
//
// Usage:
//   node scripts/run-regression-tests.mjs                # run all
//   node scripts/run-regression-tests.mjs --filter=wal   # run only tests matching substring
//   node scripts/run-regression-tests.mjs --skip-destructive
//
// Exit codes: 0 = all passed, 1 = one or more failed, 2 = runner error.

import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..');

// Tests that must run LAST because they take the hub down.
const DESTRUCTIVE = new Set([
  'test-crash-survival.mjs',
]);

// Tests that are known to require a running comms-hub.mjs. If the hub isn't
// reachable, these are SKIPPED (not failed) so CI without a hub can still
// pass the unit-only subset.
const REQUIRES_HUB = new Set([
  'test-telegram-load.mjs',
  'test-crash-survival.mjs',
  'test-ara-poke.mjs',
]);

// Per-test timeouts (ms). Default to 120s.
const TIMEOUTS = {
  'test-crash-survival.mjs': 180_000,
  'test-telegram-load.mjs': 60_000,
  'test-memory-db.mjs': 30_000,
  'test-wal-replay.mjs': 30_000,
  'test-imap-uid-dedup.mjs': 30_000,
  'test-bridge-protocol.mjs': 30_000,
};
const DEFAULT_TIMEOUT = 120_000;

function parseArgs() {
  const args = { filter: null, skipDestructive: false };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--filter=')) args.filter = a.slice('--filter='.length);
    else if (a === '--skip-destructive') args.skipDestructive = true;
  }
  return args;
}

function discoverTests() {
  const all = readdirSync(SCRIPTS_DIR)
    .filter(f => /^test-.+\.mjs$/.test(f))
    .filter(f => f !== path.basename(__filename));
  // Partition: non-destructive first, destructive last.
  const safe = all.filter(f => !DESTRUCTIVE.has(f)).sort();
  const dangerous = all.filter(f => DESTRUCTIVE.has(f)).sort();
  return [...safe, ...dangerous];
}

async function hubReachable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('http://localhost:3457/health', { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

function runOne(file, timeoutMs) {
  return new Promise((resolve) => {
    const full = path.join(SCRIPTS_DIR, file);
    const start = Date.now();
    const child = spawn(process.execPath, [full], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      const durationMs = Date.now() - start;
      resolve({
        file,
        exitCode: code,
        signal,
        timedOut,
        durationMs,
        stdout: stdout.slice(-8000), // cap to keep report small
        stderr: stderr.slice(-4000),
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
        pass: !timedOut && code === 0,
      });
    });
    child.on('error', (e) => {
      clearTimeout(killer);
      resolve({
        file,
        exitCode: -1,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - start,
        stdout: '',
        stderr: e.message,
        stdoutBytes: 0,
        stderrBytes: e.message.length,
        pass: false,
      });
    });
  });
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const args = parseArgs();
  const runStart = Date.now();
  const runIso = new Date().toISOString();
  const reportTs = runIso.replace(/[:.]/g, '-');

  let tests = discoverTests();
  if (args.filter) {
    tests = tests.filter(f => f.includes(args.filter));
  }
  if (args.skipDestructive) {
    tests = tests.filter(f => !DESTRUCTIVE.has(f));
  }

  const hubUp = await hubReachable();
  console.log('=== Regression Test Runner ===');
  console.log(`timestamp: ${runIso}`);
  console.log(`hub reachable: ${hubUp ? 'yes' : 'no'}`);
  console.log(`tests discovered: ${tests.length}`);
  for (const t of tests) console.log(`  - ${t}${DESTRUCTIVE.has(t) ? ' (destructive — runs last)' : ''}`);
  console.log('');

  const results = [];
  for (const file of tests) {
    if (REQUIRES_HUB.has(file) && !hubUp) {
      console.log(`[SKIP] ${file} — requires comms-hub on :3457 (not reachable)`);
      results.push({
        file,
        pass: true, // skipped counts as pass so CI without a hub still passes
        skipped: true,
        reason: 'comms-hub unreachable',
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        stdoutBytes: 0,
        stderrBytes: 0,
      });
      continue;
    }
    const timeoutMs = TIMEOUTS[file] || DEFAULT_TIMEOUT;
    console.log(`[RUN ] ${file} (timeout ${fmtMs(timeoutMs)})`);
    const r = await runOne(file, timeoutMs);
    const tag = r.pass ? 'PASS' : (r.timedOut ? 'TIMEOUT' : 'FAIL');
    console.log(`[${tag.padEnd(4)}] ${file} — ${fmtMs(r.durationMs)} (exit ${r.exitCode}${r.signal ? ` signal ${r.signal}` : ''})`);
    if (!r.pass) {
      // Echo tail of stderr + last few stdout lines so CI logs show the failure fast.
      const lastStdout = r.stdout.trim().split('\n').slice(-20).join('\n');
      if (lastStdout) console.log(`    --- stdout tail ---\n${lastStdout.split('\n').map(l => '    ' + l).join('\n')}`);
      if (r.stderr.trim()) console.log(`    --- stderr ---\n${r.stderr.trim().split('\n').slice(-20).map(l => '    ' + l).join('\n')}`);
    }
    results.push(r);
  }

  const runEnd = Date.now();
  const passed = results.filter(r => r.pass && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.pass).length;

  const summary = {
    timestamp: runIso,
    durationMs: runEnd - runStart,
    hubReachable: hubUp,
    totalTests: results.length,
    passed,
    failed,
    skipped,
    allPass: failed === 0,
    tests: results,
  };

  // Write structured JSON report
  const reportDir = '/tmp';
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `regression-test-report-${reportTs}.json`);
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  // Also write a stable-named pointer so CI / other tooling can find the latest.
  writeFileSync(path.join(reportDir, 'regression-test-report-latest.json'), JSON.stringify(summary, null, 2));

  console.log('');
  console.log('=== Summary ===');
  console.log(`total:   ${summary.totalTests}`);
  console.log(`passed:  ${passed}`);
  console.log(`failed:  ${failed}`);
  console.log(`skipped: ${skipped}`);
  console.log(`duration: ${fmtMs(summary.durationMs)}`);
  console.log(`report:  ${reportPath}`);
  console.log('');
  console.log(summary.allPass ? 'OVERALL: PASS' : 'OVERALL: FAIL');

  process.exit(summary.allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Runner fatal error:', err);
  process.exit(2);
});
