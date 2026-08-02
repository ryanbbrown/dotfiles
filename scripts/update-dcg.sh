#!/usr/bin/env bash
set -euo pipefail

dcg_bin="$HOME/.local/bin/dcg"

if [ ! -x "$dcg_bin" ]; then
  echo "error: dcg is not installed at $dcg_bin" >&2
  exit 1
fi

"$dcg_bin" update --verify --no-configure
