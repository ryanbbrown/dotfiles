#!/usr/bin/env bash
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

submodules=(
  "gstack"
  "mattpocock-skills"
  "agent-html-skills"
  "drawio-mcp"
  "taste-skill"
  "last30days-skill"
  "crit"
  "vercel-agent-skills"
)

generated_paths=(
  "plugins/html-artifacts/skills/html-artifacts"
  "plugins/drawio/skills/drawio"
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

if [ -x scripts/generate-html-artifacts-skill.sh ]; then
  log "GENERATE html-artifacts skill"
  scripts/generate-html-artifacts-skill.sh || die "failed to generate html-artifacts skill"
fi

if [ -x scripts/generate-drawio-skill.sh ]; then
  log "GENERATE drawio skill"
  scripts/generate-drawio-skill.sh || die "failed to generate drawio skill"
fi

if [ -x scripts/build-gstack-browse.sh ]; then
  log "BUILD gstack browse binary"
  scripts/build-gstack-browse.sh || die "failed to build gstack browse binary"
fi

if [ -x create-links.sh ]; then
  log "LINK agent skills"
  ./create-links.sh || die "failed to link agent skills"
fi

changed=()
for submodule in "${submodules[@]}"; do
  if ! git config --file .gitmodules --get "submodule.$submodule.url" >/dev/null; then
    continue
  fi

  if ! git diff --quiet -- "$submodule"; then
    changed+=("$submodule")
  fi
done

for generated_path in "${generated_paths[@]}"; do
  if [ -e "$generated_path" ] && {
    ! git diff --quiet -- "$generated_path" ||
    [ -n "$(git ls-files --others --exclude-standard -- "$generated_path")" ]
  }; then
    changed+=("$generated_path")
  fi
done

if [ "${#changed[@]}" -eq 0 ]; then
  log "No skill source changes"
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

git commit -m "chore: update skill sources" --only -- "${changed[@]}" || die "failed to commit skill source updates"

if [ "$push" != true ]; then
  exit 0
fi

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then
  die "refusing to push from branch '$branch'; expected main"
fi

git push || die "push failed; leaving local commit in place"
log "Pushed skill submodule update"
