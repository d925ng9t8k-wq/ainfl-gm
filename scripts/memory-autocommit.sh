#!/bin/bash
# memory-autocommit.sh
# Auto-commits any changes in the memory directory every 30 minutes.
# Run via LaunchAgent com.9.memory-autocommit.plist

MEMORY_DIR="/Users/jassonfishback/.claude/projects/-Users-jassonfishback-Projects-BengalOracle/memory"
GIT="/usr/bin/git"
LOG="/Users/jassonfishback/Projects/BengalOracle/logs/memory-autocommit.log"

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] memory-autocommit: checking for changes" >> "$LOG"

cd "$MEMORY_DIR" || exit 1

# Check if there are any changes
if $GIT diff --quiet && $GIT diff --cached --quiet && [ -z "$($GIT status --porcelain)" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] memory-autocommit: no changes" >> "$LOG"
  exit 0
fi

# Stage all changes
$GIT add -A

# Count changed files
CHANGED=$($GIT status --porcelain | wc -l | tr -d ' ')

# Commit
$GIT commit -m "Auto-checkpoint: $CHANGED file(s) changed $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$LOG" 2>&1
echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] memory-autocommit: committed $CHANGED files" >> "$LOG"
