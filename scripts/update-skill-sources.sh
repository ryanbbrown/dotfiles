#!/usr/bin/env bash
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

submodules=(
  "gstack"
  "mattpocock-skills"
)

commit=false
push=false

usage() {
  cat <<'USAGE'
Usage: update-skill-sources.sh [--commit] [--push]

Updates known skill submodules. With --commit, commits only the submodule
pointer changes. With --push, pushes that commit after it is created.

Guardrails:
  - Skips any submodule with local modifications.
  - Commits only known submodule paths.
  - Refuses to push unless on main.
  - Does not rebase or merge if push fails.
USAGE
}

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit)
      commit=true
      shift
      ;;
    --push)
      commit=true
      push=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

for submodule in "${submodules[@]}"; do
  if [ ! -d "$submodule" ]; then
    log "SKIP $submodule: directory missing"
    continue
  fi

  if ! git config --file .gitmodules --get "submodule.$submodule.url" >/dev/null; then
    log "SKIP $submodule: not listed in .gitmodules"
    continue
  fi

  if [ -n "$(git -C "$submodule" status --porcelain)" ]; then
    log "SKIP $submodule: submodule has local modifications"
    continue
  fi

  log "UPDATE $submodule"
  git submodule update --remote "$submodule" || die "failed to update $submodule"
done

changed=()
for submodule in "${submodules[@]}"; do
  if ! git config --file .gitmodules --get "submodule.$submodule.url" >/dev/null; then
    continue
  fi

  if ! git diff --quiet -- "$submodule"; then
    changed+=("$submodule")
  fi
done

if [ "${#changed[@]}" -eq 0 ]; then
  log "No skill submodule pointer changes"
  exit 0
fi

log "Changed skill submodules: ${changed[*]}"

if [ "$commit" != true ]; then
  exit 0
fi

git add -- "${changed[@]}"

if git diff --cached --quiet -- "${changed[@]}"; then
  log "No staged submodule pointer changes"
  exit 0
fi

git commit --only -- "${changed[@]}" -m "chore: update skill submodules" || die "failed to commit skill submodule updates"

if [ "$push" != true ]; then
  exit 0
fi

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  die "refusing to push from branch '$branch'; expected main"
fi

git push || die "push failed; leaving local commit in place"
log "Pushed skill submodule update"
