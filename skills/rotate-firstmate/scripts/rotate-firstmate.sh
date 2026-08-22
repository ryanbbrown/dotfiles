#!/usr/bin/env bash
set -euo pipefail

bb_bin="${BB_CLI:-bb}"
old_id="${BB_THREAD_ID:-}"
project_id="${BB_PROJECT_ID:-}"
environment_id="${BB_ENVIRONMENT_ID:-}"
pi_provider="${PI_PROVIDER:-}"
pi_model="${PI_MODEL:-}"
reasoning_level="${PI_REASONING_LEVEL:-}"
new_id=""
state_dir=""
completed=false
rollback_started=false

cleanup() {
  [ -z "$state_dir" ] || rm -rf "$state_dir"
}

die() {
  echo "rotate-firstmate failed: $*" >&2
  exit 1
}

valid_id() {
  local value="$1"
  local prefix="$2"
  [[ "$value" =~ ^${prefix}_[[:alnum:]]+$ ]]
}

valid_token() {
  local value="$1"
  [[ -n "$value" && "$value" != *[[:space:]]* && "$value" != *[[:cntrl:]]* ]]
}

thread_json() {
  "$bb_bin" thread show "$1" --json
}

is_pinned() {
  thread_json "$1" | jq -e '.thread.pinnedAt != null' >/dev/null
}

is_unpinned() {
  thread_json "$1" | jq -e '.thread.pinnedAt == null' >/dev/null
}

parent_is() {
  local thread_id="$1"
  local parent_id="$2"
  thread_json "$thread_id" | jq -e --arg parent "$parent_id" '.thread.parentThreadId == $parent' >/dev/null
}

collect_children() {
  local parent_id="$1"
  local active_json
  local archived_json

  active_json="$("$bb_bin" thread list --parent-thread "$parent_id" --include-hidden --json)" || return 1
  archived_json="$("$bb_bin" thread list --parent-thread "$parent_id" --include-hidden --archived --json)" || return 1
  printf '%s\n%s\n' "$active_json" "$archived_json" | jq -sr '[.[][] | .id] | unique | .[]'
}

rollback() {
  local child_id
  local rollback_incomplete=false
  local replacement_unpinned=false
  local old_pinned=false

  rollback_started=true
  : > "$state_dir/rollback-child-failures"

  while IFS= read -r child_id; do
    [ -n "$child_id" ] || continue
    if parent_is "$child_id" "$old_id" ||
      { "$bb_bin" thread update "$child_id" --parent-thread "$old_id" --json >/dev/null && parent_is "$child_id" "$old_id"; }; then
      continue
    fi
    printf '%s\n' "$child_id" >> "$state_dir/rollback-child-failures"
    rollback_incomplete=true
  done < "$state_dir/moved"

  if is_pinned "$old_id" ||
    { "$bb_bin" thread pin "$old_id" --json >/dev/null && is_pinned "$old_id"; }; then
    old_pinned=true
  else
    rollback_incomplete=true
  fi

  if is_unpinned "$new_id" ||
    { "$bb_bin" thread unpin "$new_id" --json >/dev/null && is_unpinned "$new_id"; }; then
    replacement_unpinned=true
  else
    rollback_incomplete=true
  fi

  if [ "$rollback_incomplete" = false ]; then
    echo "Rollback complete. Old Firstmate $old_id is pinned; replacement Firstmate $new_id is unpinned." >&2
    return
  fi

  echo "Rollback incomplete." >&2
  echo "Old Firstmate: $old_id" >&2
  echo "Replacement Firstmate: $new_id" >&2
  if [ -s "$state_dir/rollback-child-failures" ]; then
    while IFS= read -r child_id; do
      echo "Child not returned to $old_id: $child_id" >&2
    done < "$state_dir/rollback-child-failures"
  fi
  [ "$old_pinned" = true ] || echo "Old Firstmate pin could not be verified: $old_id" >&2
  [ "$replacement_unpinned" = true ] || echo "Replacement Firstmate unpin could not be verified: $new_id" >&2
  echo "Manual recovery is required for the exact IDs above." >&2
}

on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ] && [ -n "$new_id" ] && [ "$completed" = false ] && [ "$rollback_started" = false ]; then
    rollback
  fi
  cleanup
  exit "$status"
}

trap on_exit EXIT

command -v "$bb_bin" >/dev/null 2>&1 || die "bb is not installed"
command -v jq >/dev/null 2>&1 || die "jq is not installed"
valid_id "$old_id" thr || die "BB_THREAD_ID is missing or malformed"
valid_id "$project_id" proj || die "BB_PROJECT_ID is missing or malformed"
valid_id "$environment_id" env || die "BB_ENVIRONMENT_ID is missing or malformed"
valid_token "$pi_provider" || die "PI_PROVIDER is missing or malformed"
[[ "$pi_provider" != */* ]] || die "PI_PROVIDER is malformed"
valid_token "$pi_model" || die "PI_MODEL is missing or malformed"
[[ "$pi_model" != /* && "$pi_model" != */ && "$pi_model" != *//* ]] || die "PI_MODEL is malformed"
case "$reasoning_level" in
  low|medium|high|xhigh|max) ;;
  *) die "PI_REASONING_LEVEL is missing or malformed" ;;
esac
route_model="$pi_provider/$pi_model"

old_json="$(thread_json "$old_id")" || die "cannot inspect current thread $old_id"
printf '%s' "$old_json" | jq -e --arg thread "$old_id" --arg project "$project_id" --arg environment "$environment_id" '
  .thread.id == $thread and
  .thread.title == "Firstmate" and
  .thread.parentThreadId == null and
  .thread.projectId == $project and
  .thread.environmentId == $environment and
  .thread.pinnedAt != null
' >/dev/null || die "invoke this from the pinned root Firstmate in the current project and environment"

provider_id="$(printf '%s' "$old_json" | jq -er '.thread.providerId | select(type == "string" and test("^[a-zA-Z0-9][a-zA-Z0-9._-]*$"))')" ||
  die "current Firstmate provider is missing or malformed"

state_dir="$(mktemp -d "${TMPDIR:-/tmp}/rotate-firstmate.XXXXXX")"
: > "$state_dir/moved"

prompt='You are the new root Firstmate for this project. Read .bb/AGENTS.md and FIRSTMATE-QUEUE.md now; they are the sources of truth. This is a context handoff, not a new task. Do not copy or reconstruct the old transcript. Do not start or delegate queue work in this turn. Existing child threads are being transferred to you. Confirm that you are ready, report any missing source-of-truth file, and give the user a clickable Markdown link to the absolute FIRSTMATE-QUEUE.md path so they can open the queue.'
spawn_json="$("$bb_bin" thread spawn \
  --project "$project_id" \
  --environment "$environment_id" \
  --provider "$provider_id" \
  --model "$route_model" \
  --reasoning-level "$reasoning_level" \
  --permission-mode full \
  --title Firstmate \
  --prompt "$prompt" \
  --json)" || die "could not create the replacement Firstmate"
new_id="$(printf '%s' "$spawn_json" | jq -er '.thread.id // .id | select(type == "string" and test("^thr_[[:alnum:]]+$"))')" ||
  die "bb created a replacement but did not return a valid thread ID"

"$bb_bin" thread wait "$new_id" --status idle --json >/dev/null ||
  die "replacement Firstmate $new_id did not become ready"

new_json="$(thread_json "$new_id")" || die "cannot inspect replacement Firstmate $new_id"
printf '%s' "$new_json" | jq -e \
  --arg thread "$new_id" \
  --arg project "$project_id" \
  --arg environment "$environment_id" \
  --arg provider "$provider_id" '
  .thread.id == $thread and
  .thread.title == "Firstmate" and
  .thread.parentThreadId == null and
  .thread.projectId == $project and
  .thread.environmentId == $environment and
  .thread.providerId == $provider and
  .thread.status == "idle"
' >/dev/null || die "replacement Firstmate $new_id failed readiness verification"

"$bb_bin" thread pin "$new_id" --json >/dev/null || die "could not pin replacement Firstmate $new_id"
is_pinned "$new_id" || die "replacement Firstmate pin could not be verified: $new_id"

while :; do
  collect_children "$old_id" > "$state_dir/pending" || die "could not list every direct child of $old_id"
  [ -s "$state_dir/pending" ] || break

  while IFS= read -r child_id; do
    [ -n "$child_id" ] || continue
    if "$bb_bin" thread update "$child_id" --parent-thread "$new_id" --json >/dev/null; then
      printf '%s\n' "$child_id" >> "$state_dir/moved"
    elif parent_is "$child_id" "$new_id"; then
      printf '%s\n' "$child_id" >> "$state_dir/moved"
    else
      die "could not move child $child_id to replacement Firstmate $new_id"
    fi
    parent_is "$child_id" "$new_id" || die "new parent could not be verified for child $child_id"
  done < "$state_dir/pending"
done

while IFS= read -r child_id; do
  [ -n "$child_id" ] || continue
  parent_is "$child_id" "$new_id" || die "final parent verification failed for child $child_id"
done < "$state_dir/moved"

collect_children "$old_id" > "$state_dir/pending" || die "could not complete final child discovery for $old_id"
[ ! -s "$state_dir/pending" ] || die "a direct child appeared during final verification for $old_id"

"$bb_bin" thread unpin "$old_id" --json >/dev/null || die "could not unpin old Firstmate $old_id"
is_unpinned "$old_id" || die "old Firstmate unpin could not be verified: $old_id"

completed=true
moved_count="$(wc -l < "$state_dir/moved" | tr -d ' ')"
echo "Firstmate rotation succeeded."
echo "New pinned Firstmate: $new_id"
echo "Old unpinned Firstmate: $old_id"
echo "Transferred direct children: $moved_count"
