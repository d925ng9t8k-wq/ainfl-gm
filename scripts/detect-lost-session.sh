#!/bin/bash
# detect-lost-session.sh — Lost-session detector for SessionStart hook
# Apr 10 Phase 1 kill item G
#
# Purpose: when a new Claude Code session starts, figure out whether the PRIOR
# session died cleanly or was killed for unresponsiveness, and surface a terse
# timeline reconciliation so the new 9 can resume the thread instead of
# rebuilding work that already exists.
#
# Signals consulted:
#   1. memory/session-handoff.json      (last handoff daemon snapshot)
#   2. memory/SESSION_HANDOFF.md         (human-readable state)
#   3. logs/comms-hub.log                (Terminal watchdog / ping timeout lines)
#   4. /tmp/9-terminal-pid               (PID the hub THINKS owns the terminal)
#   5. $PPID                             (PID the current Claude CLI is actually running as)
#
# Output: a short bullet list on stdout. Fast (<3s). Fails soft on parse errors.
# No exit code shenanigans — always exits 0 so the caller never blocks.

set +e

ROOT_DIR="/Users/jassonfishback/Projects/BengalOracle"
HANDOFF_JSON="$ROOT_DIR/memory/session-handoff.json"
HANDOFF_MD="$ROOT_DIR/memory/SESSION_HANDOFF.md"
HUB_LOG="$ROOT_DIR/logs/comms-hub.log"
TERMINAL_PID_FILE="/tmp/9-terminal-pid"

out=""
append() { if [ -z "$out" ]; then out="$1"; else out="$out
$1"; fi; }

append "LOST-SESSION DETECTOR:"

# --- 1. Handoff timestamp ---
handoff_generated=""
handoff_generated_et=""
if [ -f "$HANDOFF_JSON" ]; then
  handoff_generated=$(python3 -c "
import json
try:
  d=json.load(open('$HANDOFF_JSON'))
  print(d.get('generated',''))
except Exception:
  pass
" 2>/dev/null)
  handoff_generated_et=$(python3 -c "
import json
try:
  d=json.load(open('$HANDOFF_JSON'))
  print(d.get('generatedET',''))
except Exception:
  pass
" 2>/dev/null)
fi

if [ -n "$handoff_generated" ]; then
  append "- Last handoff snapshot: ${handoff_generated_et:-$handoff_generated}"
else
  append "- detector unable to parse handoff JSON — no prior snapshot"
fi

# --- 2. Scan tail of hub log for watchdog / recovery events since handoff ---
gap_events=""
event_count=0
if [ -f "$HUB_LOG" ]; then
  # Build a python helper that finds lines matching watchdog patterns, with
  # timestamps strictly after the handoff timestamp (if we have one). Caps at 10.
  gap_events=$(python3 - <<PY 2>/dev/null
import re
from datetime import datetime, timezone

log_path = "$HUB_LOG"
handoff_ts_s = "$handoff_generated".strip()
handoff_dt = None
if handoff_ts_s:
    try:
        handoff_dt = datetime.fromisoformat(handoff_ts_s.replace("Z","+00:00"))
    except Exception:
        handoff_dt = None

patterns = [
    "Terminal watchdog",
    "Terminal ping timeout",
    "Terminal open PROCEEDING",
    "Terminal claimed control",
    "Terminal released control",
    "FREEZE DETECTOR",
    "Freeze detector: new session detected",
    "SIGTERM received",
    "Port 3457 in use",
    "orphan ping",
]

try:
    with open(log_path, "r", errors="replace") as f:
        lines = f.readlines()[-400:]
except Exception:
    lines = []

ts_re = re.compile(r"^\[([^\]]+)\]\s*(.*)$")
hits = []
for ln in lines:
    m = ts_re.match(ln)
    if not m:
        continue
    ts_str, rest = m.group(1), m.group(2)
    try:
        ln_dt = datetime.fromisoformat(ts_str.replace("Z","+00:00"))
    except Exception:
        continue
    if handoff_dt and ln_dt < handoff_dt:
        continue
    if not any(p in rest for p in patterns):
        continue
    hits.append((ts_str, rest.strip()))

for ts_str, rest in hits[-10:]:
    compact = rest if len(rest) <= 110 else rest[:107] + "..."
    print(f"{ts_str} | {compact}")
PY
)
  if [ -n "$gap_events" ]; then
    event_count=$(printf "%s\n" "$gap_events" | wc -l | tr -d ' ')
  fi
fi

# --- 3. Compare terminal PID on disk vs current Claude PID ---
stored_pid=""
if [ -f "$TERMINAL_PID_FILE" ]; then
  stored_pid=$(cat "$TERMINAL_PID_FILE" 2>/dev/null | tr -d '[:space:]')
fi
current_pid="$PPID"
pid_mismatch="no"
if [ -n "$stored_pid" ] && [ -n "$current_pid" ] && [ "$stored_pid" != "$current_pid" ]; then
  # Is the stored PID still alive?
  if kill -0 "$stored_pid" 2>/dev/null; then
    pid_mismatch="alive"
  else
    pid_mismatch="dead"
  fi
fi

# --- 4. Check for graceful release marker in the tail window ---
graceful_release="no"
if [ -n "$gap_events" ]; then
  if printf "%s" "$gap_events" | grep -q "Terminal released control"; then
    graceful_release="yes"
  fi
fi

# --- 5. Signal file state (messages queued but not yet drained) ---
queued_lines=0
if [ -f "/tmp/9-incoming-message.jsonl" ]; then
  queued_lines=$(wc -l < /tmp/9-incoming-message.jsonl 2>/dev/null | tr -d ' ')
fi

# --- 6. Prior-9 work summary from handoff ---
prior_work=""
if [ -f "$HANDOFF_JSON" ]; then
  prior_work=$(python3 - <<'PY' 2>/dev/null
import json
try:
  d = json.load(open("/Users/jassonfishback/Projects/BengalOracle/memory/session-handoff.json"))
except Exception:
  print("")
  raise SystemExit
git = d.get("completedTaskManifest",{}).get("gitLogDetailed") or d.get("gitLog") or []
tops = git[:3]
if tops:
  print("recent commits: " + " // ".join(
    (c.split("|")[-1] if "|" in c else c).strip()[:70] for c in tops
  ))
else:
  print("")
PY
)
fi

# --- Verdict ---
verdict="CLEAN RESUME"
reasons=()

if [ "$event_count" -gt 0 ] && [ "$graceful_release" = "no" ]; then
  verdict="GAP DETECTED"
  reasons+=("$event_count watchdog/recovery event(s) since last handoff")
fi
if [ "$pid_mismatch" = "dead" ]; then
  verdict="GAP DETECTED"
  reasons+=("prior terminal PID $stored_pid is dead — no graceful release recorded")
fi
if [ "$pid_mismatch" = "alive" ]; then
  verdict="GAP DETECTED"
  reasons+=("prior terminal PID $stored_pid is STILL ALIVE — possible multi-session or orphan")
fi
if [ "$queued_lines" -gt 0 ]; then
  # Queued messages alone aren't a gap, but worth flagging alongside.
  reasons+=("$queued_lines message(s) queued in signal file")
fi

append "- Verdict: $verdict"
if [ ${#reasons[@]} -gt 0 ]; then
  for r in "${reasons[@]}"; do append "  * $r"; done
fi

if [ "$graceful_release" = "yes" ] && [ "$verdict" = "CLEAN RESUME" ]; then
  append "- Graceful /terminal/release recorded in log tail — prior session exited cleanly"
fi

if [ -n "$prior_work" ]; then
  append "- Prior 9 context: $prior_work"
fi

if [ -n "$gap_events" ]; then
  append "- Events in gap window (newest last):"
  # Cap printed events at 6 to stay under 30 lines total
  printed=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    append "  * $line"
    printed=$((printed+1))
    if [ "$printed" -ge 6 ]; then break; fi
  done <<< "$gap_events"
fi

printf "%s\n" "$out"
exit 0
