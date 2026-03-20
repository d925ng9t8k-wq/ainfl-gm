#!/bin/bash
# Send a message to Jasson via both iMessage and Email
# Usage: ./scripts/msg-jasson.sh "Your message here"

MESSAGE="${1:-Update from AiNFL GM Bot}"

# iMessage
osascript -e "
tell application \"Messages\"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant \"5134031829\" of targetService
    send \"$MESSAGE\" to targetBuddy
end tell" 2>/dev/null && echo "iMessage sent" || echo "iMessage failed"

# Email
osascript -e "
tell application \"Mail\"
    set newMsg to make new outgoing message with properties {subject:\"AiNFL GM Bot Update\", content:\"$MESSAGE\n\n- Claude (AiNFL GM Bot)\", visible:false}
    tell newMsg
        make new to recipient at end of to recipients with properties {address:\"emailfishback@gmail.com\"}
    end tell
    send newMsg
end tell" 2>/dev/null && echo "Email sent" || echo "Email failed"
