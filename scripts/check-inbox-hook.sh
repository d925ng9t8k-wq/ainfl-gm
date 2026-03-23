#!/bin/bash
# Hook script: checks for incoming Telegram/iMessage/email messages
# Outputs JSON that Claude Code injects as a system message
SIGNAL="/tmp/9-incoming-message.jsonl"
if [ -f "$SIGNAL" ]; then
  TEXT=$(python3 -c "
import json, sys
lines = open('$SIGNAL').readlines()
msgs = []
for line in lines:
    try:
        m = json.loads(line.strip())
        msgs.append(f\"[{m.get('channel','?')}] {m.get('text','')}\")
    except: pass
print(' /// '.join(msgs))
" 2>/dev/null)
  rm -f "$SIGNAL"
  if [ -n "$TEXT" ]; then
    python3 -c "import json; print(json.dumps({'systemMessage': 'MESSAGE FROM JASSON: ' + '''$TEXT'''}))"
  else
    echo '{}'
  fi
else
  echo '{}'
fi
