---
name: pr-review-loop
description: After a push that opens or updates pull requests, wait for CI and the review bots on the current heads, then fix or answer every failing check and every open review thread. Use after every such push, whether or not the ship skill ran, and before you tell the user a PR is done.
---

# PR review loop

A PR is done only when both are true on its current head:

- Every check passes, or each failure has a named cause that the user has seen.
- Every review thread, from a bot or a person, has a fix on the PR head or a reply that gives the reason for no fix.

Never tell the user a PR is done, clean, or ready from memory or from an earlier head. Check again after every push.

## Review set

List every PR whose head the push created or changed, in bottom-to-top order for a stack. A restack changes the heads of descendant PRs, so include them. The loop covers the whole set; one clean PR does not make the stack clean.

## Wait

Use the repository's CI and preview wait scripts and documented stop rules when available. Pin each wait to the current head SHA. Wait for the review bots to post on that head before you read threads; a bot that has not finished is not a clean review. When the repository has no PR bots, wait only for checks.

## Read every thread

Read review threads with the GraphQL `reviewThreads` connection and its `isResolved` field, and page until `pageInfo.hasNextPage` is false. Do not use `gh api repos/<owner>/<repo>/pulls/<n>/comments` without `--paginate`: it returns 30 comments per page, and bots often post more than that. Read the review summaries (`pulls/<n>/reviews`, paginated) too; a bot that found nothing appears only there.

For checks, run `gh pr checks <n>` on each PR and open the log of each failure.

## Decide and act

Verify each thread against the code before you act. Classify it as real, already fixed in a higher PR of the stack, an expected failure from a known app bug, by design (name the decision), speculative, or style. Decide what to fix with the `decide` skill.

- Real: fix it on the lowest branch that owns the line, validate, push, then reply with the commit and resolve the thread.
- Every other class: reply with the reason, then resolve the thread.
- A failing check: find the cause in its log. Fix it when this work caused it; otherwise name the cause to the user.

Reply to every thread you act on, so each PR carries the reasoning. Resolve a fixed thread only after the fix is on the PR head.

## Repeat

The bots review again after each push. Run the loop again on the new heads. Stop after 2 fix rounds, or the number the user names (at most 3), or when the latest heads meet the done rule above. Then report a table with one row per open item: PR, check or file:line, verdict, action.
