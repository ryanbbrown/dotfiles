#!/usr/bin/env bash
# osc-notify.sh — emit "$1" as an OSC 9 desktop notification on the pane's terminal.
#
# Shared by Codex (~/.codex/notify.sh) and Claude Code (Stop / PermissionRequest hooks
# in ~/.claude/settings.json). Agent hooks/notify programs typically run detached from
# the controlling terminal, so /dev/tty is unreliable; instead we walk up the process
# tree to the nearest real terminal device and write there. cmux (and other
# Ghostty/iTerm2-compatible terminals) turn OSC 9 into a notification / unread dot.
#
# Usage: osc-notify.sh "<message>"   (empty message is a no-op)
msg=$1
[ -n "$msg" ] || exit 0

p=$PPID
while [ -n "$p" ] && [ "$p" != "1" ]; do
  t=$(ps -o tty= -p "$p" 2>/dev/null | tr -d '[:space:]')
  case "$t" in
    ttys*|pts/*|tty*) printf '\033]9;%s\007' "$msg" > "/dev/$t" 2>/dev/null && exit 0 ;;
  esac
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d '[:space:]')
done
