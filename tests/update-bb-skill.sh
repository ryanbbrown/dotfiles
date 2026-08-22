#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
skill="$repo_root/skills/update-bb/SKILL.md"
policy="$repo_root/skills/update-bb/agents/openai.yaml"
launcher="$repo_root/skills/update-bb/scripts/start-update-bb.sh"
runner="$repo_root/skills/update-bb/scripts/run-update-bb.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/update-bb-skill-test.XXXXXX")"
fake_bin="$test_root/bin"
state="$test_root/state"

cleanup() {
  rm -rf "$test_root"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  grep -F -- "$2" "$1" >/dev/null || fail "$1 does not contain: $2"
}

mkdir -p "$fake_bin" "$state"
trap cleanup EXIT

cat > "$fake_bin/bb" <<'EOF_BB'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1 $2" = "terminal list" ]; then
  if [ "${UPDATE_BB_TEST_EXISTING:-0}" = 1 ]; then
    printf '%s\n' '{"sessions":[{"id":"term_existing","title":"update-bb","status":"running"}]}'
  else
    printf '%s\n' '{"sessions":[]}'
  fi
  exit 0
fi

if [ "$1 $2" = "terminal create" ]; then
  printf '%s\n' "$@" > "$UPDATE_BB_TEST_STATE/create-args"
  printf '%s\n' '{"id":"term_new","title":"update-bb","status":"running"}'
  exit 0
fi

echo "unexpected bb command: $*" >&2
exit 1
EOF_BB

cat > "$fake_bin/sync-bb-personal" <<'EOF_SYNC'
#!/usr/bin/env bash
printf '%s\n' "fake sync output"
exit "${UPDATE_BB_TEST_SYNC_STATUS:-0}"
EOF_SYNC
chmod +x "$fake_bin/bb" "$fake_bin/sync-bb-personal"

[ -f "$skill" ] || fail "missing $skill"
[ -f "$policy" ] || fail "missing $policy"
[ -x "$launcher" ] || fail "launcher is not executable"
[ -x "$runner" ] || fail "runner is not executable"
[ ! -e "$repo_root/skills/sync-bb-personal" ] ||
  fail "the superseded sync-bb-personal skill still exists"

assert_contains "$skill" "name: update-bb"
assert_contains "$skill" "disable-model-invocation: true"
assert_contains "$policy" "allow_implicit_invocation: false"
assert_contains "$skill" '~/.agents/skills/update-bb/scripts/start-update-bb.sh'
assert_contains "$skill" 'bb terminal wait <terminal-id> --exit --timeout 7200'
assert_contains "$skill" 'Do not infer success from an exited terminal alone.'
if grep -F 'managed `process` tool' "$skill" >/dev/null; then
  fail "skill still launches the sync through pi-processes"
fi

PATH="$fake_bin:$PATH" \
  BB_CLI="$fake_bin/bb" \
  BB_THREAD_ID=thr_test \
  BB_THREAD_STORAGE="$test_root/storage" \
  UPDATE_BB_TEST_STATE="$state" \
  "$launcher" > "$test_root/launch-output"

assert_contains "$test_root/launch-output" "state: started"
assert_contains "$test_root/launch-output" "terminal_id: term_new"
assert_contains "$state/create-args" "--thread"
assert_contains "$state/create-args" "thr_test"
assert_contains "$state/create-args" "--title"
assert_contains "$state/create-args" "update-bb"
assert_contains "$state/create-args" "$runner"
assert_contains "$state/create-args" "update-bb.log"
assert_contains "$state/create-args" "outcome.txt"
[ -f "$test_root/storage/update-bb/latest.txt" ] || fail "latest run pointer was not written"

success_log="$test_root/runner-success.log"
success_outcome="$test_root/runner-success.txt"
PATH="$fake_bin:$PATH" "$runner" "$success_log" "$success_outcome" >/dev/null
assert_contains "$success_log" "fake sync output"
assert_contains "$success_outcome" "result: success"
assert_contains "$success_outcome" "exit_status: 0"

failure_log="$test_root/runner-failure.log"
failure_outcome="$test_root/runner-failure.txt"
set +e
PATH="$fake_bin:$PATH" UPDATE_BB_TEST_SYNC_STATUS=7 \
  "$runner" "$failure_log" "$failure_outcome" >/dev/null
failure_status=$?
set -e
[ "$failure_status" -eq 7 ] || fail "runner returned $failure_status, expected 7"
assert_contains "$failure_log" "fake sync output"
assert_contains "$failure_outcome" "result: failure"
assert_contains "$failure_outcome" "exit_status: 7"

rm -f "$state/create-args"
PATH="$fake_bin:$PATH" \
  BB_CLI="$fake_bin/bb" \
  BB_THREAD_ID=thr_test \
  BB_THREAD_STORAGE="$test_root/storage" \
  UPDATE_BB_TEST_STATE="$state" \
  UPDATE_BB_TEST_EXISTING=1 \
  "$launcher" > "$test_root/existing-output"
assert_contains "$test_root/existing-output" "state: already-running"
assert_contains "$test_root/existing-output" "terminal_id: term_existing"
[ ! -e "$state/create-args" ] || fail "launcher created a duplicate terminal"

echo "update-bb skill test passed."
