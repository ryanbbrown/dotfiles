---
name: pr-body
description: Rewrite a pull request description so a coworker can understand it before review. User-invoked only.
disable-model-invocation: true
---

# PR body

Write for a coworker reading about this area for the first time, who will not read the diff. Every sentence must make sense to them on its own. The diff, the review bots, and the reviewer's agent cover the code.

The body describes the PR as it is right now. It is a snapshot, not a changelog: how the code got here (review rounds, bot findings, fixes to earlier pushes, decisions revisited) never appears. A reader who arrives after the tenth push sees the same body they would have seen if the first push had been the final one.

Length: one sitting. The reader should finish it in a few minutes. Fewer than twenty bullets across the whole body is the norm; a section that wants more is grouped by the wrong axis.

## Steps

1. Identify the PR: the argument, or the PR for the current branch via `gh pr view --json number,title,body,baseRefName`.
2. Read the diff against the base branch, the current PR body, and the plan or thread for this work when one exists.
3. For a user-facing change, collect the screenshots first. Ask the user whether they have them; otherwise capture the user-facing states as screenshots. Screenshots carry the UI; the text carries what a screenshot cannot show.
4. Write the body to `~/code/scratch/pr-<number>-body.md` using the headings from the repository's `.github/pull_request_template.md` and the rules below.
5. Stop. Give the user the path and wait for them to read it. Edit the same file until they say it reads right.
6. Push it with `gh pr edit <number> --body-file ~/code/scratch/pr-<number>-body.md`.

## Rules

**What**

1. Group by concept, one bold lead per group: the setting, the new state, the trigger. Surfaces (page, card, button) appear inside the group they belong to, named as the UI and code name them. A group is one to four bullets.
2. On first mention of a data structure, say what it is and where it lives: column, JSON field, or table; per integration or per workspace. Then say what it does.
3. For a rule a reader would otherwise get wrong, write the pair: "Before: X. Now: Y." Three or four such pairs in a body; the rest of the change is described in its end state only.
4. For behavior that happens only sometimes, name the trigger: the user action, system event, or failed request.
5. One idea per bullet, one to three sentences.
6. When screenshots exist, the What section points at them ("see Reading state below") and describes only what they cannot show: triggers, data, rules, and what happens between the pictures.
7. End with **Blast radius**: the area this PR touches, then each adjacent thing a coworker would ask about. Mark each one with the word "unchanged" or "same as today". Edge cases the PR handles belong here as one line each, not as their own bullets under What.
8. Add **Not in this PR** for problems this PR exposes or leaves in place that will be fixed elsewhere. For each: the problem, and where the fix lands (a later PR in the stack, a ticket, or "follow-up").

**Risk assessment**

9. Name the specific thing that can go wrong. One line when nothing specific applies.

**Test plan**

10. Manual steps state the account, the data, and what was checked. Keep the existing test plan when it already does. Bot review counts and fix rounds are history and stay out.

**Screenshots**

11. One per user-visible state, captioned with the state's name as the UI shows it. Embed them; never leave a placeholder or a local path.
