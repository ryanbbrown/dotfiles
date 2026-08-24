#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

source_repo="$fixture_root/source"
source_remote="$fixture_root/source.git"
test_repo="$fixture_root/dotfiles"
test_remote="$fixture_root/dotfiles.git"
trace_file="$fixture_root/git-trace.json"

git init --bare -q "$source_remote"
git init -q -b main "$source_repo"
git -C "$source_repo" config user.name Test
git -C "$source_repo" config user.email test@example.com
printf 'one\n' >"$source_repo/SKILL.md"
git -C "$source_repo" add SKILL.md
git -C "$source_repo" commit -qm "first source revision"
git -C "$source_repo" remote add origin "$source_remote"
git -C "$source_repo" push -q -u origin main

git init --bare -q "$test_remote"
git init -q -b main "$test_repo"
git -C "$test_repo" config user.name Test
git -C "$test_repo" config user.email test@example.com
mkdir -p "$test_repo/scripts" "$test_repo/vendor"
cp "$repo_root/scripts/update-skill-sources.sh" "$test_repo/scripts/"
GIT_ALLOW_PROTOCOL=file git -C "$test_repo" submodule add -q "$source_remote" vendor/agent-browser
git -C "$test_repo" add .gitmodules scripts/update-skill-sources.sh vendor/agent-browser
git -C "$test_repo" commit -qm "initial fixture"
git -C "$test_repo" remote add origin "$test_remote"
git -C "$test_repo" push -q -u origin main

printf 'two\n' >"$source_repo/SKILL.md"
git -C "$source_repo" add SKILL.md
git -C "$source_repo" commit -qm "second source revision"
git -C "$source_repo" push -q

GIT_ALLOW_PROTOCOL=file GIT_TRACE2_EVENT="$trace_file" \
  "$test_repo/scripts/update-skill-sources.sh" --push >/dev/null

test "$(git -C "$test_repo" rev-parse HEAD)" = "$(git --git-dir="$test_remote" rev-parse refs/heads/main)"
test "$(git -C "$test_repo" log -1 --format=%s)" = "chore: update skill sources"

node - "$trace_file" <<'NODE'
const fs = require("fs");

const events = fs.readFileSync(process.argv[2], "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const expectedArguments = [
  "-c",
  "credential.https://github.com.helper=",
  "-c",
  "credential.https://github.com.helper=osxkeychain",
  "push",
];
const matched = events.some((event) =>
  Array.isArray(event.argv) &&
  event.argv[0].endsWith("/git") &&
  expectedArguments.every((value, index) => event.argv[index + 1] === value)
);

if (!matched) {
  const pushEvents = events
    .filter((event) => Array.isArray(event.argv) && event.argv.includes("push"))
    .map((event) => event.argv);
  throw new Error(`scheduled push did not select the macOS Keychain helper: ${JSON.stringify(pushEvents)}`);
}
NODE

echo "update-skill-sources test passed."
