#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: review-round.sh --feature NAME [--repo PATH] [--output-dir PATH]

Runs Codex, Claude Code, and Factory Droid reviewers in parallel.

Options:
  --feature NAME       Required stable feature label.
  --repo PATH          Repository to review. Defaults to current directory.
  --output-dir PATH    Output root. Defaults to <repo>/.reviews.
  -h, --help           Show this help.

Environment:
  MAX_ROUNDS           Hard cap for review versions. Defaults to 3.
  DROID_MODEL          Droid reviewer model. Defaults to deepseek-v4-pro.
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

slugify() {
  printf '%s' "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

feature=""
repo="$(pwd)"
output_root=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --feature)
      [ "$#" -ge 2 ] || die "--feature requires a value"
      feature="$2"
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || die "--repo requires a value"
      repo="$2"
      shift 2
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || die "--output-dir requires a value"
      output_root="$2"
      shift 2
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

[ -n "$feature" ] || die "--feature is required"
[ -d "$repo" ] || die "repo does not exist: $repo"

repo="$(cd "$repo" && pwd)"
git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository: $repo"

feature_slug="$(slugify "$feature")"
[ -n "$feature_slug" ] || die "feature name does not contain any slug-safe characters"

if [ -z "$output_root" ]; then
  output_root="$repo/.reviews"
fi
mkdir -p "$output_root"
output_root="$(cd "$output_root" && pwd)"

feature_dir="$output_root/$feature_slug"
mkdir -p "$feature_dir"

max_rounds="${MAX_ROUNDS:-3}"
case "$max_rounds" in
  ''|*[!0-9]*) die "MAX_ROUNDS must be a positive integer" ;;
esac
[ "$max_rounds" -gt 0 ] || die "MAX_ROUNDS must be greater than zero"

max_seen=0
for path in "$feature_dir"/"$feature_slug"-*-v*.md; do
  [ -e "$path" ] || continue
  name="$(basename "$path")"
  version="${name##*-v}"
  version="${version%.md}"
  case "$version" in
    ''|*[!0-9]*) continue ;;
  esac
  if [ "$version" -gt "$max_seen" ]; then
    max_seen="$version"
  fi
done

round=$((max_seen + 1))
if [ "$round" -gt "$max_rounds" ]; then
  die "review round v$round exceeds MAX_ROUNDS=$max_rounds for feature '$feature'"
fi

need_cmd codex
need_cmd claude
need_cmd droid

droid_model="${DROID_MODEL:-deepseek-v4-pro}"
logs_dir="$feature_dir/.logs/v$round"
mkdir -p "$logs_dir"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/multi-review.XXXXXX")" || die "failed to create temp directory"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

prompt_file="$tmp_dir/review-prompt.md"
cat > "$prompt_file" <<EOF_PROMPT
You are a read-only code reviewer for a completed feature.

Feature: $feature
Review round: v$round
Repository: $repo

Your job is to review the current repository changes for correctness, regressions, missing tests, edge cases, and alignment with local project instructions.

Rules:
- Do not edit files.
- Do not run tests, builds, package managers, linters, app servers, or ad-hoc scripts.
- Do not create temporary files.
- You may read files and use read-only git commands such as git status, git diff, git log, and git show.
- If a test or ad-hoc check would be useful, describe it as feedback for the writer to run.
- Prefer concrete findings with file paths and line numbers.
- If there are no actionable issues, say that clearly and mention residual risks.

Suggested process:
1. Read project instructions such as AGENTS.md or CLAUDE.md if present.
2. Inspect git status and diffs for the current work.
3. Review only the feature changes; ignore unrelated pre-existing issues.

Return Markdown with:
- Verdict: pass or changes requested
- Findings, ordered by severity
- Missing or follow-up tests the writer should run
- Open questions, if any
EOF_PROMPT

codex_out="$feature_dir/$feature_slug-codex-v$round.md"
claude_out="$feature_dir/$feature_slug-claude-v$round.md"
droid_out="$feature_dir/$feature_slug-droid-deepseek-v$round.md"

run_codex() {
  codex exec \
    --cd "$repo" \
    --sandbox read-only \
    --ask-for-approval never \
    --output-last-message "$codex_out" \
    - < "$prompt_file" > "$logs_dir/codex.stdout" 2> "$logs_dir/codex.stderr"
  status=$?
  if [ ! -s "$codex_out" ] && [ -s "$logs_dir/codex.stdout" ]; then
    cp "$logs_dir/codex.stdout" "$codex_out"
  fi
  return "$status"
}

run_claude() {
  (
    cd "$repo" || exit 1
    claude -p \
      --permission-mode dontAsk \
      --allowedTools "Read,Glob,Grep,LS,Bash(git status*),Bash(git diff*),Bash(git log*),Bash(git show*),Bash(pwd),Bash(ls*)" \
      --disallowedTools "Edit,Write,MultiEdit,NotebookEdit" \
      --output-format text \
      "$(cat "$prompt_file")"
  ) > "$claude_out" 2> "$logs_dir/claude.stderr"
}

run_droid() {
  droid exec \
    --cwd "$repo" \
    --model "$droid_model" \
    --output-format text \
    -f "$prompt_file" > "$droid_out" 2> "$logs_dir/droid.stderr"
}

echo "multi-review: feature '$feature' -> $feature_dir (round v$round)"

run_codex &
codex_pid=$!
run_claude &
claude_pid=$!
run_droid &
droid_pid=$!

failed=0

if wait "$codex_pid"; then
  echo "codex: $codex_out"
else
  echo "codex: failed; see $logs_dir/codex.stderr" >&2
  failed=1
fi

if wait "$claude_pid"; then
  echo "claude: $claude_out"
else
  echo "claude: failed; see $logs_dir/claude.stderr" >&2
  failed=1
fi

if wait "$droid_pid"; then
  echo "droid: $droid_out"
else
  echo "droid: failed; see $logs_dir/droid.stderr" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit "$failed"
fi

echo "multi-review: complete"
