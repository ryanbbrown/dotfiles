#!/usr/bin/env bash
set -uo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: run-update-bb.sh LOG_PATH OUTCOME_PATH" >&2
  exit 64
fi

log_path="$1"
outcome_path="$2"
started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
outcome_tmp="$outcome_path.tmp.$$"

mkdir -p "$(dirname "$log_path")" "$(dirname "$outcome_path")"

write_outcome() {
  local result="$1"
  local exit_status="$2"
  local finished_at

  finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  {
    printf 'result: %s\n' "$result"
    printf 'exit_status: %s\n' "$exit_status"
    printf 'started_at: %s\n' "$started_at"
    printf 'finished_at: %s\n' "$finished_at"
    printf 'log: %s\n' "$log_path"
  } > "$outcome_tmp"
  mv "$outcome_tmp" "$outcome_path"
}

handle_signal() {
  local signal="$1"
  local exit_status="$2"

  printf 'update-bb: interrupted by %s\n' "$signal" | tee -a "$log_path" >&2
  write_outcome "interrupted-$signal" "$exit_status"
  exit "$exit_status"
}

trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

printf 'update-bb: started at %s\n' "$started_at" | tee "$log_path"
set +e
sync-bb-personal 2>&1 | tee -a "$log_path"
sync_status="${PIPESTATUS[0]}"
set -e

if [ "$sync_status" -eq 0 ]; then
  result=success
else
  result=failure
fi

write_outcome "$result" "$sync_status"
printf 'update-bb: %s with exit status %s\n' "$result" "$sync_status" | tee -a "$log_path"
exit "$sync_status"
