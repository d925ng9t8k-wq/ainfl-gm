#!/bin/bash
# Start Claude Code inside a tmux session for crash resilience
# If a tmux session named 'claude' already exists, attach to it
# Otherwise create a new one and run Claude Code

TMUX_BIN=/opt/homebrew/bin/tmux
SESSION_NAME="claude"
PROJECT_DIR="$HOME/Projects/BengalOracle"
STARTUP_PROMPT='Run the startup protocol from CLAUDE.md. Claim terminal. Check inbox. Message Jasson on Telegram that you are alive and operational. Then start polling Telegram continuously.'

# Check if tmux session exists
if $TMUX_BIN has-session -t $SESSION_NAME 2>/dev/null; then
    echo "tmux session '$SESSION_NAME' already exists. Attaching..."
    $TMUX_BIN attach -t $SESSION_NAME
else
    echo "Creating new tmux session '$SESSION_NAME'..."
    $TMUX_BIN new-session -d -s $SESSION_NAME -c "$PROJECT_DIR"
    # Run claude inside the tmux session
    $TMUX_BIN send-keys -t $SESSION_NAME "cd $PROJECT_DIR && claude --dangerously-skip-permissions \"$STARTUP_PROMPT\"" Enter
    # Attach to it
    $TMUX_BIN attach -t $SESSION_NAME
fi
