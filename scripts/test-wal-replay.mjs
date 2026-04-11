#!/usr/bin/env node
// test-wal-replay.mjs — regression lock for commit 302aef9 (kill: wal-replay-missing)
//
// The hub's startup code at scripts/comms-hub.mjs must read pending WAL entries
// from the prior session AND actually replay them (sendTelegram/sendIMessage)
// after healthServer.listen fires, then mark the original pending entry 'sent'
// so it isn't replayed again on next startup. A regression here = silent message
// loss on every crash. This test locks it in.
//
// STRATEGY: The test parses scripts/comms-hub.mjs as source code and verifies
// the invariants that make WAL replay work. It also round-trips a fake pending
// entry through the WAL file format and verifies that the "sent" marker
// semantics match what the startup code expects. No live hub required.
//
// ASSERTIONS:
//   1. PENDING_WAL_REPLAY array is declared at module scope
//   2. Startup scan pushes fresh pending entries (< 1h old) into PENDING_WAL_REPLAY
//   3. Startup scan marks stale pending entries (> 1h old) as sent with stale:true
//   4. healthServer.listen callback iterates PENDING_WAL_REPLAY and replays
//      telegram + imessage channels via sendTelegram/sendIMessage
//   5. Each replayed entry is immediately marked sent with replayed:true
//   6. WAL file format round-trip: a 'pending' entry matched by a 'sent' entry
//      with the same walId disappears from the pending set (matches walMarkSent
//      semantics the startup code depends on)
//   7. Cleanup: no test-artifact entries left in the real WAL
//
// This test is hermetic — it uses a TEMP wal file, never touches logs/outbound-wal.jsonl.
// Idempotent — deterministic inputs, no timestamps that affect comparisons beyond
// the 1-hour staleness boundary which uses a fixed offset.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HUB_PATH = path.join(REPO_ROOT, 'scripts', 'comms-hub.mjs');

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push({ label, detail });
  }
}

console.log('\n=== WAL replay regression test (kill: wal-replay-missing, commit 302aef9) ===\n');

// ── 1. Source-level invariants ────────────────────────────────────────────
console.log('[ Source invariants — scripts/comms-hub.mjs ]');

if (!existsSync(HUB_PATH)) {
  console.error(`FATAL: ${HUB_PATH} not found`);
  process.exit(1);
}
const hubSrc = readFileSync(HUB_PATH, 'utf-8');

assert(
  'PENDING_WAL_REPLAY declared at module scope',
  /const\s+PENDING_WAL_REPLAY\s*=\s*\[\s*\]/.test(hubSrc),
);

assert(
  'Startup scan pushes fresh entries into PENDING_WAL_REPLAY',
  /PENDING_WAL_REPLAY\.push\s*\(\s*entry\s*\)/.test(hubSrc),
);

assert(
  'Startup scan has 1-hour stale threshold',
  /ONE_HOUR\s*=\s*60\s*\*\s*60\s*\*\s*1000/.test(hubSrc),
);

assert(
  'Stale entries marked sent with stale:true',
  /status:\s*['"]sent['"][\s\S]{0,80}stale:\s*true/.test(hubSrc),
);

assert(
  'healthServer.listen callback triggers WAL replay via setTimeout',
  /healthServer\.listen\s*\(\s*HEALTH_PORT[\s\S]{0,400}PENDING_WAL_REPLAY/.test(hubSrc),
);

assert(
  'Replay loop calls sendTelegram for telegram entries',
  /entry\.channel\s*===\s*['"]telegram['"][\s\S]{0,120}sendTelegram\s*\(\s*entry\.text\s*\)/.test(hubSrc),
);

assert(
  'Replay loop calls sendIMessage for imessage entries',
  /entry\.channel\s*===\s*['"]imessage['"][\s\S]{0,120}sendIMessage\s*\(\s*entry\.text\s*\)/.test(hubSrc),
);

assert(
  'Replayed entries marked sent with replayed:true',
  /status:\s*['"]sent['"][\s\S]{0,80}replayed:\s*true/.test(hubSrc),
);

assert(
  'Replay log format: "[wal-replay] Complete"',
  /\[wal-replay\] Complete/.test(hubSrc),
);

assert(
  'Telegram notification fires when replays land',
  /replayed > 0[\s\S]{0,200}sendTelegram\s*\(\s*`9: WAL replay/.test(hubSrc),
);

// ── 2. WAL file-format round-trip ──────────────────────────────────────────
console.log('\n[ WAL file-format round-trip ]');

// Simulate what comms-hub.mjs:walAppend writes and what the startup scanner reads.
const tmpWal = path.join(tmpdir(), `test-wal-replay-${process.pid}-${Date.now()}.jsonl`);

function walAppend(entry) {
  // Match comms-hub.mjs walAppend exactly: one JSON line per write.
  // (Source: scripts/comms-hub.mjs — walAppend near top of file.)
  const line = JSON.stringify(entry) + '\n';
  if (existsSync(tmpWal)) {
    writeFileSync(tmpWal, readFileSync(tmpWal, 'utf-8') + line);
  } else {
    writeFileSync(tmpWal, line);
  }
}

function scanWal() {
  // Re-implements the startup scan logic from comms-hub.mjs so we can unit-test
  // its semantics without a running hub.
  const raw = readFileSync(tmpWal, 'utf-8').trim().split('\n').filter(l => l);
  const pending = new Map();
  const sent = new Set();
  for (const line of raw) {
    try {
      const e = JSON.parse(line);
      if (e.status === 'pending') pending.set(e.id, e);
      if (e.status === 'sent' && e.walId) sent.add(e.walId);
    } catch {}
  }
  for (const id of sent) pending.delete(id);
  return pending;
}

// Inject: one pending entry (fresh), one pending entry (stale >1h), and one
// pending entry that already has a matching 'sent' marker.
const now = Date.now();
const freshEntry = {
  id: 'wal-test-fresh',
  channel: 'telegram',
  text: 'TEST_WAL_REPLAY fresh outbound',
  timestamp: new Date(now - 10_000).toISOString(),
  status: 'pending',
};
const staleEntry = {
  id: 'wal-test-stale',
  channel: 'telegram',
  text: 'TEST_WAL_REPLAY stale outbound',
  timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(), // 2h old
  status: 'pending',
};
const ackedEntry = {
  id: 'wal-test-acked',
  channel: 'imessage',
  text: 'TEST_WAL_REPLAY already acked',
  timestamp: new Date(now - 5000).toISOString(),
  status: 'pending',
};

walAppend(freshEntry);
walAppend(staleEntry);
walAppend(ackedEntry);
walAppend({ walId: 'wal-test-acked', status: 'sent', at: new Date().toISOString() });

const pending = scanWal();

assert(
  'fresh pending entry survives scan',
  pending.has('wal-test-fresh'),
  `pending keys: ${[...pending.keys()].join(',')}`,
);
assert(
  'stale pending entry also appears in pending set (staleness is filtered at replay-time, not scan-time)',
  pending.has('wal-test-stale'),
);
assert(
  'acked entry removed from pending by sent-marker match',
  !pending.has('wal-test-acked'),
);

// Now simulate the staleness partition the startup code does AFTER scan.
const ONE_HOUR = 60 * 60 * 1000;
const toReplay = [];
const toMarkStale = [];
for (const [, entry] of pending) {
  const ts = Date.parse(entry.timestamp);
  if (!Number.isNaN(ts) && (now - ts) > ONE_HOUR) toMarkStale.push(entry);
  else toReplay.push(entry);
}

assert(
  'staleness partition — 1 entry to replay',
  toReplay.length === 1 && toReplay[0].id === 'wal-test-fresh',
  `got ${toReplay.length}`,
);
assert(
  'staleness partition — 1 entry skipped as stale',
  toMarkStale.length === 1 && toMarkStale[0].id === 'wal-test-stale',
  `got ${toMarkStale.length}`,
);

// Simulate the replay: append sent markers for both the replayed and the stale.
walAppend({ walId: 'wal-test-fresh', status: 'sent', replayed: true, at: new Date().toISOString() });
walAppend({ walId: 'wal-test-stale', status: 'sent', stale: true, at: new Date().toISOString() });

const pendingAfter = scanWal();
assert(
  'after replay + stale-mark, nothing remains pending',
  pendingAfter.size === 0,
  `pending keys: ${[...pendingAfter.keys()].join(',')}`,
);

// ── 3. Cleanup ─────────────────────────────────────────────────────────────
console.log('\n[ Cleanup ]');
try {
  unlinkSync(tmpWal);
  assert('tmp WAL file removed', !existsSync(tmpWal));
} catch (e) {
  assert('tmp WAL file removed', false, e.message);
}

// Verify the real logs/outbound-wal.jsonl was never touched
const realWal = path.join(REPO_ROOT, 'logs', 'outbound-wal.jsonl');
if (existsSync(realWal)) {
  const realContents = readFileSync(realWal, 'utf-8');
  assert(
    'real WAL file unchanged (no TEST_WAL_REPLAY entries)',
    !realContents.includes('TEST_WAL_REPLAY'),
  );
} else {
  console.log('  (real WAL does not exist — nothing to verify)');
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
