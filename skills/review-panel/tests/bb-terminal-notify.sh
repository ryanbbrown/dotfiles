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
if [ "$1 $2" = "terminal create" ]; then
  shift 2
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--command" ]; then
      printf '%s\n' "$2" > "$TERMINAL_COMMAND_FILE"
      shift 2
    else
      shift
    fi
  done
  printf 'Terminal created\n'
  exit 0
fi
if [ "$1 $2" = "thread tell" ]; then
  printf '%s\n' "$@" > "$THREAD_TELL_FILE"
  exit 0
fi
exit 1
EOF
chmod +x "$test_root/bb"

export BB_THREAD_ID="thr_test"
export BB_CLI="$test_root/bb"
export REVIEW_ARGS_FILE="$test_root/review-args"
export TERMINAL_COMMAND_FILE="$test_root/terminal-command"
export THREAD_TELL_FILE="$test_root/thread-tell"

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

[ -s "$TERMINAL_COMMAND_FILE" ] || { echo "missing terminal command" >&2; exit 1; }
BB_THREAD_ID="thr_wrong" BB_TERMINAL_SESSION_ID="term_inner" \
  /bin/bash -lc "$(cat "$TERMINAL_COMMAND_FILE")"

grep -Fxq -- "--feature" "$REVIEW_ARGS_FILE"
grep -Fxq -- "demo feature" "$REVIEW_ARGS_FILE"
grep -Fxq -- "thread" "$THREAD_TELL_FILE"
grep -Fxq -- "thr_test" "$THREAD_TELL_FILE"
grep -Fxq -- "BB terminal 'review-panel-demo' succeeded. Inspect its review files and retained logs." "$THREAD_TELL_FILE"
grep -Fxq -- "queue" "$THREAD_TELL_FILE"

export REVIEW_EXIT=7
set +e
BB_THREAD_ID="thr_wrong" BB_TERMINAL_SESSION_ID="term_inner" \
  /bin/bash -lc "$(cat "$TERMINAL_COMMAND_FILE")"
status=$?
set -e
[ "$status" -eq 7 ] || { echo "review exit status was not preserved" >&2; exit 1; }
grep -Fxq -- "BB terminal 'review-panel-demo' failed with exit status 7. Inspect its review files and retained logs." "$THREAD_TELL_FILE"

echo "review-panel BB terminal notification test passed."
