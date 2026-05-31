#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: review-round.sh --feature NAME [--repo PATH] [--output-dir PATH] [--mode MODE] [--target-file PATH] [--preflight-only]

Runs Codex, Claude Code, and Factory Droid reviewers in parallel.

Options:
  --feature NAME       Required stable feature label.
  --repo PATH          Repository to review. Defaults to current directory.
  --output-dir PATH    Output root. Defaults to <repo>/.reviews.
                       Reviews are written under plans/ or implementations/.
  --mode MODE          Review mode: implementation or plan. Defaults to implementation.
  --target-file PATH   File to review, relative to repo or absolute. Required for plan mode.
  --preflight-only     Run CLI smoke checks, then exit before starting reviewers.
  -h, --help           Show this help.

Environment:
  MAX_ROUNDS           Hard cap for review versions. Defaults to 3.
  DROID_MODEL          Droid reviewer model. Defaults to custom:DeepSeek-V4-Pro-0.
  REVIEW_TIMEOUT_SECONDS
                       Per-reviewer timeout. Defaults to 900.
  SKIP_PREFLIGHT       Set to 1 to skip CLI smoke checks.
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
review_mode="implementation"
target_file=""
preflight_only=0

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
    --mode)
      [ "$#" -ge 2 ] || die "--mode requires a value"
      review_mode="$2"
      shift 2
      ;;
    --target-file)
      [ "$#" -ge 2 ] || die "--target-file requires a value"
      target_file="$2"
      shift 2
      ;;
    --preflight-only)
      preflight_only=1
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

[ -n "$feature" ] || die "--feature is required"
[ -d "$repo" ] || die "repo does not exist: $repo"
case "$review_mode" in
  implementation|plan) ;;
  *) die "--mode must be 'implementation' or 'plan'" ;;
esac

repo="$(cd "$repo" && pwd)"
git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository: $repo"

if [ -n "$target_file" ]; then
  case "$target_file" in
    /*) ;;
    *) target_file="$repo/$target_file" ;;
  esac
  [ -f "$target_file" ] || die "target file does not exist: $target_file"
fi
if [ "$review_mode" = "plan" ] && [ -z "$target_file" ]; then
  die "--target-file is required when --mode plan"
fi

feature_slug="$(slugify "$feature")"
[ -n "$feature_slug" ] || die "feature name does not contain any slug-safe characters"

case "$review_mode" in
  plan) mode_dir="plans" ;;
  implementation) mode_dir="implementations" ;;
esac

if [ -z "$output_root" ]; then
  output_root="$repo/.reviews"
fi
mkdir -p "$output_root"
output_root="$(cd "$output_root" && pwd)"

feature_dir="$output_root/$mode_dir/$feature_slug"
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

droid_model="${DROID_MODEL:-custom:DeepSeek-V4-Pro-0}"
droid_model_slug="$(slugify "$droid_model")"
review_timeout="${REVIEW_TIMEOUT_SECONDS:-900}"
case "$review_timeout" in
  ''|*[!0-9]*) die "REVIEW_TIMEOUT_SECONDS must be a positive integer" ;;
esac
[ "$review_timeout" -gt 0 ] || die "REVIEW_TIMEOUT_SECONDS must be greater than zero"
logs_dir="$feature_dir/.logs/v$round"
mkdir -p "$logs_dir"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/multi-review.XXXXXX")" || die "failed to create temp directory"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

kill_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

wait_with_timeout() {
  local pid="$1"
  local name="$2"
  local stderr_file="$3"
  local timeout_file="$logs_dir/$name.timeout"
  local watchdog_pid
  local status
  rm -f "$timeout_file"
  (
    sleep "$review_timeout"
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name: timed out after ${review_timeout}s" >> "$stderr_file"
      touch "$timeout_file"
      kill_tree "$pid"
      sleep 2
      kill -KILL "$pid" 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!
  wait "$pid"
  status=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  if [ -e "$timeout_file" ]; then
    return 124
  fi
  return "$status"
}

preflight() {
  [ "${SKIP_PREFLIGHT:-}" = "1" ] && return 0

  local failed=0
  local codex_preflight_pid
  local claude_preflight_pid
  local droid_preflight_pid

  codex exec \
    --cd "$repo" \
    --sandbox read-only \
    --ephemeral \
    "Reply with exactly: ok. Do not run tools." > "$logs_dir/codex.preflight.stdout" 2> "$logs_dir/codex.preflight.stderr" &
  codex_preflight_pid=$!

  (
    cd "$repo" || exit 1
    claude -p \
      --permission-mode dontAsk \
      --allowedTools "Read,Glob,Grep,LS,Bash(git status*),Bash(git diff*),Bash(git log*),Bash(git show*),Bash(pwd),Bash(ls*)" \
      --disallowedTools "Edit,Write,MultiEdit,NotebookEdit" \
      --output-format text \
      "Reply with exactly: ok. Do not run tools."
  ) > "$logs_dir/claude.preflight.stdout" 2> "$logs_dir/claude.preflight.stderr" &
  claude_preflight_pid=$!

  droid exec \
    --cwd "$repo" \
    --model "$droid_model" \
    --output-format text \
    "Reply with exactly: ok. Do not run tools." > "$logs_dir/droid.preflight.stdout" 2> "$logs_dir/droid.preflight.stderr" &
  droid_preflight_pid=$!

  if ! wait_with_timeout "$codex_preflight_pid" codex-preflight "$logs_dir/codex.preflight.stderr"; then
    echo "codex preflight failed; see $logs_dir/codex.preflight.stderr" >&2
    failed=1
  fi
  if ! wait_with_timeout "$claude_preflight_pid" claude-preflight "$logs_dir/claude.preflight.stderr"; then
    echo "claude preflight failed; see $logs_dir/claude.preflight.stderr" >&2
    echo "hint: non-interactive Claude must work with 'claude -p' in this repo; avoid --bare if you rely on terminal/keychain auth." >&2
    failed=1
  fi
  if ! wait_with_timeout "$droid_preflight_pid" droid-preflight "$logs_dir/droid.preflight.stderr"; then
    echo "droid preflight failed for model '$droid_model'; see $logs_dir/droid.preflight.stderr" >&2
    echo "hint: set DROID_MODEL to the model id that works in your terminal, for example custom:DeepSeek-V4-Pro-0." >&2
    failed=1
  fi

  return "$failed"
}

prompt_file="$tmp_dir/review-prompt.md"
if [ "$review_mode" = "plan" ]; then
  cat > "$prompt_file" <<EOF_PROMPT
You are a read-only plan reviewer.

Feature: $feature
Review round: v$round
Repository: $repo
Plan file: $target_file

Your job is to review the plan for correctness, regressions it might introduce, missing tests, edge cases, unclear decisions, and alignment with local project instructions.

Rules:
- Do not edit files.
- Do not run tests, builds, package managers, linters, app servers, or ad-hoc scripts.
- Do not create temporary files.
- Do not use task-list or planning tools such as TodoWrite.
- You may read files and use read-only git commands such as git status, git diff, git log, and git show.
- Do not read .reviews/, prior review outputs, reviewer logs, or generated review feedback files.
- Do not use earlier review rounds as evidence.
- If a test or ad-hoc check would be useful, describe it as feedback for the writer to run.
- Prefer concrete findings with file paths and line numbers.
- If there are no actionable issues, say that clearly and mention residual risks.

Suggested process:
1. Read project instructions such as AGENTS.md or CLAUDE.md if present.
2. Read the plan file.
3. Inspect the relevant source and tests needed to evaluate the plan.
4. Review only the target plan and its implied implementation path; ignore unrelated pre-existing issues and other planning or feedback documents.

Return Markdown with:
- Verdict: pass or changes requested
- Findings, ordered by severity
- Missing or follow-up tests the writer should run
- Open questions, if any

Your final assistant response must be the review itself. Do not send a final status-only or housekeeping response after the review.
EOF_PROMPT
else
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
- Do not use task-list or planning tools such as TodoWrite.
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

Your final assistant response must be the review itself. Do not send a final status-only or housekeeping response after the review.
EOF_PROMPT
fi

codex_out="$feature_dir/$feature_slug-codex-v$round.md"
claude_out="$feature_dir/$feature_slug-claude-v$round.md"
droid_out="$feature_dir/$feature_slug-droid-$droid_model_slug-v$round.md"

run_codex() {
  codex exec \
    --cd "$repo" \
    --sandbox read-only \
    --ephemeral \
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
    --disabled-tools TodoWrite \
    --output-format text \
    -f "$prompt_file" > "$droid_out" 2> "$logs_dir/droid.stderr"
}

echo "multi-review: feature '$feature' -> $feature_dir (round v$round)"
echo "multi-review: mode '$review_mode', droid model '$droid_model'"

if ! preflight; then
  exit 1
fi
if [ "$preflight_only" -eq 1 ]; then
  echo "multi-review: preflight complete"
  exit 0
fi

run_codex &
codex_pid=$!
run_claude &
claude_pid=$!
run_droid &
droid_pid=$!

failed=0

if wait_with_timeout "$codex_pid" codex "$logs_dir/codex.stderr"; then
  echo "codex: $codex_out"
else
  echo "codex: failed; see $logs_dir/codex.stderr" >&2
  failed=1
fi

if wait_with_timeout "$claude_pid" claude "$logs_dir/claude.stderr"; then
  echo "claude: $claude_out"
else
  echo "claude: failed; see $logs_dir/claude.stderr" >&2
  failed=1
fi

if wait_with_timeout "$droid_pid" droid "$logs_dir/droid.stderr"; then
  echo "droid: $droid_out"
else
  echo "droid: failed; see $logs_dir/droid.stderr" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit "$failed"
fi

echo "multi-review: complete"
