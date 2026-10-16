---
name: ship-small
description: Build a small, low-risk change on one branch, with one GPT-6.1 Sol code review, the final test pass, and browser verification for UI changes. The light version of `ship`.
disable-model-invocation: true
---

# Ship small

Invoke as:

```text
/ship-small <task>
```

A small change is one PR with a diff of about 500 lines or fewer. The task statement is the acceptance criteria; there is no spec or plan. You write the code yourself in this thread.

## Fit check

Before you write code, read the task and the code it touches. Switch to `ship` and stop for the user when the change:

- Needs more than one PR.
- Adds, changes, or removes a persistent write path, as the `write-path-rehearsal` skill defines it.
- Adds a database migration.
- Changes auth, permissions, or tenant scope.
- Needs a product or design decision that the task does not settle.

Done when none of these apply, or you have stopped for the user.

## Build

1. Make the change on one branch and commit it. Build what the task needs, including work it does not name (a config entry, a caller), and nothing else. Add no unit tests.
2. Check the change with type checks, lint, and by running it. Done when all three pass.

## Code review

Spawn one read-only reviewer with `bb thread spawn --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider pi --model openai-codex/gpt-6.1-sol --reasoning-level high --permission-mode full`. The brief: read the `code-review` skill; review branch B against parent P; there is no plan or spec, so the task statement below is the acceptance criteria; write the report to `.reviews/code/<slug>/<branch>-v<N>.md`. Paste the task statement into the brief.

Return control. When the report lands, verify each finding against the code and apply the `decide` skill. Fix the accepted P0 and P1 findings and rerun the review with a fresh child. Stop at a clean round (zero P0 and zero P1), or after two rounds, when the open findings go to the user.

## Final test pass

Run the `final-test-pass` skill on the branch. An unexpected failure stops for the user.

## Browser verification

Run this only when the change affects UI. Bring the app up with the repository's own commands. Record the changed flow as the Recording section of the `browser-verify` skill describes, then build the combined video as its Combined video section describes; for a static visual change, take only its screenshot. Skip the rest of that skill. Run `agent-browser close --all` when done. Done when the capture shows the change working.

## Push

Push only on the user's word. Open the PR ready for review and report its link. When the task has a Linear ticket and you made a combined video, attach it to the ticket, and link the ticket in the PR body for the video, since Linear file URLs expire.

## Complete

Report the result, the code review rounds and their findings, the final test pass table, and a link to the combined video or the screenshot if one was made.
