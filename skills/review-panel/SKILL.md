---
name: review-panel
description: Run independent Codex, Claude Code, and GLM reviews against one frozen snapshot and report the output files. Use only when the user explicitly requests the review-panel skill.
disable-model-invocation: true
---

# Review panel

This skill only runs the review script. The calling workflow owns interpreting the reports, synthesizing findings, deciding what to change, and coordinating writers.

## Run in the background

Run from the repository being reviewed. Check managed processes first so you do not start a duplicate review for the same feature. Use the harness's managed background-process support; in Pi, use `process start` with a specific name such as `review-panel-<feature-slug>`, the repository as `cwd`, and exit notifications enabled. Do not use shell background syntax such as `&` or poll for completion.

For an implementation review:

```bash
~/.claude/skills/review-panel/scripts/review-round.sh --feature "feature name" --plan-file .plans/<plan-slug>.md --base-ref <pre-implementation-sha>
```

Capture the base SHA before implementation starts. The implementation writer may commit before review, so the current `HEAD` cannot define the feature range. The launcher rejects an implementation review without a base or with an empty base-to-snapshot diff.

Claude reviews use Claude Code OAuth only. The launcher removes Anthropic API key variables and verifies a first-party OAuth login before preflight. If OAuth is unavailable, stop and ask the user to run `claude auth login`. Do not add an API key fallback and do not bypass the OAuth failure.

For a plan review:

```bash
~/.claude/skills/review-panel/scripts/review-round.sh --feature "feature name" --mode plan --target-file .plans/<plan-slug>.md
```

When the background process exits, report whether it succeeded and identify the output directory and review round. On failure, inspect the managed process output and report the error. Do not synthesize or act on findings as part of this skill.

## Options

```text
--feature NAME       Required. Stable feature label; the script derives the version from this.
--repo PATH          Repository to review. Defaults to the current directory.
--output-dir PATH    Review output root. Defaults to <repo>/.reviews.
--mode MODE          Review mode: implementation or plan. Defaults to implementation.
--target-file PATH   Plan file to review, relative to repo or absolute within it. Required for plan mode.
--plan-file PATH     Existing implementation plan, relative to repo or absolute within it. Required for implementation mode.
--base-ref REF       Git commit recorded before implementation. Required for implementation mode.
--skip LIST          Comma-separated reviewers to skip: codex, claude, glm. Repeatable.
                     Cannot skip all three. Skipping glm needs no FIREWORKS_API_KEY.
--preflight-only     Run CLI smoke checks, then exit before starting reviewers.
```

## Environment

```text
MAX_ROUNDS=3                 Hard cap; defaults to 3.
FIREWORKS_API_KEY=...        Required unless GLM is skipped.
CODEX_MODEL=gpt-5.6-sol      Default Codex reviewer model.
GLM_MODEL=accounts/fireworks/models/glm-5p2
                             Default GLM reviewer model.
REVIEW_TIMEOUT_SECONDS=900   Per-reviewer timeout.
SKIP_PREFLIGHT=1             Optional escape hatch for local debugging.
```

`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` never authenticate the Claude reviewer. Fireworks credentials remain required only for the separate GLM reviewer.

## Output

The script chooses the next `vN` for the feature and writes:

```text
.reviews/plans/<feature-slug>/                  # plan mode
.reviews/implementations/<feature-slug>/       # implementation mode
  <feature-slug>-manifest-vN.md
  <feature-slug>-codex-vN.md
  <feature-slug>-claude-vN.md
  <feature-slug>-glm-5p2-vN.md
  .logs/vN/*.stdout
  .logs/vN/*.stderr                    # Retained only after a failure, timeout, or missing report.
```

The script freezes one repository snapshot for all reviewers without changing the real branch, index, or dirty worktree. The manifest records the snapshot and review configuration.
