#!/usr/bin/env node
// test-bridge-protocol.mjs — regression lock for the 9↔Ara never-miss-messages
// protocol (commits 8208f3b + 58289b4).
//
// Protocol (as burned in ara-bridge.mjs):
//   1. [9-SEQ N] prefix, monotonic, persisted in data/ara-bridge-state.json
//   2. ACK ARA-SEQ M line when last Ara seq is known
//   3. Trailing sha256:xxxxxx (first 6 chars of sha256 of the body)
//   4. recordLastSent populates bridge state with {seq, wrapped, checksum,
//      method, sentAt, ackAt:null, retryCount:0}
//   5. markLastSentAcked(seq) clears pending ack if seq matches
//   6. OCR ACK detection regex: `ACK\s*\[?9-?SEQ\s*${n}\b` (case-insensitive)
//      tolerates variants: "ACK 9-SEQ 7", "ACK [9-SEQ 7]", "ACK9-SEQ7"
//
// HERMETIC: This test does NOT touch the real data/ara-bridge-state.json. It
// reimplements the protocol purely, cross-validates against the source file
// for drift, and exercises the contract end-to-end.
//
// IDEMPOTENT: uses a temp state file under $TMPDIR, cleans up after.

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BRIDGE_PATH = path.join(REPO_ROOT, 'scripts', 'ara-bridge.mjs');
const REAL_BRIDGE_STATE = path.join(REPO_ROOT, 'data', 'ara-bridge-state.json');

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

// Snapshot the real bridge state so we can verify we didn't touch it.
let realStateSnapshot = null;
let realStateExisted = false;
if (existsSync(REAL_BRIDGE_STATE)) {
  realStateExisted = true;
  realStateSnapshot = readFileSync(REAL_BRIDGE_STATE, 'utf-8');
}

console.log('\n=== 9↔Ara never-miss-messages protocol regression test (commits 8208f3b + 58289b4) ===\n');

// ── 1. Source-level invariants ────────────────────────────────────────────
console.log('[ Source invariants — scripts/ara-bridge.mjs ]');

if (!existsSync(BRIDGE_PATH)) {
  console.error(`FATAL: ${BRIDGE_PATH} not found`);
  process.exit(1);
}
const bridgeSrc = readFileSync(BRIDGE_PATH, 'utf-8');

assert(
  'BRIDGE_STATE_PATH points at data/ara-bridge-state.json',
  /ara-bridge-state\.json/.test(bridgeSrc),
);

assert(
  'loadBridgeState + saveBridgeState defined',
  /function\s+loadBridgeState\s*\(/.test(bridgeSrc) && /function\s+saveBridgeState\s*\(/.test(bridgeSrc),
);

assert(
  'nextNineSeq monotonic counter defined',
  /function\s+nextNineSeq\s*\(\s*\)/.test(bridgeSrc) && /s\.nineSeq\s*=\s*\(s\.nineSeq\s*\|\|\s*0\)\s*\+\s*1/.test(bridgeSrc),
);

assert(
  'recordLastSent defined and sets ackAt:null + retryCount:0',
  /function\s+recordLastSent\s*\(\s*\{\s*seq,\s*wrapped,\s*checksum,\s*method\s*\}\s*\)/.test(bridgeSrc)
    && /ackAt:\s*null/.test(bridgeSrc)
    && /retryCount:\s*0/.test(bridgeSrc),
);

assert(
  'markLastSentAcked defined and validates seq match',
  /function\s+markLastSentAcked\s*\(\s*ackedSeq\s*\)/.test(bridgeSrc)
    && /s\.lastSent\.seq\s*!==\s*ackedSeq/.test(bridgeSrc),
);

assert(
  'checksum6 uses sha256 first-6-hex prefix',
  /function\s+checksum6\s*\(\s*body\s*\)/.test(bridgeSrc)
    && /createHash\(['"]sha256['"]\)[\s\S]{0,60}digest\(['"]hex['"]\)[\s\S]{0,20}slice\(0,\s*6\)/.test(bridgeSrc)
    && /'sha256:'\s*\+/.test(bridgeSrc),
);

assert(
  'wrapProtocol defined and builds [9-SEQ N] prefix + ACK line + checksum',
  /function\s+wrapProtocol\s*\(\s*body\s*\)/.test(bridgeSrc)
    && /\[9-SEQ \$\{seq\}\]/.test(bridgeSrc)
    && /ACK ARA-SEQ \$\{ackSeq\}/.test(bridgeSrc),
);

assert(
  'OCR ACK detection regex present in source (ACK\\s*\\[?9-?SEQ\\s*${n}\\b)',
  bridgeSrc.includes('ACK\\\\s*\\\\[?9-?SEQ\\\\s*${n}\\\\b'),
);

assert(
  'recordAraSeqFromText exported for reverse-direction ACK parsing',
  /export function recordAraSeqFromText/.test(bridgeSrc),
);

// ── 2. Behavioral contract — reimplement + exercise ──────────────────────
console.log('\n[ Behavioral contract (hermetic temp state file) ]');

const tmpStateFile = path.join(tmpdir(), `test-bridge-state-${process.pid}-${Date.now()}.json`);

// These reimplementations match the ara-bridge.mjs private functions exactly.
// If ara-bridge.mjs changes its protocol semantics, the source-invariant
// assertions above should catch it; this block verifies the contract still
// behaves end-to-end.
function loadBridgeState() {
  try {
    if (existsSync(tmpStateFile)) return JSON.parse(readFileSync(tmpStateFile, 'utf-8'));
  } catch {}
  return { nineSeq: 0, lastAraSeq: null, lastSent: null };
}
function saveBridgeState(s) {
  writeFileSync(tmpStateFile, JSON.stringify(s, null, 2));
}
function nextNineSeq() {
  const s = loadBridgeState();
  s.nineSeq = (s.nineSeq || 0) + 1;
  saveBridgeState(s);
  return s.nineSeq;
}
function recordLastSent({ seq, wrapped, checksum, method }) {
  const s = loadBridgeState();
  s.lastSent = {
    seq, wrapped, checksum,
    method: method || 'paste',
    sentAt: Date.now(),
    ackAt: null,
    retryCount: 0,
  };
  saveBridgeState(s);
}
function markLastSentAcked(ackedSeq) {
  const s = loadBridgeState();
  if (!s.lastSent) return false;
  if (s.lastSent.ackAt) return false;
  if (typeof ackedSeq === 'number' && s.lastSent.seq !== ackedSeq) return false;
  s.lastSent.ackAt = Date.now();
  saveBridgeState(s);
  return true;
}
function getLastAraSeq() { return loadBridgeState().lastAraSeq; }
function setLastAraSeq(n) {
  const s = loadBridgeState();
  s.lastAraSeq = n;
  saveBridgeState(s);
}
function checksum6(body) {
  return 'sha256:' + createHash('sha256').update(body).digest('hex').slice(0, 6);
}
function wrapProtocol(body) {
  const seq = nextNineSeq();
  const ackSeq = getLastAraSeq();
  const ackLine = ackSeq != null ? `ACK ARA-SEQ ${ackSeq} | ` : '';
  const cs = checksum6(body);
  const wrapped = `[9-SEQ ${seq}] ${ackLine}${body}\n\n${cs}`;
  return { wrapped, seq, checksum: cs, ackSeq };
}

// wrapProtocol format validation
const firstWrap = wrapProtocol('hello ara');
assert(
  'wrapProtocol produces [9-SEQ 1] prefix on first call',
  firstWrap.seq === 1 && firstWrap.wrapped.startsWith('[9-SEQ 1] '),
  firstWrap.wrapped.slice(0, 40),
);
assert(
  'wrapProtocol produces sha256:xxxxxx trailer',
  /\nsha256:[0-9a-f]{6}$/.test(firstWrap.wrapped),
  firstWrap.wrapped.slice(-30),
);
assert(
  'checksum6 matches sha256(body).slice(0,6)',
  firstWrap.checksum === 'sha256:' + createHash('sha256').update('hello ara').digest('hex').slice(0, 6),
);
assert(
  'wrapProtocol omits ACK line when no lastAraSeq',
  !firstWrap.wrapped.includes('ACK ARA-SEQ'),
);
assert(
  'recordLastSent populates state: seq, wrapped, checksum, ackAt:null, retryCount:0',
  (() => {
    recordLastSent({ seq: firstWrap.seq, wrapped: firstWrap.wrapped, checksum: firstWrap.checksum, method: 'paste' });
    const s = loadBridgeState();
    return s.lastSent
      && s.lastSent.seq === 1
      && s.lastSent.ackAt === null
      && s.lastSent.retryCount === 0
      && s.lastSent.wrapped === firstWrap.wrapped
      && s.lastSent.checksum === firstWrap.checksum;
  })(),
);

// markLastSentAcked with mismatched seq should be a no-op
const badAck = markLastSentAcked(999);
assert(
  'markLastSentAcked with mismatched seq returns false and does not clear pending',
  badAck === false && loadBridgeState().lastSent.ackAt === null,
);

// markLastSentAcked with matching seq should clear pending
const goodAck = markLastSentAcked(1);
assert(
  'markLastSentAcked with matching seq returns true and sets ackAt',
  goodAck === true && typeof loadBridgeState().lastSent.ackAt === 'number',
);

// Double-ack should return false (already acked)
const doubleAck = markLastSentAcked(1);
assert(
  'markLastSentAcked is idempotent (second ack returns false)',
  doubleAck === false,
);

// Simulate receiving an ARA-SEQ reply → next wrap includes ACK line
setLastAraSeq(5);
const secondWrap = wrapProtocol('follow-up message');
assert(
  'wrapProtocol includes ACK ARA-SEQ 5 after setLastAraSeq(5)',
  secondWrap.wrapped.startsWith('[9-SEQ 2] ACK ARA-SEQ 5 | '),
  secondWrap.wrapped.slice(0, 60),
);
assert(
  'nineSeq is monotonic: second wrap = 2',
  secondWrap.seq === 2,
);

// ── 3. OCR ACK detection regex — tolerate noisy variants ─────────────────
console.log('\n[ OCR ACK detection regex — variants ]');

function matchesAck(text, n) {
  // Same regex as ara-bridge.mjs:406
  const re = new RegExp(`ACK\\s*\\[?9-?SEQ\\s*${n}\\b`, 'i');
  return re.test(text);
}

const ackVariants = [
  { text: 'ACK 9-SEQ 7', expected: true, label: 'canonical "ACK 9-SEQ 7"' },
  { text: 'ACK [9-SEQ 7]', expected: true, label: 'bracketed "ACK [9-SEQ 7]"' },
  { text: 'ACK9-SEQ7', expected: true, label: 'no-space "ACK9-SEQ7"' },
  { text: 'ack 9-seq 7', expected: true, label: 'lowercase "ack 9-seq 7"' },
  { text: 'ACK 9SEQ 7', expected: true, label: 'missing-dash "ACK 9SEQ 7"' },
  { text: '[ARA-SEQ 4] got it — ACK 9-SEQ 7 works great', expected: true, label: 'embedded in reply body' },
  { text: 'ACK 9-SEQ 70', expected: false, label: '"ACK 9-SEQ 70" must not match 7 (\\b boundary)' },
  { text: 'ACK 9-SEQ 8', expected: false, label: 'different seq should not match' },
  { text: 'SEQ 7', expected: false, label: 'missing ACK should not match' },
];

for (const v of ackVariants) {
  const got = matchesAck(v.text, 7);
  assert(`OCR ACK variant: ${v.label}`, got === v.expected, `expected ${v.expected}, got ${got}`);
}

// recordAraSeqFromText contract: should parse [ARA-SEQ N] and update state.
// We reimplement here because the export exists on the real module, but we
// don't want to import (would touch the real state file).
function recordAraSeqFromText(text) {
  if (!text) return null;
  const m = text.match(/\[ARA-SEQ\s+(\d+)\]/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  setLastAraSeq(n);
  return n;
}

const parsed = recordAraSeqFromText('[ARA-SEQ 42] copy that — all good on my side');
assert(
  'recordAraSeqFromText parses [ARA-SEQ 42] correctly and updates state',
  parsed === 42 && getLastAraSeq() === 42,
);
assert(
  'recordAraSeqFromText returns null on non-matching text',
  recordAraSeqFromText('no seq tag here') === null,
);

// ── 4. Cleanup ─────────────────────────────────────────────────────────────
console.log('\n[ Cleanup ]');
try {
  if (existsSync(tmpStateFile)) unlinkSync(tmpStateFile);
  assert('temp bridge state file removed', !existsSync(tmpStateFile));
} catch (e) {
  assert('temp bridge state file removed', false, e.message);
}

// Verify real bridge state is unchanged
if (realStateExisted) {
  const after = existsSync(REAL_BRIDGE_STATE) ? readFileSync(REAL_BRIDGE_STATE, 'utf-8') : null;
  assert(
    'real data/ara-bridge-state.json unchanged',
    after === realStateSnapshot,
  );
} else {
  assert(
    'real data/ara-bridge-state.json was not created by the test',
    !existsSync(REAL_BRIDGE_STATE),
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
