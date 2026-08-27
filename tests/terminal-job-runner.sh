#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
runner="$repo_root/bin/terminal-job-runner"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/terminal-job-runner-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ -x "$runner" ] || fail "runner is not executable"
grep -F '[ -x "$repo_root/bin/terminal-job-runner" ]' "$repo_root/scripts/link-home.sh" >/dev/null ||
  fail "link-home has no runner executable guard"
grep -F '[ -f "$repo_root/bin/terminal-job-schema.cjs" ]' "$repo_root/scripts/link-home.sh" >/dev/null ||
  fail "link-home has no runner schema guard"
grep -F 'When `bb terminal-job` is installed' "$repo_root/home/AGENTS.md" >/dev/null ||
  fail "shared instructions do not make the durable-command rule conditional"
grep -F 'every agent-started command that can outlive its tool call' "$repo_root/home/AGENTS.md" >/dev/null ||
  fail "shared instructions do not require terminal jobs"
skill="$repo_root/plugins/terminal-jobs/skills/terminal-jobs/SKILL.md"
for required in 'finite command' 'server or watcher' 'terminal-job watch' 'terminal-job show' 'retry-notification'; do
  grep -F "$required" "$skill" >/dev/null || fail "terminal-jobs skill is missing: $required"
done
grep -F 'bb terminal-job run' "$repo_root/skills/review-panel/SKILL.md" >/dev/null ||
  fail "review-panel does not use the terminal-jobs launch path"
[ ! -e "$repo_root/skills/review-panel/scripts/review-round-bb.sh" ] ||
  fail "review-panel still has an obsolete terminal wrapper"

mkdir -p "$test_root/home/.local/bin"
printf '%s\n' "existing runner" > "$test_root/home/.local/bin/terminal-job-runner"
HOME="$test_root/home" "$repo_root/scripts/link-home.sh" > "$test_root/link-output"

link="$test_root/home/.local/bin/terminal-job-runner"
[ -L "$link" ] || fail "runner link was not created"
[ "$(readlink "$link")" = "$runner" ] || fail "runner link has the wrong target"
grep -Fxq "existing runner" "$link.pre-dotfiles" || fail "existing runner was not backed up"

artifact_root="$test_root/artifacts"
set +e
BB_TERMINAL_SESSION_ID=term_shell "$link" \
  --job-id job_shell \
  --owner-thread thr_owner \
  --artifact-root "$artifact_root" \
  -- /bin/sh -c 'printf first; printf second >&2; exit 3' \
  > "$test_root/stdout"
status=$?
set -e
[ "$status" -eq 3 ] || fail "runner returned $status, expected 3"
printf 'firstsecond' > "$test_root/expected"
cmp "$test_root/expected" "$test_root/stdout"
cmp "$test_root/expected" "$artifact_root/job_shell/output.log"
node -e '
const fs = require("node:fs");
const outcome = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (outcome.jobId !== "job_shell" || outcome.terminalId !== "term_shell") process.exit(1);
if (outcome.result !== "failure" || outcome.commandExitCode !== 3 || outcome.status !== 3) process.exit(1);
' "$artifact_root/job_shell/outcome.json" || fail "runner outcome is wrong"

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

count="$(rg -l 'sdk\.terminals\.create' "$repo_root/plugins" \
  --glob '!terminal-jobs/node_modules/**' --glob '*.ts' | wc -l | tr -d ' ')"
[ "$count" -eq 1 ] || fail "expected only terminal-jobs to call sdk.terminals.create"

echo "terminal-job runner and link test passed."
