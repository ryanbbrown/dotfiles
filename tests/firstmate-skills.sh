#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
rotate_script="$repo_root/skills/rotate-firstmate/scripts/rotate-firstmate.sh"
stub_bb="$repo_root/tests/fixtures/rotate-firstmate-bb"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/firstmate-skills-test.XXXXXX")"
state="$test_root/state"
old_id=thr_old
new_id=thr_new
child_a=thr_childa
child_b=thr_childb

cleanup() {
  rm -rf "$test_root"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local text="$2"
  grep -F -- "$text" "$file" >/dev/null || fail "$file does not contain: $text"
}

assert_arg_value() {
  local file="$1"
  local flag="$2"
  local expected="$3"
  local line
  local actual

  line="$(grep -nFx -- "$flag" "$file" | cut -d: -f1)"
  [ -n "$line" ] || fail "spawn omitted $flag"
  [ "${line#*$'\n'}" = "$line" ] || fail "spawn repeated $flag"
  actual="$(sed -n "$((line + 1))p" "$file")"
  [ "$actual" = "$expected" ] || fail "$flag was $actual, expected $expected"
}

reset_state() {
  rm -rf "$state"
  mkdir -p "$state"
  printf '%s\n' "$1" > "$state/mode"
  printf '%s\n' true > "$state/old_pinned"
  printf '%s\n' false > "$state/new_pinned"
  printf '%s\n' pi > "$state/old_provider"
  printf '%s\n' "$old_id" > "$state/child_a_parent"
  printf '%s\n' "$old_id" > "$state/child_b_parent"
}

run_rotation() {
  ROTATE_FIRSTMATE_TEST_STATE="$state" \
    BB_CLI="$stub_bb" \
    BB_THREAD_ID="$old_id" \
    BB_PROJECT_ID=proj_current \
    BB_ENVIRONMENT_ID=env_current \
    PI_PROVIDER="${TEST_PI_PROVIDER-openai-codex}" \
    PI_MODEL="${TEST_PI_MODEL-gpt-5.6-sol}" \
    PI_REASONING_LEVEL="${TEST_PI_REASONING_LEVEL-high}" \
    "$rotate_script"
}

trap cleanup EXIT

for skill in update-bb rotate-firstmate; do
  skill_file="$repo_root/skills/$skill/SKILL.md"
  policy_file="$repo_root/skills/$skill/agents/openai.yaml"
  [ -f "$skill_file" ] || fail "missing $skill_file"
  [ -f "$policy_file" ] || fail "missing $policy_file"
  assert_file_contains "$skill_file" "name: $skill"
  assert_file_contains "$skill_file" "disable-model-invocation: true"
  assert_file_contains "$policy_file" "allow_implicit_invocation: false"
done

[ ! -e "$repo_root/skills/sync-bb-personal" ] || fail "the superseded sync-bb-personal skill still exists"
assert_file_contains "$repo_root/skills/rotate-firstmate/SKILL.md" '~/.agents/skills/rotate-firstmate/scripts/rotate-firstmate.sh'

reset_state success
run_rotation > "$test_root/success.out"
assert_file_contains "$test_root/success.out" "Firstmate rotation succeeded."
[ "$(sed -n '1p' "$state/old_pinned")" = false ] || fail "old Firstmate stayed pinned"
[ "$(sed -n '1p' "$state/new_pinned")" = true ] || fail "replacement Firstmate was not pinned"
[ "$(sed -n '1p' "$state/child_a_parent")" = "$new_id" ] || fail "hidden active child was not moved"
[ "$(sed -n '1p' "$state/child_b_parent")" = "$new_id" ] || fail "archived cross-project child was not moved"
assert_arg_value "$state/spawn_args" --project proj_current
assert_arg_value "$state/spawn_args" --environment env_current
assert_arg_value "$state/spawn_args" --provider pi
assert_arg_value "$state/spawn_args" --model openai-codex/gpt-5.6-sol
assert_arg_value "$state/spawn_args" --reasoning-level high
assert_arg_value "$state/spawn_args" --permission-mode full
assert_arg_value "$state/spawn_args" --title Firstmate
assert_file_contains "$state/spawn_args" '.bb/AGENTS.md'
assert_file_contains "$state/spawn_args" 'FIRSTMATE-QUEUE.md'
assert_file_contains "$state/spawn_args" 'clickable Markdown link to the absolute FIRSTMATE-QUEUE.md path'
if grep -Fx -- --parent-thread "$state/spawn_args" >/dev/null || grep -Fx -- --parent-self "$state/spawn_args" >/dev/null; then
  fail "replacement Firstmate was not spawned as a root"
fi

reset_state fail-child-b
if run_rotation > "$test_root/failure.out" 2>&1; then
  fail "rotation succeeded after a child move failed"
fi
assert_file_contains "$test_root/failure.out" "Rollback complete."
[ "$(sed -n '1p' "$state/old_pinned")" = true ] || fail "old Firstmate was not pinned after rollback"
[ "$(sed -n '1p' "$state/new_pinned")" = false ] || fail "replacement Firstmate stayed pinned after rollback"
[ "$(sed -n '1p' "$state/child_a_parent")" = "$old_id" ] || fail "moved child was not returned"
[ "$(sed -n '1p' "$state/child_b_parent")" = "$old_id" ] || fail "failed child changed parent"

reset_state fail-child-b-rollback-a
if run_rotation > "$test_root/incomplete.out" 2>&1; then
  fail "rotation succeeded after an incomplete rollback"
fi
assert_file_contains "$test_root/incomplete.out" "Rollback incomplete."
assert_file_contains "$test_root/incomplete.out" "Old Firstmate: $old_id"
assert_file_contains "$test_root/incomplete.out" "Replacement Firstmate: $new_id"
assert_file_contains "$test_root/incomplete.out" "Child not returned to $old_id: $child_a"
[ "$(sed -n '1p' "$state/new_pinned")" = false ] || fail "incomplete child rollback did not unpin the replacement"

reset_state fail-child-b-replacement-unpin
if run_rotation > "$test_root/unpin-incomplete.out" 2>&1; then
  fail "rotation succeeded after replacement unpin failed"
fi
assert_file_contains "$test_root/unpin-incomplete.out" "Rollback incomplete."
assert_file_contains "$test_root/unpin-incomplete.out" "Replacement Firstmate: $new_id"
assert_file_contains "$test_root/unpin-incomplete.out" "Replacement Firstmate unpin could not be verified: $new_id"
[ "$(sed -n '1p' "$state/child_a_parent")" = "$old_id" ] || fail "child was not returned when replacement unpin failed"

reset_state success
if TEST_PI_MODEL='bad model' run_rotation > "$test_root/malformed-model.out" 2>&1; then
  fail "rotation accepted a malformed PI_MODEL"
fi
assert_file_contains "$test_root/malformed-model.out" "PI_MODEL is missing or malformed"
[ ! -e "$state/spawn_calls" ] || fail "rotation spawned a thread before model validation completed"

reset_state success
if TEST_PI_PROVIDER='' run_rotation > "$test_root/missing-provider.out" 2>&1; then
  fail "rotation accepted a missing PI_PROVIDER"
fi
assert_file_contains "$test_root/missing-provider.out" "PI_PROVIDER is missing or malformed"
[ ! -e "$state/spawn_calls" ] || fail "rotation spawned a thread before route provider validation completed"

reset_state success
if TEST_PI_REASONING_LEVEL=none run_rotation > "$test_root/malformed-reasoning.out" 2>&1; then
  fail "rotation accepted a malformed PI_REASONING_LEVEL"
fi
assert_file_contains "$test_root/malformed-reasoning.out" "PI_REASONING_LEVEL is missing or malformed"
[ ! -e "$state/spawn_calls" ] || fail "rotation spawned a thread before reasoning validation completed"

reset_state success
printf '%s\n' 'bad provider' > "$state/old_provider"
if run_rotation > "$test_root/malformed-bb-provider.out" 2>&1; then
  fail "rotation accepted a malformed BB provider"
fi
assert_file_contains "$test_root/malformed-bb-provider.out" "current Firstmate provider is missing or malformed"
[ ! -e "$state/spawn_calls" ] || fail "rotation spawned a thread before BB provider validation completed"

printf '%s\n' "Firstmate skill tests passed."
