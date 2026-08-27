#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
review_script="$script_dir/review-round.sh"

usage() {
  cat >&2 <<'EOF'
Usage:
  review-round-bb.sh --title TITLE -- [review-round.sh arguments]
EOF
  exit 2
}

run_review() {
  [ "${1:-}" = "--" ] || usage
  shift

  "$review_script" "$@"
}

if [ "${1:-}" = "--run" ]; then
  shift
  run_review "$@"
  exit $?
fi

if [ -n "${BB_TERMINAL_SESSION_ID:-}" ]; then
  echo "error: invoke review-round-bb.sh directly from the owning thread; it creates its own BB terminal" >&2
  exit 1
fi

[ "${1:-}" = "--title" ] || usage
[ -n "${2:-}" ] || usage
terminal_title="$2"
shift 2
[ "${1:-}" = "--" ] || usage
shift
[ "$#" -gt 0 ] || usage

thread_id="${BB_THREAD_ID:-}"
thread_storage="${BB_THREAD_STORAGE:-}"
bb_cli="${BB_CLI:-$(command -v bb || true)}"
[ -n "$thread_id" ] || { echo "error: BB_THREAD_ID is required" >&2; exit 1; }
[ -n "$thread_storage" ] || { echo "error: BB_THREAD_STORAGE is required" >&2; exit 1; }
[ -n "$bb_cli" ] || { echo "error: bb CLI is required" >&2; exit 1; }
[ -x "$review_script" ] || { echo "error: review script is not executable: $review_script" >&2; exit 1; }

"$bb_cli" terminal-job run \
  --title "$terminal_title" \
  --thread "$thread_id" \
  --notify-thread "$thread_id" \
  --artifact-root "$thread_storage/review-panel-terminal-jobs" \
  --delivery queue \
  --json \
  -- \
  "$script_dir/review-round-bb.sh" \
  --run -- "$@"
