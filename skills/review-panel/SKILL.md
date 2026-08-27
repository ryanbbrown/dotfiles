---
name: review-panel
description: Run independent Codex, Claude Code, and GLM reviews against one frozen snapshot and report the output files. Use only when the user explicitly requests the review-panel skill.
---

# Review panel

This skill only runs the review script. The calling workflow owns interpreting the reports, synthesizing findings, deciding what to change, and coordinating writers.

## Launch rule

Invoke `review-round-bb.sh` directly from the owning agent process. The wrapper creates and owns the BB durable terminal. Do not put it inside `bb terminal create`, `nohup`, shell background syntax such as `&`, or `bb terminal wait`. After the wrapper returns the terminal identity, return control to BB.

Run from the repository being reviewed. Check `bb terminal list --thread "$BB_THREAD_ID"` first so you do not start a duplicate review for the same feature. When the terminal exits, the wrapper sends the owning thread a queued completion message through `bb thread tell`.

For an implementation review:

```bash
~/.claude/skills/review-panel/scripts/review-round-bb.sh --title "review-panel-<feature-slug>" -- --feature "feature name" --plan-file .plans/<plan-slug>.md --base-ref <pre-implementation-sha>
```

Capture the base SHA before implementation starts. The implementation writer may commit before review, so the current `HEAD` cannot define the feature range. The launcher rejects an implementation review without a base or with an empty base-to-snapshot diff.

Claude reviews use Claude Code OAuth only. The launcher removes Anthropic API key variables and verifies a first-party OAuth login before preflight. If OAuth is unavailable, stop and ask the user to run `claude auth login`. Do not add an API key fallback and do not bypass the OAuth failure.

For a plan review:

```bash
~/.claude/skills/review-panel/scripts/review-round-bb.sh --title "review-panel-<feature-slug>-plan" -- --feature "feature name" --mode plan --target-file .plans/<plan-slug>.md
```

For a custom review of any repository file:

```bash
~/.claude/skills/review-panel/scripts/review-round-bb.sh --title "review-panel-architecture-suggestions" -- --feature "architecture suggestions" --mode custom --target-file .html/architecture-suggestions.html --prompt "Assess each recommendation and state whether you agree, with repository evidence."
```

Use `--prompt @path/to/prompt.md` for a prompt stored in the repository. The custom text defines the review objective. The launcher still supplies the frozen snapshot, read-only rules, and repository context.

When the terminal completion message arrives, inspect the generated manifest and reports. Report whether it succeeded and identify the output directory and review round. On failure, inspect the retained review logs and report the error. Do not synthesize or act on findings as part of this skill.

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
--skip LIST          Comma-separated reviewers to skip: codex, claude, glm. Repeatable.
                     Cannot skip all three. Skipping glm needs no FIREWORKS_API_KEY.
--preflight-only     Run CLI smoke checks, then exit before starting reviewers.
```

## Environment

```text
MAX_ROUNDS=3                 Hard cap; defaults to 3.
CODEX_MODEL=gpt-5.6-sol      Default Codex reviewer model.
GLM_MODEL=accounts/fireworks/models/glm-5p2
                             Default GLM reviewer model.
REVIEW_TIMEOUT_SECONDS=900   Per-reviewer timeout.
SKIP_PREFLIGHT=1             Optional escape hatch for local debugging.
```

`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` never authenticate the Claude reviewer.

## Output

The script chooses the next `vN` for the feature and writes:

```text
.reviews/plans/<feature-slug>/                  # plan mode
.reviews/custom/<feature-slug>/                 # custom mode
.reviews/implementations/<feature-slug>/       # implementation mode
  <feature-slug>-manifest-vN.md
  <feature-slug>-codex-vN.md
  <feature-slug>-claude-vN.md
  <feature-slug>-glm-5p2-vN.md
  .logs/vN/*.stdout
  .logs/vN/*.stderr                    # Retained only after a failure, timeout, or missing report.
```

The script freezes one repository snapshot for all reviewers without changing the real branch, index, or dirty worktree. The manifest records the snapshot and review configuration.
