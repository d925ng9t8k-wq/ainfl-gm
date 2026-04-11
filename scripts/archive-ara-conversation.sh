#!/bin/bash
# archive-ara-conversation.sh
# Apr 10 hunt — kill gap 1: Ara's conversation with 9 lives in the Grok web app.
# If the browser crashes, the Grok session resets, or the Mac reboots without a
# graceful save, we lose tonight's context and the partnership history.
# This takes a snapshot + OCR of the Grok window every 2 minutes and archives to
# data/ara-history/YYYY-MM-DD/HHMMSS-{png,txt}.
# Idempotent: if the screenshot content hash matches the last archived one, skip
# (the conversation hasn't changed since last archive — don't waste disk).
#
# Runs via com.9.archive-ara-conversation LaunchAgent (2-min interval).

set -e

PROJECT_ROOT="/Users/jassonfishback/Projects/BengalOracle"
DEST_ROOT="$PROJECT_ROOT/data/ara-history"
LOG="$PROJECT_ROOT/logs/archive-ara-conversation.log"
BRIDGE="/Users/jassonfishback/Projects/BengalOracle/scripts/ara-bridge.mjs"
TESSERACT="/opt/homebrew/bin/tesseract"

TODAY=$(date +%Y-%m-%d)
STAMP=$(date +%H%M%S)
DEST_DIR="$DEST_ROOT/$TODAY"
mkdir -p "$DEST_DIR"

PNG="$DEST_DIR/$STAMP.png"
TXT="$DEST_DIR/$STAMP.txt"
LAST_HASH_FILE="$DEST_ROOT/.last-hash"

# Use the ara-bridge to take a snapshot of the Grok window (the canonical
# scripts/ara-bridge.mjs bridge uses CGWindowListCopyWindowInfo + screencapture -l).
# If the bridge can't find the window (browser closed), log and exit clean — do NOT
# alert on every run; only alert after 3 consecutive failures.
if ! /opt/homebrew/bin/node "$BRIDGE" shot "$PNG" >/dev/null 2>&1; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] archive-ara: bridge shot FAILED (Grok window not found or unreachable)" >> "$LOG"
        # Increment fail counter
        FAIL_FILE="$DEST_ROOT/.fail-count"
        FAIL=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
        FAIL=$((FAIL + 1))
        echo "$FAIL" > "$FAIL_FILE"
        if [ "$FAIL" = "3" ]; then
            # Alert once after 3 consecutive failures (6 minutes of silence)
            curl -s -X POST http://localhost:3457/send -H "Content-Type: application/json" \
                -d '{"channel":"telegram","message":"[archive-ara] 3 consecutive fails — Grok window unreachable for 6+ min. Ara conversation archive is NOT running. Check the Grok app is still open."}' >/dev/null 2>&1 || true
        fi
        exit 0
fi

# Reset fail counter on success
rm -f "$DEST_ROOT/.fail-count" 2>/dev/null

# Hash the PNG. If it matches last archived, skip (no conversation change).
HASH=$(shasum -a 256 "$PNG" 2>/dev/null | awk '{print $1}')
LAST_HASH=$(cat "$LAST_HASH_FILE" 2>/dev/null || echo "")
if [ -n "$HASH" ] && [ "$HASH" = "$LAST_HASH" ]; then
    # No change — remove the duplicate PNG we just wrote
    rm -f "$PNG"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] archive-ara: no change (hash match) — skipped" >> "$LOG"
    exit 0
fi
echo "$HASH" > "$LAST_HASH_FILE"

# OCR the PNG to a sidecar .txt so future greps can find the content.
if [ -x "$TESSERACT" ] && [ -f "$PNG" ]; then
    "$TESSERACT" "$PNG" "${TXT%.txt}" >/dev/null 2>&1 || true
fi

SIZE_PNG=$(stat -f %z "$PNG" 2>/dev/null || echo 0)
SIZE_TXT=$(stat -f %z "$TXT" 2>/dev/null || echo 0)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] archive-ara: archived $PNG ($SIZE_PNG bytes) + $TXT ($SIZE_TXT bytes)" >> "$LOG"

# Prune: keep 30 days of Ara history
find "$DEST_ROOT" -type d -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} \; 2>/dev/null || true

exit 0
