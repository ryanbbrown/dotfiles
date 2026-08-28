#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/terminal-jobs-integration-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

grep -F 'Use `bb terminal-job` only when' "$repo_root/home/AGENTS.md" >/dev/null ||
  fail "shared instructions do not define when to use Terminal Jobs"
grep -F 'bb terminal-job run' "$repo_root/skills/review-panel/SKILL.md" >/dev/null ||
  fail "review-panel does not use the Terminal Jobs launch path"
[ ! -e "$repo_root/skills/review-panel/scripts/review-round-bb.sh" ] ||
  fail "review-panel still has an obsolete terminal wrapper"

mkdir -p "$test_root/home/.local/bin"
printf '%s\n' "external runner" > "$test_root/home/.local/bin/terminal-job-runner"
HOME="$test_root/home" "$repo_root/scripts/link-home.sh" > "$test_root/link-output"
runner="$test_root/home/.local/bin/terminal-job-runner"
[ ! -L "$runner" ] || fail "link-home still manages the external Terminal Jobs runner"
grep -Fxq "external runner" "$runner" || fail "link-home changed the external Terminal Jobs runner"
[ ! -e "$runner.pre-dotfiles" ] || fail "link-home backed up the external Terminal Jobs runner"
[ -L "$test_root/home/.local/bin/papercut" ] || fail "link-home did not install a managed command"

command -v rg >/dev/null 2>&1 || fail "rg is required for direct-terminal inventory"
direct_terminal_pattern='(^|["[:space:]])bb["[:space:]]+terminal["[:space:]]+create|terminal_'"create"
scan_roots=("$repo_root/bin" "$repo_root/home" "$repo_root/scripts" "$repo_root/skills" "$repo_root/tests")
if rg -n "$direct_terminal_pattern" "${scan_roots[@]}" \
  --glob '*.sh' --glob '*.md' --glob '*.json' --glob '*.yaml' --glob '*.yml' >/dev/null; then
  fail "agent-side direct terminal creation remains in instructions or configured source"
fi
while IFS= read -r executable; do
  if rg -n "$direct_terminal_pattern" "$executable" >/dev/null; then
    fail "agent-side direct terminal creation remains in executable: $executable"
  fi
done < <(find "${scan_roots[@]}" -type f -perm -111 -print)

echo "terminal-jobs dotfiles integration test passed."
