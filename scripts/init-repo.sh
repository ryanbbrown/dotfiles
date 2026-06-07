#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: init-repo.sh [--private|--public] [GITHUB_REPO]

Initializes a new greenfield side-project repo in the current empty directory,
creates the matching GitHub repo with gh, and pushes the initial commit.

GITHUB_REPO defaults to the current directory name. Pass owner/name to create
the repo under a specific owner or organization.
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

mkdir -p .plans .reviews .html
touch .plans/.gitkeep .reviews/.gitkeep .html/.gitkeep
mkdir -p .agent
touch .agent/learnings.jsonl

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

.agent/learnings.jsonl

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

## Project Learnings
Agents should capture durable project learnings when they discover a non-obvious pattern, pitfall, user preference, architecture constraint, tool behavior, or workflow fix that would save future agents time.

Do not add every lesson directly to this file. Prefer appending a structured learning record to `.agent/learnings.jsonl`. The user will periodically review those records and promote important ones into this file.

Use this JSONL shape:

```json
{"skill":"review","type":"pitfall","key":"short-stable-key","insight":"Actionable rule future agents should follow.","confidence":8,"source":"observed","files":["path/to/relevant-file"]}
```

Types: `pattern`, `pitfall`, `preference`, `architecture`, `tool`, `operational`, `investigation`.

Sources: `observed`, `user-stated`, `inferred`, `cross-model`.

Confidence: 1-10. Use 8-9 for verified observations, 4-5 for uncertain inference, and 10 for explicit user-stated preferences.

Only log learnings that are reusable, specific, and likely to prevent a future mistake. Do not log obvious facts, one-off transient errors, or broad preferences inferred without evidence.

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
