#!/usr/bin/env bash
# context-monitor.sh — Context window pressure estimator
# Called periodically (via PostToolUse hook) to detect potential context overload.
# Writes a warning to /tmp/9-context-warning.txt when pressure is high.
# Designed to be fast and non-blocking — exits in <100ms under all conditions.

WARNING_FILE="/tmp/9-context-warning.txt"
LAST_TOOL_CALL_FILE="/tmp/9-last-tool-call"
THRESHOLD_PERCENT=60

# ── 1. Update the last-tool-call timestamp (so freeze detector knows 9 is alive)
date +%s > "$LAST_TOOL_CALL_FILE" 2>/dev/null

# ── 2. Estimate context pressure from Claude Code process RSS memory
# Claude Code's memory usage correlates with context window size.
# Baseline RSS at session start: ~200-300MB. At context limit: 600-900MB+.
# We use RSS as a proxy — imperfect but available without API access.

CLAUDE_PID=""
CONTEXT_PERCENT=0
PRESSURE_SOURCE="unknown"

# Find the Claude Code process (not the hub, not Claude Desktop)
CLAUDE_PID=$(pgrep -f "node.*claude" 2>/dev/null | head -1)

if [ -n "$CLAUDE_PID" ]; then
  # Get RSS in KB via ps
  RSS_KB=$(ps -o rss= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')
  if [ -n "$RSS_KB" ] && [ "$RSS_KB" -gt 0 ] 2>/dev/null; then
    # Heuristic: 200MB baseline, 800MB = ~100% context pressure
    # Context % = (RSS - 200MB) / (800MB - 200MB) * 100
    BASELINE_KB=204800   # 200MB
    FULL_KB=819200       # 800MB
    if [ "$RSS_KB" -gt "$BASELINE_KB" ]; then
      CONTEXT_PERCENT=$(( (RSS_KB - BASELINE_KB) * 100 / (FULL_KB - BASELINE_KB) ))
    fi
    # Cap at 100
    [ "$CONTEXT_PERCENT" -gt 100 ] && CONTEXT_PERCENT=100
    PRESSURE_SOURCE="rss:${RSS_KB}KB"
  fi
fi

# ── 3. Secondary signal: age of signal file (unread messages = context accumulating)
SIGNAL_FILE="/tmp/9-incoming-message.jsonl"
UNREAD_COUNT=0
if [ -f "$SIGNAL_FILE" ]; then
  UNREAD_COUNT=$(wc -l < "$SIGNAL_FILE" 2>/dev/null | tr -d ' ')
  # Many unread messages can spike context if they're all being read at once
  # Add 5% per unread message to pressure estimate
  if [ -n "$UNREAD_COUNT" ] && [ "$UNREAD_COUNT" -gt 0 ] 2>/dev/null; then
    SIGNAL_PRESSURE=$(( UNREAD_COUNT * 5 ))
    CONTEXT_PERCENT=$(( CONTEXT_PERCENT + SIGNAL_PRESSURE ))
    [ "$CONTEXT_PERCENT" -gt 100 ] && CONTEXT_PERCENT=100
  fi
fi

# ── 4. Write warning if over threshold
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

if [ "$CONTEXT_PERCENT" -ge "$THRESHOLD_PERCENT" ]; then
  cat > "$WARNING_FILE" <<EOF
CONTEXT WARNING
timestamp: $TIMESTAMP
estimated_percent: ${CONTEXT_PERCENT}%
source: $PRESSURE_SOURCE
claude_pid: ${CLAUDE_PID:-none}
unread_signals: $UNREAD_COUNT
action: Consider /compact or delegating work to sub-agents to reduce context pressure.
EOF
  # Exit code 1 signals warning to caller
  exit 1
else
  # No warning — remove stale warning file if it exists
  rm -f "$WARNING_FILE" 2>/dev/null
  exit 0
fi
