#!/usr/bin/env bash
set -euo pipefail

bb_bin="${BB_CLI:-bb}"
old_id="${BB_THREAD_ID:-}"
project_id="${BB_PROJECT_ID:-}"
environment_id="${BB_ENVIRONMENT_ID:-}"
new_id=""
state_dir=""

die() {
  echo "rotate-firstmate failed: $*" >&2
  exit 1
}

cleanup() {
  [ -z "$state_dir" ] || {
    rm -f "$state_dir/moved" "$state_dir/pending"
    rmdir "$state_dir"
  }
}

thread_json() {
  "$bb_bin" thread show "$1" --json
}

is_pinned() {
  thread_json "$1" | jq -e '.thread.pinnedAt != null' >/dev/null
}

parent_is() {
  local thread_id="$1"
  local parent_id="$2"
  thread_json "$thread_id" | jq -e --arg parent "$parent_id" '.thread.parentThreadId == $parent' >/dev/null
}

collect_children() {
  local parent_id="$1"
  {
    "$bb_bin" thread list --parent-thread "$parent_id" --include-hidden --json
    "$bb_bin" thread list --parent-thread "$parent_id" --include-hidden --archived --json
  } | jq -sr '[.[][] | .id] | unique | .[]'
}

rollback() {
  local rollback_failed=0
  local child_id

  while IFS= read -r child_id; do
    [ -n "$child_id" ] || continue
    if "$bb_bin" thread update "$child_id" --parent-thread "$old_id" --json >/dev/null && parent_is "$child_id" "$old_id"; then
      continue
    fi
    echo "rollback failed for child $child_id" >&2
    rollback_failed=1
  done < "$state_dir/moved"

  if [ "$rollback_failed" -eq 0 ]; then
    if "$bb_bin" thread unpin "$new_id" --json >/dev/null && ! is_pinned "$new_id"; then
      echo "Rollback complete. Old Firstmate $old_id is still pinned; new thread $new_id is unpinned." >&2
    else
      echo "Children returned to $old_id, but new thread $new_id could not be unpinned." >&2
    fi
  else
    echo "Manual recovery is required. Both Firstmates remain pinned. Move every child listed in $state_dir/moved back to $old_id before unpinning $new_id." >&2
    state_dir=""
  fi
}

trap cleanup EXIT

command -v "$bb_bin" >/dev/null 2>&1 || die "bb is not installed"
command -v jq >/dev/null 2>&1 || die "jq is not installed"
[ -n "$old_id" ] || die "BB_THREAD_ID is not set"
[ -n "$project_id" ] || die "BB_PROJECT_ID is not set"
[ -n "$environment_id" ] || die "BB_ENVIRONMENT_ID is not set"

old_json="$(thread_json "$old_id")" || die "cannot inspect current thread $old_id"
printf '%s' "$old_json" | jq -e --arg project "$project_id" --arg environment "$environment_id" '
  .thread.parentThreadId == null and
  .thread.projectId == $project and
  .thread.environmentId == $environment and
  .thread.pinnedAt != null
' >/dev/null || die "invoke this from the pinned root Firstmate in the current project and environment"

provider_id="$(printf '%s' "$old_json" | jq -er '.thread.providerId')" || die "current Firstmate has no provider"
state_dir="$(mktemp -d "${TMPDIR:-/tmp}/rotate-firstmate.XXXXXX")"
: > "$state_dir/moved"

prompt='You are the new root Firstmate for this project. Read .bb/AGENTS.md and FIRSTMATE-QUEUE.md now; they are the sources of truth. This is a context handoff, not a new task. Do not copy or reconstruct the old transcript. Do not start or delegate queue work in this turn. Existing child threads are being transferred to you. Confirm that you are ready and report any missing source-of-truth file.'
spawn_json="$("$bb_bin" thread spawn --project "$project_id" --environment "$environment_id" --provider "$provider_id" --title Firstmate --prompt "$prompt" --json)" || die "could not create the new root Firstmate"
new_id="$(printf '%s' "$spawn_json" | jq -er '.thread.id // .id')" || die "bb did not return the new thread ID"

if ! "$bb_bin" thread wait "$new_id" --status idle --json >/dev/null; then
  die "new Firstmate $new_id did not become ready; old Firstmate $old_id is unchanged and pinned"
fi

new_json="$(thread_json "$new_id")" || die "cannot inspect new Firstmate $new_id"
printf '%s' "$new_json" | jq -e --arg project "$project_id" --arg environment "$environment_id" '
  .thread.parentThreadId == null and
  .thread.projectId == $project and
  .thread.environmentId == $environment and
  .thread.status == "idle"
' >/dev/null || die "new Firstmate $new_id failed readiness verification; old Firstmate $old_id is unchanged and pinned"

"$bb_bin" thread pin "$new_id" --json >/dev/null || die "could not pin new Firstmate $new_id; old Firstmate $old_id is unchanged and pinned"
is_pinned "$new_id" || die "bb did not confirm that new Firstmate $new_id is pinned; old Firstmate $old_id is unchanged and pinned"

collect_children "$old_id" > "$state_dir/pending"
while [ -s "$state_dir/pending" ]; do
  while IFS= read -r child_id; do
    [ -n "$child_id" ] || continue
    if "$bb_bin" thread update "$child_id" --parent-thread "$new_id" --json >/dev/null; then
      echo "$child_id" >> "$state_dir/moved"
    elif parent_is "$child_id" "$new_id"; then
      echo "$child_id" >> "$state_dir/moved"
    else
      echo "Could not move child $child_id to new Firstmate $new_id." >&2
      rollback
      exit 1
    fi
    if ! parent_is "$child_id" "$new_id"; then
      echo "bb did not confirm the new parent for child $child_id." >&2
      rollback
      exit 1
    fi
  done < "$state_dir/pending"
  collect_children "$old_id" > "$state_dir/pending"
done

while IFS= read -r child_id; do
  [ -n "$child_id" ] || continue
  if ! parent_is "$child_id" "$new_id"; then
    echo "Final verification failed for child $child_id." >&2
    rollback
    exit 1
  fi
done < "$state_dir/moved"

if ! "$bb_bin" thread unpin "$old_id" --json >/dev/null || is_pinned "$old_id"; then
  die "all children moved to pinned Firstmate $new_id, but old Firstmate $old_id could not be unpinned; both may remain pinned"
fi

moved_count="$(wc -l < "$state_dir/moved" | tr -d ' ')"
echo "Firstmate rotation succeeded."
echo "New pinned Firstmate: $new_id"
echo "Old unpinned Firstmate: $old_id"
echo "Transferred direct children: $moved_count"
