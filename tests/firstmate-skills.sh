#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rotate_script="$repo_root/skills/rotate-firstmate/scripts/rotate-firstmate.sh"
stub_bb="$repo_root/tests/fixtures/rotate-firstmate-bb"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/firstmate-skills-test.XXXXXX")"

cleanup() {
  rm -f "$test_root/state/"* "$test_root/"*.out
  rmdir "$test_root/state" "$test_root"
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

reset_state() {
  mkdir -p "$test_root/state"
  printf '%s\n' "$1" > "$test_root/state/mode"
  printf '%s\n' true > "$test_root/state/old_pinned"
  printf '%s\n' false > "$test_root/state/new_pinned"
  printf '%s\n' old > "$test_root/state/child-a_parent"
  printf '%s\n' old > "$test_root/state/child-b_parent"
}

run_rotation() {
  ROTATE_FIRSTMATE_TEST_STATE="$test_root/state" \
    BB_CLI="$stub_bb" \
    BB_THREAD_ID=old \
    BB_PROJECT_ID=project \
    BB_ENVIRONMENT_ID=environment \
    "$rotate_script"
}

trap cleanup EXIT

for skill in sync-bb-personal rotate-firstmate; do
  skill_file="$repo_root/skills/$skill/SKILL.md"
  policy_file="$repo_root/skills/$skill/agents/openai.yaml"
  [ -f "$skill_file" ] || fail "missing $skill_file"
  [ -f "$policy_file" ] || fail "missing $policy_file"
  assert_file_contains "$skill_file" "name: $skill"
  assert_file_contains "$skill_file" "disable-model-invocation: true"
  assert_file_contains "$policy_file" "allow_implicit_invocation: false"
done

assert_file_contains "$repo_root/skills/sync-bb-personal/SKILL.md" 'sync-bb-personal'
assert_file_contains "$repo_root/skills/rotate-firstmate/SKILL.md" '~/.agents/skills/rotate-firstmate/scripts/rotate-firstmate.sh'
if grep -F 'thread list --project' "$rotate_script" >/dev/null; then
  fail "rotation limits child discovery to the Firstmate project"
fi

reset_state success
run_rotation > "$test_root/success.out"
assert_file_contains "$test_root/success.out" "Firstmate rotation succeeded."
[ "$(sed -n '1p' "$test_root/state/old_pinned")" = false ] || fail "old Firstmate stayed pinned"
[ "$(sed -n '1p' "$test_root/state/new_pinned")" = true ] || fail "new Firstmate was not pinned"
[ "$(sed -n '1p' "$test_root/state/child-a_parent")" = new ] || fail "active child was not moved"
[ "$(sed -n '1p' "$test_root/state/child-b_parent")" = new ] || fail "archived child was not moved"

rm -f "$test_root/state/"*
reset_state fail-child-b
if run_rotation > "$test_root/failure.out" 2>&1; then
  fail "rotation succeeded after a child move failed"
fi
assert_file_contains "$test_root/failure.out" "Rollback complete."
[ "$(sed -n '1p' "$test_root/state/old_pinned")" = true ] || fail "old Firstmate was unpinned after rollback"
[ "$(sed -n '1p' "$test_root/state/new_pinned")" = false ] || fail "new Firstmate stayed pinned after rollback"
[ "$(sed -n '1p' "$test_root/state/child-a_parent")" = old ] || fail "moved child was not returned"
[ "$(sed -n '1p' "$test_root/state/child-b_parent")" = old ] || fail "failed child changed parent"

echo "Firstmate skill tests passed."
