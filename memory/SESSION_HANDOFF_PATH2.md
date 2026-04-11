# Path 2 Channels Pairing Handoff — 2026-04-10

**Written by previous-9 (PID 11407, session token session-1775851770044-ugqmhd) just before Jasson exited to relaunch with --channels.**

## If you are reading this as the new 9 after `bash start-channels.sh`

Your single job: complete the Telegram Channels pairing that the previous session started. Everything else (Path 2 Phase 2+, tick engine, observation window) comes AFTER this.

## State before handoff (verified live just before exit)

- **Plugin:** `telegram@claude-plugins-official` v0.0.5 installed at `~/.claude/plugins/cache/claude-plugins-official/telegram/0.0.5/`
- **Running MCP server:** `bun server.ts` PID 11545 (child of 11481) — from v0.0.4 cache dir, started at 15:39 ET. May be from a zombie session. The new session should spawn a fresh server for v0.0.5 automatically on `--channels` startup.
- **Token:** `TELEGRAM_BOT_TOKEN=8767603151:AAGDg_yjVtJNyFe-deEy2FGYdnBOiM43B9E` persisted in `~/.claude/channels/telegram/.env`
- **Bot:** `@AiNFLGMbot` — verified live via Telegram API earlier this session
- **access.json state:**
  - `dmPolicy: "pairing"` (correct for initial pairing)
  - `allowFrom: []` (empty — Jasson is NOT yet approved)
  - `pending: { "b64aac": ... }` — EXPIRED code from an earlier crashed attempt. Safe to ignore; will be replaced on next DM.
- **Jasson's Telegram sender ID:** `8784022142` (verified from the stale pending entry and earlier access.json context)
- **Hub (`comms-hub.mjs`):** still polling Telegram inbound. Previous 9 did NOT flip `CHANNELS_INBOUND_TAKEOVER=1` yet, intentionally. Hub stays as a safety net until pairing completes.
- **OC relay grace-period fix:** deployed earlier this session (see `isRelayLockdownActive` in `scripts/comms-hub.mjs`, lines ~877-900). Not yet committed to git.
- **Snapshot for rollback:** `backups/pre-channels-20260410-174808/` — 13 files including rollback.sh that's been unit-tested 8/8 pass.

## Your exact steps in order

1. **Read this file and `memory/MEMORY.md`** to get full context on Jasson, the project, and the comms architecture.
2. **Verify the MCP server is running under --channels:** `ps aux | grep "bun.*telegram"` should show at least one process.
3. **Verify the skill is loaded:** you should see `telegram:access` and `telegram:configure` in the session-start skill list.
4. **Announce to Jasson on Telegram** (use `curl POST http://localhost:3457/send` with `"channel":"telegram"` while the hub is still polling both directions): "New session live. --channels active. DM the bot with any message and tell me the pairing code it replies with."
5. **Wait for Jasson to report the pairing code** (he'll type it in the terminal).
6. **Validate the code format** — 6 characters, alphanumeric, check that it exists in `~/.claude/channels/telegram/access.json` under `pending`. **Do NOT pair a code that isn't in pending** — that's the attack vector the skill warned against.
7. **Invoke the Skill tool for `telegram:access pair <code>`** — this will load the skill instructions. Then actually execute the pairing: read access.json, add the senderId from pending[<code>] to allowFrom, delete the pending entry, write back, create `~/.claude/channels/telegram/approved/<senderId>` with chatId as contents.
8. **Verify pairing worked** — re-read access.json, confirm Jasson's senderId (`8784022142`) is in `allowFrom` and the code is gone from `pending`.
9. **Lock policy:** invoke the skill to set `dmPolicy` to `allowlist` (prevents strangers from getting pairing codes).
10. **Flip the hub Telegram-inbound toggle:**
    - Add `CHANNELS_INBOUND_TAKEOVER=1` to `.env`
    - Restart the hub: `pkill -f "node.*comms-hub.mjs"; sleep 2; cd /Users/jassonfishback/Projects/BengalOracle && nohup /opt/homebrew/bin/node scripts/comms-hub.mjs > /dev/null 2>&1 & disown`
    - Verify `/health` returns `status:running` and that the hub log shows `Telegram inbound DISABLED (CHANNELS_INBOUND_TAKEOVER=1)`
11. **Parallel verification test:**
    - Send a test message from Channels side (via the reply tool if it's available) — Jasson confirms on phone
    - Send a test message from hub side (`curl POST /send telegram`) — Jasson confirms on phone
    - Both paths working = Phase 1 complete
12. **Report to Jasson:** Phase 1 complete, Channels pairing done, hub is in hybrid mode (Channels owns inbound, hub owns outbound + voice + iMessage + email), ready for Phase 2 (24-48h observation window).

## Things the new 9 should know

- **The OC grace-period fix is uncommitted** in `scripts/comms-hub.mjs`. If anything needs to be rolled back, restore from `backups/pre-channels-20260410-174808/comms-hub.mjs` — but note that rolling back removes the OC fix too. The safer rollback is to manually cherry-pick the edit back in.
- **Don't delete the old pending code `b64aac`** from access.json manually — the skill will handle it. Just ignore it.
- **Telegram outbound `/send` via the hub still works after the toggle** — it's a different code path from `telegramPoll`. The toggle only disables inbound polling.
- **Jasson's involvement is ~30 seconds:** DM the bot, read the code, type it to you. Everything else is your work.
- **If the bot doesn't reply with a pairing code within 30 seconds of Jasson DMing it**, the --channels flag didn't actually activate the server's polling. Check `ps aux | grep "bun.*telegram"` and verify the running server is from `0.0.5`, not `0.0.4`. If it's still 0.0.4, kill the zombie and let Claude Code respawn the right one.
- **If pairing gets stuck in any weird state**, the rollback script is at `backups/pre-channels-20260410-174808/rollback.sh` — runs autonomously, restores exactly the state from snapshot.

## Trader9, OC fix, email replay, and the rest

All sidebar work from today. Not your concern for Phase 1. After pairing succeeds and Jasson is happy, the sidebar TODO is:
1. Fix the hub IMAP replay bug (adds `since` filter + persistent dedup) — prevents the Apr 10 false-alarm pattern from recurring
2. Commit the OC grace-period fix + this Phase 1 work with clean messages
3. Start Phase 3 tick engine build (3-5 days, agent work, 2-3 check-ins with Jasson)

## Jasson's state

- Scared of breaking things. Reassure frequently.
- Needs clear "done" confirmations, not hand-waving.
- iPhone Telegram only — cannot copy-paste from phone to Mac terminal.
- Has ADHD-ish attention for long monologues — keep reports tight.
- Currently in relay mode, reading you in terminal AND Telegram. Both work.
- Has been waiting most of the day for comms to be fixed. Finish line is close.
