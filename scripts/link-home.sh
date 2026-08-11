#!/usr/bin/env bash
set -euo pipefail

# Link the authored files in this repository into the locations used by local
# coding agents. Existing regular files are preserved with a .pre-dotfiles
# suffix before the first link is created.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home_source="$repo_root/home"
skills_source="$repo_root/skills"

die() {
  echo "error: $*" >&2
  exit 1
}

backup_existing() {
  local target="$1"
  local backup="$target.pre-dotfiles"

  [ ! -e "$backup" ] && [ ! -L "$backup" ] || die "backup already exists: $backup"
  mv "$target" "$backup"
  echo "Backed up $target -> $backup"
}

create_symlink() {
  local source="$1"
  local target="$2"

  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    backup_existing "$target"
  fi

  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
  echo "Linked $target -> $source"
}

clean_legacy_codex_skill_links() {
  local target_dir="$HOME/.codex/skills"
  local target
  local skill_name

  [ -d "$target_dir" ] || return 0
  for target in "$target_dir"/*; do
    [ -L "$target" ] || continue
    skill_name="$(basename "$target")"
    [ -e "$skills_source/$skill_name" ] || [ -L "$skills_source/$skill_name" ] || continue
    rm "$target"
    echo "Removed legacy Codex skill link at $target"
  done
}

configure_cmux_integrations() {
  # cmux does not currently expose the Codex integration toggle in cmux.json,
  # so keep its wrapper hooks disabled through the underlying preference.
  if [ "$(uname -s)" = "Darwin" ] && command -v defaults >/dev/null 2>&1; then
    defaults write com.cmuxterm.app codexHooksEnabled -bool false
    echo "Disabled cmux's native Codex hooks; dotfiles hooks own agent status."
  fi
}

[ -f "$home_source/AGENTS.md" ] || die "missing $home_source/AGENTS.md"
[ -x "$repo_root/bin/papercut" ] || die "missing executable $repo_root/bin/papercut"
[ -x "$repo_root/bin/claude" ] || die "missing executable $repo_root/bin/claude"
[ -x "$repo_root/bin/codex" ] || die "missing executable $repo_root/bin/codex"
[ -d "$skills_source" ] || die "missing $skills_source"
[ -f "$home_source/.config/cmux/cmux.json" ] || die "missing cmux config"
[ -f "$home_source/.claude/settings.json" ] || die "missing $home_source/.claude/settings.json"
[ -f "$home_source/.claude/mcp.json" ] || die "missing Claude MCP config"
[ -x "$home_source/.claude/hooks/cmux-session.sh" ] || die "missing executable Claude cmux hook"
[ -f "$home_source/.codex/hooks.json" ] || die "missing Codex hooks"
[ -x "$home_source/.codex/cmux-feed.sh" ] || die "missing executable Codex Feed hook"
[ -x "$home_source/.codex/notify.sh" ] || die "missing executable Codex notifier"
[ -f "$home_source/.pi/agent/settings.json" ] || die "missing $home_source/.pi/agent/settings.json"
[ -f "$home_source/.pi/agent/mcp.json" ] || die "missing $home_source/.pi/agent/mcp.json"
[ -f "$home_source/.pi/agent/APPEND_SYSTEM.md" ] || die "missing $home_source/.pi/agent/APPEND_SYSTEM.md"
[ -d "$home_source/.pi/agent/themes" ] || die "missing $home_source/.pi/agent/themes"
[ -f "$home_source/.pi/agent/extensions/cmux-session.ts" ] || die "missing cmux Pi extension"
[ -f "$home_source/.pi/agent/extensions/pi-minimal-toolcall/config.json" ] || die "missing pi-minimal-toolcall config"
[ -f "$home_source/.pi/agent/extensions/subagent/config.json" ] || die "missing pi-subagents config"

if [ "$repo_root" != "$HOME/.dotfiles" ]; then
  create_symlink "$repo_root" "$HOME/.dotfiles"
fi
create_symlink "$repo_root/bin/papercut" "$HOME/.local/bin/papercut"
create_symlink "$repo_root/bin/claude" "$HOME/.local/bin/claude"
create_symlink "$repo_root/bin/codex" "$HOME/.local/bin/codex"
create_symlink "$home_source/AGENTS.md" "$HOME/.claude/CLAUDE.md"
create_symlink "$home_source/AGENTS.md" "$HOME/.codex/AGENTS.md"
create_symlink "$home_source/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
create_symlink "$skills_source" "$HOME/.agents/skills"
create_symlink "$skills_source" "$HOME/.claude/skills"
create_symlink "$home_source/.config/cmux/cmux.json" "$HOME/.config/cmux/cmux.json"
create_symlink "$home_source/.claude/settings.json" "$HOME/.claude/settings.json"
create_symlink "$home_source/.claude/mcp.json" "$HOME/.claude/mcp.json"
create_symlink "$home_source/.claude/hooks/cmux-session.sh" "$HOME/.claude/hooks/cmux-session.sh"
create_symlink "$home_source/.codex/hooks.json" "$HOME/.codex/hooks.json"
create_symlink "$home_source/.codex/cmux-feed.sh" "$HOME/.codex/cmux-feed.sh"
create_symlink "$home_source/.codex/notify.sh" "$HOME/.codex/notify.sh"
create_symlink "$home_source/.pi/agent/settings.json" "$HOME/.pi/agent/settings.json"
create_symlink "$home_source/.pi/agent/mcp.json" "$HOME/.pi/agent/mcp.json"
create_symlink "$home_source/.pi/agent/APPEND_SYSTEM.md" "$HOME/.pi/agent/APPEND_SYSTEM.md"
create_symlink "$home_source/.pi/agent/themes" "$HOME/.pi/agent/themes"
create_symlink "$home_source/.pi/agent/extensions/cmux-session.ts" "$HOME/.pi/agent/extensions/cmux-session.ts"
create_symlink "$home_source/.pi/agent/extensions/pi-minimal-toolcall" "$HOME/.pi/agent/extensions/pi-minimal-toolcall"
create_symlink "$home_source/.pi/agent/extensions/subagent" "$HOME/.pi/agent/extensions/subagent"

clean_legacy_codex_skill_links
configure_cmux_integrations

echo "Home links are current."
