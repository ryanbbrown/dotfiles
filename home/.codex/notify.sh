#!/usr/bin/env bash
# Codex notify -> cmux desktop notification previewing the assistant message.
# Codex appends a JSON payload as the final arg; on agent-turn-complete it carries
# "last-assistant-message". Strip control chars and cap length for a clean one-line
# preview, then raise it through cmux's notification system. (cmux no longer honors
# OSC 9 escapes; we target the session's surface via CMUX_SURFACE_ID from the env,
# which Codex passes through to this child process.)
msg=$(printf '%s' "$1" | jq -r '."last-assistant-message" // empty' 2>/dev/null | tr -d '\000-\037' | cut -c1-140)
[ -n "$msg" ] || exit 0
[ -n "$CMUX_SURFACE_ID" ] || exit 0
cli="${CMUX_BUNDLED_CLI_PATH:-cmux}"
exec "$cli" notify --surface "$CMUX_SURFACE_ID" --title "Codex" --body "$msg"
