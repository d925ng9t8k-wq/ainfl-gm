# Infrastructure Solutions: Issues 7, 8, 9

**Date:** March 26, 2026
**Author:** 9 (Solutions Agent)
**Classification:** Owner Eyes Only

---

## Issue 7: Terminal Idle Detection

### Problem

The PostToolUse hook in `~/.claude/settings.json` fires `scripts/check-messages.sh` after every tool call. But when Claude is idle -- thinking, writing a long response, or waiting for user input -- no tool calls happen. During these idle periods, incoming messages (Telegram, iMessage, email) pile up unread in `/tmp/9-incoming-message.jsonl` with no mechanism to detect or surface them. CLAUDE.md already warns "NEVER go more than 2 minutes without making a tool call," but this is a behavioral rule, not a technical guarantee.

### Current State

The settings.json hooks cover four events:
- **PreToolUse** -- fires before a tool runs
- **PostToolUse** -- fires after a tool runs
- **Notification** -- fires on Claude Code notifications (errors, permission prompts)
- **Stop** -- fires when Claude stops generating (turn ends)

The **Stop** hook is the most relevant -- it fires when Claude finishes a response, which partially covers the idle case. But it does NOT fire during long-running generation (e.g., writing a 500-line file) or when Claude is waiting for user input between turns.

### Research Findings

**Available Claude Code hooks (exhaustive list):**
1. `PreToolUse` -- before each tool call
2. `PostToolUse` -- after each tool call
3. `Notification` -- on notifications/errors
4. `Stop` -- when generation ends (turn completion)

There is no `Idle`, `Timer`, or `Heartbeat` hook. Claude Code does not support forced periodic tool calls or background polling within the session.

**Potential solutions evaluated:**

| Approach | Feasibility | Verdict |
|----------|-------------|---------|
| **Rely on Stop hook** | Works today | Partial fix -- catches end-of-turn but not mid-generation idle |
| **fswatch on signal file** | macOS native, zero dependencies | Cannot inject into Claude's context -- fswatch runs outside the Claude process |
| **Background launchd/cron polling** | Always works | Same problem -- cannot inject messages into Claude's context from outside |
| **Force periodic tool calls via CLAUDE.md instructions** | Already in place | Behavioral, not enforced -- Claude sometimes forgets |
| **Self-ping pattern** | Claude calls a no-op tool periodically | Only works if Claude cooperates; cannot force from outside |
| **VPS watchdog + Telegram nudge** | Independent of Claude | If messages pile up for >2 min, VPS sends a Telegram "nudge" that re-triggers the hub, which writes to the signal file; next tool call picks it up |
| **Comms hub terminal injection** | Hub writes to stdout of Claude process | Not possible -- Claude Code does not expose stdin/stdout injection |

### Recommended Solution: Layered Defense

**Layer 1 (immediate): Maximize existing hooks.**
The Stop hook already fires check-messages.sh. Confirm it is working. This catches every turn boundary.

**Layer 2 (behavioral): Strengthen CLAUDE.md discipline.**
Add an explicit instruction: "If your response will take more than 60 seconds to generate, break it into parts with a Read or Bash call between each part." This is already partially there but can be more explicit.

**Layer 3 (architectural, with VPS): Watchdog escalation.**
Once the VPS is live (Issue 8), the health monitor checks `/tmp/9-last-tool-call` timestamp. If stale by >3 minutes:
1. VPS sends a Telegram message: "[WATCHDOG] Messages waiting. Terminal appears idle."
2. This message flows through the normal relay pipeline back to the signal file.
3. The next tool call (even if it's just the Stop hook) picks it up.
4. If still no response after 5 minutes, VPS uses Haiku autonomous mode to respond directly.

**Layer 4 (future): Claude Code feature request.**
Request an `Idle` or `Timer` hook from Anthropic that fires every N seconds regardless of tool activity. This is the only real fix. File as a feature request on the Claude Code GitHub repo.

### Implementation Steps

1. **Verify Stop hook works** (5 min) -- trigger it manually, confirm check-messages.sh runs
2. **Update CLAUDE.md** (5 min) -- add explicit "break long responses" rule
3. **Build VPS watchdog** (part of Issue 8) -- checks last-tool-call timestamp, escalates
4. **File feature request** (10 min) -- request Idle/Timer hook on Claude Code repo

### Cost

$0 for layers 1-3 (VPS watchdog is part of the $6/mo VPS from Issue 8). Layer 4 is free (feature request).

### Timeline

- Layers 1-2: Today (10 minutes)
- Layer 3: When VPS deploys (Issue 8 timeline)
- Layer 4: Depends on Anthropic

---

## Issue 8: Mac Dependency

### Problem

The entire 9 Enterprises stack runs on a single Mac. When the Mac sleeps, reboots, loses WiFi, or the terminal crashes, ALL communication channels go dark simultaneously. Telegram messages go unanswered. iMessage monitoring stops. Email polling halts. Voice calls fail. There is zero redundancy.

This is the single biggest reliability risk in the system.

### Current State

`docs/vps-deployment-plan.md` already contains a thorough plan for a $6/mo DigitalOcean droplet. The plan is solid. This section validates it and prioritizes execution.

### What MUST Stay on Mac (cannot move)

| Service | Why |
|---------|-----|
| Claude Code terminal (9) | Requires Claude Code CLI, local filesystem, git, dev tools |
| iMessage monitor | Requires macOS + Full Disk Access to read chat.db |
| Email monitor (current) | Uses osascript (macOS Mail.app) -- but see migration note below |
| Browser automation | Puppeteer needs a real browser + display |
| Screenshots/captures | macOS screen access required |
| Training Staff LaunchAgent | Opens Terminal.app on macOS |

### What CAN Move to VPS (priority order)

| Priority | Service | Effort | Impact |
|----------|---------|--------|--------|
| **P0** | Telegram relay (polling + forwarding) | 2 hours | Eliminates #1 failure mode -- Telegram works 24/7 even when Mac is off |
| **P0** | Health watchdog | 1 hour | Independent monitoring -- detects Mac outages, alerts via Telegram directly |
| **P1** | Haiku autonomous fallback | 1 hour | Messages get intelligent responses even when Mac/Claude is down |
| **P1** | trader9 monitoring | 1 hour | Market monitoring cannot stop for Mac reboots |
| **P2** | Email monitoring (IMAP) | 2 hours | Replace osascript with IMAP polling -- eliminates macOS dependency for email |
| **P2** | Jules SMS server | 2 hours | Twilio API is cloud-native, no macOS dependency |
| **P3** | Cloudflare Worker consolidation | 4 hours | Move Backup QB logic to VPS, simplify architecture |
| **P3** | underwriter9 API | 4 hours | RAG + API, no macOS dependency |

### Key Insight: Email Can Move

The current email monitor uses `osascript` to read Mail.app -- this is a macOS dependency by implementation choice, not by necessity. IMAP polling (via `nodemailer` or `imapflow` npm packages) works from anywhere. Moving email to VPS eliminates one more Mac dependency.

### Implementation Steps

The VPS deployment plan in `docs/vps-deployment-plan.md` is comprehensive and correct. Execute it as written, with this prioritization:

**Week 1: Foundation + P0**
1. Create DigitalOcean account, spin up $6/mo droplet (Phase 1-2 of existing plan)
2. Deploy telegram-relay.mjs on VPS with PM2 (Phase 3)
3. Deploy health watchdog cron (Phase 4)
4. Update Mac hub to receive forwarded messages via `/relay-message` (Phase 5)
5. Verify end-to-end (Phase 6)

**Week 2: P1**
6. Deploy Haiku autonomous fallback on VPS
7. Deploy trader9 monitoring cron
8. Run both systems in parallel for 48 hours, verify no missed messages

**Week 3: P2**
9. Build IMAP email monitor, deploy on VPS
10. Migrate Jules SMS server to VPS
11. Remove macOS email dependencies from comms-hub

**Week 4: P3 (optional, lower priority)**
12. Evaluate Cloudflare Worker consolidation
13. Scope underwriter9 API migration

### Cost

| Item | Monthly |
|------|---------|
| DigitalOcean droplet | $6.00 |
| Haiku fallback API calls | ~$1-2 |
| **Total** | **~$7-8/mo** |
| First 60 days | $0 (DO free credit) |

### Timeline

- Week 1: VPS live with Telegram relay + watchdog
- Week 2: Haiku fallback + trader9 monitoring
- Week 3: Email + Jules migration
- Week 4: Cleanup and consolidation

---

## Issue 9: Signal File Race Condition

### Problem

The original code for reading `/tmp/9-incoming-message.jsonl` used `cat` followed by `rm`:

```bash
# OLD (vulnerable):
messages=$(cat "$INCOMING")
rm -f "$INCOMING"
```

Between `cat` and `rm`, the comms hub could write a new message to the file. That message would be deleted by `rm` without ever being read. This is a classic TOCTOU (time-of-check-to-time-of-use) race condition.

### Current Fix (Atomic mv)

The fix in `scripts/check-messages.sh` uses atomic `mv` instead:

```bash
# CURRENT FIX:
TMPFILE="/tmp/9-incoming-processing-$$.jsonl"
mv "$INCOMING" "$TMPFILE" 2>/dev/null || exit 0
messages=$(cat "$TMPFILE")
rm -f "$TMPFILE"
```

### Verification: Is the Fix Correct?

**Yes, the fix is correct.** Here is the analysis:

1. **`mv` on the same filesystem is atomic** -- on Linux/macOS, `rename(2)` is a single atomic kernel operation when source and dest are on the same filesystem. `/tmp` to `/tmp` is always the same filesystem. The file is either at the old path or the new path, never in limbo.

2. **New writes go to a new file** -- after the `mv`, the original path (`/tmp/9-incoming-message.jsonl`) no longer exists. When the hub writes again, it creates a brand new file. The hook reads the moved copy. No overlap.

3. **PID-based temp filename (`$$`)** -- prevents collisions if two hook instances somehow run concurrently (unlikely but defensive).

4. **`|| exit 0` on mv failure** -- if another hook instance already moved the file, the mv fails gracefully and the hook exits without error. No duplicate processing.

5. **One subtle edge case (benign):** If the hub opens the file for append before the mv, the hub's file descriptor still points to the renamed file (now at the temp path). The hub's next write goes to the moved file, which the hook is about to read -- so the message is still captured. After the hub closes and reopens, it creates a fresh file at the original path. No messages lost.

**Verdict: The atomic mv fix is sound. No messages can be lost.**

### Research: Better IPC Methods

While the signal file approach works, here are alternatives ranked by suitability:

| Method | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Signal file + atomic mv (current)** | Simple, works with shell hooks, no dependencies, battle-tested pattern | Polling-based (hook must fire), file I/O overhead | **Keep for now** -- good enough, and the hook architecture demands it |
| **Unix domain socket** | True push-based IPC, zero polling, instant delivery, no filesystem overhead | Hook scripts cannot listen on sockets -- they run and exit. Would require a persistent daemon inside Claude's process. | **Not compatible** with current hook architecture |
| **Named pipe (FIFO)** | Push-based, blocks writer until reader consumes | Same problem -- hook scripts are ephemeral. A FIFO reader must be persistent. Also, multiple writers to a FIFO can interleave. | **Not compatible** with hooks |
| **HTTP localhost endpoint** | Already partially implemented (the `/inbox` fallback in check-messages.sh). True request-response. Stateless. | Adds 3s curl timeout per tool call. The hub must track "already delivered" messages to avoid duplicates. | **Good as belt-and-suspenders** -- already in place as fallback |
| **SQLite message queue** | ACID, handles concurrent access natively, queryable, persistent across crashes | Heavier than a signal file. Shell hooks would need sqlite3 CLI. Adds a dependency. | **Overkill for this use case** -- but good for VPS relay message queue |
| **Redis pub/sub** | True push, handles fan-out, fast | Massive overkill. New dependency. Memory overhead. | **No** |
| **dbus / macOS XPC** | OS-native IPC | Platform-specific, complex, overkill | **No** |

### Recommendation

**Keep the current signal file + atomic mv approach.** It is the right tool for the constraint: Claude Code hooks are ephemeral shell scripts that run-and-exit. They cannot maintain persistent connections (sockets, pipes, pub/sub). The signal file is the natural IPC mechanism for this architecture.

The existing belt-and-suspenders design (signal file as primary, HTTP `/inbox` as fallback) is solid.

**One enhancement worth adding:** After the mv+read, if the message content is empty or malformed, log it rather than silently dropping. Add a one-line validation:

```bash
if [ -z "$messages" ]; then
  rm -f "$TMPFILE"
  exit 0
fi
```

This is already effectively handled (the outer `[ -s "$INCOMING" ]` check ensures the file is non-empty before the mv), but adding a post-read check is extra safety.

### Implementation Steps

1. **No changes needed** -- the current fix is correct
2. **Optional:** Add post-read empty check (5 min, low priority)
3. **Test the race condition** (15 min) -- write a script that rapidly writes to the signal file while triggering hook calls, verify zero messages lost
4. **When VPS deploys:** Use SQLite message queue on the VPS relay (already in the VPS plan) for the VPS-to-Mac pipeline. Signal file stays for the Mac-local hook pipeline.

### Cost

$0. The fix is already in place and correct.

### Timeline

Already done. Optional hardening test: 15 minutes whenever convenient.

---

## Summary Table

| Issue | Severity | Solution | Cost | Timeline |
|-------|----------|----------|------|----------|
| **#7 Terminal Idle** | Medium | Layered: Stop hook + CLAUDE.md discipline + VPS watchdog + feature request | $0 | Today (layers 1-2), VPS deploy (layer 3) |
| **#8 Mac Dependency** | Critical | $6/mo DigitalOcean VPS per existing plan, prioritized migration | $7-8/mo | 4 weeks phased rollout |
| **#9 Signal File Race** | Low (fixed) | Atomic mv already correct; signal file is right tool for hook architecture | $0 | Already done |

---

*Who Dey.*
