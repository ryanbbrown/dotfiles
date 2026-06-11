#!/usr/bin/env bash
set -euo pipefail

# Rebuild the gstack browse binary when submodule sources are newer than the
# compiled binary. Mirrors gstack/setup's build path without its skill
# registration (create-links.sh owns linking in this repo).

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gstack_dir="$repo_root/gstack"
bin="$gstack_dir/browse/dist/browse"

command -v bun >/dev/null 2>&1 || { echo "error: bun is required" >&2; exit 1; }

needs_build=0
if [ ! -x "$bin" ]; then
  needs_build=1
elif [ -n "$(find "$gstack_dir/browse/src" -type f -newer "$bin" -print -quit 2>/dev/null)" ]; then
  needs_build=1
elif [ "$gstack_dir/package.json" -nt "$bin" ]; then
  needs_build=1
elif [ -f "$gstack_dir/bun.lock" ] && [ "$gstack_dir/bun.lock" -nt "$bin" ]; then
  needs_build=1
fi

if [ "$needs_build" -eq 0 ]; then
  echo "browse binary up to date"
  exit 0
fi

cd "$gstack_dir"
bun install --frozen-lockfile 2>/dev/null || bun install
bun run build

# Bun --compile can emit a corrupt code signature that macOS kills with
# SIGKILL (exit 137); remove + ad-hoc re-sign fixes it (gstack#997).
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  for b in browse/dist/browse browse/dist/find-browse; do
    [ -x "$b" ] || continue
    codesign --remove-signature "$b" 2>/dev/null || true
    codesign -s - -f "$b"
  done
fi

# Match the headless Chromium to the playwright version the build pinned.
bunx playwright install chromium-headless-shell

# The build regenerates tracked SKILL.md docs; upstream's committed versions
# are canonical, and a dirty submodule makes update-skill-sources.sh skip it.
git -C "$gstack_dir" checkout -- .

echo "browse binary rebuilt"
