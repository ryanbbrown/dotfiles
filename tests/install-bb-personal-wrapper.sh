#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
wrapper="${WRAPPER_UNDER_TEST:-$repo_root/bin/install-bb-personal.command}"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/install-bb-personal-wrapper-test.XXXXXX")"
test_root="$(cd "$test_root" && pwd -P)"
test_home="$test_root/home"
fake_bin="$test_root/bin"
state="$test_root/state"

cleanup() {
  rm -rf -- "$test_root"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  grep -F -- "$2" "$1" >/dev/null || fail "$1 does not contain: $2"
}

mkdir -p "$test_home/code/bb-personal" "$fake_bin" "$state"
trap cleanup EXIT

[ -x "$wrapper" ] || fail "missing executable wrapper: $wrapper"

cat > "$fake_bin/pnpm" <<'EOF_PNPM'
#!/usr/bin/env bash
printf '%s\n' "$PWD" > "$INSTALL_WRAPPER_TEST_STATE/pnpm-cwd"
printf '%s\n' "$*" > "$INSTALL_WRAPPER_TEST_STATE/pnpm-args"
exit "${INSTALL_WRAPPER_TEST_PNPM_STATUS:-0}"
EOF_PNPM

cat > "$fake_bin/osascript" <<'EOF_OSASCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$INSTALL_WRAPPER_TEST_STATE/osascript-args"
exit 0
EOF_OSASCRIPT
chmod +x "$fake_bin/pnpm" "$fake_bin/osascript"

run_wrapper() {
  local pnpm_status="$1" output="$2"
  : > "$state/osascript-args"
  set +e
  HOME="$test_home" \
    PATH="$fake_bin:/usr/bin:/bin" \
    INSTALL_WRAPPER_TEST_PNPM_STATUS="$pnpm_status" \
    INSTALL_WRAPPER_TEST_STATE="$state" \
    "$wrapper" </dev/null >"$output" 2>&1
  wrapper_status=$?
  set -e
}

run_wrapper 0 "$test_root/success-output"
[ "$wrapper_status" -eq 0 ] || fail "success returned $wrapper_status"
[ "$(cat "$state/pnpm-args")" = "personal:install" ] ||
  fail "wrapper did not invoke pnpm personal:install"
if [ -z "${WRAPPER_UNDER_TEST:-}" ]; then
  [ "$(cat "$state/pnpm-cwd")" = "$test_home/code/bb-personal" ] ||
    fail "wrapper used the wrong personal checkout"
fi
for _ in {1..50}; do
  [ -s "$state/osascript-args" ] && break
  sleep 0.01
done
assert_contains "$state/osascript-args" 'tell application "Terminal" to close front window'

run_wrapper 23 "$test_root/failure-output"
[ "$wrapper_status" -eq 23 ] || fail "failure returned $wrapper_status instead of 23"
[ ! -s "$state/osascript-args" ] || fail "wrapper closed Terminal after failure"
assert_contains "$test_root/failure-output" "Personal BB installation failed with exit status 23."

if [ -z "${WRAPPER_UNDER_TEST:-}" ]; then
  HOME="$test_home" "$repo_root/scripts/link-home.sh" > "$test_root/link-output"
  linked_wrapper="$test_home/Desktop/install-bb-personal.command"
  [ -f "$linked_wrapper" ] || fail "link-home did not install the Desktop wrapper"
  [ ! -L "$linked_wrapper" ] || fail "Desktop wrapper must be a regular file"
  [ -x "$linked_wrapper" ] || fail "Desktop wrapper is not executable"
  cmp -s "$wrapper" "$linked_wrapper" || fail "Desktop wrapper does not match its source"

  printf '#!/usr/bin/env bash\nexit 99\n' > "$linked_wrapper"
  chmod +x "$linked_wrapper"
  HOME="$test_home" "$repo_root/scripts/link-home.sh" > "$test_root/reinstall-output"
  cmp -s "$wrapper" "$linked_wrapper" || fail "link-home did not refresh the Desktop wrapper"

  TEST_WRAPPER="$linked_wrapper" \
    TEST_HOME="$test_home" \
    TEST_PATH="$fake_bin:/usr/bin:/bin" \
    TEST_STATE="$state" \
    python3 - <<'PY'
import os
import pty
import select
import sys
import time

wrapper = os.environ["TEST_WRAPPER"]
env = os.environ.copy()
env.update(
    {
        "HOME": os.environ["TEST_HOME"],
        "PATH": os.environ["TEST_PATH"],
        "INSTALL_WRAPPER_TEST_PNPM_STATUS": "23",
        "INSTALL_WRAPPER_TEST_STATE": os.environ["TEST_STATE"],
    }
)
open(os.path.join(os.environ["TEST_STATE"], "osascript-args"), "w").close()
pid, fd = pty.fork()
if pid == 0:
    os.execve(wrapper, [wrapper], env)

output = bytearray()
deadline = time.monotonic() + 5
prompt = b"Press Return to close."
while prompt not in output and time.monotonic() < deadline:
    readable, _, _ = select.select([fd], [], [], 0.1)
    if readable:
        try:
            output.extend(os.read(fd, 4096))
        except OSError:
            break

if prompt not in output:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    raise SystemExit(f"interactive failure prompt missing: {output.decode(errors='replace')}")

waited_pid, _ = os.waitpid(pid, os.WNOHANG)
if waited_pid != 0:
    raise SystemExit("wrapper exited before interactive acknowledgement")

os.write(fd, b"\r\n")
exit_status = None
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    waited_pid, status = os.waitpid(pid, os.WNOHANG)
    if waited_pid == pid:
        exit_status = status
        break
    readable, _, _ = select.select([fd], [], [], 0.1)
    if readable:
        try:
            output.extend(os.read(fd, 4096))
        except OSError:
            pass
if exit_status is None:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    raise SystemExit(
        f"interactive wrapper did not exit after Return: {output.decode(errors='replace')}"
    )
if not os.WIFEXITED(exit_status) or os.WEXITSTATUS(exit_status) != 23:
    raise SystemExit(f"interactive wrapper did not preserve exit 23: {exit_status}")

osascript_log = os.path.join(os.environ["TEST_STATE"], "osascript-args")
if os.path.getsize(osascript_log) != 0:
    raise SystemExit("interactive failure closed Terminal")
PY
fi

echo "install-bb-personal wrapper test passed."
