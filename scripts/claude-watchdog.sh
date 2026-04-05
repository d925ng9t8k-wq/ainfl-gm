#!/bin/bash
# claude-watchdog.sh — Auto-restart claude inside tmux session "9-claude"
# Logs restarts, captures RSS memory every 30s, POSTs Telegram alert on crash.
# Designed to be launched by start-claude-watchdog.sh or the LaunchAgent.
# DO NOT kill a running claude process — watchdog only picks up on next exit.

TMUX_BIN=/opt/homebrew/bin/tmux
SESSION="9-claude"
PROJECT_DIR="$HOME/Projects/BengalOracle"
WATCHDOG_LOG="$PROJECT_DIR/logs/claude-watchdog.log"
MEMORY_LOG="$PROJECT_DIR/logs/claude-memory.log"
HUB_URL="http://localhost:3457"

mkdir -p "$PROJECT_DIR/logs"

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

wlog() { echo "[$(ts)] $*" | tee -a "$WATCHDOG_LOG"; }

post_telegram() {
  local msg="$1"
  curl -s -X POST "$HUB_URL/send" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"telegram\",\"message\":\"$msg\"}" \
    > /dev/null 2>&1 || true
}

# Ensure we're running inside the 9-claude tmux session.
# If we're not inside tmux, ensure the session exists and hand off.
if [ -z "$TMUX" ]; then
  if ! $TMUX_BIN has-session -t "$SESSION" 2>/dev/null; then
    wlog "tmux session '$SESSION' does not exist — creating it"
    $TMUX_BIN new-session -d -s "$SESSION" -c "$PROJECT_DIR"
  fi
  wlog "Not inside tmux — re-launching watchdog inside session '$SESSION'"
  $TMUX_BIN send-keys -t "$SESSION" "bash $PROJECT_DIR/scripts/claude-watchdog.sh" Enter
  exit 0
fi

wlog "=== claude-watchdog started inside tmux session '$SESSION' ==="

memory_monitor() {
  local claude_pid="$1"
  while kill -0 "$claude_pid" 2>/dev/null; do
    local rss
    rss=$(ps -o rss= -p "$claude_pid" 2>/dev/null | tr -d ' ')
    if [ -n "$rss" ]; then
      echo "[$(ts)] PID=$claude_pid RSS=${rss}KB" >> "$MEMORY_LOG"
    fi
    sleep 30
  done
  echo "[$(ts)] PID=$claude_pid — process gone, memory monitor exiting" >> "$MEMORY_LOG"
}

# Main restart loop
while true; do
  wlog "Starting claude --dangerously-skip-permissions --resume"
  start_time=$(date +%s)

  cd "$PROJECT_DIR" || { wlog "ERROR: cannot cd to $PROJECT_DIR"; sleep 10; continue; }

  # Launch claude and capture exit code
  claude --dangerously-skip-permissions --resume &
  CLAUDE_PID=$!
  wlog "claude PID=$CLAUDE_PID"

  # Start memory monitor in background
  memory_monitor "$CLAUDE_PID" &
  MEM_MON_PID=$!

  # Wait for claude to exit
  wait "$CLAUDE_PID"
  exit_code=$?
  end_time=$(date +%s)
  uptime_secs=$((end_time - start_time))

  # Stop memory monitor
  kill "$MEM_MON_PID" 2>/dev/null || true

  wlog "claude exited (exit=$exit_code, uptime=${uptime_secs}s) — will restart"

  # Send Telegram alert (non-blocking, best-effort)
  post_telegram "9: auto-recovered from crash (exit=${exit_code}, uptime=${uptime_secs}s) — resuming"

  # Brief pause before restart to avoid tight crash loops
  sleep 3
done
