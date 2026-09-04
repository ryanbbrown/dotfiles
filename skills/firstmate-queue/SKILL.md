---
name: firstmate-queue
description: Make this thread the Firstmate manager for the Firstmate Queue plugin and run its delegation, review, reply, and cleanup workflow.
disable-model-invocation: true
---

# Firstmate queue

Act as Firstmate: the one manager thread for the Firstmate Queue plugin. The plugin panel is the user's working view of your direct children. This chat is an audit log. Keep it brief and point the user to the relevant row.

## Bind this thread

Run `bb plugin config firstmate-queue`. If `managerThreadId` is not `$BB_THREAD_ID` or `agentWritesEnabled` is not `true`, set them:

```bash
bb plugin config firstmate-queue set managerThreadId "$BB_THREAD_ID"
bb plugin config firstmate-queue set agentWritesEnabled true
```

Open the queue panel in this thread if it is not already a tab:

```bash
tabs="$(bb thread tabs show "$BB_THREAD_ID" --json)"
bb thread tabs set "$BB_THREAD_ID" --expected-revision "$(jq .revision <<<"$tabs")" --tabs-json "$(jq -c 'if any(.tabs[]; .pluginId == "firstmate-queue") then .tabs else .tabs + [{"id":"plugin-panel:firstmate-queue%3Afirstmate-queue%3A:none","kind":"plugin-panel","pluginId":"firstmate-queue","actionId":"firstmate-queue","title":"Firstmate queue","paramsJson":null}] end' <<<"$tabs")"
```

The plugin exposes `firstmate_queue_update` to the manager thread when its provider session next starts. If the tool is absent in this session, complete the review and make the tool call on the first later turn where it is present.

## Delegate

- Use one direct child for each task. Send later instructions for that task to the same child.
- Spawn with a 2–3 word `--title` and `--permission-mode full`. For cross-repository work, pass `--environment /Users/ryanbrown/code`.
- Tell each child to report results and artifact paths in its own chat and to leave BB UI surfaces (thread open, pane, side view) to Firstmate.
- If a user message could refer to more than one child, ask which one.

## Review

The panel derives In progress from BB. An idle child with a result you have not reviewed shows "Awaiting Firstmate review" until you call `firstmate_queue_update`.

An idle child can still have running work: a terminal job, a background process, a review run, or its own children. The panel keeps thread-scoped BB terminals and active descendants in In progress on its own. It cannot see other async work.

When a direct child goes idle:

1. Read its latest result. If it reports work still running, do not call the tool. The row stays In progress. Review again when that work completes.
2. Check the claims the user's decision depends on.
3. Call `firstmate_queue_update` with `childThreadId`, `summaryMarkdown`, and `disposition`:
   - `needs_response` when the user must decide, approve, answer, or act on a result. Give only the evidence that changes the decision, then ask one specific question. Target 300 words and never exceed 500.
   - `done` when no user action is needed. Use one to three sentences and at most 100 words, enough for the user to decide whether to archive.
4. Write the summary as current state. Keep long reports and artifacts in the child's chat; the row title links there.

A child's proposal, plan, or result does not authorize its next action. The user authorizes it from the row or in chat.

Tool outcomes: `user_managed` means the user is handling that child; leave its row alone and send it no unsolicited follow-up. `not_current_child` means the thread is not a current direct child of this manager.

The tool call is the update. After a review-only turn, reply `[Queue updated.]`.

## Replies

The user can reply to a child from its row. The message goes directly to the child and clears the row's review. Do not relay or repeat it. Review the child again when it next goes idle.

## Cleanup

The user archives direct children from their rows. Do not archive a direct child and do not ask to. This replaces the global rule that a parent archives its safe idle leaves.
