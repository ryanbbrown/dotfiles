---
name: implement
description: Plan and implement a task with exact plan and implementation review cycles. Use only when the user explicitly requests the implement skill.
---

# Implement

Invoke as:

```text
/implement [interview] [brief] p<N> i<N> — <task or approved plan>
```

Require both counts. `pN` is the number of successful plan-review cycles. `iN` is the number of successful implementation-review cycles. Zero means no panel for that phase. Run exactly the requested counts and no extra cycles.

The main agent owns planning, decisions, review synthesis, and final validation. Use one BB child thread in the current environment as the only implementation writer.

## Plan

Use an existing approved plan without recreating or reopening it. Otherwise inspect the task and the code, then write the plan with the `write-plan` skill.

Ask the user before writing only for a fork that changes what the product does or what the user sees, or for a fact the task and the code cannot supply. With `interview`, ask every unresolved design question. Put all questions in one message, each with a recommended answer, and wait. Settle every other fork yourself and record it in the plan.

When the plan is written, post this summary in the thread:

```markdown
Plan: .plans/<slug>.md

After this change:
- <responsibility>: <where it runs or lives> (moves | new | stays)

Decisions: D1 <title>. D2 <title>. ...
Forks: D<n>: <the other choice a reasonable agent might have made, one line>.
Not authorized: <one line, when the plan names one>.
```

With `brief`, also write `.reviews/briefs/<slug>.md`, post it in the thread, and wait for approval before any panel or implementation. The brief is for the user, who reads it to catch a wrong direction before it is built. It contains:

- Result shape: every responsibility the task touches, including the ones that stay where they are, with the language, process, or layer each one runs in after the change.
- A decision entry for each plan decision that the user would change the plan over: where a responsibility lives or what runs it, an interface, data format, or storage that other code depends on, a removed or replaced behaviour, a number such as a limit, default, or budget, and every fork named in the summary. Leave out naming, file layout inside one module, and test structure. The test: if the user disagreed, would the plan change?
- For an algorithm or data-flow decision, one extra line that states the mechanism, so the user can see what the code will do and not only where it lives.

```markdown
# <title>: decisions

## Result shape
| Responsibility | Before | After | Moves or stays |
|---|---|---|---|

## Decisions
### D1. <title>
- What: <end state, one or two lines>
- Instead of: <the alternative and why it lost>
- If wrong: <what the user would see>

## Questions
- <only when one exists>
```

For each requested plan-review cycle, run `review-panel` in plan mode, verify and synthesize its findings, and apply required revisions to the plan. Write the synthesis beside the reports. A cycle succeeds when the panel succeeds and its required revisions are resolved. A panel succeeds with at least two valid reviewer reports; a panel with fewer does not count. After the cycles, when a brief was approved and an accepted finding changed one of its decisions, post the changed decisions in the thread and continue.

Accept a finding into a synthesis only after you verify it against the code. A finding that proposes a retry, fallback, lock, checkpoint, resume path, timeout, validation layer, or compatibility path is rejected or deferred unless it cites an observed failure, a measured requirement, or a user requirement. Reviewers are adversarial by design; the synthesis is the filter.

## Implement

If implementation reviews are requested, require a clean worktree and record the pre-implementation Git SHA after the plan is settled.

Spawn the implementation writer with `bb thread spawn --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider pi --model openai-codex/gpt-5.6-sol --reasoning-level high --permission-mode full`. Give it the plan, acceptance checks, validation requirements, and review base when needed. Keep the brief focused on this work only.

Return control after spawning. BB reports the child's blockers and completion to this thread; do not poll or wait. Inspect its handoff and continue the same child with `bb thread tell <id> "..." --reasoning-level high --mode auto` until the implementation and required validation are complete.

For each requested implementation-review cycle, run `review-panel` in implementation mode against the original review base. Read every report, verify findings against the frozen snapshot, and write a synthesis beside the reports. Continue the same implementation child with required fixes and validation. A cycle succeeds when the panel succeeds, required fixes are complete, and required validation passes. A panel succeeds with at least two valid reviewer reports; a panel with fewer does not count.

Decide findings by evidence rather than reviewer count, with the same verification and mechanism rule as the plan synthesis. Send the implementation child the synthesis, not the raw reports.

## Stop boundaries

Stop for the user when a material product, scope, architecture, security, privacy, data-loss, or irreversible decision cannot be safely inferred.

The invocation does not authorize deployment, publishing, pushing, external communication, production changes, or spending outside the requested review panels. Require explicit authorization for those actions.

## Complete

Inspect the final diff and validation. Report the result, completed review counts, synthesis files, deferred findings, and residual risks.
