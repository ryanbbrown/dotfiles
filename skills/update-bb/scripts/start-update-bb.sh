#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BB_THREAD_ID:-}" ]; then
  echo "error: BB_THREAD_ID is required" >&2
  exit 1
fi
if [ -z "${BB_THREAD_STORAGE:-}" ]; then
  echo "error: BB_THREAD_STORAGE is required" >&2
  exit 1
fi

bb_bin="${BB_CLI:-bb}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
runner="$script_dir/run-update-bb.sh"

existing="$("$bb_bin" terminal list --thread "$BB_THREAD_ID" --json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(input);
  const session = (payload.sessions || []).find(item =>
    item.title === "update-bb" && ["starting", "running"].includes(item.status));
  if (session) process.stdout.write(session.id);
});
')"

if [ -n "$existing" ]; then
  printf 'state: already-running\nterminal_id: %s\n' "$existing"
  exit 0
fi

run_id="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
artifact_root="$BB_THREAD_STORAGE/update-bb"
run_dir="$artifact_root/$run_id"
log_path="$run_dir/update-bb.log"
outcome_path="$run_dir/outcome.txt"
launch_path="$run_dir/launch.txt"
latest_path="$artifact_root/latest.txt"
mkdir -p "$run_dir"

printf -v terminal_command 'exec %q %q %q' "$runner" "$log_path" "$outcome_path"
create_json="$("$bb_bin" terminal create \
  --thread "$BB_THREAD_ID" \
  --title update-bb \
  --command "$terminal_command" \
  --json)"
terminal_id="$(printf '%s' "$create_json" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const session = JSON.parse(input);
  if (typeof session.id !== "string" || session.id.length === 0) process.exit(1);
  process.stdout.write(session.id);
});
')"

{
  printf 'state: started\n'
  printf 'terminal_id: %s\n' "$terminal_id"
  printf 'log: %s\n' "$log_path"
  printf 'outcome: %s\n' "$outcome_path"
} > "$launch_path"
printf '%s\n' "$run_dir" > "$latest_path.tmp.$$"
mv "$latest_path.tmp.$$" "$latest_path"
cat "$launch_path"
