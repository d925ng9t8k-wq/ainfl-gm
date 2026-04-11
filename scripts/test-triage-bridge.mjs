#!/usr/bin/env node
// test-triage-bridge.mjs — regression test for scripts/triage-bridge.mjs
//
// Strategy: stage minimal mock state on disk that each trigger reads, run
// triage-bridge with --once --dry-run, and assert the structured TRIAGE_RESULTS
// JSON line shows the expected fire/skip outcome.
//
// We do NOT touch /tmp/9-incoming-message.jsonl or send any real Telegram —
// --dry-run guarantees the daemon never calls fetch() against /terminal/poke
// or /send.
//
// Exit codes: 0 = pass, 1 = fail, 2 = skip (preconditions missing).
//
// Required preconditions:
//   - The triage-bridge.mjs file exists in scripts/.
//   - We are running from the repo root (or anywhere — paths are absolute).
//
// This test BACKS UP and RESTORES any pre-existing files it touches:
//   - data/ara-bridge-state.json
//   - data/ara-conversation.jsonl
//   - data/triage-9-status-for-ara.json
//   - logs/backup-memory.log
//   - /tmp/9-last-tool-call

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const FILES = {
  bridge: path.join(ROOT, 'data', 'ara-bridge-state.json'),
  conv: path.join(ROOT, 'data', 'ara-conversation.jsonl'),
  statusForAra: path.join(ROOT, 'data', 'triage-9-status-for-ara.json'),
  backupLog: path.join(ROOT, 'logs', 'backup-memory.log'),
  heartbeat: '/tmp/9-last-tool-call',
};

const backups = new Map();
function backup(p) {
  if (fs.existsSync(p)) {
    backups.set(p, fs.readFileSync(p));
  } else {
    backups.set(p, null);
  }
}
function restore() {
  for (const [p, content] of backups.entries()) {
    try {
      if (content === null) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } else {
        fs.writeFileSync(p, content);
      }
    } catch (e) {
      console.error(`restore failed for ${p}: ${e.message}`);
    }
  }
}

function fail(msg, extra) {
  console.error(`FAIL: ${msg}`);
  if (extra) console.error(extra);
  restore();
  process.exit(1);
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function runDaemonOnce() {
  const res = spawnSync('node', [path.join(__dirname, 'triage-bridge.mjs'), '--once', '--dry-run'], {
    cwd: ROOT,
    env: { ...process.env, POLL_MS: '999999' },
    encoding: 'utf8',
    timeout: 30000,
  });
  if (res.status !== 0) {
    fail(`triage-bridge --once exited ${res.status}`, res.stderr || res.stdout);
  }
  // Find the TRIAGE_RESULTS=... line.
  const line = res.stdout.split('\n').find(l => l.startsWith('TRIAGE_RESULTS='));
  if (!line) fail('no TRIAGE_RESULTS line in output', res.stdout);
  try {
    return { results: JSON.parse(line.slice('TRIAGE_RESULTS='.length)), stdout: res.stdout };
  } catch (e) {
    fail(`could not parse TRIAGE_RESULTS: ${e.message}`, line);
  }
}

function findResult(results, trigger) {
  return results.find(r => r.trigger === trigger);
}

async function main() {
  // Sanity: triage-bridge exists.
  const daemon = path.join(__dirname, 'triage-bridge.mjs');
  if (!fs.existsSync(daemon)) {
    console.error('SKIP: triage-bridge.mjs not found');
    process.exit(2);
  }

  // Back everything up.
  for (const p of Object.values(FILES)) backup(p);

  // ── Stage T1: 9 freeze (heartbeat 10 minutes ago) ──
  // Note: T1 only fires when terminal is in relay mode AND hub is reachable.
  // In CI / dry-run we just check it COMPILES correctly — fire-or-skip both pass.
  fs.writeFileSync(FILES.heartbeat, String(Math.floor((Date.now() - 600 * 1000) / 1000)));

  // ── Stage T2: backup-memory failure (last 2 cycles failed) ──
  const fakeBackupLog = [
    '[2026-04-11T07:00:00.000Z] === backup-memory.mjs starting ===',
    '[2026-04-11T07:00:01.000Z] BACKUP FAILED: simulated error 1',
    '[2026-04-11T07:01:00.000Z] === backup-memory.mjs starting ===',
    '[2026-04-11T07:01:01.000Z] BACKUP FAILED: simulated error 2',
  ].join('\n') + '\n';
  fs.mkdirSync(path.dirname(FILES.backupLog), { recursive: true });
  fs.writeFileSync(FILES.backupLog, fakeBackupLog);

  // ── Stage T5: Ara stuck (lastSent.ackAt null, sentAt 10 min ago) ──
  const fakeBridgeState = {
    nineSeq: 5,
    lastAraSeq: 2,
    lastSent: {
      seq: 5,
      wrapped: '[9-SEQ 5] test',
      checksum: 'sha256:test',
      method: 'send',
      sentAt: Date.now() - 600 * 1000,
      ackAt: null,
      retryCount: 0,
    },
  };
  fs.writeFileSync(FILES.bridge, JSON.stringify(fakeBridgeState, null, 2));

  // ── Stage T6: Ara conv with stale references ──
  const fakeMsgs = [
    JSON.stringify({
      ts: new Date().toISOString(),
      role: 'assistant',
      content: 'I checked `scripts/this-does-not-exist.mjs` and `data/fake-file.json` — both look fine. Also the file `scripts/ara-bridge.mjs` is there.',
      seq: 99,
    }),
  ].join('\n') + '\n';
  fs.writeFileSync(FILES.conv, fakeMsgs);

  // Remove any old status snapshot so we can verify a fire would write one.
  // (Dry run does NOT actually write — we just check the trigger output.)
  if (fs.existsSync(FILES.statusForAra)) fs.unlinkSync(FILES.statusForAra);

  // ── Run cycle ──
  const { results, stdout } = runDaemonOnce();
  console.log('--- daemon stdout ---');
  console.log(stdout);
  console.log('--- end stdout ---');

  // ── Assertions ──
  // T1: must be present in results — fired OR skipped (depends on hub reachable).
  const t1 = findResult(results, 'T1');
  if (!t1) fail('T1 missing from results');
  pass(`T1 present: ${JSON.stringify(t1)}`);

  // T2: MUST fire (we staged 2 failed cycles) UNLESS skipped by cooldown
  // (cooldown is fresh-process so impossible). Accept fired=true OR skip-arming-state.
  const t2 = findResult(results, 'T2');
  if (!t2) fail('T2 missing from results');
  if (!t2.fired) {
    // The implementation may also report ok with failedCycles>=2 in transitional states;
    // accept fired:true as the strict win, otherwise fail loudly.
    fail(`T2 should have fired with 2 staged failed cycles: ${JSON.stringify(t2)}`);
  }
  pass(`T2 fired: ${JSON.stringify(t2)}`);

  // T3: gh may be present — accept either fired/skipped/ok. Just must exist.
  const t3 = findResult(results, 'T3');
  if (!t3) fail('T3 missing from results');
  pass(`T3 present: ${JSON.stringify(t3)}`);

  // T4: hub may be reachable or not — present is enough.
  const t4 = findResult(results, 'T4');
  if (!t4) fail('T4 missing from results');
  pass(`T4 present: ${JSON.stringify(t4)}`);

  // T5: MUST fire (Ara stuck 10min, no ack).
  const t5 = findResult(results, 'T5');
  if (!t5) fail('T5 missing from results');
  if (!t5.fired) fail(`T5 should have fired with stuck bridge state: ${JSON.stringify(t5)}`);
  pass(`T5 fired: ${JSON.stringify(t5)}`);

  // T6: MUST fire (we staged 2 missing refs).
  const t6 = findResult(results, 'T6');
  if (!t6) fail('T6 missing from results');
  if (!t6.fired) fail(`T6 should have fired with stale refs staged: ${JSON.stringify(t6)}`);
  if (t6.missing < 2) fail(`T6 missing count expected >=2, got ${t6.missing}`);
  pass(`T6 fired: ${JSON.stringify(t6)}`);

  // T7: cannot fire on first cycle (no tracked pokes from prior cycles).
  const t7 = findResult(results, 'T7');
  if (!t7) fail('T7 missing from results');
  pass(`T7 present: ${JSON.stringify(t7)}`);

  // T8: present is enough — gh-dependent.
  const t8 = findResult(results, 'T8');
  if (!t8) fail('T8 missing from results');
  pass(`T8 present: ${JSON.stringify(t8)}`);

  restore();
  console.log('PASS: all 8 triggers wired and running under --once --dry-run');
  process.exit(0);
}

main().catch(e => {
  console.error('test crashed:', e);
  restore();
  process.exit(1);
});
