---
name: multi-review
description: Run a read-only multi-agent code review round for a named feature using Codex, Claude Code, and GLM (via Fireworks). Use when a writer has finished changes and needs parallel reviewer feedback captured into versioned files before deciding what to fix.
---

# Multi Review

Use this skill after the writer has implemented a feature and run the required tests, or when a plan needs a read-only multi-agent review before implementation. The review round is deterministic orchestration: three read-only reviewer CLIs run in parallel, their final feedback is captured to files, and the writer decides what to fix.

## Run

From the repository being reviewed:

```bash
/Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "feature name"
```

For plan review:

```bash
/Users/ryanbrown/code/global-agent-context/plugins/personal/skills/multi-review/scripts/review-round.sh --feature "feature name" --mode plan --target-file .plans/<plan-slug>.md
```

Plan reviewers may inspect source and tests needed to evaluate the target plan, but must not read prior review outputs, `.reviews/`, reviewer logs, generated feedback files, or other planning documents as evidence.

Options:

```bash
--feature NAME       Required. Stable feature label; the script derives the version from this.
--repo PATH          Repository to review. Defaults to the current directory.
--output-dir PATH    Review output root. Defaults to <repo>/.reviews.
--mode MODE          Review mode: implementation or plan. Defaults to implementation.
--target-file PATH   File to review, relative to repo or absolute. Required for plan mode.
--skip LIST          Comma-separated reviewers to skip: codex, claude, glm. Repeatable.
                     Cannot skip all three. E.g. --skip codex or --skip codex,glm.
                     Skipping glm needs no FIREWORKS_API_KEY; skipping codex saves Codex usage.
--preflight-only     Run CLI smoke checks, then exit before starting reviewers.
```

Environment:

```bash
MAX_ROUNDS=3                 # hard cap, default 3
FIREWORKS_API_KEY=...        # required for the GLM reviewer; export in your shell
GLM_MODEL=accounts/fireworks/models/glm-5p2
                             # default GLM reviewer model (Fireworks)
REVIEW_TIMEOUT_SECONDS=900   # per-reviewer timeout
SKIP_PREFLIGHT=1             # optional escape hatch for local debugging
```

The script runs preflight smoke checks before starting reviewer work. Both Claude and GLM run through `claude -p` in the target repo; the GLM reviewer points the Claude Code harness at Fireworks' Anthropic-compatible endpoint via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL`, scoped to that invocation so the Claude reviewer keeps your normal Anthropic auth.

The earlier Factory Droid/DeepSeek reviewer (`droid exec --model "$DROID_MODEL"`, default `custom:DeepSeek-V4-Pro-0`) is commented out in the script for reference.

## Output

The script writes one directory per feature slug:

```text
.reviews/plans/<feature-slug>/                  # --mode plan
.reviews/implementations/<feature-slug>/       # --mode implementation
  <feature-slug>-codex-vN.md
  <feature-slug>-claude-vN.md
  <feature-slug>-glm-5p2-vN.md
  .logs/vN/*.stderr
```

The caller passes the feature name; the script scans existing files for that feature within the selected mode directory and chooses `max(vN)+1`. Do not manually choose the review number.

## Reviewer Contract

Reviewers must:

- Review only; do not edit files, run tests, run builds, install packages, or create temp scripts.
- Do not use task-list or planning tools such as TodoWrite.
- Make the final assistant response the review itself; do not send a final status-only or housekeeping response after the review.
- Treat the writer's test run as the verification source.
- Report suspected missing tests, risky behavior, or useful ad-hoc checks as feedback for the writer to verify.
- Prefer concrete findings with file and line references.

After the round completes, read all three review files, decide what to implement, ask the user only for decisions that cannot be made from the code and product intent, then run another round if needed.
