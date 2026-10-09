---
name: implement
description: Plan and implement a task from an approved plan, with a cross-model plan review, a per-branch GPT-6 Sol code review through the `code-review` skill, browser verification, and a bot-review fix loop after push. Use only when the user explicitly requests the implement skill.
---

# Implement

Invoke as:

```text
/implement <task or approved plan>
```

The plan gets one cross-model review unless the user asks to skip it.

Each PR in the plan's `## PR split` section is one branch. Every branch gets a GPT-6 Sol code review before the push, and the repository's PR bots review after it. The main agent owns planning, decisions, finding verification, synthesis, and final validation. One BB child thread in the current environment is the only implementation writer for a stack.

## Tools

- **Branch:** `git switch -c <branch>`
- **App setup:** the repository's documented commands.

## Plan

Use an existing approved plan without recreating or reopening it. Otherwise inspect the task and the code, then write the plan with the `write-plan` skill.

The `write-plan` skill ends by posting the plan's `## PR split`, `## Out of scope`, and `## Open questions` sections and waiting. Wait for the user's approval of those three sections before any plan review or implementation, unless the user said at the start to skip this approval. An open question that names a behavior spec scenario blocks until the user answers it.

Unless the user asked to skip the plan review, spawn one read-only reviewer child from the other model family, so the plan's author never reviews its own plan. Read `providerId` from `bb thread show --self --json`. When it is `claude-code`, spawn with `--provider pi --model openai-codex/gpt-6-astra --reasoning-level high`; when it is `pi`, spawn with `--provider claude-code --model "claude-opus-5-5[1m]" --reasoning-level high`. Always add `--project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --permission-mode full`. The brief names the plan path and the report path `.reviews/plans/<slug>/<slug>-review.md`, and contains these terms, verbatim:

```text
You are a read-only plan reviewer. Read the plan, the behavior spec it names, and the code it touches. Do not edit files, run builds or tests, or create files other than the report. Do not read .reviews/ or earlier review rounds. Review at two levels. Strategy: is this the right approach? Name every bad decision: a wrong design, a missing or unneeded piece, a simpler approach the existing code supports, a behavior change from main that the spec does not ask for, or a PR split that will be hard to ship. Validity: find where the plan is wrong about the code, where a spec scenario is not delivered by the steps mapped to it or is narrowed outside "Out of scope", and where the plan would break an existing behaviour. Do not propose defensive mechanisms (retries, locks, fallbacks, and similar) unless you cite an observed failure. Write the report with these headings, in order: ## Verdict (pass or changes requested), ## Findings (each with file evidence), ## Missing or follow-up tests, ## Open questions. Your final message is the report path.
```

Return control after spawning; BB reports the child's completion. When the report lands, verify each finding against the code and revise the plan directly for the ones that hold. You own the plan, so the plan is the record; do not write a synthesis file. Post one short message: accepted findings by number, and each rejected finding with its reason. The review is complete when the report has a valid verdict and its required revisions are resolved; a missing or unparseable report is rerun once with a fresh child. There is no second round by default. When the review changed the PR split, Out of scope, or an acceptance criteria mapping, post the changed sections and wait for approval again; the user may also ask for another round, which runs the same way with a fresh child and a `-v2` report.

Accept a finding only after you verify it against the code. A finding that proposes a retry, fallback, lock, fence, checkpoint, resume path, sweep, timeout, validation layer, or compatibility path is rejected or deferred unless it cites an observed failure, a measured requirement, or a user requirement. Reviewers are adversarial by design; your verification is the filter. This rule also governs the bot-review synthesis below.

## Implement

Require a clean worktree and record the pre-implementation Git SHA after the plan is settled.

Spawn the writer with `bb thread spawn --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider claude-code --model "claude-opus-5-5[1m]" --reasoning-level high --permission-mode full`. The writer brief contains the plan path, the branch name prefix, and these standing terms, verbatim, with `<branch command>` replaced by the Branch command from Tools:

```text
Scope: build what the plan's steps and the behavior spec scenarios they map to need, including work no step names (a test fixture, a config entry, a caller), and nothing else. The plan's "Out of scope" section is binding. Do not add defensive mechanisms (a lock, revision fence, retry, sweep, fallback, cache) that no scenario needs. If a scenario cannot be met as planned, or meeting it needs a decision the plan and spec do not settle, stop and ask. Same rule for every fix round.
Local state: never run destructive local commands (database reset, seed, data deletion) unless the validation section names them.
Git: one branch per PR in the plan's "PR split" section, in merge order. Create each with `<branch command>` on top of the previous branch, commit that PR's steps there, and run each step's "Verify" line and the plan's "Test & verification plan" commands that apply before you start the next branch. No push, no PR.
```

Return control after spawning. BB reports the child's blockers and completion to this thread; do not poll or wait. Continue the same child with `bb thread tell <id> "..." --reasoning-level high --mode auto` until every step and its verification are complete. One writer builds the whole stack: each fix low in the stack restacks everything above it, so two writers would rebase over each other. Start a fresh writer for a new stack, or when the current one has accumulated its own design ideas; context is not worth drift.

### Code review

When the writer reports the build complete, review every branch before browser verification or push. Spawn one read-only reviewer per branch, in parallel, with `bb thread spawn --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider pi --model openai-codex/gpt-6-sol --reasoning-level high --permission-mode full`. The brief is short: read the `code-review` skill; review branch B against parent P, the plan at `.plans/<slug>.md`, and the behavior spec at <location>; write the report to `.reviews/code/<slug>/<branch>-v<N>.md`. From round 2 on, the brief also carries the previous round's findings, each marked accepted with its fix commit or rejected with the reason.

Return control. When the reports land, verify each finding against the code and apply the `decide` skill: fix what falls inside the plan and spec by sending the writer one fix round, grouped by branch, bottom of the stack first; raise a finding that needs a preference the plan and spec did not settle. A round is clean when it confirms zero P0 and zero P1; accepted P2 and P3 findings ride along in a fix round that happens anyway and are otherwise left to the PR bots. After a fix round, rerun the reviewer with a fresh child on every branch the round changed. Stop at a clean round, or after three rounds, when the open P0 and P1 findings go to the user.

### Browser verification

Skip this when the plan's "Test & verification plan" names no browser flows; its commands are the verification. Otherwise, after the code review:

1. Have the writer bring the app up with the repository's own setup, service, seed, and health commands, as listed under App setup in Tools. Run each service in its own BB terminal, `bb terminal create --environment "$BB_ENVIRONMENT_ID" --title <service> --command "<command> 2>&1 | tee .reviews/verify/<slug>/logs/<service>.log"`, so it persists and shows in the BB UI. It reuses a healthy running service and stops for a human-owned blocker such as expired auth or Docker down, which you report as unverified.
2. Have the writer write `.reviews/verify/<slug>/readiness.md` with these headings, each filled:
   - **Flows**: the browser flows from the plan's "Test & verification plan": entry URL, steps, expected UI result, and tables written per flow.
   - **Services**: URL and port per service, and the health check that passed for each.
   - **Login**: the dev or test login path and credentials source, or "none needed".
   - **Logs**: the teed log file paths.
   - **Database**: how to open a query shell and the tables the flows write.
   - **Previous round** (round 2 and later): the last verdict's issues, now claimed fixed.
3. Record a fingerprint: `git status --porcelain` and `git diff HEAD | shasum -a 256`.
4. Spawn the verifier with `bb thread spawn --project "$BB_PROJECT_ID" --environment "$BB_ENVIRONMENT_ID" --parent-self --provider claude-code --model "claude-opus-5-5[1m]" --reasoning-level high --permission-mode full`. The brief is one line: read the `browser-verify` skill, verify `.reviews/verify/<slug>/readiness.md`, and write the verdict to `.reviews/verify/<slug>/round-<N>.md`. Return control.
5. On completion, recompute the fingerprint. A changed worktree voids the verdict: discard it and rerun the round. A missing round file, an unparseable verdict, or a PASS with an empty walkthrough is unverified, never a pass; rerun the round once, then treat it as FAIL with the verifier's output as the issue.
6. FAIL: send the issues to the writer as a fix round, then start the next round from step 2. Three rounds is the cap; past it, report the open issues as unverified and stop for the user.
7. PASS: the round file's walkthrough goes into the PR body as verification evidence, and your report to the user links each flow's trimmed video.

## Push

Push only on the user's word. Before pushing, identify whether the result is one PR or a stack. For each branch, bottom first, run `git push -u origin <branch>`, then `gh pr create --base <parent branch> --fill`. Submit ready for review, never draft; the bots skip drafts. Record every PR whose head was created or changed, in bottom-to-top order.

After pushing, use the repository's CI and preview wait scripts and documented stop rules when available; wait for the matching preview before browser verification against it.

## Bot review loop

Report every PR link. When the repository has no PR bots, the work is done.

## Stop boundaries

Stop for the user when a material product, scope, architecture, security, privacy, data-loss, or irreversible decision cannot be safely inferred, and at every point named above: plan approval, push, and findings raised under the `decide` skill.

For a stack, the push checkpoint must name every branch or PR that the stack submit will create or update. If that set changes, stop for renewed push approval.

The invocation does not authorize deployment, publishing, external communication, production changes, or spending outside the plan review and the requested fix cycles.

## Complete

Inspect the final diff and validation. Report the result, whether the plan was reviewed, the code review reports per branch, the fix cycles run and their synthesis files, deferred findings, and residual risks.
