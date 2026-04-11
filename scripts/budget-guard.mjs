#!/usr/bin/env node
/**
 * budget-guard.mjs
 *
 * CLI gate for any cost-incurring action. Exit code:
 *   0 — budget OK, proceed
 *   1 — budget tripped, abort
 *
 * Usage from a Bash caller (cron job, regression script, sub-agent spawner):
 *
 *   if ! node scripts/budget-guard.mjs --quiet; then
 *     echo "Budget tripped, skipping spawn"
 *     exit 0
 *   fi
 *   node scripts/spawn-some-expensive-thing.mjs
 *
 * Flags:
 *   --quiet      Suppress JSON snapshot, only set exit code
 *   --json       Print full snapshot JSON to stdout (default)
 *   --status-only Print just the status word
 *
 * Single source of truth: scripts/budget-tracker.mjs.
 */

import { computeBudgetSnapshot, isTripped, TRIPPED_FLAG_FILE } from './budget-tracker.mjs';

const args = process.argv.slice(2);
const quiet      = args.includes('--quiet');
const statusOnly = args.includes('--status-only');

let snap;
try {
  snap = computeBudgetSnapshot();
} catch (e) {
  // Compute failure should NOT block production work — log to stderr and pass.
  console.error(`[budget-guard] compute failed (passing through): ${e.message}`);
  process.exit(0);
}

const tripped = snap.status === 'tripped' || isTripped();

if (statusOnly) {
  console.log(snap.status);
} else if (!quiet) {
  console.log(JSON.stringify({
    ...snap,
    flag_file: TRIPPED_FLAG_FILE,
    tripped,
  }, null, 2));
}

process.exit(tripped ? 1 : 0);
