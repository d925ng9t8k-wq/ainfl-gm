#!/bin/bash
# Check for new emails from Jasson and display them
# Usage: ./scripts/check-email.sh

osascript -e '
tell application "Mail"
    check for new mail
    delay 3
    set output to ""
    set inboxMsgs to messages of inbox
    set msgCount to count of inboxMsgs
    set startAt to msgCount - 4
    if startAt < 1 then set startAt to 1
    repeat with i from startAt to msgCount
        set m to item i of inboxMsgs
        set fromAddr to sender of m
        set subj to subject of m
        set msgDate to date received of m
        set msgContent to content of m
        if fromAddr contains "emailfishback" or fromAddr contains "jassonfishback" then
            set output to output & "---" & linefeed & "FROM: " & fromAddr & linefeed & "SUBJECT: " & subj & linefeed & "DATE: " & (msgDate as string) & linefeed & "BODY: " & (paragraph 1 of msgContent) & linefeed
        end if
    end repeat
    if output is "" then
        return "No recent emails from Jasson"
    end if
    return output
end tell'
