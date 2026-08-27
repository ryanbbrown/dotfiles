#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/review-panel-bb-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

scripts="$test_root/scripts"
mkdir -p "$scripts"
cp "$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)/review-round-bb.sh" "$scripts/"
chmod +x "$scripts/review-round-bb.sh"

cat > "$scripts/review-round.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$REVIEW_ARGS_FILE"
exit "${REVIEW_EXIT:-0}"
EOF
chmod +x "$scripts/review-round.sh"

cat > "$test_root/bb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1 $2" >> "$BB_CALLS_FILE"
if [ "$1 $2" = "terminal-job run" ]; then
  printf '%s\n' "$@" > "$TERMINAL_JOB_ARGS_FILE"
  shift 2
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
  [ "${1:-}" = "--" ] || exit 2
  shift
  printf '%q ' "$@" > "$TERMINAL_COMMAND_FILE"
  printf '\n' >> "$TERMINAL_COMMAND_FILE"
  printf '%s\n' '{"jobId":"job_review","terminal":{"id":"term_review"}}'
  exit 0
fi
echo "unexpected bb command: $*" >&2
exit 1
EOF
chmod +x "$test_root/bb"

export BB_THREAD_ID="thr_test"
export BB_THREAD_STORAGE="$test_root/thread-storage"
export BB_CLI="$test_root/bb"
export REVIEW_ARGS_FILE="$test_root/review-args"
export TERMINAL_JOB_ARGS_FILE="$test_root/terminal-job-args"
export TERMINAL_COMMAND_FILE="$test_root/terminal-command"
export BB_CALLS_FILE="$test_root/bb-calls"

export BB_TERMINAL_SESSION_ID="term_outer"
set +e
"$scripts/review-round-bb.sh" --title "review-panel-demo" -- \
  --feature "demo feature" --mode plan --target-file .plans/demo.md \
  >"$test_root/nested.out" 2>"$test_root/nested.err"
status=$?
set -e
[ "$status" -eq 1 ] || { echo "nested terminal launch was not rejected" >&2; exit 1; }
grep -Fxq -- \
  "error: invoke review-round-bb.sh directly from the owning thread; it creates its own BB terminal" \
  "$test_root/nested.err"
[ ! -e "$TERMINAL_COMMAND_FILE" ] || { echo "nested launch created a terminal" >&2; exit 1; }
unset BB_TERMINAL_SESSION_ID

"$scripts/review-round-bb.sh" --title "review-panel-demo" -- \
  --feature "demo feature" --mode plan --target-file .plans/demo.md >/dev/null

grep -Fxq -- "terminal-job" "$TERMINAL_JOB_ARGS_FILE"
grep -Fxq -- "run" "$TERMINAL_JOB_ARGS_FILE"
grep -Fxq -- "--notify-thread" "$TERMINAL_JOB_ARGS_FILE"
grep -Fxq -- "thr_test" "$TERMINAL_JOB_ARGS_FILE"
grep -Fxq -- "$BB_THREAD_STORAGE/review-panel-terminal-jobs" "$TERMINAL_JOB_ARGS_FILE"
if grep -Fqx -- "terminal" "$TERMINAL_JOB_ARGS_FILE"; then
  echo "raw terminal command escaped the wrapper" >&2
  exit 1
fi
[ -s "$TERMINAL_COMMAND_FILE" ] || { echo "missing terminal command" >&2; exit 1; }
BB_THREAD_ID="thr_wrong" BB_TERMINAL_SESSION_ID="term_inner" \
  /bin/bash -lc "$(cat "$TERMINAL_COMMAND_FILE")"

grep -Fxq -- "--feature" "$REVIEW_ARGS_FILE"
grep -Fxq -- "demo feature" "$REVIEW_ARGS_FILE"
[ "$(grep -Fxc 'terminal-job run' "$BB_CALLS_FILE")" -eq 1 ] || {
  echo "expected one terminal-job completion path" >&2
  exit 1
}
if grep -Fq 'thread tell' "$BB_CALLS_FILE"; then
  echo "wrapper sent a duplicate completion" >&2
  exit 1
fi

export REVIEW_EXIT=7
set +e
BB_THREAD_ID="thr_wrong" BB_TERMINAL_SESSION_ID="term_inner" \
  /bin/bash -lc "$(cat "$TERMINAL_COMMAND_FILE")"
status=$?
set -e
[ "$status" -eq 7 ] || { echo "review exit status was not preserved" >&2; exit 1; }
if grep -Fq 'thread tell' "$BB_CALLS_FILE"; then
  echo "wrapper sent a duplicate failure completion" >&2
  exit 1
fi

echo "review-panel single terminal-job completion test passed."
