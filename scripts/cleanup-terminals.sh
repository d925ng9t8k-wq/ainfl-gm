#!/bin/bash
# 9 — Close stale Terminal tabs + kill orphan Claude sessions on startup
# Catches ctrl+break edge cases that leave zombie sessions competing for terminal control.

MY_PID=$$
MY_PPID=$PPID

# Walk up the process tree to find the actual Claude Code PID
# $PPID is the bash subshell from Claude's Bash tool, not Claude Code itself.
# We need to find the real Claude Code process to avoid killing ourselves.
CLAUDE_PID=""
check_pid=$MY_PPID
for i in 1 2 3 4 5; do
    parent=$(ps -o ppid= -p "$check_pid" 2>/dev/null | tr -d ' ')
    [ -z "$parent" ] && break
    if ps -p "$parent" -o command= 2>/dev/null | grep -q "claude"; then
        CLAUDE_PID="$parent"
    fi
    check_pid="$parent"
done

# 1. Kill orphan Claude CLI processes that aren't THIS session
echo "=== Orphan Claude session sweep ==="
echo "  Protected PIDs: $MY_PID, $MY_PPID, ${CLAUDE_PID:-none}"
while IFS= read -r line; do
    orphan_pid=$(echo "$line" | awk '{print $2}')
    orphan_tty=$(echo "$line" | awk '{print $7}')

    # Skip our own entire process tree
    if [ "$orphan_pid" = "$MY_PPID" ] || [ "$orphan_pid" = "$MY_PID" ] || [ "$orphan_pid" = "$CLAUDE_PID" ]; then
        continue
    fi

    # Skip Claude Desktop app processes (they have ?? as TTY and run from /Applications)
    if echo "$line" | grep -q "/Applications/Claude.app"; then
        continue
    fi

    # Skip processes with ?? TTY that aren't terminal Claude sessions
    if [ "$orphan_tty" = "??" ]; then
        continue
    fi

    # Skip any process whose parent is our Claude Code PID (sibling tool calls)
    if [ -n "$CLAUDE_PID" ]; then
        orphan_ppid=$(ps -o ppid= -p "$orphan_pid" 2>/dev/null | tr -d ' ')
        if [ "$orphan_ppid" = "$CLAUDE_PID" ]; then
            echo "  Skipping child of current session: PID $orphan_pid"
            continue
        fi
    fi

    echo "Killing orphan Claude CLI: PID $orphan_pid (TTY: $orphan_tty)"
    kill "$orphan_pid" 2>/dev/null
    sleep 1
    # Force kill if still alive
    kill -0 "$orphan_pid" 2>/dev/null && kill -9 "$orphan_pid" 2>/dev/null && echo "  Force-killed PID $orphan_pid"
done < <(ps aux | grep -E "^[^ ]+ +[0-9]+ .* claude" | grep -v grep | grep -v "Claude.app" | grep -v "Claude Helper")

# 2. Close idle Terminal windows (AppleScript approach)
# SAFETY: Skip the frontmost window — that's us (Claude is running in it).
# A tab may appear "not busy" while Claude is thinking between tool calls.
osascript -e '
tell application "Terminal"
    set winCount to count of windows
    if winCount > 1 then
        set frontWin to front window
        repeat with i from winCount to 1 by -1
            set w to window i
            if w is frontWin then
                -- Never close the window we are running in
            else
                set allIdle to true
                repeat with t in tabs of w
                    if busy of t then
                        set allIdle to false
                        exit repeat
                    end if
                end repeat
                if allIdle then
                    close w
                end if
            end if
        end repeat
    end if
end tell
' 2>/dev/null

echo "Terminal cleanup complete"
