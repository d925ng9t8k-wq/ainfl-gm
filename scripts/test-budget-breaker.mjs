#!/usr/bin/env node
/**
 * test-budget-breaker.mjs
 *
 * Regression test for the $500/day budget circuit breaker.
 *
 *   1. Snapshot the current state.
 *   2. Inject a fake agent-runs file under data/agent-runs/<today-ET>/ that
 *      contains assistant usage tokens worth >$500 (Opus heavy spend).
 *   3. Hit GET /budget/today on the live hub and assert status === 'tripped'.
 *   4. Verify /tmp/9-budget-tripped exists (after waiting up to ~70s for the
 *      hub's 60s breaker sweep — or call /budget/today which is recompute-live).
 *   5. Hit /health and assert budget_check === 'tripped' and budgetTripped===true
 *      after the next sweep cycle.
 *   6. Clean up the fake file and the trip flag.
 *
 * If the hub is not running (port 3457 unreachable), the test runs the
 * in-process budget tracker directly and validates pure-function correctness.
 *
 * Exit 0 = pass, 1 = fail.
 */

import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeBudgetSnapshot, todayET, TRIPPED_FLAG_FILE, DAILY_CAP_USD } from './budget-tracker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.resolve(__dirname, '..');
const HUB_URL   = 'http://localhost:3457';

const date = todayET();
const dayDir = path.join(PROJECT, 'data', 'agent-runs', date);
const fakeFile = path.join(dayDir, 'agent-test-budget-breaker-DELETEME.jsonl');

let pass = true;
function assert(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    pass = false;
  }
}

async function fetchJson(url, timeoutMs = 5000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function hubAlive() {
  const h = await fetchJson(`${HUB_URL}/health`, 2000);
  return !!h;
}

function injectFakeOverspend() {
  // Make sure the day folder exists.
  try { mkdirSync(dayDir, { recursive: true }); } catch {}

  // 50,000,000 cache_read tokens at Opus $1.50/M = $75
  // Plus 8,000,000 output tokens at Opus $75/M = $600
  // Total ~$675 — comfortably above the $500 cap even if there's negative
  // existing spend (impossible) and it survives any rounding.
  const usage = {
    input_tokens: 0,
    output_tokens: 8_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 50_000_000,
  };
  const line = JSON.stringify({
    parentUuid: null,
    isSidechain: true,
    agentId: 'a-test-budget-breaker',
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      model: 'claude-opus-4-6',
      usage,
    },
  });
  writeFileSync(fakeFile, line + '\n');
}

function cleanupFake() {
  try { if (existsSync(fakeFile)) unlinkSync(fakeFile); } catch {}
  try { if (existsSync(TRIPPED_FLAG_FILE)) unlinkSync(TRIPPED_FLAG_FILE); } catch {}
}

async function main() {
  console.log('=== test-budget-breaker ===');
  console.log(`date (ET):   ${date}`);
  console.log(`cap:         $${DAILY_CAP_USD}`);
  console.log(`fake file:   ${fakeFile}`);
  console.log(`flag file:   ${TRIPPED_FLAG_FILE}`);
  console.log('');

  // Always clean up — guard against a half-finished prior run.
  cleanupFake();

  // Baseline snapshot before injection.
  const baseline = computeBudgetSnapshot();
  console.log(`baseline:    $${baseline.spent_usd} / $${baseline.cap_usd} (${baseline.percent_used}%) status=${baseline.status}`);

  // Inject overspend.
  injectFakeOverspend();
  console.log('injected fake overspend (~$675 Opus equivalent)');

  // Recompute pure-function snapshot.
  const after = computeBudgetSnapshot();
  console.log(`after fake:  $${after.spent_usd} / $${after.cap_usd} (${after.percent_used}%) status=${after.status}`);
  assert('pure-function status === tripped', after.status === 'tripped', `got ${after.status} at $${after.spent_usd}`);
  assert('spent_usd > cap',                  after.spent_usd > DAILY_CAP_USD);

  // If hub is up, optionally probe the live endpoint. The hub will only have
  // the new endpoint after a natural restart — we don't restart it from inside
  // the test (per the deployment constraint). If /budget/today returns 404,
  // we mark this as SKIPPED, not failed.
  const live = await hubAlive();
  if (live) {
    const budget = await fetchJson(`${HUB_URL}/budget/today`);
    if (!budget) {
      console.log('hub is up but /budget/today is not yet wired — SKIPPED (hub needs natural restart to pick up new code)');
    } else {
      console.log('hub is up AND /budget/today is wired — testing live endpoints');
      assert('/budget/today status === tripped', budget.status === 'tripped', `got ${budget.status}`);
      assert('/budget/today spent_usd > cap',    budget.spent_usd > DAILY_CAP_USD);
      assert('/budget/today has cap_usd',        budget.cap_usd === DAILY_CAP_USD);
      assert('/budget/today has remaining_usd',  budget.remaining_usd === 0);

      // Wait up to ~75s for the hub's 60s breaker sweep to fire.
      console.log('waiting up to 75s for hub circuit-breaker sweep...');
      let sawFlag = false;
      let sawHealth = false;
      for (let i = 0; i < 75; i++) {
        if (!sawFlag && existsSync(TRIPPED_FLAG_FILE)) sawFlag = true;
        if (!sawHealth) {
          const h = await fetchJson(`${HUB_URL}/health`, 2000);
          if (h && h.budget_check === 'tripped' && h.budgetTripped === true) sawHealth = true;
        }
        if (sawFlag && sawHealth) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      assert('hub wrote /tmp/9-budget-tripped',  sawFlag);
      assert('/health budget_check === tripped', sawHealth);
    }
  } else {
    console.log('hub is NOT running — skipping live-endpoint assertions (pure-function path validated)');
  }

  // Cleanup.
  cleanupFake();

  // Validate cleanup restored sanity. Compare against baseline (today may
  // already be over the cap, in which case "below cap" is impossible — what
  // we really want is "spend dropped back to baseline").
  const restored = computeBudgetSnapshot();
  console.log(`after clean: $${restored.spent_usd} / $${restored.cap_usd} (${restored.percent_used}%) status=${restored.status}`);
  const tolerance = 1.00; // $1 tolerance for float / new agent activity during test
  assert('cleanup restored baseline', Math.abs(restored.spent_usd - baseline.spent_usd) < tolerance, `baseline ${baseline.spent_usd} vs restored ${restored.spent_usd}`);
  assert('flag file cleaned up',      !existsSync(TRIPPED_FLAG_FILE));

  console.log('');
  console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch(e => {
  console.error('test crashed:', e);
  cleanupFake();
  process.exit(1);
});
