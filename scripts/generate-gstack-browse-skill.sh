#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

source_root="vendor/gstack/browse"
target_root="skills/browse"

if [ ! -f "$source_root/SKILL.md" ]; then
  echo "error: missing $source_root/SKILL.md; run git submodule update --init --recursive" >&2
  exit 1
fi

rm -rf "$target_root"
mkdir -p "$target_root"
cp "$source_root/SKILL.md" "$target_root/SKILL.md"

# The upstream skill assumes the complete gstack checkout is installed inside
# Claude's skill directory. This repository exposes only browse as a skill, so
# its helper commands use the stable dotfiles link instead.
perl -0pi -e 's#(?:~|\$HOME|\${HOME})/\.claude/skills/gstack#\${HOME}/.dotfiles/vendor/gstack#g' "$target_root/SKILL.md"

for entry in PLAN-snapshot-dropdown-interactive.md SKILL.md.tmpl bin dist scripts src test; do
  ln -s "../../vendor/gstack/browse/$entry" "$target_root/$entry"
done

echo "Generated $target_root"
