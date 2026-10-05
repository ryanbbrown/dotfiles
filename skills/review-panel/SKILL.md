---
name: review-panel
description: Run Claude Code and Pi GPT-6 Sol reviews against one frozen snapshot and report the output files. Use only when the user explicitly requests the review-panel skill.
---

# Review panel

This skill starts the review. The calling workflow interprets the reports, decides what to change, and coordinates writers.

## Durable launch in BB

Run from the repository to review. Choose a terminal title that is unique to the feature and mode. Check `bb terminal list --thread "$BB_THREAD_ID" --json` for an active terminal with that exact title. If one exists, report it instead of starting a duplicate.

Launch exactly once for the request from the owning agent process. Use one `bb terminal-job run` call. The Terminal Jobs plugin owns the durable terminal, command log, outcome, and completion notice to the explicit owner thread.

```bash
bb terminal-job run \
  --title "review-panel-<feature-slug>" \
  --thread "$BB_THREAD_ID" \
  --notify-thread "$BB_THREAD_ID" \
  --artifact-root "$BB_THREAD_STORAGE/terminal-jobs" \
  --delivery queue \
  --json \
  -- \
  ~/.claude/skills/review-panel/scripts/review-round-pi.sh \
  --feature "feature name" \
  --plan-file .plans/<plan-slug>.md \
  --base-ref <pre-implementation-sha>
```

Replace only the review arguments after `review-round-pi.sh` for plan or custom mode. The result must contain a job ID; report a launch error and stop if it does not. The terminal ID can be null while the plugin resolves an uncertain launch. Keep the job ID. Then return control to BB. The plugin sends the queued stable-marker completion. Do not poll or wait.

Capture the base SHA before implementation starts. The implementation writer can commit before review, so current `HEAD` cannot define the feature range. The review command rejects an implementation review without a base or with an empty base-to-snapshot diff.

For a plan review, use these review arguments and a title that ends in `-plan`:

```text
--feature "feature name" --mode plan --target-file .plans/<plan-slug>.md
```

For a custom review, use these review arguments:

```text
--feature "architecture suggestions" --mode custom --target-file .html/architecture-suggestions.html --prompt "Assess each recommendation and state whether you agree, with repository evidence."
```

Use `--prompt @path/to/prompt.md` for a prompt stored in the repository. The custom text defines the review objective. The command still supplies the frozen snapshot, read-only rules, and repository context.

The panel runs Claude Code and Pi GPT-6 Sol against the same frozen snapshot. Its purpose is two different models on one review, not two independent tools.

The unused `scripts/review-round.sh` keeps the Codex and Grok reviewers. Neither CLI is installed on this machine. Do not run it.

Claude reviews use Claude Code OAuth only. The command removes Anthropic API key variables and verifies a first-party OAuth login before preflight. If OAuth is unavailable, stop and ask the user to run `claude auth login`.

Sol runs through the Pi CLI (`pi`) with the `openai-codex` OAuth login at high thinking. The command checks the login with `pi auth check` during preflight and runs the reviewer with `--no-context-files`, `--no-extensions`, and `--no-skills`, so the frozen prompt is its whole instruction set. If the login is unavailable, stop and ask the user to run `pi`, then `/login`, and choose `openai-codex`.

When the completion message arrives, run `bb terminal-job show <job-id> --json`. On success, inspect the review manifest and reports. On failure, inspect the terminal-job `output.log` and the retained review logs. Report the result, output directory, and review round. This skill does not synthesize or act on findings.

## Direct local use

Outside BB, or when durable execution is not needed, run the review command in the foreground:

```bash
~/.claude/skills/review-panel/scripts/review-round-pi.sh <review arguments>
```

It writes the same review artifacts. A round succeeds when both reviewers produce valid reports, or when the only reviewer that runs does. The manifest Outcome section names each reviewer that failed or produced an invalid report, and its logs stay under `.logs/vN/`. The command returns a non-zero status when preflight fails or fewer reviewers succeed than the round needs. It does not send a BB completion notice.

## Options

```text
--feature NAME       Required. Stable feature label; the script derives the version from this.
--repo PATH          Repository to review. Defaults to the current directory.
--output-dir PATH    Review output root. Defaults to <repo>/.reviews.
--mode MODE          Review mode: implementation, plan, or custom. Defaults to implementation.
--target-file PATH   File to review, relative to repo or absolute within it. Required for plan and custom modes.
--prompt TEXT|@PATH  Custom objective as inline text or an @-prefixed repository file. Required for custom mode.
--plan-file PATH     Existing implementation plan, relative to repo or absolute within it. Required for implementation mode.
--base-ref REF       Git commit recorded before implementation. Required for implementation mode.
--skip LIST          Comma-separated reviewers to skip: claude, sol. Repeatable.
                     Cannot skip both.
--preflight-only     Run CLI smoke checks, then exit before starting reviewers.
```

## Environment

```text
MAX_ROUNDS=3                    Hard cap; defaults to 3.
SOL_MODEL=openai-codex/gpt-6-sol
                                Pi Sol reviewer model.
REVIEW_TIMEOUT_SECONDS=900      Per-reviewer timeout.
SKIP_PREFLIGHT=1                Optional local debugging switch.
```

`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` never authenticate the Claude reviewer.

## Artifacts

Terminal Jobs writes durable execution evidence to:

```text
$BB_THREAD_STORAGE/terminal-jobs/<job-id>/
  launch.json
  output.log
  outcome.json
```

The review command chooses the next `vN` and writes:

```text
.reviews/plans/<feature-slug>/                  # plan mode
.reviews/custom/<feature-slug>/                 # custom mode
.reviews/implementations/<feature-slug>/       # implementation mode
  <feature-slug>-manifest-vN.md
  <feature-slug>-claude-vN.md
  <feature-slug>-sol-vN.md
  .logs/vN/*.stdout
  .logs/vN/*.stderr                    # Retained after a failure, timeout, or invalid report.
```

The command freezes one repository snapshot for all reviewers without changing the real branch, index, or dirty worktree. The manifest records the snapshot, the review configuration, and a Timing section with wall seconds per reviewer.
