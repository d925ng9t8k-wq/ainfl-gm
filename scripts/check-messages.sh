#!/bin/bash
# PostToolUse hook — checks for incoming messages from comms hub
# Uses hookSpecificOutput.additionalContext so Claude sees the messages.
# Also does a LIVE inbox check if the signal file is empty — belt and suspenders.

INCOMING="/tmp/9-incoming-message.jsonl"

# First: check signal file (written by monitoring daemon)
if [ -f "$INCOMING" ] && [ -s "$INCOMING" ]; then
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

# Second: if no signal file, do a quick live inbox check (3s timeout)
LIVE=$(curl -s --max-time 3 http://localhost:3457/inbox 2>/dev/null)
if [ "$LIVE" != "[]" ] && [ -n "$LIVE" ] && [ "$LIVE" != "" ]; then
  context=$(python3 -c "
import json, sys
msgs = sys.stdin.read().strip()
# Parse and reformat for clarity
parsed = json.loads(msgs)
lines = []
for m in parsed:
    lines.append(json.dumps({'channel': m.get('channel',''), 'text': m.get('text',''), 'timestamp': m.get('timestamp','')}))
print(json.dumps('INCOMING MESSAGE — RESPOND IMMEDIATELY: ' + chr(10).join(lines)))
" <<< "$LIVE" 2>/dev/null)

  if [ -n "$context" ]; then
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":${context}}}"
    exit 0
  fi
fi

exit 0
