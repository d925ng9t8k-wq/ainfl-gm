#!/bin/bash
# SessionStart hook — auto-runs startup checks when a new Claude Code session opens
# This replaces manual startup steps. The CLAUDE.md protocol still runs the full sequence,
# but this hook ensures hub health + inbox are checked even if protocol is skipped.

HUB_URL="http://localhost:3457"

# 1. Check hub health
HUB_STATUS=$(curl -s --max-time 3 "$HUB_URL/health" 2>/dev/null)
if [ -z "$HUB_STATUS" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"WARNING: Comms hub is DOWN. Run: nohup /opt/homebrew/bin/node scripts/comms-hub.mjs > /dev/null 2>&1 & disown"}}'
  exit 0
fi

# 2. Check inbox for pending messages
INBOX=$(curl -s --max-time 3 "$HUB_URL/inbox" 2>/dev/null)
if [ -n "$INBOX" ] && [ "$INBOX" != "[]" ]; then
  context=$(python3 -c "
import json, sys
inbox = sys.stdin.read().strip()
print(json.dumps('SESSION START — PENDING INBOX: ' + inbox))
" <<< "$INBOX" 2>/dev/null)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":${context}}}"
  exit 0
fi

# 3. All clear
echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Hub healthy. Inbox clear. Ready."}}'
