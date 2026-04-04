#!/bin/bash
# Stop hook — auto-releases terminal when Claude Code session ends
# Closes the gap between 9 leaving and DC mode taking over (was 2 min, now instant)

HUB_URL="http://localhost:3457"

# Release terminal control
curl -s -X POST "$HUB_URL/terminal/release" > /dev/null 2>&1

# Kill ping loop
kill $(cat /tmp/terminal-ping.pid 2>/dev/null) 2>/dev/null
rm -f /tmp/terminal-ping.pid

echo '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"Terminal released. DC mode active."}}'
