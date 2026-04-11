#!/bin/bash
# PostToolUse hook — checks for incoming messages from comms hub
# Uses hookSpecificOutput.additionalContext so Claude sees the messages.
# Also does a LIVE inbox check if the signal file is empty — belt and suspenders.
# Also checks 9ops_push_notifications for unread push notifications from 9-Ops.

INCOMING="/tmp/9-incoming-message.jsonl"
DB="/Users/jassonfishback/Projects/BengalOracle/data/9-memory.db"

# Update heartbeat — hub uses this to detect freezes
date +%s > /tmp/9-last-tool-call 2>/dev/null

# First: check signal file (written by monitoring daemon)
# FIX: use atomic mv instead of cat+rm to prevent race condition (messages written between read and delete are lost)
# FIX 2 (Apr 5, silent-gap incident): if context construction fails, RESTORE the signal file so the
# message is not silently consumed. Previously a python3 failure would leave the message lost forever.
if [ -f "$INCOMING" ] && [ -s "$INCOMING" ]; then
  TMPFILE="/tmp/9-incoming-processing-$$.jsonl"
  mv "$INCOMING" "$TMPFILE" 2>/dev/null || exit 0
  messages=$(cat "$TMPFILE")

  # Use python to properly JSON-escape the message content
  context=$(python3 -c "
import json, sys
msgs = sys.stdin.read().strip()
print(json.dumps('INCOMING MESSAGE — RESPOND IMMEDIATELY: ' + msgs))
" <<< "$messages" 2>/dev/null)

  if [ -z "$context" ]; then
    # Context construction failed (python error, encoding issue, etc.) — restore signal file.
    # Next hook invocation will retry. Never silently lose a message.
    cat "$TMPFILE" >> "$INCOMING"
    rm -f "$TMPFILE"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] check-messages.sh: context build FAILED — restored $INCOMING" >> /Users/jassonfishback/Projects/BengalOracle/logs/check-messages-errors.log
    exit 0
  fi

  rm -f "$TMPFILE"
  # Log every successful delivery so we have an audit trail for silent-gap incidents
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] check-messages.sh: delivered $(echo "$messages" | wc -l | tr -d ' ') line(s) to context" >> /Users/jassonfishback/Projects/BengalOracle/logs/check-messages-errors.log
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":${context}}}"
  exit 0
fi

# Second: check 9ops_push_notifications for unread push notifications from 9-Ops
# Uses better-sqlite3 via a small Node.js snippet (no shell sqlite3 — DB may be encrypted)
if [ -f "$DB" ]; then
  OPS_NOTIFICATIONS=$(node --input-type=module <<'NODE_EOF' 2>/dev/null
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

const _require = createRequire(import.meta.url);
let Database;
try { Database = _require('better-sqlite3-multiple-ciphers'); }
catch { Database = _require('better-sqlite3'); }

const DB_PATH = '/Users/jassonfishback/Projects/BengalOracle/data/9-memory.db';
const ENV_PATH = '/Users/jassonfishback/Projects/BengalOracle/.env';

// Load env
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && !k.startsWith('#')) process.env[k] = v;
    }
  }
}

// Load encryption key
function loadKey() {
  try {
    return execSync('security find-generic-password -a "9-enterprises" -s "SQLITE_ENCRYPTION_KEY" -w',
      { stdio: ['pipe','pipe','pipe'] }).toString().trim();
  } catch {}
  return process.env.SQLITE_ENCRYPTION_KEY || null;
}

try {
  const db = new Database(DB_PATH);
  const key = loadKey();
  if (key) { db.pragma(`key = '${key}'`); db.pragma('cipher = sqlcipher'); }
  db.pragma('journal_mode = WAL');

  // Fetch unread push notifications
  const rows = db.prepare(`
    SELECT id, tag, message, created_at
    FROM "9ops_push_notifications"
    WHERE acknowledged_by_9 = 0
    ORDER BY created_at ASC
    LIMIT 10
  `).all();

  if (rows.length === 0) { process.exit(0); }

  // Mark them acknowledged
  const ids = rows.map(r => r.id);
  db.prepare(`
    UPDATE "9ops_push_notifications"
    SET acknowledged_by_9 = 1, acknowledged_at = datetime('now')
    WHERE id IN (${ids.map(() => '?').join(',')})
  `).run(...ids);

  db.close();

  // Output as JSON array
  process.stdout.write(JSON.stringify(rows));
} catch (e) {
  process.exit(0);
}
NODE_EOF
)

  if [ -n "$OPS_NOTIFICATIONS" ] && [ "$OPS_NOTIFICATIONS" != "[]" ] && [ "$OPS_NOTIFICATIONS" != "" ]; then
    context=$(python3 -c "
import json, sys
raw = sys.stdin.read().strip()
rows = json.loads(raw)
lines = []
for r in rows:
    lines.append('[9-Ops ' + r.get('tag','STATUS') + '] ' + r.get('message',''))
full = '9-OPS PUSH NOTIFICATION — READ AND RELAY TO OWNER:\n' + '\n---\n'.join(lines)
print(json.dumps(full))
" <<< "$OPS_NOTIFICATIONS" 2>/dev/null)

    if [ -n "$context" ]; then
      echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":${context}}}"
      exit 0
    fi
  fi
fi

# Third: if no signal file and no 9-Ops notifications, do a quick live inbox check (3s timeout)
LIVE=$(curl -s --max-time 3 http://localhost:3457/inbox 2>/dev/null)
if [ "$LIVE" != "[]" ] && [ -n "$LIVE" ] && [ "$LIVE" != "" ]; then
  context=$(python3 -c "
import json, sys
msgs = sys.stdin.read().strip()
# Parse and reformat for clarity
parsed = json.loads(msgs)
lines = []
for m in parsed:
    lines.append(json.dumps({'channel': m.get('channel',''), 'text': m.get('text',''), 'timestamp': m.get('timestamp','')}))
print(json.dumps('INCOMING MESSAGE — RESPOND IMMEDIATELY: ' + chr(10).join(lines)))
" <<< "$LIVE" 2>/dev/null)

  if [ -n "$context" ]; then
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":${context}}}"
    exit 0
  fi
fi

exit 0
