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
  local notify_thread="$1"
  local bb_cli="$2"
  local terminal_title="$3"
  shift 3
  [ "${1:-}" = "--" ] || usage
  shift

  notify_on_exit() {
    local status=$?
    local outcome="succeeded"
    trap - EXIT
    [ "$status" -eq 0 ] || outcome="failed with exit status $status"
    if ! "$bb_cli" thread tell "$notify_thread" \
      "BB terminal '$terminal_title' $outcome. Inspect its review files and retained logs." \
      --mode queue; then
      echo "warning: could not notify BB thread $notify_thread" >&2
    fi
    exit "$status"
  }

  trap notify_on_exit EXIT
  "$review_script" "$@"
}

quote_command() {
  local command=""
  local argument
  local quoted
  for argument in "$@"; do
    printf -v quoted '%q' "$argument"
    command+="${command:+ }$quoted"
  done
  printf '%s\n' "$command"
}

if [ "${1:-}" = "--run" ]; then
  [ "$#" -ge 5 ] || usage
  notify_thread="$2"
  bb_cli="$3"
  terminal_title="$4"
  shift 4
  run_review "$notify_thread" "$bb_cli" "$terminal_title" "$@"
  exit $?
fi

[ "${1:-}" = "--title" ] || usage
[ -n "${2:-}" ] || usage
terminal_title="$2"
shift 2
[ "${1:-}" = "--" ] || usage
shift
[ "$#" -gt 0 ] || usage

thread_id="${BB_THREAD_ID:-}"
bb_cli="${BB_CLI:-$(command -v bb || true)}"
[ -n "$thread_id" ] || { echo "error: BB_THREAD_ID is required" >&2; exit 1; }
[ -n "$bb_cli" ] || { echo "error: bb CLI is required" >&2; exit 1; }
[ -x "$review_script" ] || { echo "error: review script is not executable: $review_script" >&2; exit 1; }

terminal_command="$(quote_command \
  "$script_dir/review-round-bb.sh" \
  --run "$thread_id" "$bb_cli" "$terminal_title" -- "$@")"

"$bb_cli" terminal create \
  --thread "$thread_id" \
  --title "$terminal_title" \
  --command "$terminal_command"
