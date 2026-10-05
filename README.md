# dotfiles

Personal coding-agent configuration and skills for Ryan Brown.

This repository is the durable source for Claude Code, Codex, and Pi. It gives all three agents shared instructions and one flat skill set. It also tracks agent-specific settings and hooks.

The repository does not track credentials, sessions, caches, trust decisions, or other runtime state.

## How the repository works

### Layout

- `home/` contains global instructions and durable settings for Claude Code, Codex, and Pi.
- `skills/` contains the skills exposed to all three coding agents.
- `vendor/` contains complete upstream repositories as Git submodules.
- `scripts/` contains installation, project setup, and source update commands.
- `bin/` contains small shared commands, including `papercut` and `sync-bb-personal`.
- `tests/` contains checks for shared commands and installation behavior.

Each entry under `skills/` is one of:

- an authored personal skill
- a generated wrapper around selected upstream material
- a link to a skill in an upstream repository under `vendor/`

Skills use flat names such as `implement`, `agent-browser`, and `test-quality`. They do not use agent-specific plugin namespaces.

### Install

Initialize the upstream sources after cloning:

```bash
git submodule update --init --recursive
```

Then install the home links:

```bash
scripts/link-home.sh
```

Install Vercel's browser automation CLI and its managed Chrome runtime:

```bash
npm install -g agent-browser
agent-browser install
```

Install the Railway CLI for deployment management:

```bash
brew install railway
```

The script creates `~/.dotfiles` as a stable link to the checkout. It then installs these groups of links:

```text
Shared instructions
  ~/.claude/CLAUDE.md
  ~/.codex/AGENTS.md
  ~/.pi/agent/AGENTS.md

Shared skills
  ~/.agents/skills
  ~/.claude/skills

Claude Code
  ~/.claude/settings.json

Codex
  ~/.codex/hooks.json

Pi
  ~/.pi/agent/settings.json
  ~/.pi/agent/mcp.json

Other
  ~/.local/bin/papercut
  ~/.local/bin/sync-bb-personal
  ~/Desktop/install-bb-personal.command
```

Codex and Pi discover `~/.agents/skills`. Claude Code discovers `~/.claude/skills`. Both locations resolve to the same `skills/` directory.

The installer preserves an existing file or directory with a `.pre-dotfiles` suffix. It stops rather than overwrite an existing backup. It removes an existing symlink at a managed target without a backup.

This repository does not wrap the `claude` or `codex` executables. Each tool uses its own installer and launcher.

Pi installs configured package contents under `~/.pi/agent`. Claude Code and Codex also retain their own runtime state outside this repository.

### BB plugins

BB plugins live in their own repositories, which own their source, skills, tests, and releases. The [Terminal Jobs plugin](https://github.com/ryanbbrown/bb-plugin-terminal-jobs) supplies `bb terminal-job`, and the [Firstmate plugin](https://github.com/ryanbbrown/bb-plugin-firstmate) supplies the Firstmate queue and its `firstmate-queue` skill. This repository keeps only shared agent policy and integrations that use those installed plugins.

The review panel uses the official Grok Build CLI with a SuperGrok account login. Install it and complete browser OAuth before the first review:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login
```

### Update bb from Firstmate

In a Firstmate thread that loaded the installed skills, run:

```text
/update-bb
```

This manual-only skill checks for an existing `update-bb` terminal, then starts `sync-bb-personal` in a thread-scoped BB terminal. It records a durable log and final outcome marker under the invoking thread's storage, so the update survives a provider-session replacement. Skills load when a thread starts, so a running Firstmate does not discover a newly installed skill.

Test the skill without running the sync:

```bash
tests/update-bb-skill.sh
```

### Sync the bb personal branch

Run on demand from anywhere:

```bash
sync-bb-personal
```

The command works on `~/code/bb`. Pass `--repo PATH` to use another checkout.

What it does, in order:

1. Checks that the `personal` worktree is clean. It stops before fetching if it is not.
2. Fetches `upstream` and advances local `main` with fast-forward-only semantics. It finds the `main` worktree with `git worktree list --porcelain`, so it works whether `main` is checked out or not. It stops if `main` is behind and its checkout is dirty, or if `main` has diverged.
3. Merges `main` into `personal` inside a temporary worktree. The real checkout is never in a merge state.
4. Lets Git merge and rerere replay whatever cached resolutions match. rerere runs with autoupdate, so replayed resolutions are staged.
5. If textual conflicts remain, hands the merge to the installed Codex CLI once, non-interactively with full permission. Codex gets the unresolved set, merge base, and commit history of both sides.
6. Codex resolves the conflicts, installs dependencies, and typechecks the changed packages and their dependants. It then runs focused tests for affected packages and real failures. Only after those checks pass does it run the nested complete repository graph, which is limited to one run.
7. Commits the merge in the temporary worktree and runs the complete repository graph. A clean automatic merge that passes stays agent-free. All checks must pass unless the graph's sole failure is the exact known flaky `PromptBoxInternal` selection-reveal test with its upstream focus-before-spy order. In that one case, the command reruns only that test once and continues only if it passes.
8. If a clean automatic merge has any other failure, multiple failures, or a failed PromptBox retry, launches Codex in the same temporary worktree. Codex gets the failed check log and output, plus the same merge base and branch history. Codex repairs and validates the merge before the script amends the merge commit and confirms the complete graph again.
9. Rejects the merge if Git still reports an unresolved path, if any file the merge touched holds conflict markers, if Codex fails, or if the independent check and its permitted retry fail. Each Codex check writes its complete output to a temporary log and prints a short failed-task summary with the log path.
10. Fast-forwards the real `personal` branch onto the tested merge, but only if `personal` is still at the commit where the merge started and is still clean.

The command holds no opinion about which files conflict or what a conflict in them means, so it keeps working as the repository changes. A run that does not reach the end leaves the rerere cache exactly as it found it, so a resolution it could not verify is never replayed later. The temporary worktree and check logs are always removed. Nothing is ever pushed: the push URL of every remote is broken through the environment for the duration of the resolver, rather than by restricting what Codex may run.

Run the checks:

```bash
tests/sync-bb-personal.sh
```

The tests build their own throwaway repositories and stub `codex` and `pnpm`. They verify the exact non-interactive, full-permission Codex invocation without starting a model call. They never touch the real bb checkout.

### Update upstream skill sources

Run:

```bash
$HOME/.dotfiles/scripts/update-skill-sources.sh
```

The script updates known submodules and rebuilds generated wrappers. It currently regenerates the `drawio` skill.

Pass `--commit` to commit known source changes. Pass `--push` to commit and push them from `main`.

The daily cron uses:

```bash
$HOME/.dotfiles/scripts/update-skill-sources.sh --push
```

The scheduled push reads the existing GitHub credential from macOS Keychain.
It does not store a token in the script or cron environment.

Update the browser automation CLI separately:

```bash
agent-browser upgrade
```

### Set up a project

Add these functions to `~/.zshrc`:

```bash
unalias init-repo 2>/dev/null
init-repo() { "$HOME/.dotfiles/scripts/init-repo.sh" "$@"; }
unalias adapt-repo 2>/dev/null
adapt-repo() { "$HOME/.dotfiles/scripts/adapt-repo.sh" "$@"; }
```

Run `init-repo` from an empty directory. It requires `git` and an authenticated GitHub CLI.

The command creates a private GitHub repository by default. Pass `--public` for public visibility. Pass `--behavior` to add a product behavior contract.

Pass an optional `owner/name` argument to choose the GitHub repository. The command also adds agent instructions and standard workflow directories.

Run `adapt-repo` inside an existing repository. It adds local agent instructions without changing tracked project files. Pass `--force` to replace its local instruction files.

Both workflows use these directories:

- `.plans/` for ordered implementation plans
- `.reviews/` for independent review reports
- `.html/` for useful visual artifacts
- `.archive/` for retired local material

## Coding-agent setup

### Shared foundation

Claude Code, Codex, and Pi receive the same global instructions from `home/AGENTS.md`. The main defaults are:

- Pause when a user decision could change the next action.
- Prefer the simplest implementation that meets the current requirements.
- Do not preserve backward compatibility unless the project requires it.
- Use existing dependencies before adding code or packages.
- Write concise prose in active voice.
- Record small workflow problems with `papercut`.

### Pi

Install Pi with `npm install -g @earendil-works/pi-coding-agent`. The older `@mariozechner/pi-coding-agent` package is frozen at 0.73.1 and cannot load the extensions below.

Pi defaults to `openai-codex/gpt-6-sol` with high reasoning.

The tracked Pi settings install these packages:

| Package | Purpose |
| --- | --- |
| [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | Discovers MCP tools on demand and keeps large tool catalogs out of the prompt. |
| [`pi-web-access`](https://github.com/nicobailon/pi-web-access) | Adds web search, source checks, page extraction, repository fetching, and video analysis. |
| [`pi-openai-server-compaction`](https://github.com/ryanbbrown/pi-openai-server-compaction) | Preserves more old context through OpenAI server compaction, with higher token and downstream context costs. |

The compaction extension declares support for Pi 0.80.x. Its smoke test and runtime load pass on Pi 0.84.2, but its typecheck fails on widened provider header types.

### Claude Code and Codex

Claude Code uses the shared skills plus several Claude-specific plugins:

- Code Simplifier
- SwiftUI Expert
- Swift LSP
- OpenAI Codex

### MCP servers

Pi uses this custom MCP set:

- `context7` provides current documentation for libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.
- `grep` finds real code examples in public GitHub repositories through grep.app.

The repository tracks it in `home/.pi/agent/mcp.json`, and the installer links that file into the Pi agent directory.

Codex stores hook trust and any MCP servers in its untracked `~/.codex/config.toml`. Add `context7` and `grep` there if Codex needs them.

Pi uses `pi-mcp-adapter` to search cached tool metadata. It starts an MCP server only when the agent needs it.

An agent may expose its own built-in MCP servers. This repository does not configure or manage those servers.

The vendored draw.io repository only supplies the generated `drawio` skill. This setup does not enable its MCP server.

### Major skills

#### Firstmate operations

- `update-bb` runs the installed bb personal sync in a durable BB terminal. It runs only when invoked as `/update-bb`.

#### Planning and delivery

- `grilling` stress-tests a plan, decision, or idea through focused questions.
- `wait-what` explains confusing code or concepts from first principles.
- `eli5` explains an unfamiliar topic in plain language, with a comic-strip HTML graphic in `~/code/scratch/`. It runs only when invoked as `/eli5`.
- `implement` runs the main implementation and review workflow described below.
- `write-plan` writes an implementation plan for one project phase against its behavior spec: planning evidence, affected paths, ordered steps with a verify line each, data and DB changes, verification, risks, out of scope, acceptance criteria mapping by scenario ID, and a PR split under the PR split rule.
- `review-panel` runs independent Claude Code and Pi GPT-6 Sol reviews against one frozen snapshot. Its skill starts the review with one direct Terminal Jobs command; the review script also works in a local foreground shell.
- `test-quality` favors tests that prove observable behavior and protect against costly regressions.
- `retro` reviews a coding session's logs and suggests improvements to navigation, automated checks, coding standards, steering files, and tool use. It runs only when invoked as `/retro`.

#### Review and browser QA

- `agent-browser` drives a browser for automation, product testing, and site dogfooding.
- `crit` collects structured inline feedback on code, plans, HTML files, and live pages.

#### Architecture and design

- `codebase-design` provides a shared vocabulary for deep module interfaces and useful seams.
- `domain-modeling` sharpens project terminology and records important domain decisions.
- `improve-codebase-architecture` finds module deepening opportunities and presents them visually.
- `drawio` creates native draw.io diagrams and exports them to image or document formats.

#### Research and framework guidance

- `last30days` researches recent public discussion across social networks, video sites, GitHub, and the web.
- `vercel-react-best-practices` guides React and Next.js performance work.

#### Writing

- `plain-words` removes filler and makes general prose clear and specific.
- `govuk-style` applies GOV.UK and GDS house style when requested.
- `writing-for-agents` provides the design principles used to write predictable agent instructions.

## Main implementation flow

Invoke the `implement` skill with optional words and explicit review counts:

```text
/implement [interview] [brief] p<N> i<N> — <task or approved plan>
```

The agent decides by default and asks only for a fork that changes product behavior or for a fact the task and code cannot supply. `interview` forces the design questions first. `brief` writes a decision brief to `.reviews/briefs/<slug>.md` for the user to approve before any panel or implementation. Every run posts a result-shape summary after the plan is written. An existing approved plan is used without recreation.

`pN` and `iN` are the required numbers of successful plan-review and implementation-review cycles. Zero means no panel for that phase. The parent agent owns planning, review synthesis, and final validation. One BB child thread in the current environment remains the only implementation writer and receives the verified synthesis after each implementation review.
