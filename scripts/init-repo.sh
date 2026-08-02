#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: init-repo.sh [--private|--public] [--behavior] [GITHUB_REPO]

Initializes a new greenfield side-project repo in the current empty directory,
creates the matching GitHub repo with gh, and pushes the initial commit.

GITHUB_REPO defaults to the current directory name. Pass owner/name to create
the repo under a specific owner or organization.

Options:
  --behavior  Create docs/behavior.md for durable behavior contracts.
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

repo_visibility="--private"
include_behavior=false
github_repo=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --private)
      repo_visibility="--private"
      shift
      ;;
    --public)
      repo_visibility="--public"
      shift
      ;;
    --behavior)
      include_behavior=true
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
      [ -z "$github_repo" ] || die "only one GITHUB_REPO argument is supported"
      github_repo="$1"
      shift
      ;;
  esac
done

need_cmd git
need_cmd gh

project_root="$(pwd)"
project_name="$(basename "$project_root")"
[ -n "$project_name" ] || die "could not determine project name"

if [ -z "$github_repo" ]; then
  github_repo="$project_name"
fi

if [ -n "$(find . -mindepth 1 -maxdepth 1 ! -name .DS_Store -print -quit)" ]; then
  die "current directory is not empty"
fi

git init
git branch -M main

mkdir -p .plans .reviews .html .archive
touch .plans/.gitkeep .reviews/.gitkeep .html/.gitkeep

if [ "$include_behavior" = true ]; then
  mkdir -p docs
  cat > docs/behavior.md <<'EOF_BEHAVIOR'
# Behavior

This file records durable product behavior so plan reviews can check the intended behavior contract before implementation.

<!--
## Feature Name

### Purpose

One short paragraph describing the behavior from the user or system perspective.

### Requirements

Use an uppercase, readable requirement prefix from the section name, such as `BACKGROUND-1` or `TOOL-APPROVAL-1`.

- FEATURE-1: A concrete externally meaningful behavior.
- FEATURE-2: A behavior constraint, including any important exclusion or boundary.

### Scenarios

Use this section only when ordering, lifecycle, concurrency, retries, streaming, cancellation, or multi-actor behavior matters.
-->
EOF_BEHAVIOR
fi

cat > .gitignore <<'EOF_GITIGNORE'
.DS_Store
.env
.env.*
!.env.example

node_modules/
dist/
build/
.next/
coverage/

__pycache__/
.venv/

.archive/

.reviews/*
!.reviews/.gitkeep
EOF_GITIGNORE

cat > CLAUDE.md <<'EOF_CLAUDE'
# Project Instructions

## Project Context
- This is a greenfield side project.
- Unless the user explicitly says otherwise, there are no backwards-compatibility requirements.

## Workflow
- Plans live in `.plans/`, should be committed, and should be named with implementation-order prefixes like `01-auth.md`, `02-billing.md`, and `03-dashboard.md`.
- Multi-agent reviews live in `.reviews/`; the directory is kept with `.gitkeep`, but review outputs are ignored by default.
- Generated HTML artifacts live in `.html/` and should be committed when they capture useful design, planning, or review context.
- Keep `README.md` current with the minimum context needed to run and understand the project.
EOF_CLAUDE

if [ "$include_behavior" = true ]; then
  cat >> CLAUDE.md <<'EOF_CLAUDE'
## Behavior Contracts
Update `docs/behavior.md` after the plan review cycle and before implementation for any nontrivial change that affects durable product behavior. Follow the structure in that file. Usually this means adding a new section, but review existing behavior sections and update affected requirements when the planned implementation changes or clarifies them. Edit only affected sections; avoid wording churn.

Do not update `docs/behavior.md` for pure refactors, internal cleanup, renames, file moves, dependency updates, or implementation-only API changes unless they change the product behavior described there. If the intended behavior cannot be stated clearly, stop and clarify before implementation.

EOF_CLAUDE
fi

cat >> CLAUDE.md <<'EOF_CLAUDE'
## Development
- Prefer the simplest implementation that satisfies the current product intent.
- Every implementation step must end with passing verification.
- Write tests for behavior that would be expensive or risky to verify manually.
- Run the relevant tests, typecheck, and lint before declaring work complete.
EOF_CLAUDE

ln -s CLAUDE.md AGENTS.md

cat > README.md <<EOF_README
# $project_name

Greenfield side project.
EOF_README

git add .
git commit -m "chore: initialize repo"

gh repo create "$github_repo" "$repo_visibility" --source=. --remote=origin --push

echo "Initialized $github_repo in $project_root"
