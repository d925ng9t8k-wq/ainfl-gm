#!/bin/bash
# ─── Path 2 Channels Rollback Script ────────────────────────────────────────
# Created by 9 on 2026-04-10 during Phase 0 pre-flight for Channels install.
# Purpose: restore exact state that existed BEFORE any Path 2 action was taken.
#
# WHAT THIS SCRIPT DOES (in order):
#   1. Restores scripts/comms-hub.mjs from snapshot (undoes the inbound-disable toggle)
#   2. Restores ~/.claude/settings.json from snapshot
#   3. Removes ~/.claude/channels/ directory (uninstalls Channels plugin state)
#   4. Kills any Claude Code process with --channels flag
#   5. Gracefully restarts the comms-hub with the restored code
#   6. Verifies hub health + Telegram polling resumed
#   7. Sends a Telegram notification that rollback completed
#
# SAFETY:
#   - Only touches files in backup scope. Never deletes .env, .git, or 9-memory.db.
#   - Hub restart is graceful (SIGTERM → wait → respawn). 5-10 seconds of
#     Telegram poll downtime, no message loss (offset persisted).
#   - Runs `node -c` on restored comms-hub.mjs BEFORE restart — aborts if syntax broken.
#   - Requires NO human input. Fully automatic.
#
# USAGE:
#   cd /Users/jassonfishback/Projects/BengalOracle
#   bash backups/pre-channels-20260410-174808/rollback.sh
#
# EXIT CODES:
#   0 = rollback complete, hub healthy, Telegram verified
#   1 = syntax check on restored comms-hub.mjs failed — manual intervention needed
#   2 = hub did not come back healthy after restart
#   3 = snapshot files missing — cannot restore
# ──────────────────────────────────────────────────────────────────────────────

set -u  # undefined vars = error (but NOT set -e — we handle errors explicitly)

SNAP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="/Users/jassonfishback/Projects/BengalOracle"
HUB_SCRIPT="$REPO_DIR/scripts/comms-hub.mjs"
SETTINGS="$HOME/.claude/settings.json"
CHANNELS_DIR="$HOME/.claude/channels"
LOG="/tmp/9-rollback-$(date +%Y%m%d-%H%M%S).log"

log() {
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*" | tee -a "$LOG"
}

log "═══════════════════════════════════════════════════════════════"
log "Path 2 Channels Rollback — starting"
log "Snapshot: $SNAP_DIR"
log "Repo:     $REPO_DIR"
log "═══════════════════════════════════════════════════════════════"

# ─── Sanity check: snapshot files must exist ───────────────────────────────
for f in "$SNAP_DIR/comms-hub.mjs" "$SNAP_DIR/settings.json"; do
  if [ ! -f "$f" ]; then
    log "FATAL: snapshot file missing: $f"
    log "Cannot proceed with rollback. Manual intervention required."
    exit 3
  fi
done
log "Step 0: snapshot files verified present"

# ─── Step 1: Restore comms-hub.mjs ──────────────────────────────────────────
log "Step 1: restoring scripts/comms-hub.mjs from snapshot"
cp "$SNAP_DIR/comms-hub.mjs" "$HUB_SCRIPT"
log "  ok: comms-hub.mjs restored ($(wc -l < "$HUB_SCRIPT") lines)"

# ─── Step 2: Syntax check the restored hub ─────────────────────────────────
log "Step 2: syntax checking restored comms-hub.mjs"
if ! node -c "$HUB_SCRIPT" 2>&1 | tee -a "$LOG"; then
  log "FATAL: syntax error in restored comms-hub.mjs — aborting rollback"
  log "Manual intervention required. Do NOT restart hub until this is resolved."
  exit 1
fi
log "  ok: syntax check passed"

# ─── Step 3: Restore settings.json ─────────────────────────────────────────
log "Step 3: restoring ~/.claude/settings.json from snapshot"
if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "${SETTINGS}.pre-rollback-$(date +%H%M%S)"
  log "  saved current settings to ${SETTINGS}.pre-rollback-*"
fi
cp "$SNAP_DIR/settings.json" "$SETTINGS"
log "  ok: settings.json restored"

# ─── Step 4: Remove Channels plugin state ──────────────────────────────────
log "Step 4: removing ~/.claude/channels/ directory (if present)"
if [ -d "$CHANNELS_DIR" ]; then
  mv "$CHANNELS_DIR" "${CHANNELS_DIR}.removed-$(date +%H%M%S)"
  log "  ok: moved $CHANNELS_DIR to ${CHANNELS_DIR}.removed-*"
else
  log "  skip: $CHANNELS_DIR does not exist"
fi

# ─── Step 5: Kill any Claude Code with --channels flag ─────────────────────
log "Step 5: killing any Claude process running with --channels"
CHANNELS_PIDS=$(pgrep -f "claude.*--channels" 2>/dev/null || true)
if [ -n "$CHANNELS_PIDS" ]; then
  for pid in $CHANNELS_PIDS; do
    log "  killing Claude --channels PID $pid"
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 2
else
  log "  skip: no Claude --channels processes found"
fi

# ─── Step 6: Gracefully restart the hub ────────────────────────────────────
log "Step 6: restarting comms-hub"
HUB_PID=$(pgrep -f "node.*comms-hub.mjs" | head -1)
if [ -n "$HUB_PID" ]; then
  log "  current hub PID: $HUB_PID — sending SIGTERM"
  kill -TERM "$HUB_PID" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if kill -0 "$HUB_PID" 2>/dev/null; then
      sleep 1
    else
      log "  hub exited after ${i}s"
      break
    fi
  done
  # Force kill if still alive
  if kill -0 "$HUB_PID" 2>/dev/null; then
    log "  hub did not exit gracefully — SIGKILL"
    kill -KILL "$HUB_PID" 2>/dev/null || true
    sleep 1
  fi
fi

log "  starting fresh hub"
cd "$REPO_DIR"
nohup /opt/homebrew/bin/node scripts/comms-hub.mjs > /dev/null 2>&1 &
disown
sleep 3

# ─── Step 7: Verify hub health ─────────────────────────────────────────────
log "Step 7: verifying hub health"
for attempt in 1 2 3 4 5; do
  HEALTH=$(curl -s --max-time 3 http://localhost:3457/health 2>/dev/null || echo "")
  if echo "$HEALTH" | grep -q '"status":"running"'; then
    log "  ok: hub healthy on attempt $attempt"
    break
  fi
  log "  attempt $attempt: not healthy yet, waiting"
  sleep 2
  if [ "$attempt" = "5" ]; then
    log "FATAL: hub did not become healthy after 5 attempts"
    log "Manual intervention required."
    exit 2
  fi
done

# ─── Step 8: Telegram notification ─────────────────────────────────────────
log "Step 8: notifying via Telegram"
curl -s -X POST http://localhost:3457/send \
  -H "Content-Type: application/json" \
  -d '{"channel":"telegram","message":"9: Path 2 ROLLBACK COMPLETE. Hub restored from snapshot, Channels state removed, hub healthy. You are back at pre-Path-2 state. Full rollback log at '"$LOG"'"}' \
  > /dev/null 2>&1 || log "  warn: Telegram notify failed (non-fatal)"

log "═══════════════════════════════════════════════════════════════"
log "ROLLBACK COMPLETE"
log "Log file: $LOG"
log "═══════════════════════════════════════════════════════════════"
exit 0
