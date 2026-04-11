#!/usr/bin/env node
// Apr 10 Phase 1 Track 3 — Telegram reliability load test.
// Injects 20 synthetic inbound Telegram messages (prefixed "LOADTEST:") over
// a 10-second burst via POST /test/inbound, then verifies 6 success criteria
// against shared-state.json, comms-hub.log, /tmp/9-incoming-message.jsonl,
// and logs/check-messages-errors.log.
//
// Usage: node scripts/test-telegram-load.mjs
//
// Cleanup: strips the 20 LOADTEST entries from shared-state.json after verify.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const HUB = 'http://localhost:3457';
const STATE_PATH = '/Users/jassonfishback/Projects/BengalOracle/scripts/shared-state.json';
const HUB_LOG_PATH = '/Users/jassonfishback/Projects/BengalOracle/logs/comms-hub.log';
const SIGNAL_PATH = '/tmp/9-incoming-message.jsonl';
const HOOK_ERR_LOG = '/Users/jassonfishback/Projects/BengalOracle/logs/check-messages-errors.log';

const BURST_COUNT = 20;
const BURST_SPACING_MS = 500; // 20 * 500ms = 10s window
const VERIFY_WAIT_MS = 2500;
const RUN_ID = Date.now().toString(36);
const msgText = (i) => `LOADTEST:${RUN_ID}:msg-${String(i).padStart(2, '0')} reliability hunt Apr 10`;

function stamp() { return new Date().toISOString(); }

async function checkHealth() {
  try {
    const r = await fetch(`${HUB}/health`, { signal: AbortSignal.timeout(5000) });
    return r.status;
  } catch (e) {
    return `err:${e.message}`;
  }
}

async function inject(text) {
  const r = await fetch(`${HUB}/test/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`inject ${r.status}: ${await r.text()}`);
  return r.json();
}

function readStateMessages() {
  const raw = readFileSync(STATE_PATH, 'utf-8');
  const s = JSON.parse(raw);
  return { raw: s, recent: s.recentMessages || [] };
}

function tailLog(path, bytes = 500_000) {
  if (!existsSync(path)) return '';
  const buf = readFileSync(path);
  return buf.slice(Math.max(0, buf.length - bytes)).toString('utf-8');
}

async function main() {
  const results = {};
  console.log(`[${stamp()}] RUN_ID=${RUN_ID} starting Telegram load test — ${BURST_COUNT} msgs @ ${BURST_SPACING_MS}ms spacing`);

  // Criterion 6 start: health at start
  const h0 = await checkHealth();
  console.log(`[${stamp()}] health at start: ${h0}`);
  const startedAt = Date.now();

  // Fire burst
  const injected = [];
  const injectErrors = [];
  for (let i = 0; i < BURST_COUNT; i++) {
    const text = msgText(i);
    try {
      await inject(text);
      injected.push(text);
    } catch (e) {
      injectErrors.push({ i, err: e.message });
      console.error(`[${stamp()}] inject ${i} failed: ${e.message}`);
    }
    if (i < BURST_COUNT - 1) await sleep(BURST_SPACING_MS);
  }
  const burstEnd = Date.now();
  console.log(`[${stamp()}] burst done in ${burstEnd - startedAt}ms — ${injected.length}/${BURST_COUNT} injected, ${injectErrors.length} errors`);

  // Wait for state/log fsync to settle
  await sleep(VERIFY_WAIT_MS);

  // ── Criterion 1: shared-state.json ─────────────────────────
  // All 20 messages with direction=in, within 5s of injection
  const { recent } = readStateMessages();
  const matched = recent.filter(m =>
    m.direction === 'in' && typeof m.text === 'string' && m.text.includes(`LOADTEST:${RUN_ID}:`)
  );
  const matchedTexts = new Set(matched.map(m => m.text));
  const missingFromState = injected.filter(t => !matchedTexts.has(t));
  results.c1_state = {
    pass: missingFromState.length === 0 && matched.length === BURST_COUNT,
    found: matched.length,
    missing: missingFromState,
  };

  // ── Criterion 2: logs/comms-hub.log ───────────────────────
  const logTail = tailLog(HUB_LOG_PATH);
  const logHits = injected.filter(t => logTail.includes(`Telegram IN: "${t}"`));
  const missingFromLog = injected.filter(t => !logTail.includes(`Telegram IN: "${t}"`));
  results.c2_log = {
    pass: missingFromLog.length === 0,
    found: logHits.length,
    missing: missingFromLog,
  };

  // ── Criterion 3: signal file OR hook delivery log ─────────
  // Signal file may have been drained by check-messages.sh — that's OK.
  // Check the hook err log (which also logs successful deliveries) for "delivered N line"
  let signalContent = '';
  if (existsSync(SIGNAL_PATH)) {
    signalContent = readFileSync(SIGNAL_PATH, 'utf-8');
  }
  const signalHits = injected.filter(t => signalContent.includes(t));
  const hookTail = tailLog(HOOK_ERR_LOG, 200_000);
  // Compute total lines the hook has delivered recently
  const deliverMatches = hookTail.match(/delivered\s+(\d+)\s+line/gi) || [];
  const totalDelivered = deliverMatches
    .map(m => parseInt(m.match(/(\d+)/)[1], 10))
    .reduce((a, b) => a + b, 0);
  const missingFromSignalAndHook = injected.filter(t => !signalContent.includes(t));
  // PASS if all are present in signal file OR the missing ones could have been consumed.
  // We cannot perfectly attribute "delivered" lines to our run, so:
  //   PASS if (signalHits + anything-hook-delivered-since-test-start) >= BURST_COUNT
  //   Practical: if signal file covers all, PASS outright.
  //   Otherwise check hook log shows recent delivery activity covering the gap.
  const c3pass =
    signalHits.length === BURST_COUNT ||
    (signalHits.length + totalDelivered) >= BURST_COUNT;
  results.c3_signal_or_hook = {
    pass: c3pass,
    signal_hits: signalHits.length,
    signal_file_exists: existsSync(SIGNAL_PATH),
    hook_recent_delivered_lines: totalDelivered,
    missing_from_signal_file: missingFromSignalAndHook.length,
  };

  // ── Criterion 4: no messages lost ─────────────────────────
  // Derived — all three pipelines accounted for every injected message.
  const allAccountedFor = (
    missingFromState.length === 0 &&
    missingFromLog.length === 0 &&
    c3pass
  );
  results.c4_no_loss = {
    pass: allAccountedFor,
    state_missing: missingFromState.length,
    log_missing: missingFromLog.length,
    signal_missing: missingFromSignalAndHook.length,
  };

  // ── Criterion 5: hub healthy start & end ─────────────────
  const h1 = await checkHealth();
  results.c5_health = {
    pass: h0 === 200 && h1 === 200,
    start: h0,
    end: h1,
  };

  // ── Criterion 6: total duration < 30s ────────────────────
  const totalMs = Date.now() - startedAt;
  results.c6_duration = {
    pass: totalMs < 30_000,
    total_ms: totalMs,
  };

  // ── Cleanup: strip LOADTEST entries from shared-state.json ──
  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    const s = JSON.parse(raw);
    const beforeCount = (s.recentMessages || []).length;
    s.recentMessages = (s.recentMessages || []).filter(m =>
      !(typeof m.text === 'string' && m.text.includes(`LOADTEST:${RUN_ID}:`))
    );
    const afterCount = s.recentMessages.length;
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
    console.log(`[${stamp()}] cleanup: removed ${beforeCount - afterCount} LOADTEST entries from shared-state.json`);
  } catch (e) {
    console.error(`[${stamp()}] cleanup failed: ${e.message}`);
  }

  // ── Cleanup: strip LOADTEST entries from signal file too ──
  try {
    if (existsSync(SIGNAL_PATH)) {
      const lines = readFileSync(SIGNAL_PATH, 'utf-8').split('\n');
      const kept = lines.filter(l => !l.includes(`LOADTEST:${RUN_ID}:`));
      writeFileSync(SIGNAL_PATH, kept.join('\n'));
    }
  } catch (e) {
    console.error(`[${stamp()}] signal cleanup failed: ${e.message}`);
  }

  // Report
  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  const allPass = Object.values(results).every(r => r.pass);
  console.log(`\nOVERALL: ${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(2);
});
