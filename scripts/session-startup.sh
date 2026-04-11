#!/bin/bash
# SessionStart hook — auto-runs startup checks when a new Claude Code session opens
# This replaces manual startup steps. The CLAUDE.md protocol still runs the full sequence,
# but this hook ensures hub health + inbox + queued signal file are all drained at session start.
# Apr 10 hunt — kill: SessionStart blindness (messages queued during terminal recovery were lost)

HUB_URL="http://localhost:3457"
SIGNAL_FILE="/tmp/9-incoming-message.jsonl"

# 1. Check hub health
HUB_STATUS=$(curl -s --max-time 3 "$HUB_URL/health" 2>/dev/null)
if [ -z "$HUB_STATUS" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"WARNING: Comms hub is DOWN. Run: nohup /opt/homebrew/bin/node scripts/comms-hub.mjs > /dev/null 2>&1 & disown"}}'
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

if [ -n "$COMBINED" ]; then
  context=$(python3 -c "
import json, sys
raw = sys.stdin.read().strip()
print(json.dumps('SESSION START — PENDING MESSAGES FROM GAP: ' + raw))
" <<< "$COMBINED" 2>/dev/null)
  if [ -n "$context" ]; then
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":${context}}}"
    exit 0
  fi
fi

# 5. All clear
echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Hub healthy. Inbox clear. Signal file drained. Ready."}}'
