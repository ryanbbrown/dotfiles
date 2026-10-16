#!/usr/bin/env bash
set -euo pipefail

# Make the systemd bb.service start Claude Code through bin/claude-bb.
# For the Linux agent host only; the Mac runs bb as an app and does not need it.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$HOME/.local/bin/claude-bb"
dropin=/etc/systemd/system/bb.service.d/claude-bb.conf

[ "$#" -eq 0 ] || { echo "usage: install-bb-claude-wrapper.sh" >&2; exit 2; }
[ "$(uname -s)" = Linux ] || { echo "error: Linux only" >&2; exit 1; }
systemctl cat bb.service >/dev/null 2>&1 || { echo "error: bb.service not found" >&2; exit 1; }

mkdir -p "$(dirname "$target")"
ln -sfn "$repo_root/bin/claude-bb" "$target"
echo "Linked $target -> $repo_root/bin/claude-bb"

sudo mkdir -p "$(dirname "$dropin")"
printf '[Service]\nEnvironment=BB_CLAUDE_CODE_EXECUTABLE=%s\n' "$target" | sudo tee "$dropin" >/dev/null
echo "Wrote $dropin"

sudo systemctl daemon-reload
sudo systemctl restart bb.service
echo "Restarted bb.service; open threads use the wrapper from their next turn."
