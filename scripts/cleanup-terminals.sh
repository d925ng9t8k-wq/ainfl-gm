#!/bin/bash
# 9 — Close stale Terminal tabs on startup
# Closes all Terminal tabs EXCEPT the one running the current Claude session.
# Called during startup protocol to clean up old frozen sessions.

CURRENT_TTY=$(tty 2>/dev/null | sed 's|/dev/||')

osascript <<'APPLESCRIPT'
tell application "Terminal"
    set currentTTY to do shell script "tty 2>/dev/null | sed 's|/dev/||'"
    repeat with w in windows
        set tabsToClose to {}
        repeat with t in tabs of w
            set tabTTY to tty of t
            -- Close tabs that are NOT the current session
            if tabTTY is not equal to ("/dev/" & currentTTY) then
                -- Check if the tab has a busy process (don't close active claude sessions)
                set tabBusy to busy of t
                if not tabBusy then
                    set end of tabsToClose to t
                end if
            end if
        end repeat
    end repeat
end tell
APPLESCRIPT

# Simpler approach: close Terminal windows that have no busy processes
# except our current window
osascript -e '
tell application "Terminal"
    set winCount to count of windows
    if winCount > 1 then
        repeat with i from winCount to 1 by -1
            set w to window i
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
        end repeat
    end if
end tell
' 2>/dev/null

echo "Terminal cleanup complete"
