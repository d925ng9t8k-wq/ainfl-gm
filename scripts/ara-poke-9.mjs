#!/usr/bin/env node
// ara-poke-9.mjs — peer-side helper to wake 9 when 9 looks frozen.
//
// WHY: Born from the Apr 11 double-freeze incident. 9 froze TWICE in one hour
// during long text responses. No tool calls = no PostToolUse hook = inbound
// Telegram messages sat in /tmp/9-incoming-message.jsonl unread. Owner directive:
// give Ara a way to "poke" 9 when 9 looks stuck. This script is the trigger.
//
// USAGE:
//   node scripts/ara-poke-9.mjs --reason "9 has not ack'd ARA-SEQ 16 in 3 min" --urgency high
//   node scripts/ara-poke-9.mjs --reason "lower priority nudge" --urgency normal
//   node scripts/ara-poke-9.mjs --reason "..." --from ara-watchdog
//
// Behavior: POSTs to http://localhost:3457/terminal/poke. The hub jams a
// 🚨 POKE FROM ARA red-flag entry into /tmp/9-incoming-message.jsonl which the
// PostToolUse hook surfaces as a system-reminder on 9's next tool call. If
// urgency=high and 9 still does not ping within 90s, the hub fires a secondary
// Telegram alert to Owner.
//
// Exit codes: 0 = queued, 1 = error.

const HUB_URL = process.env.HUB_URL || 'http://localhost:3457';

function parseArgs(argv) {
  const args = { reason: null, urgency: 'normal', from: 'ara' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reason' || a === '-r') args.reason = argv[++i];
    else if (a === '--urgency' || a === '-u') args.urgency = argv[++i];
    else if (a === '--from' || a === '-f') args.from = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: ara-poke-9.mjs --reason "text" [--urgency high|normal] [--from ara]');
      process.exit(0);
    }
  }
  return args;
}

async function pokeHub({ reason, urgency, from }) {
  const body = JSON.stringify({ from, reason, urgency });
  const res = await fetch(`${HUB_URL}/terminal/poke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`hub returned ${res.status}: ${text}`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.reason) {
    console.error('error: --reason is required');
    console.error('usage: ara-poke-9.mjs --reason "text" [--urgency high|normal] [--from ara]');
    process.exit(1);
  }
  if (args.urgency !== 'high' && args.urgency !== 'normal') {
    console.error(`error: --urgency must be "high" or "normal" (got "${args.urgency}")`);
    process.exit(1);
  }
  try {
    const result = await pokeHub(args);
    console.log(JSON.stringify({ ok: true, sent: args, result }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message, sent: args }));
    process.exit(1);
  }
}

main();
