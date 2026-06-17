# Ryan's Agent Context

Personal home base for how Ryan Brown uses coding agents across local side projects. This repo keeps global instructions, active skills, wrapped third-party skills, and repo bootstrapping scripts in one place, then links them into Claude Code and Codex.

The current workflow is intentionally small: start greenfield repos with the same agent-readable structure, let agents draft implementation plans in committed files, use generated HTML when a visual artifact is clearer than prose, and run multi-agent review when a plan or implementation needs outside pressure.

## Daily Workflow

### Start A Repo

Add this function to `~/.zshrc`:

```bash
unalias init-repo 2>/dev/null
init-repo() { /Users/ryanbrown/code/global-agent-context/scripts/init-repo.sh "$@"; }
unalias adapt-repo 2>/dev/null
adapt-repo() { /Users/ryanbrown/code/global-agent-context/scripts/adapt-repo.sh "$@"; }
```

From an empty project directory:

```bash
init-repo
```

For durable app, agent-workflow, or package behavior that should be reviewed as a product contract:

```bash
init-repo --behavior
```

The script creates a greenfield side-project repo with:

- `.plans/` for committed implementation plans, named in implementation order like `01-auth.md`, `02-billing.md`, `03-dashboard.md`
- `.reviews/` for multi-agent review outputs; gitignored by default, force-add (`git add -f`) the ones that capture useful decision context
- `.html/` for committed generated HTML artifacts when visual explanation is useful
- optional `docs/behavior.md` for durable product behavior contracts
- `CLAUDE.md` and `AGENTS.md` project instructions
- a minimal `README.md`
- an initial commit and GitHub remote via `gh repo create`

### Adapt An Existing Repo

From an existing git repo that should not receive Ryan-specific workflow files:

```bash
adapt-repo
```

The script creates the local workflow directories and adds local-only ignore rules to `.git/info/exclude`, leaving the repo's tracked `.gitignore` untouched. `.plans/` is intentionally not ignored so implementation plans are visible while working; remove it before merging upstream if the target repo should not receive planning artifacts.

It writes:

- `CLAUDE.local.md` with local workflow instructions for Claude Code, including an `@AGENTS.md` import when the repo has `AGENTS.md` but no `CLAUDE.md`
- `AGENTS.override.md` with the repo's current `AGENTS.md` instructions, or `CLAUDE.md` if there is no `AGENTS.md`, followed by the same local workflow instructions for Codex

Both files are ignored locally. Rerun with `--force` to replace existing local instruction files.

### Plan Work

Plans are regular markdown files in `.plans/`. They are committed because they explain implementation order and intent over time. The filename number is the order the work is expected to land, not a priority score.

Most planning is free-form agent work rather than an explicit skill invocation. The generated project instructions carry the conventions that matter.

### Review Work

Use the `multi-review` skill when a plan or implementation needs read-only feedback from multiple agents. Review output goes under `.reviews/plans/<feature>/` or `.reviews/implementations/<feature>/`. Outputs are gitignored by default; `git add -f` the ones worth keeping.

Use the `interview` skill when the agent should ask questions and shape a plan/spec before writing.

### Generate Visual Artifacts

Use the `html-artifacts` skill when HTML would communicate better than markdown: diagrams, timelines, comparison matrices, design prototypes, data explorers, or visual reports. Generated files should usually live in `.html/`.

## Active Skills

Personal skills currently kept active:

- `interview`
- `multi-review`

Wrapped third-party skills currently kept active:

- `browse` (gstack)
- `crit` and `crit-cli`
- `drawio`
- `html-artifacts`
- `last30days`
- `grill-with-docs` (mattpocock-skills)
- `improve-codebase-architecture` (mattpocock-skills)
- `taste-skill` and `gpt-tasteskill`
- `vercel-react-best-practices`

Older personal workflows are preserved in `archive/personal-skills/` but are not linked into Claude or Codex.

## Layout

- `CLAUDE.md` is the global instruction file linked into Claude Code and Codex.
- `plugins/` is the active source tree for skills and plugin manifests.
- `archive/` preserves retired personal skills.
- `scripts/init-repo.sh` creates new side-project repositories.
- `scripts/adapt-repo.sh` adds local workflow files to existing repositories without changing tracked project files.
- `scripts/update-skill-sources.sh` updates third-party submodules, regenerates wrapped skills, reruns links, and can commit/push known source updates from cron.
- `create-links.sh` links this repo into local Claude/Codex homes.

## Setup

Run from this repo:

```bash
./create-links.sh
```

That links:

- `CLAUDE.md` -> `~/.claude/CLAUDE.md`
- `CLAUDE.md` -> `~/.codex/AGENTS.md`
- `plugins/*/skills/*` -> `~/.claude/skills/*` and `~/.codex/skills/*`
- `gstack` -> `~/.claude/skills/gstack` (compiled browse binary + helpers)

Skills are exposed under flat names in both agents (e.g. `multi-review`, not
`personal:multi-review`); `~/.claude/plugins` is managed by Claude Code's
plugin system and is not touched. Codex's `.system` skills are preserved.

## Third-Party Sources

The repo tracks selected external skill sources as submodules and wraps only the skills Ryan currently wants active. The daily cron runs:

```bash
/Users/ryanbrown/code/global-agent-context/scripts/update-skill-sources.sh --push
```

This updates known submodules, regenerates `html-artifacts`, reruns `create-links.sh`, and commits only known submodule/generated source changes.
