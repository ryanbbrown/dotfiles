---
name: multi-review
description: Run a read-only multi-agent code review round for a named feature using Codex, Claude Code, and Factory Droid/DeepSeek. Use when a writer has finished changes and needs parallel reviewer feedback captured into versioned files before deciding what to fix.
---

# Multi Review

Use this skill after the writer has implemented a feature and run the required tests. The review round is deterministic orchestration: three read-only reviewer CLIs run in parallel, their final feedback is captured to files, and the writer decides what to fix.

## Run

From the repository being reviewed:

```bash
/Users/ryanbrown/code/global-agent-context/skills/multi-review/scripts/review-round.sh --feature "feature name"
```

Options:

```bash
--feature NAME       Required. Stable feature label; the script derives the version from this.
--repo PATH          Repository to review. Defaults to the current directory.
--output-dir PATH    Review output root. Defaults to <repo>/.reviews.
```

Environment:

```bash
MAX_ROUNDS=3                 # hard cap, default 3
DROID_MODEL=deepseek-v4-pro  # default Droid reviewer model
```

Droid authentication must be available. For your custom DeepSeek config, export `DEEPSEEK_API_KEY` before running the script.

## Output

The script writes one directory per feature slug:

```text
.reviews/<feature-slug>/
  <feature-slug>-codex-vN.md
  <feature-slug>-claude-vN.md
  <feature-slug>-droid-deepseek-vN.md
  .logs/vN/*.stderr
```

The caller passes the feature name; the script scans existing files for that feature and chooses `max(vN)+1`. Do not manually choose the review number.

## Reviewer Contract

Reviewers must:

- Review only; do not edit files, run tests, run builds, install packages, or create temp scripts.
- Treat the writer's test run as the verification source.
- Report suspected missing tests, risky behavior, or useful ad-hoc checks as feedback for the writer to verify.
- Prefer concrete findings with file and line references.

After the round completes, read all three review files, decide what to implement, ask the user only for decisions that cannot be made from the code and product intent, then run another round if needed.
