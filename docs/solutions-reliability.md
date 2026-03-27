# Reliability Solutions — Issues 10-12

## Issue 10: Freeze Detector Disabled (False Positives Between Sessions)

**File:** `scripts/comms-hub.mjs` lines 310-366

### Problem

The freeze detector monitors `/tmp/9-last-tool-call` and alerts when no tool call happens for 3+ minutes while the terminal is marked active. It was disabled March 26 because the reset logic created a repeating alert loop between sessions:

1. Terminal session ends, but `terminalActive` stays true briefly (ping timeout gap).
2. Stale tool-call timestamp in `/tmp/9-last-tool-call` triggers freeze alert.
3. New session starts, timestamp advances, `freezeAlertSent` resets.
4. Old timestamp ages past threshold again, fires another alert.
5. Repeat.

The root cause: the detector has no concept of session boundaries. It treats any stale timestamp as a freeze, even when the staleness is simply the gap between two sessions.

### Solution: Session-Aware Freeze Detector

Tie the freeze detector to the session token system that already exists (`terminalSessionToken`). Track which session wrote the last tool call. Only alert if the tool call is stale AND belongs to the current active session.

### Code Changes

Replace the commented-out block at lines 315-366 in `scripts/comms-hub.mjs`:

```javascript
// ─── Freeze Detector ─────────────────────────────────────────────────────────
// Session-aware rebuild (March 26, 2026).
// Only monitors within an active session. Resets cleanly on session boundaries.
let freezeAlertSent = false;
let freezeAlertForTimestamp = 0;
let freezeSessionToken = null; // Track which session we're monitoring
const FREEZE_THRESHOLD_MS = 180000; // 3 minutes
const LAST_TOOL_CALL_FILE = '/tmp/9-last-tool-call';

setInterval(() => {
  // ── Guard 1: No terminal = nothing to monitor. Reset state cleanly.
  if (!terminalActive) {
    freezeAlertSent = false;
    freezeAlertForTimestamp = 0;
    freezeSessionToken = null;
    return;
  }

  // ── Guard 2: Session boundary detection.
  // If session token changed, this is a new session. Reset everything.
  if (terminalSessionToken !== freezeSessionToken) {
    freezeAlertSent = false;
    freezeAlertForTimestamp = 0;
    freezeSessionToken = terminalSessionToken;
    log('Freeze detector: new session detected — reset state');
    return; // Give the new session a full threshold window before monitoring
  }

  try {
    const raw = readFileSync(LAST_TOOL_CALL_FILE, 'utf-8').trim();
    const lastCallTs = parseInt(raw) * 1000;
    if (!lastCallTs || isNaN(lastCallTs)) return;

    // ── Guard 3: Ignore tool calls from before this session started.
    // terminalLastPing is set on /terminal/claim — use it as session start proxy.
    // If the tool call timestamp predates the current session, skip it entirely.
    const sessionStartApprox = terminalLastPing - 120000; // 2 min grace
    if (lastCallTs < sessionStartApprox && !freezeAlertSent) {
      // Stale timestamp from a previous session — not a freeze
      return;
    }

    // Tool call advanced since last alert — 9 is alive, clear the flag
    if (freezeAlertSent && lastCallTs > freezeAlertForTimestamp) {
      freezeAlertSent = false;
      freezeAlertForTimestamp = 0;
      log('Freeze detector: tool call detected — 9 is active, alert cleared');
      return;
    }

    const age = Date.now() - lastCallTs;
    if (age > FREEZE_THRESHOLD_MS && !freezeAlertSent) {
      const ageMin = Math.round(age / 60000);
      log(`FREEZE DETECTOR: No tool call in ${ageMin}+ minutes — terminal may be frozen`);

      sendTelegram(`9: WARNING — Terminal may be frozen. No tool call in ${ageMin}+ minutes. Attempting to unblock.`).catch(() => {});

      try {
        execSync(`osascript -e 'tell application "System Events" to keystroke return'`, { timeout: 5000 });
        log('Freeze detector: sent keystroke return via osascript');
      } catch (e) {
        log(`Freeze detector: osascript keystroke failed — ${e.message}`);
      }

      freezeAlertSent = true;
      freezeAlertForTimestamp = lastCallTs;
    }
  } catch {}
}, 30000);
```

### Key Differences from Original

| Aspect | Old | New |
|--------|-----|-----|
| Session awareness | None | Tracks `freezeSessionToken`, resets on session change |
| Between-session gap | Fires false alert | Returns early (Guard 3: timestamp predates session) |
| New session startup | Immediately monitors stale timestamp | Skips first interval to give new session a full window |
| Reset trigger | Only on timestamp advance or terminal down | Also on session token change |

### Implementation Steps

1. Edit `scripts/comms-hub.mjs`: remove the comment block (lines 320-326) and the `/* ... */` wrapper (lines 327, 366).
2. Replace lines 315-366 with the code above.
3. Restart comms-hub: `pkill -f comms-hub && nohup /opt/homebrew/bin/node scripts/comms-hub.mjs > /dev/null 2>&1 & disown`
4. Test: start a terminal session, make tool calls, verify no alert. End session, wait 5 minutes, start new session — verify no false alert fires in the gap.

### Timeline

30 minutes to implement and test.

---

## Issue 11: Cloud Handoff Gap (10-Minute Dead Zone)

**File:** `cloud-worker/src/worker.js`

### Problem

Three compounding delays create a worst-case 10+ minute gap where nobody answers Telegram:

1. **Mac sync interval is 5 minutes** (`scripts/comms-hub.mjs` line 2164: `setInterval(syncToCloud, 300000)`). The cloud worker only knows the Mac is alive via the heartbeat bundled in this sync.
2. **Cloud worker declares Mac dead after 10 minutes** (`worker.js` line 156: `elapsed < 600000`). That is 2 missed syncs.
3. **Cron watchdog runs every 2 minutes** (`worker.js` line 449 comment). Even after declaring Mac dead, the webhook switch happens on the next cron tick.

Worst case: Mac dies right after a sync. Cloud does not notice for 5 min (next sync missed) + 5 min (second sync missed) + 2 min (next cron) = 12 minutes of silence.

### Solution: Faster Heartbeat, Tighter Threshold, Immediate Webhook on Detection

#### Change 1: Reduce Mac sync interval to 2 minutes

In `scripts/comms-hub.mjs`, line 2164:

```javascript
// BEFORE
setInterval(syncToCloud, 300000); // Every 5 min

// AFTER
setInterval(syncToCloud, 120000); // Every 2 min (faster cloud failover detection)
```

This increases KV writes from ~288/day to ~720/day. Cloudflare free tier allows 1,000 writes/day — still within budget. If approaching the limit, the existing burn rate monitor will flag it.

#### Change 2: Reduce cloud worker dead threshold from 10 min to 5 min

In `cloud-worker/src/worker.js`, update the `isMacAlive` function (line 156) and the cron check (line 460):

```javascript
// isMacAlive function — line 156
// BEFORE
return elapsed < 600000; // 10 minutes

// AFTER
return elapsed < 300000; // 5 minutes (syncs every 2 min, so 2 missed = dead)
```

```javascript
// scheduled function — line 460
// BEFORE
const macAlive = elapsed < 600000; // 10 minutes

// AFTER
const macAlive = elapsed < 300000; // 5 minutes (syncs every 2 min)
```

#### Change 3: Set webhook immediately on detection (skip waiting for cron)

Add webhook activation directly in the `isMacAlive` check path. In the webhook handler (line 264-266), when Mac is detected as down during a live message, activate the webhook inline:

```javascript
// In the /webhook handler, after macAlive check (line 264-271):
if (macAlive) {
  await queueMessage(env.STATE, { channel: 'telegram', text: userText });
  return new Response('ok');
}

// Mac is down — if webhook isn't active yet, we got here via Telegram
// getUpdates (cron set it). Either way, respond immediately.
await sendTyping(env.TELEGRAM_BOT_TOKEN, env.CHAT_ID);
```

The real fix is ensuring the cron runs frequently enough. Cloudflare Workers cron can run every 1 minute on paid plans. On the free plan (every 1 minute is not available), the existing 2-minute cron is the fastest option.

#### Change 4: Add a "last gasp" heartbeat on Mac shutdown

In `scripts/comms-hub.mjs`, add to the `shutdown` function (line 2169):

```javascript
function shutdown(signal) {
  log(`${signal} received — saving state and shutting down`);
  state.channels.telegram.status = 'shutdown';
  state.channels.imessage.status = 'shutdown';
  state.channels.email.status = 'shutdown';
  saveState(state);

  // Last gasp: tell cloud we're going down so it takes over immediately
  if (CLOUD_WORKER_URL) {
    try {
      const cloudSecret = process.env.CLOUD_SECRET || '';
      const headers = { 'Content-Type': 'application/json' };
      if (cloudSecret) headers['x-cloud-secret'] = cloudSecret;
      // Send heartbeat=0 to signal intentional shutdown
      fetch(`${CLOUD_WORKER_URL}/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: { channels: state.channels }, intentionalShutdown: true }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    } catch {}
  }

  // Give the fetch a moment to complete
  setTimeout(() => process.exit(0), 500);
}
```

In `cloud-worker/src/worker.js`, update the heartbeat handler (around line 211) to detect intentional shutdown:

```javascript
// Inside the /heartbeat POST handler, after parsing body:
if (body.intentionalShutdown) {
  // Mac is shutting down gracefully — set heartbeat to 0 so isMacAlive returns false immediately
  const bundle = {
    heartbeat: 0, // Forces isMacAlive to return false
    state: body.state || null,
  };
  await env.STATE.put('mac-bundle', JSON.stringify(bundle));

  // Immediately activate webhook
  const workerUrl = `https://9-cloud-standin.789k6rym8v.workers.dev`;
  await fetch(`${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${workerUrl}/webhook` }),
  });
  await env.STATE.put('webhook-status', 'true');
  await env.STATE.put('mac-status', 'false');

  await sendTelegram(
    env.TELEGRAM_BOT_TOKEN,
    env.CHAT_ID,
    'Mac shutting down gracefully. Cloud backup active — I\'m here on Telegram.'
  );

  return Response.json({ status: 'ok', shutdown: true });
}
```

### Worst-Case Handoff Time After Fix

| Scenario | Before | After |
|----------|--------|-------|
| Graceful shutdown (SIGTERM/SIGINT) | 10+ min | ~1 second (last gasp) |
| Hard crash (power loss, kernel panic) | 12 min | 5 min (2 missed syncs + next cron) |
| Mac freeze (hub still running but stuck) | 10 min | 5 min |

### Implementation Steps

1. Edit `scripts/comms-hub.mjs`: change sync interval on line 2164 from 300000 to 120000.
2. Edit `scripts/comms-hub.mjs`: add last-gasp logic to `shutdown()` function.
3. Edit `cloud-worker/src/worker.js`: change both `600000` thresholds to `300000`.
4. Edit `cloud-worker/src/worker.js`: add `intentionalShutdown` handling in the heartbeat POST handler.
5. Deploy cloud worker: `cd cloud-worker && ./deploy.sh`
6. Restart comms-hub on Mac.
7. Test: kill hub gracefully (`kill -TERM <pid>`), verify cloud takes over within seconds. Kill hub hard (`kill -9 <pid>`), verify cloud takes over within 5 minutes.

### Timeline

1 hour to implement all changes and test both graceful and hard-crash scenarios.

---

## Issue 12: Pilot Auto-Relay (Manual iMessage Polling for Kyle)

**File:** `scripts/pilot-server.mjs`, `scripts/comms-hub.mjs`

### Problem

The pilot server (Jules) for Kyle Cabezas currently receives messages only via Twilio SMS webhook. There is no automated path from Kyle's iMessages to the pilot server. Today, someone has to manually poll the iMessage DB, copy Kyle's messages, and relay them to the pilot's `/sms` endpoint. This breaks the "always-on assistant" experience.

The comms-hub already has a working iMessage monitor (`imessageMonitor()` at line 1225) that reads `chat.db` via sqlite3 every 5 seconds. It currently filters for Jasson's phone number only (line 637: `h.id LIKE '%5134031829%'`). The Jamie/Jules routing stub exists (line 1243) but only matches `JAMIE_PHONE`.

### Solution: Add Kyle's Phone to iMessage Monitor, Route to Pilot Server

#### Change 1: Add Kyle's phone number to comms-hub config

In `scripts/comms-hub.mjs`, near line 52 (after `JAMIE_PHONE`):

```javascript
const JAMIE_PHONE   = process.env.JAMIE_PHONE || '';
const KYLEC_PHONE   = process.env.JULES_KYLEC_RECIPIENT_PHONE || ''; // Kyle Cabezas — pilot routing
const PILOT_SERVER_URL = 'http://localhost:3472'; // pilot-server.mjs
```

#### Change 2: Expand iMessage query to include Kyle's number

In `scripts/comms-hub.mjs`, modify the `checkNewIMessages()` function (line 632). The WHERE clause currently only matches Jasson. Add Kyle:

```javascript
function checkNewIMessages() {
  try {
    // Build handle filter dynamically based on configured phones
    const handleFilters = ["h.id LIKE '%5134031829%'", "h.id LIKE '%jassonfishback%'"];
    if (KYLEC_PHONE) {
      const kylecDigits = KYLEC_PHONE.replace(/\D/g, '').slice(-10);
      handleFilters.push(`h.id LIKE '%${kylecDigits}%'`);
    }
    if (JAMIE_PHONE) {
      const jamieDigits = JAMIE_PHONE.replace(/\D/g, '').slice(-10);
      handleFilters.push(`h.id LIKE '%${jamieDigits}%'`);
    }

    const query = `SELECT m.ROWID, m.text, m.is_from_me, h.id as handle_id
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.ROWID > ${lastImsgRowId}
        AND m.is_from_me = 0
        AND (${handleFilters.join(' OR ')})
      ORDER BY m.ROWID ASC;`;
    const result = execSync(`sqlite3 "${IMSG_DB}" "${query}"`, { encoding: 'utf-8' }).trim();
    if (!result) return [];

    const messages = [];
    for (const line of result.split('\n')) {
      const [rowid, text, , handle] = line.split('|');
      if (text && text.trim()) {
        messages.push({ rowid: parseInt(rowid), text: text.trim(), handle });
        lastImsgRowId = Math.max(lastImsgRowId, parseInt(rowid));
      }
    }
    return messages;
  } catch (e) {
    if (!e.message.includes('no such table')) {
      log(`iMessage read error: ${e.message}`);
    }
    return [];
  }
}
```

#### Change 3: Add Kyle routing in the iMessage monitor loop

In `scripts/comms-hub.mjs`, in the `imessageMonitor()` function (line 1241), add Kyle routing right after the Jamie check:

```javascript
for (const msg of messages) {
  // ── Jules routing: if sender is Jamie, route to Jules handler ──
  if (JAMIE_PHONE && msg.handle && msg.handle.includes(JAMIE_PHONE.replace(/\D/g, '').slice(-10))) {
    log(`Jules message received — routing to Jules handler`);
    await handleJulesMessage(msg);
    continue;
  }

  // ── Pilot routing: if sender is Kyle Cabezas, relay to pilot server ──
  if (KYLEC_PHONE && msg.handle && msg.handle.includes(KYLEC_PHONE.replace(/\D/g, '').slice(-10))) {
    log(`Pilot message from Kyle: "${msg.text.slice(0, 100)}"`);
    await relayToPilot(msg.text, msg.handle);
    continue; // Pilot handles this — don't process as a 9/OC message
  }

  // ... existing Jasson message handling ...
```

#### Change 4: Add the relay function

Add this new function in `scripts/comms-hub.mjs`, near the `handleJulesMessage` stub (around line 1222):

```javascript
// ─── Pilot Relay — Routes Kyle's iMessages to the pilot server ──────────────
async function relayToPilot(text, handle) {
  try {
    const res = await fetch(`${PILOT_SERVER_URL}/imessage-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, handle, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      log(`Pilot relay: sent to pilot, got response (${data.reply?.length || 0} chars)`);

      // Send pilot's response back via iMessage to Kyle
      if (data.reply) {
        try {
          const escaped = data.reply.replace(/"/g, '\\"').replace(/'/g, "'\\''");
          execSync(`osascript -e 'tell application "Messages" to send "${escaped}" to buddy "${KYLEC_PHONE}" of service "iMessage"'`, { timeout: 10000 });
          log(`Pilot relay: sent response back to Kyle via iMessage`);
        } catch (e) {
          log(`Pilot relay: iMessage send to Kyle failed — ${e.message}`);
          // Fallback: send via SMS through Twilio (pilot already has this)
        }
      }
    } else {
      log(`Pilot relay: pilot server returned ${res.status}`);
    }
  } catch (e) {
    log(`Pilot relay error: ${e.message}`);
    // Don't alert Jasson — this is a pilot system issue, not a comms-hub issue
  }
}
```

#### Change 5: Add `/imessage-in` endpoint to pilot-server.mjs

Add a new endpoint in the pilot server's HTTP handler to accept relayed iMessages. This mirrors the existing `/sms` handler but takes JSON instead of Twilio form data:

```javascript
// Add this route in the server's request handler (alongside /sms, /health, etc.)

if (pathname === '/imessage-in' && req.method === 'POST') {
  // Relayed from comms-hub iMessage monitor
  const body = JSON.parse(rawBody);
  const userText = (body.text || '').trim();

  if (!userText) {
    res.writeHead(400, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'empty message' }));
    return;
  }

  log(`iMessage IN (via relay): "${userText.slice(0, 100)}"`);
  messageCount++;

  const profile = loadProfile();
  if (!profile) {
    res.writeHead(500, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'profile not found' }));
    return;
  }

  // Check for rate update
  const rateUpdate = detectRateUpdate(userText);
  if (rateUpdate) {
    profile.mortgage_context = profile.mortgage_context || {};
    profile.mortgage_context.last_known_rate = rateUpdate;
    profile.mortgage_context.rate_updated = new Date().toISOString();
    saveProfile(profile);
    const reply = `Got it. Logged ${rateUpdate}% as today's rate.`;
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ reply }));
    return;
  }

  // Check for reminder
  const reminderIntent = detectReminderIntent(userText);
  if (reminderIntent) {
    const fireTime = scheduleReminder(reminderIntent.task, reminderIntent.time, profile);
    const reply = fireTime
      ? `Reminder set: "${reminderIntent.task}" — I'll text you at ${reminderIntent.time}.`
      : `Got the reminder but couldn't parse the time. Try "remind me at 3pm to call Garcia."`;
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ reply }));
    return;
  }

  // Check for note
  const noteText = detectNoteIntent(userText);
  if (noteText) {
    profile.notes = profile.notes || [];
    profile.notes.push(noteText);
    saveProfile(profile);
    const reply = `Noted: "${noteText}"`;
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ reply }));
    return;
  }

  // Check for guideline intent (fast path — no Claude needed)
  const guidelineIntent = detectGuidelineIntent(userText);
  if (guidelineIntent) {
    const answer = handleGuidelineIntent(guidelineIntent, profile);
    if (answer) {
      // Save to conversation memory
      profile.conversation_memory = profile.conversation_memory || [];
      profile.conversation_memory.push({ role: 'user', content: userText });
      profile.conversation_memory.push({ role: 'assistant', content: answer });
      if (profile.conversation_memory.length > 20) profile.conversation_memory = profile.conversation_memory.slice(-20);
      saveProfile(profile);

      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ reply: answer }));
      return;
    }
  }

  // General message — send to Claude
  try {
    const systemPrompt = buildSystemPrompt(profile);
    const reply = await askClaude(systemPrompt, userText, CLAUDE_HAIKU);

    profile.conversation_memory = profile.conversation_memory || [];
    profile.conversation_memory.push({ role: 'user', content: userText });
    profile.conversation_memory.push({ role: 'assistant', content: reply });
    if (profile.conversation_memory.length > 20) profile.conversation_memory = profile.conversation_memory.slice(-20);
    saveProfile(profile);

    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ reply }));
  } catch (e) {
    log(`iMessage handler Claude error: ${e.message}`);
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ reply: 'Hit a snag processing that. Try again in a sec.' }));
  }
  return;
}
```

### Architecture After Fix

```
Kyle sends iMessage
    |
    v
macOS chat.db (new row detected by sqlite3 poll)
    |
    v
comms-hub.mjs imessageMonitor() — matches Kyle's phone
    |
    v
relayToPilot() — POST to localhost:3472/imessage-in
    |
    v
pilot-server.mjs — processes message (guideline lookup / Claude / reminder / note)
    |
    v
Response JSON { reply: "..." }
    |
    v
comms-hub.mjs — sends reply back to Kyle via iMessage (osascript)
```

### Environment Setup

Add to `.env`:
```
JULES_KYLEC_RECIPIENT_PHONE=+15132255681
```

This variable is already referenced in `pilot-server.mjs` and documented in `docs/jules-kyle-cabezas-plan.md`.

### Implementation Steps

1. Add `JULES_KYLEC_RECIPIENT_PHONE` to `.env` if not already set.
2. Edit `scripts/comms-hub.mjs`: add `KYLEC_PHONE` and `PILOT_SERVER_URL` constants (near line 52).
3. Edit `scripts/comms-hub.mjs`: expand `checkNewIMessages()` query to include Kyle's phone.
4. Edit `scripts/comms-hub.mjs`: add `relayToPilot()` function near line 1222.
5. Edit `scripts/comms-hub.mjs`: add Kyle routing in `imessageMonitor()` loop before Jasson's message handling.
6. Edit `scripts/pilot-server.mjs`: add `/imessage-in` POST endpoint.
7. Restart both services: comms-hub and pilot-server.
8. Test: send an iMessage from Kyle's number, verify it arrives at pilot server and response routes back.

### Timeline

1.5 hours to implement, test end-to-end, and verify iMessage send/receive with Kyle's number.

---

## Summary

| Issue | Root Cause | Fix | Effort |
|-------|-----------|-----|--------|
| 10. Freeze Detector | No session awareness — fires between sessions | Track session token, skip stale cross-session timestamps | 30 min |
| 11. Cloud Handoff | 5-min sync + 10-min threshold + 2-min cron | 2-min sync, 5-min threshold, last-gasp on shutdown | 1 hr |
| 12. Pilot Auto-Relay | No iMessage path to pilot server | Expand iMessage monitor to match Kyle, relay to pilot | 1.5 hrs |

**Total implementation time: ~3 hours**

All three fixes are backward-compatible and can be deployed independently.
