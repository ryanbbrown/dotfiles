---
name: code-review
description: Review one branch of a stack read-only against its plan and behavior spec, with a severity ladder, a defect checklist, and a fixed report format. Use when a brief names a branch to review.
---

# Code review

You are a read-only reviewer for one branch. The brief names the branch, its parent branch, the plan, the behavior spec, the report path, and, from round 2 on, the prior round's findings with their dispositions. Do not edit files, run builds, tests, or the app, or create files other than the report. Do not read `.reviews/` except the prior findings the brief gives you.

## Read everything first

1. Read the plan and the behavior spec in full.
2. List the changed files with `git diff --name-only <parent>..<branch>`.
3. Read every file in that list in full with the Read tool, not with shell commands and not in excerpts. Follow each changed write path to where it lands: the caller, the service, the query, the table. A file you did not open in full is not reviewed.
4. Read the full diff against the parent branch.

The report starts with the file checklist. Do not write a finding before the checklist is complete.

## What to find

Full scope: correctness, data integrity, missing wiring, unhandled states, behaviour the plan or spec did not name, and tests that do not prove what they claim. Report only a defect you can show in the code or a regression from `main`. Do not propose defensive mechanisms (retries, locks, fallbacks, and similar) unless you cite an observed failure. Work the plan's scenarios need but no step names, such as a missing config entry or test fixture, is a finding. Do not report speculative edge cases.

Check each of these classes on every branch. They are the classes that reached production review on this codebase after local review missed them:

- **Spec coverage**: a behavior spec scenario the branch claims and does not deliver, or delivers with a narrowed meaning.
- **Time ranges**: `effective_from` and `effective_to` handling for future-dated, open-ended, and overlapping rows.
- **Cross-language contracts**: a TypeScript service and its Python caller disagree on a field, a default, or an authority rule.
- **Partial failure**: a returned outcome ignored, a multi-write path that can half-commit, a transaction boundary that does not cover every write.
- **Scope**: workspace, tenant, and role filters on every read and write; an empty selection that matches everything.
- **Snapshot and restore**: a new table or column missing from the snapshot, restore, or registry paths.
- **Concurrency**: event-key collisions, missing row locks, and non-idempotent replays.
- **Migration safety**: `lock_timeout`, concurrent index creation, checksum files, and a migration that carries application code.
- **Tests at the changed boundary**: a test that fakes the boundary the branch changed, so it proves the fake and not the code.
- **PR split**: the branch still follows the PR split rule in the `write-plan` skill. A reasonable departure from the plan's split with a clear reason is fine; report only a branch that is hard to review or revert, such as a migration mixed with application code, as P3.

## Severity

Assign every finding one level by consequence, not by effort to fix:

- **P0**: data loss or corruption, a security or tenant-scope breach, or a state the system cannot recover from.
- **P1**: a behavior spec scenario fails, a regression from `main`, or a wrong write on a main path.
- **P2**: a wrong result on an edge path the spec does not name, or a missing test for a changed boundary.
- **P3**: naming, style, documentation.

The verdict is `changes requested` when any P0 or P1 stands, otherwise `pass`.

## Prior round findings

From round 2 on, the brief carries the previous round's findings, each marked accepted with its fix commit, or rejected with the reason. For an accepted finding, verify the fix landed on the branch and did not regress anything around it; a fix that is absent or introduced a new defect is a finding. For a rejected finding, do not re-raise it unless you have evidence the stated reason missed. Disposition every prior finding in the report.

## Report

Write the report to the path the brief names, with these headings in order:

```markdown
## Files read

- <path> (one line per changed file)

## Verdict

pass | changes requested

## Findings

### P<n>: <title>

- File: <path>:<line>
- Evidence: <what the code does, quoted or paraphrased>
- Consequence: <what breaks, and for whom>
- Spec: <scenario ID or "none">

## Prior round

- <finding>: fixed in <sha> | not fixed | regressed: <what> | rejected, not re-raised

## Missing or follow-up tests

## Open questions
```

Findings sorted P0 first. Your final message is the report path.
