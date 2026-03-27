# Communications Architecture Audit

**Date:** 2026-03-26
**Auditor:** Agent (Claude Opus 4.6)
**Scope:** Full comms stack — comms-hub.mjs, check-messages.sh, cloud-worker, voice-server.mjs, hooks, terminal detection, crash recovery

---

## Architecture Overview

The system is a custom-built communications layer between an AI agent ("9") running in Claude Code on a Mac, and its owner (Jasson) across four channels: Telegram, iMessage, Email, and Voice. It operates in two modes:

- **Relay mode:** Terminal is active. Hub collects messages and writes them to a signal file (`/tmp/9-incoming-message.jsonl`). A PostToolUse hook reads the file after every tool call and injects messages into Claude's context.
- **Autonomous mode:** Terminal is down. Hub responds directly using Claude API (via "OC" persona) or hands off to "The Doorman" on iMessage.

A Cloudflare Worker provides cloud failover when the entire Mac goes offline.

---

## FINDING 1: The Idle Terminal Black Hole

**Issue:** The PostToolUse hook only fires when Claude makes a tool call. If Claude is writing a long response, thinking, or waiting for input, the hook does not fire. Messages accumulate in the signal file unread. The CLAUDE.md explicitly warns "NEVER go more than 2 minutes without making a tool call" — but this is a behavioral rule that depends on the AI remembering to obey it, not an architectural guarantee.

**Impact:** P0. This is the single biggest reliability gap. Jasson sends a message on Telegram, the hub writes it to the signal file, but Claude does not see it until the next tool call. If Claude is idle for 5+ minutes (common during long text generation or when waiting at a prompt), the message sits in limbo. The 60-second relay timeout in the hub will eventually fire an autonomous OC response, but that means Jasson gets a Haiku response instead of the full-power terminal response, and the terminal copy of the message may still be consumed later causing a duplicate response.

**Current mitigations (partial):**
- The hub sends osascript keystrokes at 10s and 30s to "nudge" the terminal
- The Notification hook also runs check-messages.sh
- The Stop hook runs check-messages.sh

**Gaps in mitigations:**
- The osascript nudge only works if Terminal.app is the foreground app
- Notification hook fires only when Claude pauses to wait for user input, not during generation
- There is no PreToolUse hook configured, which would double the check frequency during active tool use

**Fix:**
1. Add a PreToolUse hook that also runs check-messages.sh — doubles check frequency during active work for zero cost.
2. Implement a dedicated background poller in the hub that, when terminal is active, periodically hits a "wake" endpoint on Claude Code. The `/inbox` endpoint already acts as a heartbeat — repurpose or add a lightweight HTTP ping that the hook can respond to.
3. Consider a `SubagentCompleted` or `SessionPause` hook if Claude Code exposes one in future.
4. The real fix: add a filesystem watcher (fswatch/chokidar) in the hook script that triggers on signal file changes, then sends an interrupt to the terminal. This closes the gap entirely.

**Priority:** P0

---

## FINDING 2: Signal File Race Condition

**Issue:** The signal file `/tmp/9-incoming-message.jsonl` is read and deleted atomically in check-messages.sh (`cat` then `rm -f`), but the hub appends to it asynchronously using `appendFileSync`. If the hub writes a new message between the `cat` and `rm -f` in the hook, that message is lost.

**Impact:** P1. Under normal operation this window is microseconds, but during bursts (Jasson sends multiple messages rapidly, or messages arrive on multiple channels simultaneously), the probability increases. A lost message means Jasson gets no response and has to repeat himself.

**Code in check-messages.sh (lines 12-15):**
```bash
if [ -f "$INCOMING" ] && [ -s "$INCOMING" ]; then
  messages=$(cat "$INCOMING")
  rm -f "$INCOMING"
```

**Fix:** Use atomic file operations. Replace `cat` + `rm` with `mv` to a temp file, then read the temp file:
```bash
TEMP="/tmp/9-incoming-message-processing.$$"
if [ -f "$INCOMING" ] && [ -s "$INCOMING" ]; then
  mv "$INCOMING" "$TEMP" 2>/dev/null || exit 0
  messages=$(cat "$TEMP")
  rm -f "$TEMP"
```
The `mv` is atomic on the same filesystem. Any new writes from the hub will create a fresh file.

**Priority:** P1

---

## FINDING 3: Crash Detection Latency — 2 Minutes is Too Slow

**Issue:** Terminal ping timeout is 120 seconds (`TERMINAL_TIMEOUT = 120000`). The watchdog checks every 30 seconds. Combined worst case: up to 150 seconds (2.5 minutes) before a crash is detected. During this window, messages go into the signal file but nobody reads them.

**Impact:** P1. Jasson sends a message, Claude is dead, and he waits up to 2.5 minutes for any response. Then the recovery sequence starts (write signal file, LaunchAgent opens Terminal, Claude boots, runs startup protocol, claims terminal). Total time from crash to operational: potentially 3-5 minutes.

**Current architecture:**
- Ping loop runs every 60 seconds (CLAUDE.md line 23)
- Watchdog checks every 30 seconds (comms-hub.mjs line 277)
- PID check (process.kill signal 0) runs every 30 seconds — this is the fast path

**Fix:**
1. Reduce ping interval from 60s to 15s. The ping is a single `curl -s -X POST` to localhost — negligible overhead.
2. Reduce `TERMINAL_TIMEOUT` from 120s to 45s. Two missed 15s pings = 30s, plus 15s watchdog cycle = 45s max detection.
3. The PID check is already good (30s cycle, immediate detection on PID death). Keep it.
4. Add the `/tmp/9-last-tool-call` timestamp to the watchdog (currently disabled). The freeze detector was disabled due to false positives between sessions — fix it by only checking when `terminalActive === true` AND the file timestamp is from the current session (compare against `terminalLastPing` start time, not just absolute age).

**Priority:** P1

---

## FINDING 4: Cloud-to-Mac Sync Has a 10-Minute Dead Zone

**Issue:** The cloud worker considers the Mac alive if heartbeat is less than 10 minutes old (`elapsed < 600000`). The Mac syncs every 60 seconds. This means the cloud can wait up to 10 minutes after Mac death before taking over Telegram.

**Impact:** P1. If the Mac crashes and the cloud worker's cron runs right after the last heartbeat, it will not detect the outage for up to 10 minutes. During this time, Telegram messages are silently dropped — the Mac is not polling (it is dead), and the cloud has not set the webhook yet.

**Flow on Mac crash:**
1. Mac dies at T=0
2. Last heartbeat was at T=-30s (worst case T=-60s)
3. Cloud cron runs every 2 minutes
4. First cron after crash: at best T=+2m, at worst T=+4m
5. But `elapsed < 600000` means cron must see 10 minutes of silence
6. Cloud takes over at T=+10m to T=+12m

**Fix:**
1. Reduce the cloud alive threshold from 600000ms (10 min) to 180000ms (3 min). With 60s sync interval, 3 missed syncs = definitely dead.
2. Reduce the cloud cron from every 2 minutes to every 1 minute (Cloudflare Workers supports this).
3. Combined: worst-case detection drops from 12 minutes to 4 minutes.
4. Better: have the Mac sync every 30s instead of 60s, and set cloud threshold to 120000ms (2 min). Worst case: 3 minutes.

**Priority:** P1

---

## FINDING 5: Telegram Channel — Single Point of Failure in Cloud Handoff

**Issue:** When the Mac is alive, it uses long-polling to receive Telegram messages. When Mac dies, the cloud worker must set a webhook to start receiving messages. But during the transition, there is a gap where neither is listening.

The cloud worker also queues messages when Mac is alive (`macAlive` check in webhook handler, line 266-269), but this queue is only drained when the Mac sends its next heartbeat. If the Mac crashes right after receiving a queued message, that message may never be processed.

**Impact:** P1. Messages sent during the handoff window are lost or significantly delayed.

**Fix:**
1. Have the cloud worker ALWAYS accept and queue Telegram messages via webhook, regardless of Mac status. This eliminates the gap.
2. When Mac is alive, the cloud still queues but also forwards to Mac via HTTP POST to a new `/relay` endpoint on the hub.
3. This requires keeping the webhook set permanently and having the Mac NOT use long-polling. Instead, the Mac receives all messages from the cloud relay. Single source of truth.
4. Simpler alternative: keep current architecture but have the cloud respond with a brief acknowledgment ("Got it, passing to 9") during the handoff window instead of silently queuing.

**Priority:** P1

---

## FINDING 6: No PreToolUse Hook

**Issue:** The settings.json configures PostToolUse, Notification, and Stop hooks — but not PreToolUse. PreToolUse fires before every tool call, which would effectively double the message-check frequency for zero additional cost.

**Impact:** P2. Easy win left on the table.

**Fix:** Add to `~/.claude/settings.json`:
```json
"PreToolUse": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "bash /Users/jassonfishback/Projects/BengalOracle/scripts/check-messages.sh",
        "timeout": 5
      }
    ]
  }
]
```

**Priority:** P2

---

## FINDING 7: iMessage Read Requires Terminal FDA — Degraded After Reboot

**Issue:** iMessage reading depends on Full Disk Access (FDA) to read `~/Library/Messages/chat.db`. When the hub is started by LaunchAgent (not from Terminal), it does not have FDA. After a Mac reboot, iMessage goes to send-only mode until someone manually restarts the hub from Terminal.

**Impact:** P2. After every reboot, iMessage is degraded. The CLAUDE.md documents this ("After a Mac Reboot... hub restarts via LaunchAgent but in degraded mode") and has a manual fix, but this means the system cannot fully self-heal from a reboot.

**Fix:**
1. Grant Full Disk Access to `/opt/homebrew/bin/node` in System Settings (not just Terminal.app). This allows the LaunchAgent-spawned hub to read the iMessage DB.
2. Alternative: use a login item or LaunchAgent that opens a Terminal window and starts the hub there (the open-terminal.mjs approach, but for the hub itself).
3. The CLAUDE.md already documents the workaround — the real fix is making the LaunchAgent path FDA-aware.

**Priority:** P2

---

## FINDING 8: Email Deduplication by Subject Only

**Issue:** Email dedup uses a `Set` of subject lines (comms-hub.mjs line 1306). Two different emails with the same subject will cause the second to be silently dropped. Also, the Set is in-memory — it resets on hub restart, potentially re-processing old emails.

**Impact:** P2. If Jasson forwards two different emails with the same subject, or replies to a thread (same subject), only the first is processed.

**Fix:**
1. Dedup by Message-ID header instead of subject. This requires modifying the AppleScript to extract the message ID.
2. Short-term: dedup by subject + first 100 chars of body.
3. Persist the dedup set to disk so hub restarts do not re-process.

**Priority:** P2

---

## FINDING 9: Voice Tunnel Uses Free-Tier Cloudflare Quick Tunnels

**Issue:** The system uses `cloudflared tunnel --url http://localhost:3456` which creates ephemeral "quick tunnels" with randomly generated URLs (e.g., `xyz-abc.trycloudflare.com`). These URLs change on every tunnel restart, requiring Twilio webhook updates.

**Impact:** P2. Every tunnel restart triggers a cascade: update `.env`, restart voice server, update Twilio webhook. Any failure in this chain means missed calls. Quick tunnels also have no SLA and can be rate-limited by Cloudflare.

**Fix:**
1. Set up a named Cloudflare Tunnel with a stable subdomain (e.g., `voice.9comms.com`). Cost: $0 with Cloudflare free tier + a domain.
2. This eliminates the tunnel URL rotation problem entirely. Twilio webhook becomes static.
3. The `restartVoiceWithTunnel()` function becomes a simple `cloudflared tunnel run <name>` — no URL parsing, no .env update, no Twilio update.

**Priority:** P2

---

## FINDING 10: Autonomous Mode Uses Sonnet 4.6 — Expensive for Quick Replies

**Issue:** When terminal is down, the hub's `askClaude` function uses `claude-sonnet-4-6` (comms-hub.mjs line 753) for autonomous responses. The cloud worker uses `claude-haiku-4-5-20251001` (worker.js line 112). The hub should also use Haiku for quick acknowledgments and simple queries.

**Impact:** P2. Sonnet 4.6 is roughly 10-15x more expensive than Haiku 4.5. During extended terminal outages, the hub could burn significant API budget on messages that Haiku could handle fine.

**Fix:**
1. Use Haiku for autonomous mode responses (like the cloud worker does).
2. Reserve Sonnet for complex queries detected by `detectComplexRequest()`.
3. Alternatively, use Haiku by default and only escalate to Sonnet if the Haiku response includes uncertainty markers.

**Priority:** P2

---

## FINDING 11: No PermissionRequest Hook — Missed Auto-Approve Opportunity

**Issue:** The autonomy-improvements.md document (already researched) identifies that a PermissionRequest hook could auto-approve safe operations like `ExitPlanMode`. This is not yet configured.

**Impact:** P2. When Claude Code hits a permission prompt and no one is watching, it blocks until someone approves. This contributes to the idle terminal problem.

**Fix:** Add to settings.json:
```json
"PermissionRequest": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "echo '{\"hookSpecificOutput\": {\"hookEventName\": \"PermissionRequest\", \"decision\": {\"behavior\": \"allow\"}}}'",
        "timeout": 5
      }
    ]
  }
]
```
Note: This auto-approves ALL permission requests. A matcher should be added to scope it to safe operations only, or the `--dangerously-skip-permissions` flag (already used in open-terminal.mjs line 55) covers this case.

**Priority:** P2

---

## FINDING 12: The Doorman Uses Sonnet 4.6 — Overkill

**Issue:** The Doorman is a recovery-only assistant that walks Jasson through reconnecting to 9. It uses `claude-sonnet-4-6` (comms-hub.mjs line 499). Its responses are entirely scripted recovery steps — Haiku or even a hardcoded decision tree would work.

**Impact:** P2. Unnecessary cost. The Doorman's job is narrow enough for Haiku or even template responses.

**Fix:** Change model to `claude-haiku-4-5-20251001` for askDoorman, or replace with a simple keyword-matching function that returns canned recovery steps.

**Priority:** P2

---

## FINDING 13: Freeze Detector Disabled — No Replacement

**Issue:** The freeze detector (comms-hub.mjs lines 310-366) was disabled on March 26 due to false positive spam. The comment says "Disabling entirely until DOC agent can rebuild it properly with session-aware state." No replacement has been built.

**Impact:** P1. Without the freeze detector, a frozen terminal (process alive but unresponsive) is only caught by the 60-second relay timeout on individual messages. There is no proactive detection — it is purely reactive per message.

**Fix:** Rebuild the freeze detector with session-aware logic:
```javascript
setInterval(() => {
  if (!terminalActive) return;

  try {
    const raw = readFileSync(LAST_TOOL_CALL_FILE, 'utf-8').trim();
    const lastCallTs = parseInt(raw) * 1000;
    if (!lastCallTs || isNaN(lastCallTs)) return;

    // Only alert if the timestamp is FROM THIS SESSION
    // (after terminal was last claimed)
    const terminalClaimTime = terminalLastPing - TERMINAL_TIMEOUT; // approximate
    if (lastCallTs < terminalClaimTime) return; // Stale from previous session

    const age = Date.now() - lastCallTs;
    if (age > FREEZE_THRESHOLD_MS && !freezeAlertSent) {
      // One alert per freeze event
      freezeAlertSent = true;
      freezeAlertForTimestamp = lastCallTs;
      sendTelegram(`9 may be frozen — no tool call in ${Math.round(age/60000)}+ min.`);
      execSync(`osascript -e 'tell application "System Events" to keystroke return'`, { timeout: 5000 });
    }

    // Reset only when timestamp ADVANCES (new tool call detected)
    if (freezeAlertSent && lastCallTs > freezeAlertForTimestamp) {
      freezeAlertSent = false;
    }
  } catch {}
}, 30000);
```

**Priority:** P1

---

## FINDING 14: Scalability — Single Mac, Single Process, No Isolation

**Issue:** The entire comms stack runs on one Mac as a single Node.js process. All channels share the same event loop. A blocking operation in one channel (e.g., a slow AppleScript email check with 15s timeout) blocks message delivery on all other channels.

**Impact:** P2 now, P0 at 15 businesses. At current scale (1 business), this works. At 15 businesses, the single Mac becomes a bottleneck. AppleScript calls are synchronous (`execSync`), the Telegram long-poll blocks a connection, and the email monitor's `osascript` calls can hang for 15+ seconds.

**Fix (short term):**
1. Replace `execSync` AppleScript calls with `exec` (async) for email and iMessage operations.
2. Move the email monitor to a separate process or worker thread.
3. Add circuit breakers: if an AppleScript call hangs for >10s, kill it and move on.

**Fix (long term for 15 businesses):**
1. Move to a VPS-based architecture with proper message queuing (Redis/RabbitMQ).
2. Each business gets its own agent instance with isolated comms.
3. The Mac becomes a client, not the server.
4. Use proper IMAP for email instead of AppleScript/Mail.app.
5. Use a persistent Telegram webhook (via cloud) instead of long-polling from Mac.

**Priority:** P2 (but escalates to P0 when expanding)

---

## FINDING 15: Cloud Worker State Sync is One-Way (Mac to Cloud)

**Issue:** The Mac pushes state to the cloud every 60 seconds, but the cloud's conversation history (messages handled while Mac was down) is only pulled when the Mac sends its next heartbeat. If the Mac crashes and recovers, it pulls queued messages — but the cloud's conversation context (what was said, what was promised) may not fully transfer.

**Impact:** P2. After a Mac recovery, 9 may not know what OC or Backup QB told Jasson during the outage. This can lead to contradictory responses.

**Fix:**
1. On terminal startup, always fetch `/state` from the cloud worker to get full conversation history.
2. Inject the cloud's conversation context into the terminal's startup context.
3. The startup protocol in CLAUDE.md should add: `curl -s https://9-cloud-standin.<domain>/state` and include cloud responses in the session context.

**Priority:** P2

---

## FINDING 16: Hook Timeout of 5 Seconds is Tight

**Issue:** The check-messages.sh hook has a 5-second timeout. It performs: file read, Python JSON escape, and optionally a `curl` to localhost:3457/inbox with a 3-second timeout. If the hub is under load or the inbox has many messages, the curl alone can take 3+ seconds, leaving <2 seconds for the rest.

**Impact:** P2. If the hook times out, the message is not delivered to Claude on that tool call. It will be picked up on the next call (the file is not deleted on timeout), but this adds latency.

**Fix:**
1. Increase hook timeout from 5 to 10 seconds.
2. Remove the live inbox curl fallback from the hook — it is a belt-and-suspenders check that adds latency for marginal benefit. The signal file is the primary path; trust it.
3. If keeping the curl, reduce its `--max-time` from 3 to 1 second.

**Priority:** P2

---

## FINDING 17: No Message Delivery Confirmation

**Issue:** When the hub writes a message to the signal file and Claude reads it via the hook, there is no confirmation back to the hub that the message was actually seen and processed by Claude. The hub marks messages as "read" when the `/inbox` endpoint is polled, but the signal file path has no acknowledgment.

**Impact:** P2. The hub cannot distinguish between "Claude read the message" and "the hook consumed the file but Claude ignored the context." If Claude's context window is full or the additionalContext is truncated, the message is effectively lost with no indication.

**Fix:**
1. After the hook injects a message, have Claude (or the hook) call `POST /ack` on the hub to confirm receipt.
2. If no ack within 30 seconds, the hub re-queues the message and tries again.
3. This creates a proper delivery guarantee instead of fire-and-forget.

**Priority:** P2

---

## FINDING 18: osascript Nudge Requires Terminal to Be Frontmost

**Issue:** The keystroke nudge at lines 1128-1136 uses `tell application "Terminal" to activate` followed by `tell application "System Events" to keystroke return`. This only works if Terminal.app can become frontmost and if the keystroke reaches the right window.

**Impact:** P2. If the Mac's screen is locked, in screensaver, or another app is focused and blocking, the nudge fails silently. The 60-second autonomous fallback catches this, but the nudge was supposed to prevent needing that fallback.

**Fix:**
1. Instead of keystroke simulation, use a more reliable interrupt mechanism. Write to a pipe/socket that Claude Code monitors, or use the Notification hook to surface messages.
2. Alternatively, accept that the nudge is best-effort and rely on the 60-second fallback as the guaranteed path.

**Priority:** P2

---

## SUMMARY TABLE

| # | Finding | Priority | Effort | Impact |
|---|---------|----------|--------|--------|
| 1 | Idle terminal black hole (hook only fires on tool calls) | P0 | High | Messages delayed or missed during idle periods |
| 2 | Signal file race condition (cat+rm not atomic) | P1 | Low | Messages lost during burst sends |
| 3 | Crash detection latency (2+ minutes) | P1 | Low | Long gap before recovery starts |
| 4 | Cloud handoff dead zone (10 minutes) | P1 | Low | Telegram goes dark for up to 12 minutes |
| 5 | Telegram gap during Mac-to-cloud transition | P1 | Medium | Messages lost during handoff |
| 6 | No PreToolUse hook | P2 | Trivial | Easy win: 2x check frequency |
| 7 | iMessage degraded after reboot (FDA) | P2 | Low | iMessage goes send-only until manual fix |
| 8 | Email dedup by subject only | P2 | Low | Duplicate subjects silently dropped |
| 9 | Ephemeral tunnel URLs | P2 | Medium | Cascade of updates on every restart |
| 10 | Sonnet 4.6 for autonomous mode | P2 | Trivial | Unnecessary API cost |
| 11 | No PermissionRequest hook | P2 | Trivial | Terminal blocks on permission prompts |
| 12 | Doorman uses Sonnet | P2 | Trivial | Unnecessary cost for simple task |
| 13 | Freeze detector disabled, no replacement | P1 | Medium | No proactive frozen-terminal detection |
| 14 | Scalability — single Mac, single process | P2 | High | Blocks expansion to 15 businesses |
| 15 | One-way cloud sync | P2 | Low | Context loss after recovery |
| 16 | Hook timeout tight at 5 seconds | P2 | Trivial | Occasional missed deliveries |
| 17 | No message delivery confirmation | P2 | Medium | No guarantee Claude actually saw message |
| 18 | osascript nudge unreliable | P2 | Low | Nudge fails when screen locked |

---

## RECOMMENDED IMPLEMENTATION ORDER

**Week 1 (Quick Wins):**
1. Fix signal file race condition (Finding 2) — 15 minutes
2. Add PreToolUse hook (Finding 6) — 5 minutes
3. Reduce ping interval to 15s, timeout to 45s (Finding 3) — 10 minutes
4. Reduce cloud alive threshold to 180s (Finding 4) — 5 minutes
5. Switch autonomous mode and Doorman to Haiku (Findings 10, 12) — 10 minutes
6. Increase hook timeout to 10s (Finding 16) — 2 minutes

**Week 2 (Medium Effort):**
7. Rebuild freeze detector with session awareness (Finding 13)
8. Set up named Cloudflare Tunnel (Finding 9)
9. Add cloud state pull to startup protocol (Finding 15)
10. Add PermissionRequest hook (Finding 11)

**Week 3 (Larger Work):**
11. Implement delivery acknowledgment (Finding 17)
12. Address Telegram handoff gap (Finding 5)
13. Make AppleScript calls async (Finding 14)
14. Grant FDA to node binary (Finding 7)

**Future (Scalability):**
15. Move to VPS-based architecture with proper message queuing
16. Implement proper IMAP email handling
17. Permanent Telegram webhook architecture

---

## BOTTOM LINE

The system is impressively engineered for a custom build — four channels running in parallel with autonomous failover, cloud backup, battery monitoring, API health probing, and self-healing terminal recovery. That said, the fundamental architecture has a structural weakness: **message delivery depends on Claude making tool calls**, and there is no guaranteed interrupt mechanism when it is not. Every other finding flows from this core issue or from the complexity of managing a single Mac as the nerve center for an always-on AI.

The most impactful changes are the quick wins in Week 1 — they take under an hour combined and address the worst reliability gaps. The idle terminal problem (Finding 1) is the hardest to solve properly and may require changes to Claude Code itself (an idle-interrupt hook) to fully close.
