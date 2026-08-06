#!/usr/bin/env bash
set -u

event="${1:-}"
payload="$(cat)"
cmux_cli="${CMUX_BUNDLED_CLI_PATH:-cmux}"

[ -n "${CMUX_SURFACE_ID:-}" ] || exit 0
command -v "$cmux_cli" >/dev/null 2>&1 || [ -x "$cmux_cli" ] || exit 0

session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null)"
[ -n "$session_id" ] || exit 0

workspace_args=()
if [ -n "${CMUX_WORKSPACE_ID:-}" ]; then
  workspace_args=(--workspace "$CMUX_WORKSPACE_ID")
fi
surface_args=("${workspace_args[@]}" --surface "$CMUX_SURFACE_ID")

case "$event" in
  prompt-submit)
    "$cmux_cli" set-status agentrun Running --icon bolt.fill --color "#4C8DFF" >/dev/null 2>&1 || true
    cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)"
    [ -n "$cwd" ] || cwd="${PWD:-$HOME}"
    "$cmux_cli" --json surface resume set \
      "${surface_args[@]}" \
      --name "Claude Code" \
      --kind claude \
      --checkpoint-id "$session_id" \
      --source agent-hook \
      --cwd "$cwd" \
      -- /usr/bin/env \
      CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000 \
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=25 \
      claude --resume "$session_id" --dangerously-skip-permissions --remote-control \
      >/dev/null 2>&1 || true
    ;;
  session-end)
    "$cmux_cli" --json surface resume clear \
      "${surface_args[@]}" \
      --checkpoint-id "$session_id" \
      --source agent-hook \
      >/dev/null 2>&1 || true
    ;;
esac
