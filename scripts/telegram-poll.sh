#!/bin/bash
# Telegram polling heartbeat — runs once, checks inbox, exits
# Designed to be chained: run in background → get notified → respond → run again
DELAY=${1:-10}
sleep "$DELAY"
INBOX=$(curl -s http://localhost:3457/inbox 2>/dev/null)
if [ "$INBOX" != "[]" ] && [ -n "$INBOX" ]; then
  echo "TELEGRAM_MESSAGES:$INBOX"
else
  echo "TELEGRAM_CLEAR"
fi
