#!/bin/bash
# SessionStart hook — auto-runs startup checks when a new Claude Code session opens
# This replaces manual startup steps. The CLAUDE.md protocol still runs the full sequence,
# but this hook ensures hub health + inbox + queued signal file are all drained at session start.
# Apr 10 hunt — kill: SessionStart blindness (messages queued during terminal recovery were lost)

HUB_URL="http://localhost:3457"
SIGNAL_FILE="/tmp/9-incoming-message.jsonl"
DETECTOR="$(dirname "$0")/detect-lost-session.sh"

# 0. Lost-session detector — runs BEFORE health check so even if hub is down
# we still surface the gap timeline. Bounded to 5s via background+kill so it
# never blocks the hook (macOS has no 'timeout' binary by default).
LOST_SESSION_REPORT=""
if [ -x "$DETECTOR" ]; then
  TMPOUT="/tmp/9-lost-session-detect-$$.out"
  "$DETECTOR" > "$TMPOUT" 2>/dev/null &
  DETECT_PID=$!
  # Wait up to 5 seconds (50 * 0.1s)
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50; do
    if ! kill -0 "$DETECT_PID" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if kill -0 "$DETECT_PID" 2>/dev/null; then
    kill "$DETECT_PID" 2>/dev/null
    wait "$DETECT_PID" 2>/dev/null
    LOST_SESSION_REPORT="LOST-SESSION DETECTOR: detector timed out (>5s)"
  else
    wait "$DETECT_PID" 2>/dev/null
    LOST_SESSION_REPORT=$(cat "$TMPOUT" 2>/dev/null)
  fi
  rm -f "$TMPOUT"
fi

# 1. Check hub health
HUB_STATUS=$(curl -s --max-time 3 "$HUB_URL/health" 2>/dev/null)
if [ -z "$HUB_STATUS" ]; then
  DOWN_MSG="WARNING: Comms hub is DOWN. Run: nohup /opt/homebrew/bin/node scripts/comms-hub.mjs > /dev/null 2>&1 & disown"
  if [ -n "$LOST_SESSION_REPORT" ]; then
    DOWN_MSG="$DOWN_MSG

$LOST_SESSION_REPORT"
  fi
  context=$(python3 -c "
import json, sys
print(json.dumps(sys.stdin.read().strip()))
" <<< "$DOWN_MSG" 2>/dev/null)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":${context}}}"
  exit 0
fi

# 2. Drain the signal file FIRST — these are messages queued during the gap between prior session
# death and this session's startup (e.g. terminal watchdog recovery). Without this, any message
# received in the gap sits unread until the first manual tool call fires the PostToolUse hook.
SIGNAL_CONTENT=""
if [ -f "$SIGNAL_FILE" ] && [ -s "$SIGNAL_FILE" ]; then
  TMPFILE="/tmp/9-session-start-drain-$$.jsonl"
  mv "$SIGNAL_FILE" "$TMPFILE" 2>/dev/null
  SIGNAL_CONTENT=$(cat "$TMPFILE" 2>/dev/null)
  rm -f "$TMPFILE"
fi

# 3. Check inbox for messages not yet in the signal file
INBOX=$(curl -s --max-time 3 "$HUB_URL/inbox" 2>/dev/null)

# 4. Combine signal file + inbox into one context payload
COMBINED=""
if [ -n "$SIGNAL_CONTENT" ]; then
  COMBINED="QUEUED SIGNAL FILE (drained on session start):
$SIGNAL_CONTENT"
fi
if [ -n "$INBOX" ] && [ "$INBOX" != "[]" ]; then
  if [ -n "$COMBINED" ]; then
    COMBINED="$COMBINED

LIVE INBOX:
$INBOX"
  else
    COMBINED="LIVE INBOX:
$INBOX"
  fi
fi

# 5. Prepend lost-session report if we have one
PAYLOAD=""
if [ -n "$COMBINED" ]; then
  PAYLOAD="SESSION START — PENDING MESSAGES FROM GAP: $COMBINED"
fi
if [ -n "$LOST_SESSION_REPORT" ]; then
  if [ -n "$PAYLOAD" ]; then
    PAYLOAD="$LOST_SESSION_REPORT

$PAYLOAD"
  else
    PAYLOAD="$LOST_SESSION_REPORT"
  fi
fi

if [ -n "$PAYLOAD" ]; then
  context=$(python3 -c "
import json, sys
print(json.dumps(sys.stdin.read().strip()))
" <<< "$PAYLOAD" 2>/dev/null)
  if [ -n "$context" ]; then
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":${context}}}"
    exit 0
  fi
fi

# 6. All clear
echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Hub healthy. Inbox clear. Signal file drained. Ready."}}'
