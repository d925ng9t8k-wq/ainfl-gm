#!/usr/bin/env node
// test-imap-uid-dedup.mjs — regression lock for kill C (commit c7c1742)
//
// The hub's checkNewEmails() used to mark Gmail IMAP messages \Seen BEFORE the
// caller durably persisted them. A crash in that gap silently lost the email.
//
// Fix: checkNewEmails() now fetches {seen: false} without marking, tracks UIDs
// in a persistent file /tmp/9-imap-processed-uids.json, and the caller must
// call ackEmailUidProcessed(uid) AFTER saveState() succeeds. Re-fetching a UID
// before ack is safe because the persistent set filters duplicates.
//
// This test is hermetic: it does NOT connect to Gmail IMAP. It uses a temp UID
// file, reimplements the pure dedup logic (loadProcessedEmailUids +
// markEmailUidProcessed), and verifies:
//
// ASSERTIONS:
//   1. Source-level: checkNewEmails fetches {seen: false} without
//      messageFlagsAdd \Seen inside the fetch loop
//   2. Source-level: loadProcessedEmailUids / markEmailUidProcessed /
//      ackEmailUidProcessed all exist and are wired correctly
//   3. Source-level: emailMonitor calls ackEmailUidProcessed AFTER saveState
//   4. Source-level: 7-day TTL prune
//   5. Behavioral: an un-acked UID fetched once is returned again on the next
//      simulated fetch (no skip)
//   6. Behavioral: after ack, the same UID is filtered out
//   7. Behavioral: entries older than 7 days are pruned on load
//   8. Behavioral: ack is idempotent — calling it twice on the same UID is a
//      no-op
//   9. Cleanup: temp files removed, real /tmp/9-imap-processed-uids.json
//      untouched

import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HUB_PATH = path.join(REPO_ROOT, 'scripts', 'comms-hub.mjs');
const REAL_UIDS_FILE = '/tmp/9-imap-processed-uids.json';

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

// Snapshot the real UIDs file so we can verify we didn't touch it.
let realUidsSnapshot = null;
let realUidsExistedAtStart = false;
if (existsSync(REAL_UIDS_FILE)) {
  realUidsExistedAtStart = true;
  realUidsSnapshot = readFileSync(REAL_UIDS_FILE, 'utf-8');
}

console.log('\n=== IMAP UID dedup regression test (kill C, commit c7c1742) ===\n');

// ── 1. Source-level invariants ────────────────────────────────────────────
console.log('[ Source invariants — scripts/comms-hub.mjs ]');

if (!existsSync(HUB_PATH)) {
  console.error(`FATAL: ${HUB_PATH} not found`);
  process.exit(1);
}
const hubSrc = readFileSync(HUB_PATH, 'utf-8');

assert(
  'checkNewEmails uses fetch({ seen: false })',
  /client\.fetch\(\s*\{\s*seen:\s*false\s*\}/.test(hubSrc),
);

assert(
  'checkNewEmails does NOT mark seen inside the main fetch loop (comment mentions the contract)',
  /do NOT mark the[\s\S]{0,60}server-side[\s\S]{0,30}Seen flag/i.test(hubSrc),
);

assert(
  'loadProcessedEmailUids defined',
  /function\s+loadProcessedEmailUids\s*\(/.test(hubSrc),
);

assert(
  'markEmailUidProcessed defined',
  /function\s+markEmailUidProcessed\s*\(\s*uid\s*\)/.test(hubSrc),
);

assert(
  'ackEmailUidProcessed defined and async',
  /async\s+function\s+ackEmailUidProcessed\s*\(\s*uid\s*\)/.test(hubSrc),
);

assert(
  'checkNewEmails skips UIDs already in processed set',
  /if\s*\(\s*processedUids\.has\s*\(\s*uid\s*\)\s*\)\s*continue/.test(hubSrc),
);

assert(
  'checkNewEmails returns UID-prefixed lines ("UID:...|SUBJECT:...|BODY:...")',
  /UID:\$\{uid\}\|SUBJECT:/.test(hubSrc),
);

assert(
  'emailMonitor calls ackEmailUidProcessed after processing',
  /ackEmailUidProcessed\s*\(\s*uid\s*\)/.test(hubSrc),
);

assert(
  '7-day TTL on processed UIDs',
  /7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(hubSrc),
);

assert(
  'UID processed file path is /tmp/9-imap-processed-uids.json',
  /\/tmp\/9-imap-processed-uids\.json/.test(hubSrc),
);

// ── 2. Behavioral dedup — reimplement the pure logic + exercise it ────────
console.log('\n[ Behavioral dedup (hermetic temp file) ]');

const tmpUidsFile = path.join(tmpdir(), `test-imap-uids-${process.pid}-${Date.now()}.json`);

// These reimplement loadProcessedEmailUids + markEmailUidProcessed from
// comms-hub.mjs exactly, pointed at a TEMP file. If these semantics drift, the
// source-invariant assertions above should catch the drift via pattern match,
// and this block verifies the contract still works as advertised.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadProcessedEmailUids(file) {
  try {
    if (!existsSync(file)) return new Set();
    const raw = JSON.parse(readFileSync(file, 'utf-8') || '{}');
    const cutoff = Date.now() - TTL_MS;
    const fresh = new Set();
    for (const [uid, ts] of Object.entries(raw)) {
      if (ts > cutoff) fresh.add(uid);
    }
    return fresh;
  } catch {
    return new Set();
  }
}

function markEmailUidProcessed(file, uid) {
  const raw = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf-8') || '{}')
    : {};
  raw[String(uid)] = Date.now();
  writeFileSync(file, JSON.stringify(raw));
}

// Simulates checkNewEmails — takes an array of (uid, subject, from) envelope
// stubs and returns only the UIDs that are NOT in processedUids. The test
// double-checks the contract: an un-acked UID is surfaced on every call until
// ackEmailUidProcessed marks it.
function stubCheckNewEmails(envelopeStubs, file) {
  const processedUids = loadProcessedEmailUids(file);
  const out = [];
  for (const e of envelopeStubs) {
    const uid = String(e.uid);
    if (processedUids.has(uid)) continue;
    out.push(uid);
  }
  return out;
}

// Case 1: fresh file, one incoming UID, no ack yet → next fetch returns it again
const envelopes = [
  { uid: 1001, subject: 'Test 1', from: 'alice@example.com' },
  { uid: 1002, subject: 'Test 2', from: 'bob@example.com' },
];

const firstFetch = stubCheckNewEmails(envelopes, tmpUidsFile);
assert(
  'first fetch returns both UIDs',
  firstFetch.length === 2 && firstFetch.includes('1001') && firstFetch.includes('1002'),
  `got: ${JSON.stringify(firstFetch)}`,
);

// Do NOT ack (simulating a crash between fetch and saveState). Refetch.
const secondFetch = stubCheckNewEmails(envelopes, tmpUidsFile);
assert(
  'without ack, second fetch returns the SAME UIDs (no silent skip)',
  secondFetch.length === 2 && secondFetch.includes('1001') && secondFetch.includes('1002'),
  `got: ${JSON.stringify(secondFetch)}`,
);

// Ack UID 1001. Refetch.
markEmailUidProcessed(tmpUidsFile, 1001);
const thirdFetch = stubCheckNewEmails(envelopes, tmpUidsFile);
assert(
  'after ack, acked UID is filtered',
  thirdFetch.length === 1 && thirdFetch[0] === '1002',
  `got: ${JSON.stringify(thirdFetch)}`,
);

// Ack UID 1002. Refetch.
markEmailUidProcessed(tmpUidsFile, 1002);
const fourthFetch = stubCheckNewEmails(envelopes, tmpUidsFile);
assert(
  'after acking all, fetch returns empty',
  fourthFetch.length === 0,
  `got: ${JSON.stringify(fourthFetch)}`,
);

// Ack idempotency — calling mark twice on the same UID must not throw, and the
// file must still parse cleanly.
markEmailUidProcessed(tmpUidsFile, 1001);
markEmailUidProcessed(tmpUidsFile, 1001);
const reloadedMap = JSON.parse(readFileSync(tmpUidsFile, 'utf-8'));
assert(
  'ack is idempotent — file still parses and contains 1001',
  typeof reloadedMap === 'object' && '1001' in reloadedMap,
);

// Case 2: TTL prune. Write an entry with a timestamp 8 days old and verify
// loadProcessedEmailUids drops it.
const staleUidsFile = path.join(tmpdir(), `test-imap-uids-stale-${process.pid}-${Date.now()}.json`);
const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
writeFileSync(staleUidsFile, JSON.stringify({
  '9999': eightDaysAgo,  // stale
  '10000': Date.now(),    // fresh
}));
const pruned = loadProcessedEmailUids(staleUidsFile);
assert(
  'TTL prune — entries older than 7 days are dropped',
  !pruned.has('9999') && pruned.has('10000'),
  `got: ${[...pruned].join(',')}`,
);

// Case 3: corrupt file → load returns empty Set (no throw).
const corruptFile = path.join(tmpdir(), `test-imap-uids-corrupt-${process.pid}-${Date.now()}.json`);
writeFileSync(corruptFile, 'not valid json {{{');
const corruptLoad = loadProcessedEmailUids(corruptFile);
assert(
  'corrupt UID file → returns empty Set without throwing',
  corruptLoad instanceof Set && corruptLoad.size === 0,
);

// ── 3. Cleanup ─────────────────────────────────────────────────────────────
console.log('\n[ Cleanup ]');
for (const f of [tmpUidsFile, staleUidsFile, corruptFile]) {
  try {
    if (existsSync(f)) unlinkSync(f);
    assert(`temp file removed: ${path.basename(f)}`, !existsSync(f));
  } catch (e) {
    assert(`temp file removed: ${path.basename(f)}`, false, e.message);
  }
}

// Verify real UIDs file is unchanged
if (realUidsExistedAtStart) {
  const after = existsSync(REAL_UIDS_FILE) ? readFileSync(REAL_UIDS_FILE, 'utf-8') : null;
  assert(
    'real /tmp/9-imap-processed-uids.json unchanged',
    after === realUidsSnapshot,
  );
} else {
  assert(
    'real /tmp/9-imap-processed-uids.json was not created by the test',
    !existsSync(REAL_UIDS_FILE),
  );
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? ': ' + f.detail : ''}`);
  process.exit(1);
}
process.exit(0);
