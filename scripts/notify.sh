#!/bin/bash
# Send a message to Jasson via iMessage and/or email
# Usage: ./scripts/notify.sh "Your message here"

MESSAGE="${1:-Hello from AiNFL GM Bot}"

# iMessage (primary)
osascript -e "
tell application \"Messages\"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant \"5134031829\" of targetService
    send \"$MESSAGE\" to targetBuddy
end tell" 2>/dev/null && echo "iMessage sent" || echo "iMessage failed"

# Email backup via ntfy.sh
curl -s -o /dev/null \
  -H "Title: AiNFL GM Update" \
  -H "Priority: 3" \
  -H "Tags: robot" \
  -H "Email: emailfishback@gmail.com" \
  -d "$MESSAGE" \
  ntfy.sh/ainfl-gm-bot-jf2026 && echo "Email notification sent" || echo "Email failed"
