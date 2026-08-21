---
name: implement
description: Plan and implement a task in interview or direct mode with exact plan and implementation review cycles. Use only when the user explicitly requests the implement skill.
---

# Implement

Invoke as:

```text
/implement <interview|direct> p<N> i<N> — <task or approved plan>
```

Require both counts. `pN` is the number of successful plan-review cycles. `iN` is the number of successful implementation-review cycles. Zero means no panel for that phase. Run exactly the requested counts and no extra cycles.

The main agent owns planning, decisions, review synthesis, and final validation. Use one implementation subagent as the only implementation writer.

## Plan

Use an existing approved plan without recreating or reopening it. Otherwise create a plan that states the scope, decisions, acceptance checks, and required validation.

- `interview`: inspect the task and code, identify the few important unresolved design decisions, give a recommendation for each, and wait for the user. After the user responds, create the plan and continue.
- `direct`: inspect the task and code, make clear bounded decisions, create the plan, and continue without unnecessary questions.

For each requested plan-review cycle, run `review-panel` in plan mode, verify and synthesize its findings, and apply required revisions to the plan. Write the synthesis beside the reports. A cycle succeeds when the panel succeeds and its required revisions are resolved. A failed panel does not count.

## Implement

If implementation reviews are requested, require a clean worktree and record the pre-implementation Git SHA after the plan is settled.

Launch one implementation subagent with the plan, acceptance checks, validation requirements, and review base when needed. Inspect its handoff and resume the same subagent until the implementation and required validation are complete.

For each requested implementation-review cycle, run `review-panel` in implementation mode against the original review base. Read every report, verify findings against the frozen snapshot, and write a synthesis beside the reports. Resume the same implementation subagent with required fixes and validation. A cycle succeeds when the panel succeeds, required fixes are complete, and required validation passes. A failed panel does not count.

Decide findings by evidence rather than reviewer count. Send the implementation subagent the synthesis, not the raw reports.

## Stop boundaries

In `direct` mode, stop for the user when a material product, scope, architecture, security, privacy, data-loss, or irreversible decision cannot be safely inferred.

The invocation does not authorize deployment, publishing, pushing, external communication, production changes, or spending outside the requested review panels. Require explicit authorization for those actions.

## Complete

Inspect the final diff and validation. Report the result, completed review counts, synthesis files, deferred findings, and residual risks.
