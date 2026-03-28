#!/bin/bash
# freeze-watchdog.sh — External freeze watchdog (independent of comms-hub)
# Runs every 60 seconds via LaunchAgent. If Claude Code PID is alive but the
# last tool call timestamp is >8 minutes old, SIGKILLs it so normal recovery
# (open-terminal signal + hub watchdog) can take over.
#
# This is a belt-and-suspenders layer — the hub's freeze detector handles
# escalation up to 7 min. This catches anything the hub misses (e.g., hub
# itself is degraded).

LAST_TOOL_CALL_FILE="/tmp/9-last-tool-call"
PID_FILE="/tmp/9-terminal-pid"
SIGNAL_FILE="/tmp/9-open-terminal"
LOG_FILE="/Users/jassonfishback/Projects/BengalOracle/logs/freeze-watchdog.log"
STALE_THRESHOLD=480  # 8 minutes in seconds

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1" >> "$LOG_FILE"
}

# No tool call file = nothing to check
if [ ! -f "$LAST_TOOL_CALL_FILE" ]; then
  exit 0
fi

# No PID file = no Claude session to kill
if [ ! -f "$PID_FILE" ]; then
  exit 0
fi

LAST_TS=$(cat "$LAST_TOOL_CALL_FILE" 2>/dev/null | tr -d '[:space:]')
CLAUDE_PID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')

# Validate both values are numeric
if ! [[ "$LAST_TS" =~ ^[0-9]+$ ]] || ! [[ "$CLAUDE_PID" =~ ^[0-9]+$ ]]; then
  exit 0
fi

NOW=$(date +%s)
AGE=$((NOW - LAST_TS))

# Not stale enough
if [ "$AGE" -lt "$STALE_THRESHOLD" ]; then
  exit 0
fi

# Check if Claude PID is actually alive
if ! kill -0 "$CLAUDE_PID" 2>/dev/null; then
  # Already dead — nothing to do
  exit 0
fi

# Stale + PID alive = frozen Claude. Kill it.
log "FREEZE WATCHDOG: PID $CLAUDE_PID alive but last tool call ${AGE}s ago (>${STALE_THRESHOLD}s threshold). Sending SIGKILL."
kill -9 "$CLAUDE_PID" 2>/dev/null
log "FREEZE WATCHDOG: SIGKILL sent to PID $CLAUDE_PID"

# Write open-terminal signal so the LaunchAgent reopens Claude Code
echo "Freeze watchdog SIGKILL recovery (PID $CLAUDE_PID, stale ${AGE}s)" > "$SIGNAL_FILE"
log "FREEZE WATCHDOG: wrote open-terminal signal"
