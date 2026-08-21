#!/usr/bin/env bash
set -euo pipefail

# Every test builds its own throwaway repositories. Nothing here reads or
# changes the real bb checkout, and no test starts a real model call.

script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/bin/sync-bb-personal"
[ -x "$script" ] || { echo "missing executable $script" >&2; exit 1; }

test_root="$(mktemp -d "${TMPDIR:-/tmp}/sync-bb-personal-test.XXXXXX")"
cleanup() {
  rm -rf -- "$test_root"
}
trap cleanup EXIT

fail() {
  echo "assertion failed: $*" >&2
  exit 1
}

assert_eq() {
  [ "$2" = "$3" ] || fail "$1: expected '$3', got '$2'"
}

assert_ne() {
  [ "$2" != "$3" ] || fail "$1: expected a value other than '$3'"
}

assert_contains() {
  case "$2" in
    *"$3"*) ;;
    *) fail "$1: '$3' is missing from: $2" ;;
  esac
}

assert_missing() {
  case "$2" in
    *"$3"*) fail "$1: '$3' should not appear in: $2" ;;
  esac
}

write_file() {
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" > "$1"
}

protocol_file() {
  printf 'export type Envelope = {\n  id: string;\n};\n\nexport const HOST_DAEMON_PROTOCOL_VERSION = %s as const;\n' "$1"
}

dispatch_file() {
  printf 'export function dispatch(command: string) {\n  return command%s;\n}\n' "$1"
}

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

new_fixture() {
  fixture="$test_root/$1"
  upstream_bare="$fixture/upstream.git"
  origin_bare="$fixture/origin.git"
  repo="$fixture/repo"
  personal="$fixture/personal"
  upstream_work="$fixture/upstream-work"
  stub_bin="$fixture/bin"
  pnpm_log="$fixture/pnpm.log"
  claude_log="$fixture/claude.log"
  claude_prompt="$fixture/claude-prompt.txt"
  run_tmp="$fixture/tmp"
  stdout_file="$fixture/stdout.txt"
  stderr_file="$fixture/stderr.txt"

  # Isolate Git configuration so nothing in the developer's environment can
  # supply the rerere settings that the tool is supposed to supply itself.
  export GIT_CONFIG_GLOBAL="$fixture/gitconfig"
  export GIT_CONFIG_SYSTEM=/dev/null

  mkdir -p "$fixture" "$stub_bin" "$run_tmp"
  printf '[user]\n\tname = sync test\n\temail = sync-test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n' \
    > "$GIT_CONFIG_GLOBAL"
  : > "$pnpm_log"
  : > "$claude_log"

  install_stubs

  git init -q --bare "$upstream_bare"
  git init -q --bare "$origin_bare"

  local seed="$fixture/seed"
  git init -q -b main "$seed"
  write_file "$seed/package.json" '{"name":"bb","private":true}'
  write_file "$seed/packages/host-daemon-contract/package.json" '{"name":"@bb/host-daemon-contract"}'
  write_file "$seed/packages/host-daemon-contract/src/protocol.ts" "$(protocol_file 100)"
  write_file "$seed/packages/host-daemon-contract/src/commands.ts" \
    'export const commands = {
  listThreads: "listThreads",
};'
  write_file "$seed/packages/host-daemon-contract/test/contract.test.ts" \
    'test("contract", () => {
  expect(commands.listThreads).toBe("listThreads");
});'
  write_file "$seed/apps/host-daemon/package.json" '{"name":"@bb/host-daemon"}'
  write_file "$seed/apps/host-daemon/src/command-dispatch.ts" "$(dispatch_file '')"
  git -C "$seed" add -A
  git -C "$seed" commit -qm "base"
  git -C "$seed" push -q "$upstream_bare" main
  git -C "$seed" push -q "$origin_bare" main:personal
  rm -rf -- "$seed"

  git clone -q "$upstream_bare" "$repo"
  git -C "$repo" remote rename origin upstream
  git -C "$repo" remote add origin "$origin_bare"
  git -C "$repo" fetch -q origin
  git -C "$repo" branch personal main
  git -C "$repo" worktree add -q "$personal" personal

  git clone -q "$upstream_bare" "$upstream_work"
}

install_stubs() {
  cat > "$stub_bin/pnpm" <<'STUB_PNPM'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PNPM_LOG"
if [ -n "${PNPM_HOOK:-}" ]; then
  "$PNPM_HOOK"
fi
if [ -n "${PNPM_FAIL_ON:-}" ]; then
  case "$*" in
    *"$PNPM_FAIL_ON"*) exit 1 ;;
  esac
fi
exit 0
STUB_PNPM

  cat > "$stub_bin/claude" <<'STUB_CLAUDE'
#!/usr/bin/env bash
printf 'called\n' >> "$CLAUDE_LOG"
previous=""
for argument in "$@"; do
  if [ "$previous" = "-p" ]; then
    printf '%s' "$argument" > "$CLAUDE_PROMPT"
  fi
  previous="$argument"
done
if [ -n "${CLAUDE_RESOLVER:-}" ]; then
  exec "$CLAUDE_RESOLVER"
fi
exit "${CLAUDE_EXIT:-0}"
STUB_CLAUDE

  chmod +x "$stub_bin/pnpm" "$stub_bin/claude"
}

upstream_commit() {
  local message="$1"
  shift
  git -C "$upstream_work" pull -q --ff-only
  "$@"
  git -C "$upstream_work" add -A
  git -C "$upstream_work" commit -qm "$message"
  git -C "$upstream_work" push -q origin main
}

personal_commit() {
  local message="$1"
  shift
  "$@"
  git -C "$personal" add -A
  git -C "$personal" commit -qm "$message"
}

run_sync() {
  refs_before_origin="$(git -C "$origin_bare" for-each-ref)"
  refs_before_upstream="$(git -C "$upstream_bare" for-each-ref)"
  set +e
  env \
    PATH="$stub_bin:$PATH" \
    TMPDIR="$run_tmp" \
    PNPM_LOG="$pnpm_log" \
    CLAUDE_LOG="$claude_log" \
    CLAUDE_PROMPT="$claude_prompt" \
    "$@" \
    "$script" --repo "$repo" > "$stdout_file" 2> "$stderr_file"
  status=$?
  set -e
  stdout="$(cat "$stdout_file")"
  stderr="$(cat "$stderr_file")"
}

assert_no_push() {
  assert_eq "origin refs" "$(git -C "$origin_bare" for-each-ref)" "$refs_before_origin"
  assert_eq "upstream refs" "$(git -C "$upstream_bare" for-each-ref)" "$refs_before_upstream"
}

assert_no_leftover_state() {
  assert_eq "worktree count" "$(git -C "$repo" worktree list | wc -l | tr -d ' ')" "2"
  assert_eq "temporary directories" "$(ls -A "$run_tmp")" ""
}

assert_personal_unchanged() {
  assert_eq "personal head" "$(git -C "$repo" rev-parse personal)" "$1"
  assert_eq "personal worktree is clean" "$(git -C "$personal" status --porcelain)" ""
}

sha() {
  git -C "$repo" rev-parse "$1"
}

# ---------------------------------------------------------------------------
# Scenario builders
# ---------------------------------------------------------------------------

diverge_without_conflict() {
  upstream_commit "upstream feature" \
    write_file "$upstream_work/apps/host-daemon/src/upstream-only.ts" 'export const upstreamOnly = true;'
  personal_commit "personal feature" \
    write_file "$personal/apps/host-daemon/src/personal-only.ts" 'export const personalOnly = true;'
}

diverge_on_protocol_version() {
  upstream_commit "upstream protocol bump" \
    write_file "$upstream_work/packages/host-daemon-contract/src/protocol.ts" "$(protocol_file 105)"
  personal_commit "personal protocol bump" \
    write_file "$personal/packages/host-daemon-contract/src/protocol.ts" "$(protocol_file 103)"
}

diverge_on_dispatch() {
  upstream_commit "upstream dispatch" \
    write_file "$upstream_work/apps/host-daemon/src/command-dispatch.ts" "$(dispatch_file ' + "-upstream"')"
  personal_commit "personal dispatch" \
    write_file "$personal/apps/host-daemon/src/command-dispatch.ts" "$(dispatch_file ' + "-personal"')"
}

diverge_on_wire_contract() {
  upstream_commit "upstream contract" \
    write_file "$upstream_work/packages/host-daemon-contract/src/commands.ts" 'export const commands = {
  listThreads: "listThreads",
  upstreamCommand: "upstreamCommand",
};'
  personal_commit "personal contract" \
    write_file "$personal/packages/host-daemon-contract/src/commands.ts" 'export const commands = {
  listThreads: "listThreads",
  personalCommand: "personalCommand",
};'
}

write_dispatch_resolver() {
  cat > "$fixture/resolver.sh" <<'RESOLVER'
#!/usr/bin/env bash
set -euo pipefail
path="apps/host-daemon/src/command-dispatch.ts"
printf 'export function dispatch(command: string) {\n  return command + "-personal-upstream";\n}\n' > "$path"
git add -- "$path"
RESOLVER
  chmod +x "$fixture/resolver.sh"
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

t_clean_sync() {
  diverge_without_conflict
  local before_personal before_main upstream_main
  before_personal="$(sha personal)"
  before_main="$(sha main)"
  upstream_main="$(git -C "$upstream_bare" rev-parse main)"
  assert_ne "upstream moved" "$before_main" "$upstream_main"

  run_sync
  assert_eq "exit status" "$status" "0"
  assert_eq "main is current" "$(sha main)" "$upstream_main"
  assert_eq "main worktree updated" \
    "$(cat "$repo/apps/host-daemon/src/upstream-only.ts")" 'export const upstreamOnly = true;'
  assert_eq "personal first parent" "$(sha 'personal^1')" "$before_personal"
  assert_eq "personal second parent" "$(sha 'personal^2')" "$upstream_main"
  assert_eq "personal worktree is clean" "$(git -C "$personal" status --porcelain)" ""
  assert_eq "upstream file reached personal" \
    "$(cat "$personal/apps/host-daemon/src/upstream-only.ts")" 'export const upstreamOnly = true;'
  assert_eq "personal file survived" \
    "$(cat "$personal/apps/host-daemon/src/personal-only.ts")" 'export const personalOnly = true;'
  assert_eq "claude was not used" "$(cat "$claude_log")" ""
  assert_eq "checks ran" "$(sed -n '1p' "$pnpm_log")" "install --frozen-lockfile --prefer-offline"
  assert_eq "checks were scoped to the merge" "$(sed -n '2p' "$pnpm_log")" \
    "exec turbo run typecheck test --filter=...[$before_personal]"
  assert_contains "output reports adoption" "$stdout" "Adopted"
  assert_contains "output reports no push" "$stdout" "Nothing was pushed."
  assert_no_push
  assert_no_leftover_state
}

t_already_current() {
  local before_personal
  before_personal="$(sha personal)"
  run_sync
  assert_eq "exit status" "$status" "0"
  assert_contains "output explains the no-op" "$stdout" "Nothing to do."
  assert_personal_unchanged "$before_personal"
  assert_eq "no checks ran" "$(cat "$pnpm_log")" ""
  assert_eq "claude was not used" "$(cat "$claude_log")" ""
  assert_no_push
  assert_no_leftover_state
}

t_protocol_version_resolved() {
  diverge_on_protocol_version
  local before_personal
  before_personal="$(sha personal)"

  run_sync
  assert_eq "exit status" "$status" "0"
  # upstream 105 + (personal 103 - base 100)
  assert_eq "resolved protocol version" \
    "$(sed -n 's/^export const HOST_DAEMON_PROTOCOL_VERSION = \([0-9]*\) as const;$/\1/p' \
      "$personal/packages/host-daemon-contract/src/protocol.ts")" "108"
  assert_eq "claude was not used" "$(cat "$claude_log")" ""
  assert_eq "personal advanced" "$(sha 'personal^1')" "$before_personal"
  assert_eq "personal worktree is clean" "$(git -C "$personal" status --porcelain)" ""
  assert_no_push
  assert_no_leftover_state
}

t_claude_resolves_remaining_conflict() {
  diverge_on_dispatch
  write_dispatch_resolver
  local before_personal
  before_personal="$(sha personal)"

  run_sync CLAUDE_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "claude was used once" "$(cat "$claude_log")" "called"
  assert_eq "resolution reached personal" \
    "$(cat "$personal/apps/host-daemon/src/command-dispatch.ts")" \
    "$(dispatch_file ' + "-personal-upstream"')"
  assert_eq "personal advanced" "$(sha 'personal^1')" "$before_personal"
  assert_eq "personal worktree is clean" "$(git -C "$personal" status --porcelain)" ""

  local prompt
  prompt="$(cat "$claude_prompt")"
  assert_contains "prompt names the conflict" "$prompt" "apps/host-daemon/src/command-dispatch.ts"
  assert_contains "prompt forbids committing" "$prompt" "Do not commit"
  assert_no_push
  assert_no_leftover_state
}

# The resolver is free to edit beyond the conflicted files, so whatever it
# leaves in the worktree must reach the commit that gets checked and adopted.
t_claude_edits_beyond_the_conflict() {
  diverge_on_dispatch
  cat > "$fixture/resolver.sh" <<'RESOLVER'
#!/usr/bin/env bash
set -euo pipefail
path="apps/host-daemon/src/command-dispatch.ts"
printf 'export function dispatch(command: string) {\n  return command + "-personal-upstream";\n}\n' > "$path"
git add -- "$path"
printf 'export const claudeHelper = true;\n' > "apps/host-daemon/src/claude-helper.ts"
printf 'export const upstreamOnly = false;\n' > "apps/host-daemon/src/personal-only.ts"
RESOLVER
  chmod +x "$fixture/resolver.sh"
  personal_commit "personal helper target" \
    write_file "$personal/apps/host-daemon/src/personal-only.ts" 'export const upstreamOnly = true;'
  local before_personal
  before_personal="$(sha personal)"

  run_sync CLAUDE_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "the new file is committed" \
    "$(git -C "$repo" show "personal:apps/host-daemon/src/claude-helper.ts")" \
    "export const claudeHelper = true;"
  assert_eq "the unrelated edit is committed" \
    "$(git -C "$repo" show "personal:apps/host-daemon/src/personal-only.ts")" \
    "export const upstreamOnly = false;"
  assert_eq "the new file reached the checkout" \
    "$(cat "$personal/apps/host-daemon/src/claude-helper.ts")" "export const claudeHelper = true;"
  assert_eq "personal worktree is clean" "$(git -C "$personal" status --porcelain)" ""
  assert_eq "personal advanced" "$(sha 'personal^1')" "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# A merge that only moves root files selects no turbo package, so a filtered
# run would check nothing at all.
t_root_only_change_checks_everything() {
  upstream_commit "upstream root change" \
    write_file "$upstream_work/package.json" '{"name":"bb","private":true,"packageManager":"pnpm@9"}'
  personal_commit "personal package change" \
    write_file "$personal/apps/host-daemon/src/personal-only.ts" 'export const personalOnly = true;'

  run_sync
  assert_eq "exit status" "$status" "0"
  assert_eq "checks were not filtered" "$(sed -n '2p' "$pnpm_log")" \
    "exec turbo run typecheck test"
  assert_contains "output explains the wider run" "$stdout" "Checking everything."
  assert_no_push
  assert_no_leftover_state
}

t_rerere_replays_cached_resolution() {
  diverge_on_dispatch
  write_dispatch_resolver
  local before_personal
  before_personal="$(sha personal)"

  run_sync CLAUDE_RESOLVER="$fixture/resolver.sh"
  assert_eq "first run exit status" "$status" "0"
  assert_eq "first run used claude" "$(cat "$claude_log")" "called"

  # Replay the same merge. rerere must supply the same resolution with no model.
  git -C "$personal" reset -q --hard "$before_personal"
  : > "$claude_log"
  : > "$pnpm_log"

  run_sync CLAUDE_EXIT=1
  assert_eq "second run exit status" "$status" "0"
  assert_eq "second run did not use claude" "$(cat "$claude_log")" ""
  assert_eq "cached resolution reached personal" \
    "$(cat "$personal/apps/host-daemon/src/command-dispatch.ts")" \
    "$(dispatch_file ' + "-personal-upstream"')"
  assert_eq "personal advanced" "$(sha 'personal^1')" "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

t_unresolved_conflict_aborts() {
  diverge_on_dispatch
  local before_personal
  before_personal="$(sha personal)"

  # The stub returns success without resolving anything.
  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "claude was used" "$(cat "$claude_log")" "called"
  assert_contains "error names the conflict" "$stderr" "apps/host-daemon/src/command-dispatch.ts"
  assert_personal_unchanged "$before_personal"
  assert_eq "personal keeps its own version" \
    "$(cat "$personal/apps/host-daemon/src/command-dispatch.ts")" \
    "$(dispatch_file ' + "-personal"')"
  assert_eq "no checks ran" "$(cat "$pnpm_log")" ""
  assert_no_push
  assert_no_leftover_state
}

t_wire_contract_conflict_stops_for_review() {
  diverge_on_wire_contract
  diverge_on_dispatch
  local before_personal
  before_personal="$(sha personal)"

  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "claude was never called" "$(cat "$claude_log")" ""
  assert_contains "error names the wire contract file" "$stderr" \
    "packages/host-daemon-contract/src/commands.ts"
  assert_contains "error asks for review" "$stderr" "need your review"
  assert_personal_unchanged "$before_personal"
  assert_eq "no checks ran" "$(cat "$pnpm_log")" ""
  assert_no_push
  assert_no_leftover_state
}

t_contract_test_conflict_stops_for_review() {
  upstream_commit "upstream contract test" \
    write_file "$upstream_work/packages/host-daemon-contract/test/contract.test.ts" \
    'test("contract", () => {
  expect(commands.upstreamCommand).toBe("upstreamCommand");
});'
  personal_commit "personal contract test" \
    write_file "$personal/packages/host-daemon-contract/test/contract.test.ts" \
    'test("contract", () => {
  expect(commands.personalCommand).toBe("personalCommand");
});'
  local before_personal
  before_personal="$(sha personal)"

  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "claude was never called" "$(cat "$claude_log")" ""
  assert_contains "error names the contract test" "$stderr" \
    "packages/host-daemon-contract/test/contract.test.ts"
  assert_personal_unchanged "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

t_dirty_main_stops() {
  diverge_without_conflict
  local before_personal before_main
  before_personal="$(sha personal)"
  before_main="$(sha main)"
  write_file "$repo/apps/host-daemon/src/command-dispatch.ts" "$(dispatch_file ' + "-wip"')"

  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "main did not move" "$(sha main)" "$before_main"
  assert_eq "work in progress survived" \
    "$(cat "$repo/apps/host-daemon/src/command-dispatch.ts")" "$(dispatch_file ' + "-wip"')"
  assert_contains "error explains the dirty checkout" "$stderr" "local changes"
  assert_personal_unchanged "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

t_dirty_personal_stops_before_fetch() {
  diverge_without_conflict
  local before_personal before_main before_upstream_ref
  before_personal="$(sha personal)"
  before_main="$(sha main)"
  before_upstream_ref="$(sha upstream/main)"
  write_file "$personal/apps/host-daemon/src/command-dispatch.ts" "$(dispatch_file ' + "-wip"')"

  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "personal head did not move" "$(sha personal)" "$before_personal"
  assert_eq "work in progress survived" \
    "$(cat "$personal/apps/host-daemon/src/command-dispatch.ts")" "$(dispatch_file ' + "-wip"')"
  assert_eq "main did not move" "$(sha main)" "$before_main"
  assert_eq "nothing was fetched" "$(sha upstream/main)" "$before_upstream_ref"
  assert_contains "error explains the dirty checkout" "$stderr" "local changes"
  assert_no_push
  assert_no_leftover_state
}

t_main_not_checked_out() {
  diverge_without_conflict
  git -C "$repo" checkout -q -b scratch main
  local before_personal upstream_main
  before_personal="$(sha personal)"
  upstream_main="$(git -C "$upstream_bare" rev-parse main)"

  run_sync
  assert_eq "exit status" "$status" "0"
  assert_eq "main is current" "$(sha main)" "$upstream_main"
  assert_eq "the scratch branch was untouched" "$(git -C "$repo" rev-parse --abbrev-ref HEAD)" "scratch"
  assert_eq "personal first parent" "$(sha 'personal^1')" "$before_personal"
  assert_eq "personal second parent" "$(sha 'personal^2')" "$upstream_main"
  assert_no_push
  assert_no_leftover_state
}

t_checks_failure_aborts() {
  diverge_without_conflict
  local before_personal
  before_personal="$(sha personal)"

  run_sync PNPM_FAIL_ON="turbo"
  assert_ne "exit status" "$status" "0"
  assert_contains "error explains the failure" "$stderr" "checks failed"
  assert_personal_unchanged "$before_personal"
  assert_eq "the upstream file never reached personal" \
    "$([ -e "$personal/apps/host-daemon/src/upstream-only.ts" ] && echo present || echo absent)" "absent"
  assert_no_push
  assert_no_leftover_state
}

t_personal_moving_during_checks_aborts() {
  diverge_without_conflict
  local before_personal
  before_personal="$(sha personal)"
  cat > "$fixture/hook.sh" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
git -C "$personal" rev-parse HEAD > /dev/null
if [ "\$(git -C "$personal" rev-parse HEAD)" = "$before_personal" ]; then
  git -C "$personal" commit -q --allow-empty -m "concurrent work"
fi
HOOK
  chmod +x "$fixture/hook.sh"

  run_sync PNPM_HOOK="$fixture/hook.sh"
  assert_ne "exit status" "$status" "0"
  assert_contains "error explains the race" "$stderr" "moved during the sync"
  assert_eq "personal keeps the concurrent commit" \
    "$(git -C "$repo" log -1 --format=%s personal)" "concurrent work"
  assert_eq "personal has one parent" "$(git -C "$repo" rev-list --parents -1 personal | wc -w | tr -d ' ')" "2"
  assert_eq "the upstream file never reached personal" \
    "$([ -e "$personal/apps/host-daemon/src/upstream-only.ts" ] && echo present || echo absent)" "absent"
  assert_no_push
  assert_no_leftover_state
}

# The arithmetic resolver must not become "take one side of protocol.ts".
t_protocol_resolver_keeps_both_sides() {
  upstream_commit "upstream protocol work" \
    write_file "$upstream_work/packages/host-daemon-contract/src/protocol.ts" \
    'export type UpstreamPayload = { kind: string };

export type Envelope = {
  id: string;
};

export const HOST_DAEMON_PROTOCOL_VERSION = 105 as const;'
  personal_commit "personal protocol work" \
    write_file "$personal/packages/host-daemon-contract/src/protocol.ts" \
    'export type Envelope = {
  id: string;
};

export const HOST_DAEMON_PROTOCOL_VERSION = 103 as const;

export type PersonalPayload = { kind: number };'

  run_sync
  assert_eq "exit status" "$status" "0"
  local resolved
  resolved="$(cat "$personal/packages/host-daemon-contract/src/protocol.ts")"
  assert_contains "upstream type survived" "$resolved" "UpstreamPayload"
  assert_contains "personal type survived" "$resolved" "PersonalPayload"
  assert_contains "version is the replayed bump" "$resolved" \
    "export const HOST_DAEMON_PROTOCOL_VERSION = 108 as const;"
  assert_missing "no conflict markers" "$resolved" "<<<<<<<"
  assert_eq "claude was not used" "$(cat "$claude_log")" ""
  assert_no_push
  assert_no_leftover_state
}

# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

tests=(
  t_clean_sync
  t_already_current
  t_protocol_version_resolved
  t_protocol_resolver_keeps_both_sides
  t_claude_resolves_remaining_conflict
  t_claude_edits_beyond_the_conflict
  t_root_only_change_checks_everything
  t_rerere_replays_cached_resolution
  t_unresolved_conflict_aborts
  t_wire_contract_conflict_stops_for_review
  t_contract_test_conflict_stops_for_review
  t_dirty_main_stops
  t_dirty_personal_stops_before_fetch
  t_main_not_checked_out
  t_checks_failure_aborts
  t_personal_moving_during_checks_aborts
)

failures=0
for name in "${tests[@]}"; do
  printf '%-46s' "$name"
  if ( set -e; new_fixture "$name"; "$name" ) > "$test_root/$name.log" 2>&1; then
    echo "ok"
  else
    echo "FAIL"
    sed 's/^/    /' "$test_root/$name.log"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures of ${#tests[@]} tests failed." >&2
  exit 1
fi
echo "All ${#tests[@]} tests passed."
