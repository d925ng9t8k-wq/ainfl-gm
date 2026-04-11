#!/usr/bin/env node
// test-ara-poke.mjs — verify the Ara-poke-9 freeze-prevention mechanism.
//
// Steps:
//   1. POST a test entry to /terminal/poke (urgency=normal so we don't trigger
//      a real Telegram alert to Owner during test runs).
//   2. Verify /tmp/9-incoming-message.jsonl contains an entry with the
//      🚨 POKE FROM ARA prefix matching our test reason.
//   3. Clean up the test entry from the signal file (rewrite without it).
//   4. Exit 0 on pass, 1 on fail.
//
// NOTE: If the running comms-hub does not yet have the /terminal/poke route
// (i.e. process is older than this commit), the test exits 2 with a SKIP
// message. The hub will pick up the new route on next natural restart.

import fs from 'fs';

const HUB_URL = process.env.HUB_URL || 'http://localhost:3457';
const SIGNAL_FILE = '/tmp/9-incoming-message.jsonl';
const TEST_TAG = `test-ara-poke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_REASON = `TEST POKE ${TEST_TAG} — automated regression check, ignore`;

function fail(msg, extra) {
  console.error(`FAIL: ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
}
function skip(msg) {
  console.error(`SKIP: ${msg}`);
  process.exit(2);
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
  process.exit(0);
}

async function main() {
  // 0. Sanity-check the hub is up at all.
  try {
    const h = await fetch(`${HUB_URL}/health`);
    if (!h.ok) fail(`hub /health returned ${h.status}`);
  } catch (e) {
    fail(`hub unreachable at ${HUB_URL}: ${e.message}`);
  }

  // 1. POST the poke.
  let pokeRes;
  try {
    pokeRes = await fetch(`${HUB_URL}/terminal/poke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'test',
        reason: TEST_REASON,
        urgency: 'normal',
      }),
    });
  } catch (e) {
    fail(`POST /terminal/poke threw: ${e.message}`);
  }

  if (pokeRes.status === 404) {
    skip('hub does not have /terminal/poke route yet (running process predates this commit). Restart hub to pick up the new route, then re-run this test.');
  }
  if (!pokeRes.ok) {
    const body = await pokeRes.text().catch(() => '');
    fail(`POST /terminal/poke returned ${pokeRes.status}`, body);
  }

  let pokeJson;
  try {
    pokeJson = await pokeRes.json();
  } catch (e) {
    fail(`POST /terminal/poke returned non-JSON: ${e.message}`);
  }
  if (!pokeJson.ok || !pokeJson.queued) {
    fail(`POST /terminal/poke response missing ok/queued`, JSON.stringify(pokeJson));
  }
  const messageId = pokeJson.messageId;
  if (!messageId) fail(`POST /terminal/poke response missing messageId`, JSON.stringify(pokeJson));

  // Allow the hub a brief moment to flush the appendFileSync (it is sync, but
  // give the FS a tick anyway).
  await new Promise(r => setTimeout(r, 100));

  // 2. Verify /tmp/9-incoming-message.jsonl contains the entry.
  if (!fs.existsSync(SIGNAL_FILE)) {
    fail(`signal file ${SIGNAL_FILE} does not exist after poke`);
  }
  const raw = fs.readFileSync(SIGNAL_FILE, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  let foundIdx = -1;
  let foundEntry = null;
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try { parsed = JSON.parse(lines[i]); } catch { continue; }
    if (parsed.id === messageId) {
      foundIdx = i;
      foundEntry = parsed;
      break;
    }
  }
  if (foundIdx === -1) {
    fail(`signal file does not contain entry with id ${messageId}`);
  }
  if (!foundEntry.text || !foundEntry.text.includes('🚨 POKE FROM TEST')) {
    fail(`signal entry text missing 🚨 POKE FROM TEST prefix`, JSON.stringify(foundEntry));
  }
  if (!foundEntry.text.includes(TEST_TAG)) {
    fail(`signal entry text missing test tag ${TEST_TAG}`, JSON.stringify(foundEntry));
  }

  // 3. Clean up — rewrite signal file without our test entry.
  const cleaned = lines.filter((_, i) => i !== foundIdx).join('\n') + (lines.length > 1 ? '\n' : '');
  fs.writeFileSync(SIGNAL_FILE, cleaned === '\n' ? '' : cleaned);

  pass(`/terminal/poke wrote 🚨 entry id=${messageId} to ${SIGNAL_FILE} and cleanup succeeded`);
}

main().catch(e => fail(`unexpected error: ${e.message}`, e.stack));
