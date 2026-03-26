#!/bin/bash
# start-teams-monitor.sh
# Ensures Playwright Chromium is installed and starts the Teams monitor.
# Logs to /tmp/teams-monitor.log

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/teams-monitor.log"
PID_FILE="/tmp/teams-monitor.pid"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] start-teams-monitor.sh launched" >> "$LOG_FILE"

# ── Check Node ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found in PATH" | tee -a "$LOG_FILE"
  exit 1
fi

# ── Check Playwright ───────────────────────────────────────────────────────
echo "Checking Playwright..." | tee -a "$LOG_FILE"
PLAYWRIGHT_VERSION=$(npx playwright --version 2>/dev/null || echo "not installed")
echo "  Playwright: $PLAYWRIGHT_VERSION" | tee -a "$LOG_FILE"

if [[ "$PLAYWRIGHT_VERSION" == "not installed" ]]; then
  echo "Installing Playwright..." | tee -a "$LOG_FILE"
  cd "$PROJECT_DIR" && npm install playwright 2>&1 | tee -a "$LOG_FILE"
fi

# ── Check Chromium ─────────────────────────────────────────────────────────
echo "Checking Chromium browser..." | tee -a "$LOG_FILE"
CHROMIUM_CHECK=$(node -e "
  import('playwright').then(({ chromium }) => {
    const execPath = chromium.executablePath();
    const fs = await import('fs');
    console.log(fs.existsSync(execPath) ? 'ok' : 'missing');
  }).catch(() => console.log('missing'));
" 2>/dev/null || echo "missing")

if [[ "$CHROMIUM_CHECK" == "missing" ]]; then
  echo "Installing Chromium..." | tee -a "$LOG_FILE"
  cd "$PROJECT_DIR" && npx playwright install chromium 2>&1 | tee -a "$LOG_FILE"
else
  echo "  Chromium: installed" | tee -a "$LOG_FILE"
fi

# ── Kill existing monitor if running ──────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing monitor (PID $OLD_PID)..." | tee -a "$LOG_FILE"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# ── Launch monitor in background ──────────────────────────────────────────
echo "Starting teams-monitor.mjs..." | tee -a "$LOG_FILE"
nohup node "$PROJECT_DIR/scripts/teams-monitor.mjs" >> "$LOG_FILE" 2>&1 &
MONITOR_PID=$!
echo "$MONITOR_PID" > "$PID_FILE"

echo "  Monitor started. PID: $MONITOR_PID" | tee -a "$LOG_FILE"
echo "  Log:  $LOG_FILE"
echo "  PID:  $PID_FILE"
echo "  Output: /tmp/teams-kyle-messages.jsonl"
echo ""
echo "To check status:"
echo "  tail -20 $LOG_FILE"
echo "  cat /tmp/teams-kyle-messages.jsonl"
echo ""
echo "If auth is needed (first run):"
echo "  node $PROJECT_DIR/scripts/teams-monitor.mjs --auth"
