#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
skill="$repo_root/skills/review-panel/SKILL.md"
review_script="$repo_root/skills/review-panel/scripts/review-round.sh"
removed_wrapper="$repo_root/skills/review-panel/scripts/review-round-bb.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/review-panel-launch-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  grep -F -- "$2" "$1" >/dev/null || fail "$1 does not contain: $2"
}

[ -f "$skill" ] || fail "missing $skill"
[ -x "$review_script" ] || fail "review script is not executable"
[ ! -e "$removed_wrapper" ] || fail "obsolete BB wrapper still exists"

assert_contains "$skill" 'bb terminal-job run'
assert_contains "$skill" '--thread "$BB_THREAD_ID"'
assert_contains "$skill" '--notify-thread "$BB_THREAD_ID"'
assert_contains "$skill" '--artifact-root "$BB_THREAD_STORAGE/terminal-jobs"'
assert_contains "$skill" '~/.claude/skills/review-panel/scripts/review-round.sh'
assert_contains "$skill" 'Launch exactly once'
assert_contains "$skill" 'Direct local use'

if grep -F 'review-round-bb.sh' "$skill" >/dev/null; then
  fail "skill still names the removed wrapper"
fi
if grep -F 'another terminal job' "$skill" >/dev/null; then
  fail "skill still documents the obsolete nested-launch path"
fi
[ "$(grep -Fxc 'bb terminal-job run \' "$skill")" -eq 1 ] ||
  fail "skill must define one durable review launch command"

"$review_script" --help >"$test_root/help.out"
grep -Fq 'Usage: review-round.sh' "$test_root/help.out" ||
  fail "direct review command did not return its help"

echo "review-panel launch contract test passed."
