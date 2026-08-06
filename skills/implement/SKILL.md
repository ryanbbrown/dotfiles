---
name: implement
description: Implement an approved plan with one subagent, run independent review panels, synthesize findings, return required fixes to the same implementation subagent, and run the requested or warranted review rounds. Use after planning is complete and implementation is authorized.
---

# Implement

Use this skill after an implementation plan is complete and approved. The main agent owns the workflow and remains the final decision-maker. Use one implementation subagent as the only writer for the active worktree.

## Required inputs

Before implementation, identify:

- the approved plan file
- a stable feature name for every review round
- the repository being changed
- the plan's acceptance checks and required validation
- the exact number of review rounds, if the user specified one

Ask the user about any unresolved product, scope, or architecture decision before launching the implementation subagent. Do not ask for a review-round count when the user did not provide one.

## Implement

1. List the available subagents and confirm that an implementation worker is executable.
2. Launch one implementation subagent with the plan path, approved scope, acceptance checks, validation requirements, and expected handoff. Do not edit the same worktree or launch another writer while it runs.
3. When the implementation subagent finishes, inspect its handoff. If implementation or required validation is incomplete, resume the same subagent to finish before review.

## Review and synthesize

1. Load and follow the `review-panel` skill in implementation mode, using the stable feature name and original plan. It runs the script in the background and reports the generated files.
2. After the review process succeeds, read the round manifest and every reviewer report.
3. Verify each finding against the frozen snapshot. Decide by evidence rather than reviewer count, and merge duplicate findings.
4. Write `<feature-slug>-synthesis-vN.md` next to that round's reports. This is the authoritative fix list for the implementation subagent.
5. For each required fix, include the source findings, file location, verified problem, required outcome, and validation. Briefly record findings that require a user decision or need no action, with the reason.
6. Ask the user only for decisions that cannot be made from the code and approved plan. Update the synthesis with each decision before continuing.

## Fix

If required fixes remain, resume the same implementation subagent. Pass it the original plan and synthesis file. Tell it to apply the required fixes, preserve approved decisions, run the listed validation, and return an updated handoff. Do not launch a fresh fix worker when the original subagent can be resumed, and do not ask it to reinterpret the raw review reports.

If no required fixes remain, skip the fix handoff.

## Decide whether to repeat

If the user specified a review-round count, run exactly that many rounds. Follow that count even when the dynamic guidelines below would choose a different number. Use the same feature name so the script creates the next version.

If the user did not specify a count, default to one review round. After fixes, use focused validation and inspect the final diff. Do not repeat only because a fix changed behavior or corrected a defect.

Run a second round only when the fixes are broad, high-risk, or difficult to validate directly. Examples include security, privacy, safety, data loss, concurrency, or major architecture changes. Run a third round only when the second-round fixes introduce another substantial high-risk change.

Do not repeat a round only to pursue optional polish. Treat the script's review-round cap as a safety limit, not a target. Do not hide unresolved required fixes or material risks when the final round ends.

## Complete

Inspect the final diff and confirm the required validation before reporting completion. Report the implementation result, validation evidence, synthesis files, review rounds, deferred findings, and residual risks.

A user decision pauses the workflow; it does not end it. After the user answers, continue with the saved implementation subagent when fixes remain. If that subagent cannot be resumed and substituting a new writer would lose important context, stop and ask the user.
