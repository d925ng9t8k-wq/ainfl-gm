#!/bin/bash
# archive-agent-runs.sh
# Apr 10 hunt — kill gap 4: sub-agent JSONL outputs live in /private/tmp/claude-501/.../tasks/*.output
# which is ephemeral (wiped on reboot, tmp cleanup, or claude harness restart).
# Copies them to data/agent-runs/YYYY-MM-DD/ where they survive.
# Idempotent: only copies files that don't exist at the destination yet (by filename).
# Run hourly via com.9.archive-agent-runs LaunchAgent (loaded Apr 10).

set -e

PROJECT_ROOT="/Users/jassonfishback/Projects/BengalOracle"
DEST_ROOT="$PROJECT_ROOT/data/agent-runs"
LOG="$PROJECT_ROOT/logs/archive-agent-runs.log"

# The task output files live under this symlink target
# /private/tmp/claude-501/<project-dir>/<session-id>/tasks/<agent-id>.output
# Follow symlinks; files are JSONL transcripts.
SRC_ROOT="/private/tmp/claude-501"

TODAY=$(date +%Y-%m-%d)
DEST_DIR="$DEST_ROOT/$TODAY"
mkdir -p "$DEST_DIR"

COPIED=0
SKIPPED=0
SKIPPED_EMPTY=0

# Find all task outputs under any project/session
if [ -d "$SRC_ROOT" ]; then
    while IFS= read -r src_file; do
        [ -z "$src_file" ] && continue
        # Follow symlinks to get the real file
        real_src=$(readlink -f "$src_file" 2>/dev/null || echo "$src_file")
        [ ! -f "$real_src" ] && continue
        # Skip empty files — nothing to preserve
        if [ ! -s "$real_src" ]; then
            SKIPPED_EMPTY=$((SKIPPED_EMPTY + 1))
            continue
        fi
        # Build destination filename: agent-id.output
        base=$(basename "$real_src")
        dest="$DEST_DIR/$base"
        # Idempotent: if destination exists AND has the same size, skip
        if [ -f "$dest" ]; then
            src_size=$(stat -f %z "$real_src" 2>/dev/null || echo 0)
            dst_size=$(stat -f %z "$dest" 2>/dev/null || echo 0)
            if [ "$src_size" = "$dst_size" ]; then
                SKIPPED=$((SKIPPED + 1))
                continue
            fi
            # Destination exists but source has grown — overwrite with the larger version
        fi
        cp "$real_src" "$dest" 2>/dev/null && COPIED=$((COPIED + 1))
    done < <(find "$SRC_ROOT" -type l -name "*.output" 2>/dev/null; find "$SRC_ROOT" -type f -name "*.output" 2>/dev/null)
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] archive-agent-runs: copied=$COPIED skipped=$SKIPPED empty=$SKIPPED_EMPTY dest=$DEST_DIR" >> "$LOG"

# Prune: keep 30 days of agent runs
find "$DEST_ROOT" -type d -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} \; 2>/dev/null || true

exit 0
