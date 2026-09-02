---
name: review-panel
description: Run independent Codex, Claude Code, and Grok 4.5 reviews against one frozen snapshot and report the output files. Use only when the user explicitly requests the review-panel skill.
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
  ~/.claude/skills/review-panel/scripts/review-round.sh \
  --feature "feature name" \
  --plan-file .plans/<plan-slug>.md \
  --base-ref <pre-implementation-sha>
```

Replace only the review arguments after `review-round.sh` for plan or custom mode. The result must contain a job ID; report a launch error and stop if it does not. The terminal ID can be null while the plugin resolves an uncertain launch. Keep the job ID. Then return control to BB. The plugin sends the queued stable-marker completion. Do not poll or wait.

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

Claude reviews use Claude Code OAuth only. The command removes Anthropic API key variables and verifies a first-party OAuth login before preflight. If OAuth is unavailable, stop and ask the user to run `claude auth login`.

Grok reviews always use the script-owned `grok-4.5` model through the official Grok Build CLI and grok.com OAuth from the user's SuperGrok account. Callers cannot override this model. The command removes `XAI_API_KEY` from every Grok process, checks for a cached account login, and verifies model access during preflight. Grok receives built-in read, list, grep, and terminal tools under `bypassPermissions` and a read-only sandbox, so a denied call returns to the model instead of ending its turn. It inspects the exact base-to-snapshot changes with supported read-only commands such as `git diff`; edit, write, web, subagent, and MCP access remain unavailable. If OAuth is unavailable, stop and ask the user to run `grok login` and complete the browser sign-in.

When the completion message arrives, run `bb terminal-job show <job-id> --json`. On success, inspect the review manifest and reports. On failure, inspect the terminal-job `output.log` and the retained review logs. Report the result, output directory, and review round. This skill does not synthesize or act on findings.

## Direct local use

Outside BB, or when durable execution is not needed, run the review command in the foreground:

```bash
~/.claude/skills/review-panel/scripts/review-round.sh <review arguments>
```

It writes the same review artifacts. A round succeeds when at least two reviewers produce valid reports, or when the only reviewer that runs does. The manifest Outcome section names each reviewer that failed or produced an invalid report, and its logs stay under `.logs/vN/`. The command returns a non-zero status when preflight fails or fewer reviewers succeed than the round needs. It does not send a BB completion notice.

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
--skip LIST          Comma-separated reviewers to skip: codex, claude, grok. Repeatable.
                     Cannot skip all three.
--preflight-only     Run CLI smoke checks, then exit before starting reviewers.
```

## Environment

```text
MAX_ROUNDS=3                 Hard cap; defaults to 3.
CODEX_MODEL=gpt-5.6-sol      Default Codex reviewer model.
REVIEW_TIMEOUT_SECONDS=900   Per-reviewer timeout.
SKIP_PREFLIGHT=1             Optional local debugging switch.
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
  <feature-slug>-codex-vN.md
  <feature-slug>-claude-vN.md
  <feature-slug>-grok-4-5-vN.md
  .logs/vN/*.stdout
  .logs/vN/grok.streaming.jsonl        # Grok tool and message stream.
  .logs/vN/*.stderr                    # Retained after a failure, timeout, or invalid report.
```

The command freezes one repository snapshot for all reviewers without changing the real branch, index, or dirty worktree. The manifest records the snapshot, the review configuration, and a Timing section with wall seconds per reviewer and the Grok-reported duration and cost.
