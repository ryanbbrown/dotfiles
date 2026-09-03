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
child_c=thr_childc

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

assert_file_lacks() {
  local file="$1"
  local text="$2"
  ! grep -F -- "$text" "$file" >/dev/null || fail "$file unexpectedly contains: $text"
}

arg_value() {
  local file="$1"
  local flag="$2"
  local line

  line="$(grep -nFx -- "$flag" "$file" | cut -d: -f1)"
  [ -n "$line" ] || fail "spawn omitted $flag"
  [ "${line#*$'\n'}" = "$line" ] || fail "spawn repeated $flag"
  sed -n "$((line + 1))p" "$file"
}

assert_arg_value() {
  local actual
  actual="$(arg_value "$1" "$2")"
  [ "$actual" = "$3" ] || fail "$2 was $actual, expected $3"
}

assert_no_arg() {
  ! grep -Fx -- "$2" "$1" >/dev/null || fail "spawn unexpectedly included $2"
}

reset_state() {
  local mode="$1"
  local pinned="$2"
  local parent="$3"
  local workspace="$4"

  rm -rf "$state" "$workspace"
  mkdir -p "$state" "$workspace"
  printf '%s\n' "$mode" > "$state/mode"
  printf '%s\n' "$pinned" > "$state/old_pinned"
  printf '%s\n' false > "$state/new_pinned"
  printf '%s\n' 'Deck Captain' > "$state/old_title"
  printf '%s\n' proj_current > "$state/old_project"
  printf '%s\n' env_current > "$state/old_environment"
  printf '%s\n' pi > "$state/old_provider"
  printf '%s\n' "$parent" > "$state/old_parent"
  printf '%s\n' sec_review > "$state/old_section"
  printf '%s\n' hidden > "$state/old_visibility"
  printf '%s\n' "$workspace" > "$state/workspace_path"
  printf '%s\n' anthropic/claude-test > "$state/old_model"
  printf '%s\n' medium > "$state/old_reasoning"
  printf '%s\n' auto > "$state/old_permission"
  printf '%s\n' default > "$state/old_tier"
  printf '%s\n' "$old_id" > "$state/child_a_parent"
  printf '%s\n' "$old_id" > "$state/child_b_parent"
  printf '%s\n' "$old_id" > "$state/child_c_parent"
  : > "$state/pin_calls"
  : > "$state/unpin_calls"
  printf '%s\n' "$old_id" > "$state/manager_thread"
  printf '%s\n' false > "$state/manager_writes"
  : > "$state/queue_send_calls"
}

run_rotation() {
  ROTATE_FIRSTMATE_TEST_STATE="$state" \
    BB_CLI="$stub_bb" \
    BB_THREAD_ID="$old_id" \
    "$rotate_script"
}

trap cleanup EXIT

for skill in update-bb rotate-firstmate firstmate-queue; do
  skill_file="$repo_root/skills/$skill/SKILL.md"
  [ -f "$skill_file" ] || fail "missing $skill_file"
  assert_file_contains "$skill_file" "name: $skill"
  assert_file_contains "$skill_file" "disable-model-invocation: true"
done

for skill in update-bb rotate-firstmate; do
  policy_file="$repo_root/skills/$skill/agents/openai.yaml"
  [ -f "$policy_file" ] || fail "missing $policy_file"
  assert_file_contains "$policy_file" "allow_implicit_invocation: false"
done

[ ! -e "$repo_root/skills/sync-bb-personal" ] || fail "the superseded sync-bb-personal skill still exists"
assert_file_contains "$repo_root/skills/rotate-firstmate/SKILL.md" '~/.agents/skills/rotate-firstmate/scripts/rotate-firstmate.sh'
assert_file_contains "$repo_root/skills/rotate-firstmate/SKILL.md" '`firstmate-queue` skill'
[ ! -e "$repo_root/skills/firstmate" ] || fail "the superseded firstmate skill still exists"
assert_file_contains "$repo_root/home/.config/git/ignore" 'FIRSTMATE-QUEUE.md'

git_test="$test_root/git-ignore"
mkdir -p "$git_test"
git -C "$git_test" init -q
touch "$git_test/FIRSTMATE-QUEUE.md"
git -C "$git_test" -c core.excludesFile="$repo_root/home/.config/git/ignore" check-ignore -q FIRSTMATE-QUEUE.md ||
  fail "global excludes file did not ignore FIRSTMATE-QUEUE.md"

local_workspace="$test_root/local workspace"
reset_state success true null "$local_workspace"
run_rotation > "$test_root/pinned-root.out"
assert_file_contains "$test_root/pinned-root.out" "Firstmate rotation succeeded."
assert_file_contains "$test_root/pinned-root.out" "Transferred unarchived direct children: 2"
[ "$(<"$state/old_pinned")" = false ] || fail "old pinned root stayed pinned"
[ "$(<"$state/new_pinned")" = true ] || fail "replacement of pinned root was not pinned"
[ "$(<"$state/child_a_parent")" = "$new_id" ] || fail "hidden unarchived child was not moved"
[ "$(<"$state/child_b_parent")" = "$old_id" ] || fail "archived cross-project child changed parent"
[ "$(<"$state/child_c_parent")" = "$new_id" ] || fail "unarchived child was not moved"
assert_arg_value "$state/spawn_args" --project proj_current
assert_arg_value "$state/spawn_args" --environment env_current
assert_arg_value "$state/spawn_args" --provider pi
assert_arg_value "$state/spawn_args" --model anthropic/claude-test
assert_arg_value "$state/spawn_args" --reasoning-level medium
assert_arg_value "$state/spawn_args" --permission-mode auto
assert_arg_value "$state/spawn_args" --service-tier default
assert_arg_value "$state/spawn_args" --title 'Deck Captain'
assert_arg_value "$state/spawn_args" --section sec_review
assert_arg_value "$state/spawn_args" --visibility hidden
assert_no_arg "$state/spawn_args" --parent-thread
assert_file_contains "$state/spawn_prompt" 'installed `firstmate-queue` skill'
assert_file_contains "$state/spawn_prompt" '~/.agents/skills/firstmate-queue/SKILL.md'
assert_file_lacks "$state/spawn_prompt" 'FIRSTMATE-QUEUE.md'
assert_file_lacks "$state/spawn_prompt" '.bb/AGENTS.md'
[ "$(<"$state/pin_calls")" = "$new_id" ] || fail "pinned rotation did not pin only the replacement"
[ "$(<"$state/unpin_calls")" = "$old_id" ] || fail "pinned rotation did not unpin only the old thread"
assert_arg_value "$state/spawn_args" --send-at 1h
[ "$(<"$state/manager_thread")" = "$new_id" ] || fail "replacement was not bound as the Firstmate Queue manager"
[ "$(<"$state/manager_writes")" = true ] || fail "Firstmate Queue agent writes were not enabled"
[ "$(<"$state/queue_send_calls")" = "$new_id qmsg_first" ] || fail "the replacement's first message was not sent"

dynamic_workspace="$test_root/dynamic workspace"
reset_state success false null "$dynamic_workspace"
printf '%s\n' null > "$state/old_section"
printf '%s\n' visible > "$state/old_visibility"
printf '%s\n' '' > "$state/manager_thread"
run_rotation > "$test_root/unpinned-root.out"
[ "$(<"$state/manager_thread")" = "$new_id" ] || fail "replacement was not bound when no manager was configured"
[ "$(<"$state/old_pinned")" = false ] || fail "unpinned old root became pinned"
[ "$(<"$state/new_pinned")" = false ] || fail "unpinned replacement became pinned"
[ ! -s "$state/pin_calls" ] || fail "unpinned rotation called pin"
[ ! -s "$state/unpin_calls" ] || fail "unpinned rotation called unpin"
assert_no_arg "$state/spawn_args" --parent-thread
assert_no_arg "$state/spawn_args" --section
assert_file_contains "$state/spawn_prompt" 'installed `firstmate-queue` skill'
assert_file_lacks "$state/spawn_prompt" "$dynamic_workspace"

parented_workspace="$test_root/parented"
reset_state success false thr_parent "$parented_workspace"
printf '%s\n' 'Child Firstmate' > "$state/old_title"
run_rotation > "$test_root/parented.out"
assert_arg_value "$state/spawn_args" --parent-thread thr_parent
assert_arg_value "$state/spawn_args" --title 'Child Firstmate'

rollback_workspace="$test_root/rollback"
reset_state fail-child-c true null "$rollback_workspace"
if run_rotation > "$test_root/rollback.out" 2>&1; then
  fail "rotation succeeded after a child move failed"
fi
assert_file_contains "$test_root/rollback.out" "Rollback complete."
[ "$(<"$state/old_pinned")" = true ] || fail "rollback did not restore old pin"
[ "$(<"$state/new_pinned")" = false ] || fail "rollback left replacement pinned"
[ "$(<"$state/child_a_parent")" = "$old_id" ] || fail "rollback did not return moved child"
[ "$(<"$state/child_b_parent")" = "$old_id" ] || fail "rollback changed archived child"
[ "$(<"$state/child_c_parent")" = "$old_id" ] || fail "failed child changed parent"
[ "$(<"$state/manager_thread")" = "$old_id" ] || fail "rollback did not restore the Firstmate Queue manager"
[ "$(<"$state/manager_writes")" = false ] || fail "rollback did not restore Firstmate Queue agent writes"

reset_state fail-child-c false null "$rollback_workspace"
printf '%s\n' '' > "$state/manager_thread"
if run_rotation > "$test_root/unpinned-rollback.out" 2>&1; then
  fail "unpinned rotation succeeded after a child move failed"
fi
[ -z "$(<"$state/manager_thread")" ] || fail "rollback did not unset the Firstmate Queue manager"
[ "$(<"$state/old_pinned")" = false ] || fail "unpinned rollback pinned the old thread"
[ "$(<"$state/new_pinned")" = false ] || fail "unpinned rollback pinned the replacement"
[ ! -s "$state/pin_calls" ] || fail "unpinned rollback called pin"
[ ! -s "$state/unpin_calls" ] || fail "unpinned rollback called unpin"

reset_state fail-child-c-rollback-a true null "$rollback_workspace"
if run_rotation > "$test_root/incomplete.out" 2>&1; then
  fail "rotation succeeded after an incomplete rollback"
fi
assert_file_contains "$test_root/incomplete.out" "Rollback incomplete."
assert_file_contains "$test_root/incomplete.out" "Old thread: $old_id"
assert_file_contains "$test_root/incomplete.out" "Replacement thread: $new_id"
assert_file_contains "$test_root/incomplete.out" "Child not returned to $old_id: $child_a"

printf '%s\n' "Firstmate skill tests passed."
