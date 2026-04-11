#!/usr/bin/env node
// ara-retry-daemon.mjs — background ticker for the 9<->Ara bridge retry loop.
//
// WHY: Protocol rule #4 requires that if 9 sends [9-SEQ N] and Ara does not
// ACK within 90s, 9 resends the SAME wrapped body so Ara can dedupe by the
// tag. checkRetry() in ara-bridge.mjs implements the single-tick logic; this
// daemon just runs it on a 30s interval so the retry fires within the 90s
// window without any manual intervention.
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

const TICK_MS = 30 * 1000;

async function tick() {
  try {
    const r = await checkRetry();
    if (r) {
      console.log(`[ara-retry-daemon] ${new Date().toISOString()}`, JSON.stringify(r));
    }
  } catch (e) {
    console.error(`[ara-retry-daemon] ${new Date().toISOString()} error:`, e.message);
  }
}

// Run once immediately, then every TICK_MS.
await tick();
setInterval(tick, TICK_MS);
console.log(`[ara-retry-daemon] started — tick interval ${TICK_MS}ms`);
