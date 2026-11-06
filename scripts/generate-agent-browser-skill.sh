#!/usr/bin/env bash
set -eu

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

source_skill="vendor/agent-browser/skills/agent-browser/SKILL.md"
target_root="skills/agent-browser"

if [ ! -f "$source_skill" ]; then
  echo "error: missing $source_skill; run git submodule update --init --recursive" >&2
  exit 1
fi

rm -rf "$target_root"
mkdir -p "$target_root"
cp "$source_skill" "$target_root/SKILL.md"

note='If Chrome fails to start with "No usable sandbox!" (Linux hosts where AppArmor restricts unprivileged user namespaces, such as `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` = 1), merge `{"args": "--no-sandbox"}` into `~/.agent-browser/config.json` (create the file if it is missing), then retry.'

NOTE="$note" perl -0pi -e 's|^(Install: .*\n)|$1\n$ENV{NOTE}\n|m or die "agent-browser install line not found\n"' "$target_root/SKILL.md"

echo "Generated $target_root"
