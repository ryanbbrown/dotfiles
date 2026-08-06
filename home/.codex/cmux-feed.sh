#!/usr/bin/env sh
set -u

event="${1:-}"
cmux_cli="${CMUX_BUNDLED_CLI_PATH:-}"
if [ -z "$cmux_cli" ] || [ ! -x "$cmux_cli" ]; then
  cmux_cli="$(command -v cmux 2>/dev/null || true)"
fi

if [ -z "$event" ] || [ -z "${CMUX_SURFACE_ID:-}" ] || [ -z "$cmux_cli" ]; then
  cat >/dev/null 2>/dev/null || true
  echo '{}'
  exit 0
fi

if [ -n "${CMUX_SOCKET_PATH:-}" ]; then
  "$cmux_cli" --socket "$CMUX_SOCKET_PATH" hooks feed --source codex --event "$event" || echo '{}'
else
  "$cmux_cli" hooks feed --source codex --event "$event" || echo '{}'
fi
