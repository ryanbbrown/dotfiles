#!/usr/bin/env bash
set -euo pipefail

# Install authored files from this repository into locations used by local
# tools. Existing regular files are preserved with a .pre-dotfiles suffix
# before the first managed link or copy is created.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
home_source="$repo_root/home"
skills_source="$repo_root/skills"

[ "$#" -eq 0 ] || { echo "usage: link-home.sh" >&2; exit 2; }

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

install_executable_copy() {
  local source="$1"
  local target="$2"
  local backup="$target.pre-dotfiles"

  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    if [ -e "$backup" ] || [ -L "$backup" ]; then
      rm "$target"
    else
      backup_existing "$target"
    fi
  fi

  mkdir -p "$(dirname "$target")"
  install -m 755 "$source" "$target"
  echo "Installed $target from $source"
}

# Cursor reads only .mdc rules with frontmatter, so the shared instructions
# are generated rather than linked.
install_cursor_rule() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "$target")"
  {
    printf -- '---\n'
    printf 'description: Shared global agent instructions\n'
    printf 'alwaysApply: true\n'
    printf -- '---\n\n'
    cat "$source"
  } > "$target"
  echo "Generated $target from $source"
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

[ -f "$home_source/AGENTS.md" ] || die "missing $home_source/AGENTS.md"
[ -x "$repo_root/bin/papercut" ] || die "missing executable $repo_root/bin/papercut"
[ -x "$repo_root/bin/sync-bb-personal" ] || die "missing executable $repo_root/bin/sync-bb-personal"
[ -x "$repo_root/bin/install-bb-personal.command" ] ||
  die "missing executable $repo_root/bin/install-bb-personal.command"
[ -d "$skills_source" ] || die "missing $skills_source"
[ -f "$home_source/.claude/settings.json" ] || die "missing $home_source/.claude/settings.json"
[ -f "$home_source/.codex/hooks.json" ] || die "missing Codex hooks"
[ -f "$home_source/.pi/agent/settings.json" ] || die "missing $home_source/.pi/agent/settings.json"
[ -f "$home_source/.pi/agent/mcp.json" ] || die "missing $home_source/.pi/agent/mcp.json"
[ -f "$home_source/.config/git/ignore" ] || die "missing $home_source/.config/git/ignore"

if [ "$repo_root" != "$HOME/.dotfiles" ]; then
  create_symlink "$repo_root" "$HOME/.dotfiles"
fi
create_symlink "$repo_root/bin/papercut" "$HOME/.local/bin/papercut"
create_symlink "$repo_root/bin/sync-bb-personal" "$HOME/.local/bin/sync-bb-personal"
install_executable_copy "$repo_root/bin/install-bb-personal.command" "$HOME/Desktop/install-bb-personal.command"
create_symlink "$home_source/AGENTS.md" "$HOME/.claude/CLAUDE.md"
create_symlink "$home_source/AGENTS.md" "$HOME/.codex/AGENTS.md"
create_symlink "$home_source/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
create_symlink "$skills_source" "$HOME/.agents/skills"
create_symlink "$skills_source" "$HOME/.claude/skills"
create_symlink "$home_source/.claude/settings.json" "$HOME/.claude/settings.json"
create_symlink "$home_source/.codex/hooks.json" "$HOME/.codex/hooks.json"
create_symlink "$home_source/.pi/agent/settings.json" "$HOME/.pi/agent/settings.json"
create_symlink "$home_source/.pi/agent/mcp.json" "$HOME/.pi/agent/mcp.json"
create_symlink "$home_source/.config/git/ignore" "$HOME/.config/git/ignore"
install_cursor_rule "$home_source/AGENTS.md" "$HOME/.cursor/rules/agents.mdc"

clean_legacy_codex_skill_links

echo "Home links are current."
