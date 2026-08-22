#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
skill="$repo_root/skills/update-bb/SKILL.md"
policy="$repo_root/skills/update-bb/agents/openai.yaml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  grep -F -- "$2" "$1" >/dev/null || fail "$1 does not contain: $2"
}

[ -f "$skill" ] || fail "missing $skill"
[ -f "$policy" ] || fail "missing $policy"
[ ! -e "$repo_root/skills/sync-bb-personal" ] ||
  fail "the superseded sync-bb-personal skill still exists"

assert_contains "$skill" "name: update-bb"
assert_contains "$skill" "disable-model-invocation: true"
assert_contains "$policy" "allow_implicit_invocation: false"
assert_contains "$skill" 'action: "list"'
assert_contains "$skill" 'statuses: ["running"]'
assert_contains "$skill" 'name: "update-bb"'
assert_contains "$skill" 'action: "start"'
assert_contains "$skill" 'command: "sync-bb-personal"'
assert_contains "$skill" 'notify.onSuccess: "turn"'
assert_contains "$skill" 'notify.onFailure: "turn"'
assert_contains "$skill" 'Return as soon as the process starts.'
assert_contains "$skill" 'do not wait, poll, or read output while it runs.'
assert_contains "$skill" 'read the managed process output once'

# The test checks instructions only. It does not invoke the sync command.
echo "update-bb skill test passed."
