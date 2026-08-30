#!/usr/bin/env bash
set -euo pipefail

bb_bin="${BB_CLI:-bb}"
old_id="${BB_THREAD_ID:-}"
new_id=""
state_dir=""
completed=false
rollback_started=false
old_was_pinned=false

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

valid_text() {
  local value="$1"
  [[ -n "$value" && "$value" != *[[:cntrl:]]* ]]
}

thread_json() {
  "$bb_bin" thread show "$1" --json
}

thread_execution_json() {
  "$bb_bin" thread log "$1" --all --json | jq -cer '
    [.[] | select(.type == "client/turn/requested") | .data.execution | select(type == "object")] | last
  '
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
  local children_json

  children_json="$("$bb_bin" thread list --parent-thread "$parent_id" --include-hidden --json)" || return 1
  printf '%s\n' "$children_json" | jq -r '.[] | select(.archivedAt == null) | .id'
}

ensure_pinned() {
  local thread_id="$1"
  is_pinned "$thread_id" || {
    "$bb_bin" thread pin "$thread_id" --json >/dev/null && is_pinned "$thread_id"
  }
}

ensure_unpinned() {
  local thread_id="$1"
  is_unpinned "$thread_id" || {
    "$bb_bin" thread unpin "$thread_id" --json >/dev/null && is_unpinned "$thread_id"
  }
}

rollback() {
  local child_id
  local rollback_incomplete=false
  local old_pin_restored=false
  local replacement_unpinned=false

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

  if [ "$old_was_pinned" = true ]; then
    if ensure_pinned "$old_id"; then
      old_pin_restored=true
    else
      rollback_incomplete=true
    fi
    if ensure_unpinned "$new_id"; then
      replacement_unpinned=true
    else
      rollback_incomplete=true
    fi
  else
    if is_unpinned "$old_id"; then
      old_pin_restored=true
    else
      rollback_incomplete=true
    fi
    if is_unpinned "$new_id"; then
      replacement_unpinned=true
    else
      rollback_incomplete=true
    fi
  fi

  if [ "$rollback_incomplete" = false ]; then
    echo "Rollback complete. Old thread $old_id and replacement thread $new_id have their safe pre-rotation pin state." >&2
    return
  fi

  echo "Rollback incomplete." >&2
  echo "Old thread: $old_id" >&2
  echo "Replacement thread: $new_id" >&2
  if [ -s "$state_dir/rollback-child-failures" ]; then
    while IFS= read -r child_id; do
      echo "Child not returned to $old_id: $child_id" >&2
    done < "$state_dir/rollback-child-failures"
  fi
  [ "$old_pin_restored" = true ] || echo "Old thread pin state could not be restored: $old_id" >&2
  [ "$replacement_unpinned" = true ] || echo "Replacement thread unpin could not be verified: $new_id" >&2
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

workspace_supplies_firstmate() {
  local agents_path="$1"
  [ -f "$agents_path" ] || return 1
  grep -Eq '^#{1,6}[[:space:]]+Firstmate[[:space:]]*$' "$agents_path" &&
    grep -F 'FIRSTMATE-QUEUE.md' "$agents_path" >/dev/null
}

trap on_exit EXIT

command -v "$bb_bin" >/dev/null 2>&1 || die "bb is not installed"
command -v jq >/dev/null 2>&1 || die "jq is not installed"
valid_id "$old_id" thr || die "BB_THREAD_ID is missing or malformed"

old_json="$(thread_json "$old_id")" || die "cannot inspect current thread $old_id"
printf '%s' "$old_json" | jq -e --arg thread "$old_id" '.thread.id == $thread' >/dev/null ||
  die "BB_THREAD_ID does not identify the current thread"

project_id="$(printf '%s' "$old_json" | jq -er '.thread.projectId | select(type == "string")')" ||
  die "current thread project is missing"
environment_id="$(printf '%s' "$old_json" | jq -er '.thread.environmentId | select(type == "string")')" ||
  die "current thread environment is missing"
provider_id="$(printf '%s' "$old_json" | jq -er '.thread.providerId | select(type == "string")')" ||
  die "current thread provider is missing"
title="$(printf '%s' "$old_json" | jq -er '.thread.title | select(type == "string")')" ||
  die "current thread title is missing"
parent_id="$(printf '%s' "$old_json" | jq -r '.thread.parentThreadId // empty')"
section_id="$(printf '%s' "$old_json" | jq -r '.thread.sectionId // empty')"
visibility="$(printf '%s' "$old_json" | jq -r '.thread.visibility // empty')"
workspace_root="$(printf '%s' "$old_json" | jq -er '.environment.path | select(type == "string")')" ||
  die "current thread workspace root is missing"

valid_id "$project_id" proj || die "current thread project is malformed"
valid_id "$environment_id" env || die "current thread environment is malformed"
[[ "$provider_id" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "current thread provider is malformed"
valid_text "$title" || die "current thread title is malformed"
[ -z "$parent_id" ] || valid_id "$parent_id" thr || die "current thread parent is malformed"
[ -z "$section_id" ] || valid_token "$section_id" || die "current thread section is malformed"
case "$visibility" in
  ""|visible|hidden) ;;
  *) die "current thread visibility is malformed" ;;
esac
valid_text "$workspace_root" || die "current thread workspace root is malformed"
[[ "$workspace_root" == /* && "$workspace_root" != "/" ]] || die "current thread workspace root must be absolute"
workspace_root="${workspace_root%/}"
queue_path="$workspace_root/FIRSTMATE-QUEUE.md"
agents_path="$workspace_root/.bb/AGENTS.md"

if printf '%s' "$old_json" | jq -e '.thread.pinnedAt != null' >/dev/null; then
  old_was_pinned=true
fi

execution_json="$(thread_execution_json "$old_id")" || die "cannot inspect the current execution route"
route_model="$(printf '%s' "$execution_json" | jq -er '.model | select(type == "string")')" ||
  die "current model is missing"
reasoning_level="$(printf '%s' "$execution_json" | jq -er '.reasoningLevel | select(type == "string")')" ||
  die "current reasoning level is missing"
permission_mode="$(printf '%s' "$execution_json" | jq -er '.permissionMode | select(type == "string")')" ||
  die "current permission mode is missing"
service_tier="$(printf '%s' "$execution_json" | jq -er '.serviceTier | select(type == "string")')" ||
  die "current service tier is missing"

valid_token "$route_model" || die "current model is malformed"
case "$reasoning_level" in
  low|medium|high|xhigh|max) ;;
  *) die "current reasoning level is malformed" ;;
esac
case "$permission_mode" in
  accept-edits|auto|full) ;;
  *) die "current permission mode is malformed" ;;
esac
case "$service_tier" in
  fast|default) ;;
  *) die "current service tier is malformed" ;;
esac

state_dir="$(mktemp -d "${TMPDIR:-/tmp}/rotate-firstmate.XXXXXX")"
: > "$state_dir/moved"

if workspace_supplies_firstmate "$agents_path"; then
  printf -v prompt 'You replace thread %s as Firstmate for the same workspace setup. Read `%s` and `%s` now; they are the sources of truth. Use only that exact absolute queue path. Do not invoke the firstmate skill, search for another queue, or copy the old transcript. Do not start or delegate queue work in this turn. Existing direct children are being transferred to you. Confirm that you are ready, report any missing source-of-truth file, and give the user a clickable Markdown link to `%s`.' \
    "$old_id" "$agents_path" "$queue_path" "$queue_path"
else
  printf -v prompt 'You replace thread %s as Firstmate for the same workspace setup. Explicitly use the installed `firstmate` skill now. Bind `<workspace-root>` in that skill to the absolute path `%s`; its only queue is `%s`. Do not use a relative queue path, search for another queue, or copy the old transcript. Do not start or delegate queue work in this turn. Existing direct children are being transferred to you. Confirm that you are ready, report any missing source-of-truth file, and give the user a clickable Markdown link to `%s`.' \
    "$old_id" "$workspace_root" "$queue_path" "$queue_path"
fi

spawn_args=(
  thread spawn
  --project "$project_id"
  --environment "$environment_id"
  --provider "$provider_id"
  --model "$route_model"
  --reasoning-level "$reasoning_level"
  --service-tier "$service_tier"
  --permission-mode "$permission_mode"
  --title "$title"
  --prompt "$prompt"
  --json
)
[ -z "$parent_id" ] || spawn_args+=(--parent-thread "$parent_id")
[ -z "$section_id" ] || spawn_args+=(--section "$section_id")
[ -z "$visibility" ] || spawn_args+=(--visibility "$visibility")

spawn_json="$("$bb_bin" "${spawn_args[@]}")" || die "could not create the replacement thread"
new_id="$(printf '%s' "$spawn_json" | jq -er '.thread.id // .id | select(type == "string" and test("^thr_[[:alnum:]]+$"))')" ||
  die "bb created a replacement but did not return a valid thread ID"

"$bb_bin" thread wait "$new_id" --status idle --json >/dev/null ||
  die "replacement thread $new_id did not become ready"

new_json="$(thread_json "$new_id")" || die "cannot inspect replacement thread $new_id"
printf '%s' "$new_json" | jq -e \
  --arg thread "$new_id" \
  --arg project "$project_id" \
  --arg environment "$environment_id" \
  --arg provider "$provider_id" \
  --arg title "$title" \
  --arg parent "$parent_id" \
  --arg section "$section_id" \
  --arg visibility "$visibility" '
    .thread.id == $thread and
    .thread.projectId == $project and
    .thread.environmentId == $environment and
    .thread.providerId == $provider and
    .thread.title == $title and
    ((if $parent == "" then null else $parent end) == .thread.parentThreadId) and
    ((if $section == "" then null else $section end) == .thread.sectionId) and
    ($visibility == "" or .thread.visibility == $visibility) and
    .thread.status == "idle"
  ' >/dev/null || die "replacement thread $new_id failed identity verification"

new_execution_json="$(thread_execution_json "$new_id")" || die "cannot inspect replacement execution route"
printf '%s' "$new_execution_json" | jq -e \
  --arg model "$route_model" \
  --arg reasoning "$reasoning_level" \
  --arg permission "$permission_mode" \
  --arg tier "$service_tier" '
    .model == $model and
    .reasoningLevel == $reasoning and
    .permissionMode == $permission and
    .serviceTier == $tier
  ' >/dev/null || die "replacement thread $new_id did not preserve the execution route"

is_unpinned "$new_id" || die "replacement thread unexpectedly started pinned: $new_id"
if [ "$old_was_pinned" = true ]; then
  ensure_pinned "$new_id" || die "replacement thread pin could not be verified: $new_id"
fi

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
      die "could not move child $child_id to replacement thread $new_id"
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

if [ "$old_was_pinned" = true ]; then
  ensure_unpinned "$old_id" || die "old thread unpin could not be verified: $old_id"
else
  is_unpinned "$old_id" || die "old thread pin state changed during rotation: $old_id"
fi

completed=true
moved_count="$(wc -l < "$state_dir/moved" | tr -d ' ')"
echo "Firstmate rotation succeeded."
if [ "$old_was_pinned" = true ]; then
  echo "Replacement pinned thread: $new_id"
  echo "Old unpinned thread: $old_id"
else
  echo "Replacement unpinned thread: $new_id"
  echo "Old unpinned thread: $old_id"
fi
echo "Transferred unarchived direct children: $moved_count"
