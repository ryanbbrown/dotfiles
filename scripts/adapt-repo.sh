#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: adapt-repo.sh [--force]

Adds Ryan's local agent workflow files to an existing git repository without
touching tracked project files.

Options:
  --force  Replace existing CLAUDE.local.md and AGENTS.override.md.
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

force=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force)
      force=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      die "unknown argument: $1"
      ;;
    *)
      die "unexpected argument: $1"
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "current directory is not inside a git repository"
cd "$repo_root"

exclude_file=".git/info/exclude"

if [ "$force" != true ]; then
  [ ! -e "CLAUDE.local.md" ] || die "CLAUDE.local.md already exists; rerun with --force to replace it"
  [ ! -e "AGENTS.override.md" ] || die "AGENTS.override.md already exists; rerun with --force to replace it"
fi

ensure_excluded() {
  local pattern="$1"

  mkdir -p "$(dirname "$exclude_file")"
  touch "$exclude_file"

  if ! grep -Fxq "$pattern" "$exclude_file"; then
    printf '%s\n' "$pattern" >> "$exclude_file"
  fi
}

write_local_workflow() {
  cat <<'EOF_WORKFLOW'
## Local Agent Workflow

- Use `.plans/` for implementation plans. Plans should be named with implementation-order prefixes like `01-auth.md`, `02-billing.md`, and `03-dashboard.md`.
- Keep `.plans/` available for review while working, but remove it before merging upstream if the target repo should not receive local planning artifacts.
- Use `.reviews/` for multi-agent review outputs.
- Use `.html/` for generated HTML artifacts when visual explanation is useful.
- Treat `.reviews/`, `.html/`, `.archive/`, `CLAUDE.local.md`, and `AGENTS.override.md` as local-only files.
EOF_WORKFLOW
}

write_claude_local() {
  local target="CLAUDE.local.md"

  if [ -e "$target" ] && [ "$force" != true ]; then
    die "$target already exists; rerun with --force to replace it"
  fi

  {
    cat <<'EOF_CLAUDE'
# Local Project Instructions

This file is local to this checkout and should not be committed.

EOF_CLAUDE

    if [ ! -f "CLAUDE.md" ] && [ -f "AGENTS.md" ]; then
      cat <<'EOF_IMPORT'
## Repo Instructions

@AGENTS.md

EOF_IMPORT
    fi

    write_local_workflow
  } > "$target"
}

write_agents_override() {
  local target="AGENTS.override.md"
  local source_file=""

  if [ -e "$target" ] && [ "$force" != true ]; then
    die "$target already exists; rerun with --force to replace it"
  fi

  if [ -f "AGENTS.md" ]; then
    source_file="AGENTS.md"
  elif [ -f "CLAUDE.md" ]; then
    source_file="CLAUDE.md"
  fi

  {
    cat <<'EOF_AGENTS'
# Local Codex Override

This file is local to this checkout and should not be committed. Codex loads `AGENTS.override.md` instead of `AGENTS.md` in the same directory, so this file includes the repo instructions first and then appends local workflow conventions.

EOF_AGENTS

    if [ -n "$source_file" ]; then
      printf '## Repo Instructions From `%s`\n\n' "$source_file"
      cat "$source_file"
      printf '\n\n'
    else
      cat <<'EOF_NO_SOURCE'
## Repo Instructions

No `AGENTS.md` or `CLAUDE.md` file existed when this local override was generated.

EOF_NO_SOURCE
    fi

    write_local_workflow
  } > "$target"
}

mkdir -p .plans .reviews .html .archive
touch .plans/.gitkeep .reviews/.gitkeep .html/.gitkeep

ensure_excluded "CLAUDE.local.md"
ensure_excluded "AGENTS.override.md"
ensure_excluded ".reviews/"
ensure_excluded ".html/"
ensure_excluded ".archive/"

write_claude_local
write_agents_override

echo "Adapted $repo_root for local agent workflow"
