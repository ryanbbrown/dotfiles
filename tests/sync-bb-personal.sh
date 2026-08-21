#!/usr/bin/env bash
set -euo pipefail

# Every test builds its own throwaway repositories. Nothing here reads or
# changes the real bb checkout, and no test starts a real model call.
#
# Conflict paths are generated per fixture and change between runs, so no test
# can encode which file the tool is supposed to find conflicted.

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

source_file() {
  printf 'export const marker = "%s";\nexport const tail = "stable";' "$1"
}

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

# Paths the tests conflict on are built from this token, so they differ from run
# to run and none of them can be special-cased anywhere.
seeded_path() {
  case "$1" in
    1) printf 'packages/alpha/src/unit-%s-one.ts' "$fixture_token" ;;
    2) printf 'packages/alpha/src/unit-%s-two.ts' "$fixture_token" ;;
    3) printf 'packages/beta/src/unit-%s-three.ts' "$fixture_token" ;;
    4) printf 'apps/gamma/src/unit-%s-four.ts' "$fixture_token" ;;
    *) fail "no seeded path $1" ;;
  esac
}

fresh_path() {
  printf 'packages/beta/src/added-%s-%s.ts' "$fixture_token" "$1"
}

new_fixture() {
  fixture="$test_root/$1"
  fixture_token="$RANDOM$$"
  upstream_bare="$fixture/upstream.git"
  origin_bare="$fixture/origin.git"
  repo="$fixture/repo"
  personal="$fixture/personal"
  upstream_work="$fixture/upstream-work"
  stub_bin="$fixture/bin"
  pnpm_log="$fixture/pnpm.log"
  codex_log="$fixture/codex.log"
  codex_prompt="$fixture/codex-prompt.txt"
  codex_argv="$fixture/codex-argv.txt"
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
  : > "$codex_log"

  install_stubs

  git init -q --bare "$upstream_bare"
  git init -q --bare "$origin_bare"

  local seed="$fixture/seed" index
  git init -q -b main "$seed"
  write_file "$seed/package.json" '{"name":"fixture","private":true}'
  write_file "$seed/packages/alpha/package.json" '{"name":"@fixture/alpha"}'
  write_file "$seed/packages/beta/package.json" '{"name":"@fixture/beta"}'
  write_file "$seed/apps/gamma/package.json" '{"name":"@fixture/gamma"}'
  write_file "$seed/docs/notes.md" 'Fixture notes.'
  for index in 1 2 3 4; do
    write_file "$seed/$(seeded_path "$index")" "$(source_file "base-$index")"
  done
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
# Stands in for a repository check that fails until the resolver repairs it.
if [ -n "${PNPM_REQUIRE_FILE:-}" ]; then
  case "$*" in
    *turbo*) [ -e "$PNPM_REQUIRE_FILE" ] || exit 1 ;;
  esac
fi
if [ -n "${PNPM_FAIL_ON:-}" ]; then
  case "$*" in
    *"$PNPM_FAIL_ON"*) exit 1 ;;
  esac
fi
exit 0
STUB_PNPM

  cat > "$stub_bin/codex" <<'STUB_CODEX'
#!/usr/bin/env bash
printf 'called\n' >> "$CODEX_LOG"
: > "$CODEX_ARGV"
while [ "$#" -gt 1 ]; do
  printf '%s\n' "$1" >> "$CODEX_ARGV"
  shift
done
printf '%s' "${1:-}" > "$CODEX_PROMPT"
if [ -n "${CODEX_RESOLVER:-}" ]; then
  exec "$CODEX_RESOLVER"
fi
exit "${CODEX_EXIT:-0}"
STUB_CODEX

  chmod +x "$stub_bin/pnpm" "$stub_bin/codex"
}

# ---------------------------------------------------------------------------
# Repository edits
# ---------------------------------------------------------------------------

upstream_run() {
  git -C "$upstream_work" pull -q --ff-only
  "$@"
  git -C "$upstream_work" add -A
  git -C "$upstream_work" commit -qm "$message"
  git -C "$upstream_work" push -q origin main
}

personal_run() {
  "$@"
  git -C "$personal" add -A
  git -C "$personal" commit -qm "$message"
}

upstream_set() {
  message="upstream changes $1" upstream_run write_file "$upstream_work/$1" "$2"
}

personal_set() {
  message="personal changes $1" personal_run write_file "$personal/$1" "$2"
}

upstream_remove() {
  message="upstream removes $1" upstream_run git -C "$upstream_work" rm -q -- "$1"
}

personal_move() {
  message="personal moves $1" personal_run git -C "$personal" mv -- "$1" "$2"
}

# ---------------------------------------------------------------------------
# Running the tool
# ---------------------------------------------------------------------------

run_sync() {
  refs_before_origin="$(git -C "$origin_bare" for-each-ref)"
  refs_before_upstream="$(git -C "$upstream_bare" for-each-ref)"
  set +e
  env \
    PATH="$stub_bin:$PATH" \
    TMPDIR="$run_tmp" \
    PNPM_LOG="$pnpm_log" \
    CODEX_LOG="$codex_log" \
    CODEX_PROMPT="$codex_prompt" \
    CODEX_ARGV="$codex_argv" \
    "$@" \
    "$script" --repo "$repo" > "$stdout_file" 2> "$stderr_file"
  status=$?
  set -e
  stdout="$(cat "$stdout_file")"
  stderr="$(cat "$stderr_file")"
}

make_resolver() {
  cat > "$fixture/resolver.sh"
  chmod +x "$fixture/resolver.sh"
}

prompt_conflict_list() {
  awk '/^Git could not resolve these paths:$/ { flag = 1; next }
       /^$/ { if (flag) exit }
       flag { print }' "$codex_prompt"
}

rr_entries() {
  [ -d "$repo/.git/rr-cache" ] || return 0
  ( cd "$repo/.git/rr-cache" && find . -mindepth 1 | sort )
}

turbo_invocations() {
  grep -c 'turbo run' "$pnpm_log" | tr -d ' '
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

assert_adopted() {
  assert_eq "personal first parent" "$(sha 'personal^1')" "$1"
  assert_eq "personal second parent" "$(sha 'personal^2')" "$(sha main)"
  assert_eq "personal worktree is clean" "$(git -C "$personal" status --porcelain)" ""
}

sha() {
  git -C "$repo" rev-parse "$1"
}

diverge_without_conflict() {
  upstream_set "$(seeded_path 1)" "$(source_file upstream-1)"
  personal_set "$(seeded_path 3)" "$(source_file personal-3)"
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

t_clean_sync() {
  diverge_without_conflict
  local before_personal upstream_main
  before_personal="$(sha personal)"
  upstream_main="$(git -C "$upstream_bare" rev-parse main)"
  assert_ne "upstream moved" "$(sha main)" "$upstream_main"

  run_sync
  assert_eq "exit status" "$status" "0"
  assert_eq "main is current" "$(sha main)" "$upstream_main"
  assert_eq "main worktree updated" \
    "$(cat "$repo/$(seeded_path 1)")" "$(source_file upstream-1)"
  assert_adopted "$before_personal"
  assert_eq "upstream change reached personal" \
    "$(cat "$personal/$(seeded_path 1)")" "$(source_file upstream-1)"
  assert_eq "personal change survived" \
    "$(cat "$personal/$(seeded_path 3)")" "$(source_file personal-3)"
  assert_eq "Codex was not used" "$(cat "$codex_log")" ""
  assert_eq "install ran" "$(sed -n '1p' "$pnpm_log")" "install --frozen-lockfile --prefer-offline"
  assert_eq "the repository checks ran" "$(sed -n '2p' "$pnpm_log")" \
    "exec turbo run typecheck test"
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
  assert_eq "Codex was not used" "$(cat "$codex_log")" ""
  assert_no_push
  assert_no_leftover_state
}

# Whatever Git leaves unresolved is what Codex gets, whichever files those are.
t_modify_modify_conflicts_go_to_codex() {
  local one two four before_personal
  one="$(seeded_path 1)"
  two="$(seeded_path 2)"
  four="$(seeded_path 4)"
  upstream_set "$one" "$(source_file upstream-1)"
  upstream_set "$two" "$(source_file upstream-2)"
  upstream_set "$four" "$(source_file upstream-4)"
  personal_set "$one" "$(source_file personal-1)"
  personal_set "$two" "$(source_file personal-2)"
  personal_set "$four" "$(source_file personal-4)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
for path in "$one" "$two" "$four"; do
  printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "\$path"
  git add -- "\$path"
done
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "Codex was used once" "$(cat "$codex_log")" "called"
  assert_eq "Codex got exactly the unresolved paths" \
    "$(prompt_conflict_list | sort)" "$(printf '%s\n%s\n%s\n' "$one" "$two" "$four" | sort)"
  assert_contains "prompt carries incoming history" \
    "$(cat "$codex_prompt")" "Incoming commits since the merge base:"
  assert_contains "prompt carries local history" \
    "$(cat "$codex_prompt")" "Local commits since the merge base:"
  assert_contains "prompt names the merge base" \
    "$(cat "$codex_prompt")" "$(git -C "$repo" merge-base "$before_personal" main)"
  assert_eq "resolution reached personal" \
    "$(cat "$personal/$two")" "$(source_file merged)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

t_add_add_conflict_goes_to_codex() {
  local added before_personal
  added="$(fresh_path a)"
  upstream_set "$added" "$(source_file upstream-added)"
  personal_set "$added" "$(source_file personal-added)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$added"
git add -- "$added"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "Codex got the added path" "$(prompt_conflict_list)" "$added"
  assert_eq "resolution reached personal" "$(cat "$personal/$added")" "$(source_file merged)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

t_delete_modify_conflict_goes_to_codex() {
  local target before_personal
  target="$(seeded_path 3)"
  upstream_remove "$target"
  personal_set "$target" "$(source_file personal-3)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
git rm -q -f -- "$target"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "Codex got the deleted path" "$(prompt_conflict_list)" "$target"
  assert_eq "the file is gone from the checkout" \
    "$([ -e "$personal/$target" ] && echo present || echo absent)" "absent"
  assert_eq "the file is gone from the commit" \
    "$(git -C "$repo" ls-tree -r --name-only personal -- "$target")" ""
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

t_rename_modify_conflict_goes_to_codex() {
  local origin_path renamed before_personal conflicted
  origin_path="$(seeded_path 2)"
  renamed="$(fresh_path renamed)"
  upstream_set "$origin_path" "$(source_file upstream-2)"
  personal_move "$origin_path" "$renamed"
  personal_set "$renamed" "$(source_file personal-2)"
  before_personal="$(sha personal)"

  make_resolver <<'RESOLVER'
#!/usr/bin/env bash
set -euo pipefail
git diff --name-only --diff-filter=U -z | while IFS= read -r -d '' path; do
  printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$path"
  git add -- "$path"
done
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "Codex was used" "$(cat "$codex_log")" "called"
  conflicted="$(prompt_conflict_list)"
  assert_ne "a path was reported as conflicted" "$conflicted" ""
  assert_eq "the resolved content reached personal" \
    "$(cat "$personal/$conflicted")" "$(source_file merged)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# The resolver is free to edit beyond the conflicted files, so whatever it
# leaves in the worktree must reach the commit that gets checked and adopted.
t_codex_edits_beyond_the_conflict() {
  local conflicted untouched created before_personal
  conflicted="$(seeded_path 1)"
  untouched="$(seeded_path 4)"
  created="$(fresh_path helper)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"
printf 'export const marker = "rewritten";\nexport const tail = "stable";\n' > "$untouched"
printf 'export const marker = "created";\nexport const tail = "stable";\n' > "$created"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"
  assert_eq "the unstaged rewrite is committed" \
    "$(git -C "$repo" show "personal:$untouched")" "$(source_file rewritten)"
  assert_eq "the new file is committed" \
    "$(git -C "$repo" show "personal:$created")" "$(source_file created)"
  assert_eq "the new file reached the checkout" \
    "$(cat "$personal/$created")" "$(source_file created)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# The resolver is a normal coding agent: full permission, no tool allowlist,
# and free to run commands that have nothing to do with git.
t_resolver_has_full_command_freedom() {
  local conflicted before_personal argv
  conflicted="$(seeded_path 1)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
# None of the following is a git command.
mkdir -p build-scratch
sh -c 'printf "built by a non-git command\n" > build-scratch/report.txt'
cp build-scratch/report.txt "$(fresh_path evidence)"
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted" "$(fresh_path evidence)"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "exit status" "$status" "0"

  argv="$(cat "$codex_argv")"
  assert_eq "Codex gets the exact non-interactive full-permission invocation" "$argv" \
    "$(printf '%s\n' \
      exec \
      --dangerously-bypass-approvals-and-sandbox \
      --ignore-rules \
      --ephemeral)"

  assert_eq "the non-git work reached personal" \
    "$(git -C "$repo" show "personal:$(fresh_path evidence)")" "built by a non-git command"
  assert_eq "the conflict was resolved" \
    "$(cat "$personal/$conflicted")" "$(source_file merged)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# The whole point of the redesign: the resolver runs the repository checks
# itself, sees a failure the merge caused, and repairs it before finishing.
t_resolver_repairs_a_failing_repository_check() {
  local conflicted repair before_personal
  conflicted="$(seeded_path 1)"
  repair="$(fresh_path repair)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"

# First attempt at the repository checks fails.
if pnpm install --frozen-lockfile --prefer-offline && pnpm exec turbo run typecheck test; then
  printf 'checks passed too early\n' >&2
  exit 1
fi

# Diagnose, repair, and try again.
printf 'export const marker = "repair";\nexport const tail = "stable";\n' > "$repair"
pnpm install --frozen-lockfile --prefer-offline
pnpm exec turbo run typecheck test
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh" PNPM_REQUIRE_FILE="$repair"
  assert_eq "exit status" "$status" "0"
  assert_eq "the resolver ran the checks twice and the script confirmed once" \
    "$(turbo_invocations)" "3"
  assert_eq "the repair is in the adopted commit" \
    "$(git -C "$repo" show "personal:$repair")" "$(source_file repair)"
  assert_eq "the repair reached the checkout" \
    "$(cat "$personal/$repair")" "$(source_file repair)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# An unverified resolution must never survive to be replayed silently.
t_failed_checks_leave_no_reusable_resolution() {
  local conflicted before_personal before_rr
  conflicted="$(seeded_path 2)"
  upstream_set "$conflicted" "$(source_file upstream-2)"
  personal_set "$conflicted" "$(source_file personal-2)"
  before_personal="$(sha personal)"
  before_rr="$(rr_entries)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "unverified";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh" PNPM_FAIL_ON="turbo"
  assert_ne "exit status" "$status" "0"
  assert_contains "error explains the failure" "$stderr" "checks failed"
  assert_personal_unchanged "$before_personal"
  assert_eq "the reuse cache is untouched" "$(rr_entries)" "$before_rr"

  # Prove it by replaying the same merge with a resolver that cannot run.
  : > "$codex_log"
  run_sync CODEX_EXIT=1
  assert_ne "second run exit status" "$status" "0"
  assert_eq "the second run still needed a resolver" "$(cat "$codex_log")" "called"
  assert_contains "the conflict came back" "$stderr" "$conflicted"
  assert_personal_unchanged "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# The resolver owns the worktree but not the commit. Taking it aborts the run,
# and still leaves nothing reusable behind.
t_resolver_committing_aborts_without_caching() {
  local conflicted before_personal before_rr
  conflicted="$(seeded_path 1)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"
  before_rr="$(rr_entries)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"
git commit -q --no-edit
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_ne "exit status" "$status" "0"
  assert_contains "error explains the cause" "$stderr" "merge state was lost"
  assert_personal_unchanged "$before_personal"
  assert_eq "the reuse cache is untouched" "$(rr_entries)" "$before_rr"
  assert_no_push
  assert_no_leftover_state
}

# Nothing the resolver runs may publish, whatever it decides to try.
t_resolver_cannot_push() {
  local conflicted before_personal
  conflicted="$(seeded_path 1)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"
# HEAD is ahead of both remotes here, so these pushes would land if anything
# let them through.
for remote in origin upstream; do
  if git push --force "\$remote" HEAD:refs/heads/personal >>"$fixture/push.log" 2>&1; then
    printf '%s pushed\n' "\$remote" >> "$fixture/push.log"
  fi
done
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_missing "no push reported success" "$(cat "$fixture/push.log")" "pushed"
  assert_no_push
  assert_eq "the sync still finished" "$status" "0"
  assert_adopted "$before_personal"
  assert_no_leftover_state
}

t_unresolved_conflict_aborts() {
  local conflicted before_personal
  conflicted="$(seeded_path 1)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"

  # The stub returns success without resolving anything.
  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "Codex was used" "$(cat "$codex_log")" "called"
  assert_contains "error names the path" "$stderr" "$conflicted"
  assert_contains "error explains the cause" "$stderr" "unresolved"
  assert_personal_unchanged "$before_personal"
  assert_eq "personal keeps its own version" \
    "$(cat "$personal/$conflicted")" "$(source_file personal-1)"
  assert_eq "no checks ran" "$(cat "$pnpm_log")" ""
  assert_no_push
  assert_no_leftover_state
}

# A staged file can still hold markers, and so can a file the resolver touched
# that was never conflicted. Both have to reject the merge.
t_conflict_markers_anywhere_abort() {
  local conflicted polluted before_personal
  conflicted="$(seeded_path 1)"
  polluted="$(seeded_path 4)"
  upstream_set "$conflicted" "$(source_file upstream-1)"
  personal_set "$conflicted" "$(source_file personal-1)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"
printf '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> other\n' > "$polluted"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_ne "exit status" "$status" "0"
  assert_contains "error names the polluted file" "$stderr" "$polluted"
  assert_contains "error explains the cause" "$stderr" "conflict markers"
  assert_personal_unchanged "$before_personal"
  assert_eq "no checks ran" "$(cat "$pnpm_log")" ""
  assert_no_push
  assert_no_leftover_state
}

t_rerere_replays_cached_resolution() {
  local conflicted before_personal
  conflicted="$(seeded_path 2)"
  upstream_set "$conflicted" "$(source_file upstream-2)"
  personal_set "$conflicted" "$(source_file personal-2)"
  before_personal="$(sha personal)"

  make_resolver <<RESOLVER
#!/usr/bin/env bash
set -euo pipefail
printf 'export const marker = "merged";\nexport const tail = "stable";\n' > "$conflicted"
git add -- "$conflicted"
RESOLVER

  run_sync CODEX_RESOLVER="$fixture/resolver.sh"
  assert_eq "first run exit status" "$status" "0"
  assert_eq "first run used Codex" "$(cat "$codex_log")" "called"

  # Replay the same merge. rerere must supply the same resolution with no model.
  git -C "$personal" reset -q --hard "$before_personal"
  : > "$codex_log"
  : > "$pnpm_log"

  run_sync CODEX_EXIT=1
  assert_eq "second run exit status" "$status" "0"
  assert_eq "second run did not use Codex" "$(cat "$codex_log")" ""
  assert_eq "cached resolution reached personal" \
    "$(cat "$personal/$conflicted")" "$(source_file merged)"
  assert_adopted "$before_personal"
  assert_no_push
  assert_no_leftover_state
}

# Check scope must not depend on which files moved.
t_root_only_change_checks_everything() {
  upstream_set "package.json" '{"name":"fixture","private":true,"packageManager":"pnpm@9"}'
  personal_set "$(seeded_path 3)" "$(source_file personal-3)"

  run_sync
  assert_eq "exit status" "$status" "0"
  assert_eq "the whole repository is still checked" "$(sed -n '2p' "$pnpm_log")" \
    "exec turbo run typecheck test"
  assert_no_push
  assert_no_leftover_state
}

t_dirty_main_stops() {
  diverge_without_conflict
  local before_personal before_main
  before_personal="$(sha personal)"
  before_main="$(sha main)"
  write_file "$repo/$(seeded_path 4)" "$(source_file work-in-progress)"

  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "main did not move" "$(sha main)" "$before_main"
  assert_eq "work in progress survived" \
    "$(cat "$repo/$(seeded_path 4)")" "$(source_file work-in-progress)"
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
  write_file "$personal/$(seeded_path 4)" "$(source_file work-in-progress)"

  run_sync
  assert_ne "exit status" "$status" "0"
  assert_eq "personal head did not move" "$(sha personal)" "$before_personal"
  assert_eq "work in progress survived" \
    "$(cat "$personal/$(seeded_path 4)")" "$(source_file work-in-progress)"
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
  assert_adopted "$before_personal"
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
  assert_eq "the upstream change never reached personal" \
    "$(cat "$personal/$(seeded_path 1)")" "$(source_file base-1)"
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
  assert_eq "personal has one parent" \
    "$(git -C "$repo" rev-list --parents -1 personal | wc -w | tr -d ' ')" "2"
  assert_eq "the upstream change never reached personal" \
    "$(cat "$personal/$(seeded_path 1)")" "$(source_file base-1)"
  assert_no_push
  assert_no_leftover_state
}

# The tool must not know which files conflict or what a conflict in them means.
# Any source path baked into the script would be exactly that knowledge.
t_no_file_specific_conflict_policy() {
  local literals
  literals="$(grep -oE '[A-Za-z0-9_.$-]+/[A-Za-z0-9_.$-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|yaml|yml)' "$script" | sort -u)"
  assert_eq "the script names no source path at all" "$literals" ""
  if grep -qiE 'protected|protocol|contract|wire|dispatch|sidebar|daemon' "$script"; then
    fail "the script names a specific source file or subsystem"
  fi
}

# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

tests=(
  t_clean_sync
  t_already_current
  t_modify_modify_conflicts_go_to_codex
  t_add_add_conflict_goes_to_codex
  t_delete_modify_conflict_goes_to_codex
  t_rename_modify_conflict_goes_to_codex
  t_codex_edits_beyond_the_conflict
  t_resolver_has_full_command_freedom
  t_resolver_repairs_a_failing_repository_check
  t_failed_checks_leave_no_reusable_resolution
  t_resolver_committing_aborts_without_caching
  t_resolver_cannot_push
  t_unresolved_conflict_aborts
  t_conflict_markers_anywhere_abort
  t_rerere_replays_cached_resolution
  t_root_only_change_checks_everything
  t_dirty_main_stops
  t_dirty_personal_stops_before_fetch
  t_main_not_checked_out
  t_checks_failure_aborts
  t_personal_moving_during_checks_aborts
  t_no_file_specific_conflict_policy
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
