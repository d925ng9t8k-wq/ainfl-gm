#!/usr/bin/env node
// ara-retry-daemon.mjs — background ticker for the 9<->Ara bridge retry loop.
//
// WHY: Protocol rule #4 requires that if 9 sends [9-SEQ N] and Ara does not
// ACK within 90s, 9 resends the SAME wrapped body so Ara can dedupe by the
// tag. checkRetry() in ara-bridge.mjs implements the single-tick logic; this
// daemon just runs it on a 30s interval so the retry fires within the 90s
// window without any manual intervention.
//
// Apr 11 addition — auto-poke watchdog: if 9 sent a wrapped directive to Ara
// and the corresponding ackAt has been null for >180s AND nineSeq has not
// incremented since (meaning 9 is not even producing new turns), POKE the
// hub via /terminal/poke so the next PostToolUse hook surfaces a 🚨 wake-up.
// Born from the Apr 11 double-freeze incident. Only fires ONCE per stuck seq —
// tracked in pokedSeqs to prevent spam.
//
// USAGE:
//   node scripts/ara-retry-daemon.mjs                 # foreground tick loop
//
// LAUNCHAGENT: a plist is written to
//   ~/Library/LaunchAgents/com.9.ara-retry-daemon.plist
// with StartInterval=30 and RunAtLoad=true. To load it after review:
//   launchctl unload ~/Library/LaunchAgents/com.9.ara-retry-daemon.plist 2>/dev/null
//   launchctl load ~/Library/LaunchAgents/com.9.ara-retry-daemon.plist
// To stop:
//   launchctl unload ~/Library/LaunchAgents/com.9.ara-retry-daemon.plist

import { checkRetry } from './ara-bridge.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TICK_MS = 30 * 1000;
const BRIDGE_STATE_PATH = path.join(ROOT, 'data', 'ara-bridge-state.json');
const HUB_URL = process.env.HUB_URL || 'http://localhost:3457';
const POKE_THRESHOLD_MS = 180 * 1000; // 3 min unacked = poke

// Track which seqs we've already poked for, plus the last seen nineSeq snapshot
// at the time we observed lastSent. This lets us detect "9 has not produced
// any new turn AT ALL since the directive was sent" — the strongest freeze
// signal we have without instrumenting Claude Code itself.
const pokedSeqs = new Set();
let lastSentObservedNineSeq = null; // nineSeq value when current lastSent first appeared
let lastSentObservedForSeq = null;  // which lastSent.seq the snapshot belongs to

function readBridgeState() {
  try {
    return JSON.parse(fs.readFileSync(BRIDGE_STATE_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function firePoke(seq, ageSec, reason) {
  try {
    const res = await fetch(`${HUB_URL}/terminal/poke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ara-retry-daemon',
        reason,
        urgency: 'normal',
      }),
    });
    const text = await res.text();
    console.log(`[ara-retry-daemon] POKE fired for seq ${seq} (age ${ageSec}s) — hub said: ${text}`);
    pokedSeqs.add(seq);
  } catch (e) {
    console.error(`[ara-retry-daemon] POKE failed for seq ${seq}: ${e.message}`);
  }
}

async function freezeWatchdog() {
  const s = readBridgeState();
  if (!s || !s.lastSent || typeof s.lastSent.seq !== 'number') return;
  const { seq, sentAt, ackAt } = s.lastSent;
  if (ackAt) {
    // Acked — clear stale tracking and stop watching this seq.
    if (lastSentObservedForSeq === seq) {
      lastSentObservedForSeq = null;
      lastSentObservedNineSeq = null;
    }
    return;
  }
  // Refresh the snapshot of nineSeq at the moment we first saw THIS lastSent.
  if (lastSentObservedForSeq !== seq) {
    lastSentObservedForSeq = seq;
    lastSentObservedNineSeq = s.nineSeq;
  }
  if (pokedSeqs.has(seq)) return; // Already poked once for this seq — no spam.
  const age = Date.now() - (sentAt || 0);
  if (age <= POKE_THRESHOLD_MS) return;
  // 9's nineSeq has not advanced since this lastSent appeared = 9 is producing
  // no new turns AT ALL. Strongest available freeze signal from this side.
  if (s.nineSeq !== lastSentObservedNineSeq) {
    // 9 has produced new turns since the directive — not frozen, just slow to ack.
    // Let the bridge's normal retry path handle it.
    return;
  }
  const ageSec = Math.round(age / 1000);
  const reason = `9 has not acknowledged Ara directive seq ${seq} for ${ageSec}s and nineSeq has not incremented (currently ${s.nineSeq}). Possible freeze.`;
  await firePoke(seq, ageSec, reason);
}

async function tick() {
  try {
    const r = await checkRetry();
    if (r) {
      console.log(`[ara-retry-daemon] ${new Date().toISOString()}`, JSON.stringify(r));
    }
  } catch (e) {
    console.error(`[ara-retry-daemon] ${new Date().toISOString()} retry error:`, e.message);
  }
  try {
    await freezeWatchdog();
  } catch (e) {
    console.error(`[ara-retry-daemon] ${new Date().toISOString()} watchdog error:`, e.message);
  }
}

// Run once immediately, then every TICK_MS.
await tick();
setInterval(tick, TICK_MS);
console.log(`[ara-retry-daemon] started — tick interval ${TICK_MS}ms (poke threshold ${POKE_THRESHOLD_MS}ms)`);
