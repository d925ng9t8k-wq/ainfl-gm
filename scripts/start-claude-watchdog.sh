#!/bin/bash
# start-claude-watchdog.sh — Launch the claude watchdog in a detached tmux session.
# Safe to run at login or manually. Does not kill any running claude process.
# If the 9-claude session already exists and the watchdog is running, it's a no-op.

TMUX_BIN=/opt/homebrew/bin/tmux
SESSION="9-claude"
PROJECT_DIR="$HOME/Projects/BengalOracle"
WATCHDOG_LOG="$PROJECT_DIR/logs/claude-watchdog.log"

mkdir -p "$PROJECT_DIR/logs"

echo "[$(date '+%Y-%m-%dT%H:%M:%S')] start-claude-watchdog.sh invoked" >> "$WATCHDOG_LOG"

# Check if session already exists
if $TMUX_BIN has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists — watchdog is already running"
  echo "[$(date '+%Y-%m-%dT%H:%M:%S')] Session '$SESSION' already exists — no action" >> "$WATCHDOG_LOG"
  exit 0
fi

# Create new detached tmux session and run the watchdog inside it
$TMUX_BIN new-session -d -s "$SESSION" -c "$PROJECT_DIR"
$TMUX_BIN send-keys -t "$SESSION" "bash $PROJECT_DIR/scripts/claude-watchdog.sh" Enter

echo "tmux session '$SESSION' created — claude-watchdog.sh started"
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] Session '$SESSION' created, watchdog launched" >> "$WATCHDOG_LOG"
