#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
plugin_root="$repo_root/plugins/firstmate-queue"

npm --prefix "$plugin_root" test
npm --prefix "$plugin_root" run typecheck

printf '%s\n' "Firstmate Queue plugin tests passed."
