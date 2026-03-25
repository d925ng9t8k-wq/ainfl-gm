#!/bin/bash
# PostToolUse hook — checks for incoming messages from comms hub
# Uses hookSpecificOutput.additionalContext so Claude sees the messages.

INCOMING="/tmp/9-incoming-message.jsonl"

if [ -f "$INCOMING" ]; then
  messages=$(cat "$INCOMING")
  rm -f "$INCOMING"

  # Use python to properly JSON-escape the message content
  context=$(python3 -c "
import json, sys
msgs = sys.stdin.read().strip()
print(json.dumps('INCOMING MESSAGE — RESPOND IMMEDIATELY: ' + msgs))
" <<< "$messages" 2>/dev/null)

  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":${context}}}"
  exit 0
fi

exit 0
