# Kyle Shea RAM Guidance — April 5, 2026

## Kyle's Exact Message

> "A LOT of context loaded in multiple channels, probably unterminated sessions running in background, and a library of dependancies, plugins, and CLI's running in memory... we need to have 9 build a live-watch agent that can monitor PC resources over a long period of time with standard ops running so he can evaluate and develop a strategy for garbage collection, pruning, loading headers instead of full context, more on-demand gets to sacrifice negligible speed for free memory, etc."

— Kyle Shea, CIO Rapid Mortgage, April 5 2026

## What We Built

Kyle's guidance was not just acknowledged — it was fully implemented the same day.

### scripts/ram-watch-agent.mjs
Continuous 30-second sampler running 24/7 as a LaunchAgent. Captures:
- Total RAM, free RAM, active+wired breakdown, memory pressure level
- Top 20 processes by RSS
- Claude Code PID RSS specifically
- Node.js process count with all PIDs
- Claude child processes (subprocess flag in SQLite)
- Terminal.app, Safari/WebKit cumulative RSS, Teams, Mail.app
- System totals row with vm_stat breakdown

Writes every sample to `ram_samples` table in `data/9-memory.db` with schema:
`id, timestamp, process_name, pid, rss_mb, vsz_mb, percent_mem, is_claude_subprocess, notes`

Computes rolling stats (1m/5m/1hr trends, drift per process) and runs leak detection every 5 minutes. Logs human-readable analysis to `logs/ram-watch.log`.

Exposes `/health` and `/ram-watch/status` on port 3459.

### scripts/ram-strategy-analyzer.mjs
Nightly report generator. Reads last 24h of `ram_samples` and produces `docs/ram-profile-daily.md` with:
- System memory overview (start/end/peak)
- Top memory hogs table
- Growth leaders (MB/hr rate)
- Leak suspects (grew >30MB without retreating below 75% of peak)
- Per-process recommendations: GC hints, context pruning, header-only loads, on-demand fetches
- Estimated recoverable memory in MB by strategy

Sends a summary to Telegram via the comms hub on completion.

### scripts/orphan-session-cleaner.mjs
Identifies and kills stale orphaned sessions per Kyle's "unterminated sessions" concern:
- Orphan node processes (PPID=1, not a known production agent)
- Zombie processes (state=Z)
- Headless bash/zsh subshells (no TTY, no active children, age >2 minutes)

Protected list: all 9 production agents are immune. Dry-run by default. Runs live via `--kill` flag. Runs daily at 3am via LaunchAgent `com.9.orphan-cleaner`. Logs every kill with justification to `logs/orphan-cleaner.log`.

### LaunchAgent: com.9.ram-watch-agent
Keeps `ram-watch-agent.mjs` alive 24/7 with `KeepAlive=true`. Auto-restarts within 10s if process dies.

### LaunchAgent: com.9.orphan-cleaner
Runs `orphan-session-cleaner.mjs --kill` daily at 3:00am via `StartCalendarInterval`.

### Health Monitor Integration
`health-monitor.mjs` now polls `http://localhost:3459/health` on every 30s fast-check cycle as component `ram-watch-agent`. Any outage triggers a Telegram alert with 15-minute cooldown (same alert system as all other components).

## Why This Matters

Kyle identified the root issue: multiple long-running contexts accumulate in parallel channels, orphan processes hold memory without ever releasing it, and the system has no visibility into whether this is actually happening or how bad it is. This build gives us the instrumentation layer Kyle specified. The data it collects over the coming weeks will drive the actual GC strategy, pruning policies, and header-vs-full-context decisions — exactly as Kyle outlined.

## Credit

This implementation was built to Kyle's specification by Tee (Engineering Team Lead, 9 Front Office), April 5 2026. Kyle Shea's technical input is the direct origin of this feature.
