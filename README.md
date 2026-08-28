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
- `bin/` contains small shared commands, including the target-host `terminal-job-runner`, `papercut`, `doppler-to-env`, and `sync-bb-personal`.
- `plugins/` contains opt-in BB plugins. `terminal-jobs` is a standalone backend-only package.
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
  ~/.claude/mcp.json

Codex
  ~/.codex/hooks.json

Pi
  ~/.pi/agent/settings.json
  ~/.pi/agent/mcp.json

Other
  ~/.local/bin/claude
  ~/.local/bin/codex
  ~/.local/bin/doppler-to-env
  ~/.local/bin/papercut
  ~/.local/bin/sync-bb-personal
  ~/.local/bin/terminal-job-runner
```

Codex and Pi discover `~/.agents/skills`. Claude Code discovers `~/.claude/skills`. Both locations resolve to the same `skills/` directory.

The installer preserves an existing file or directory with a `.pre-dotfiles` suffix. It stops rather than overwrite an existing backup.

Pi installs configured package contents under `~/.pi/agent`. Claude Code and Codex also retain their own runtime state outside this repository.

### Activate terminal jobs

`plugins/terminal-jobs` keeps agent-started durable commands, target-host artifacts, terminal outcomes, and completion delivery inspectable across restarts. It is opt-in and stays a standalone npm package.

After changes reach canonical dotfiles, activate it in this order so the command exists before the conditional mandatory agent rule becomes live:

1. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` in `~/.dotfiles/plugins/terminal-jobs`.
2. Run `~/.dotfiles/scripts/link-home.sh` on each target host.
3. Run `bb plugin install ~/.dotfiles/plugins/terminal-jobs`.
4. Verify `bb terminal-job help`, plugin status, and one harmless completion job.

After later plugin source changes, run `bb plugin reload terminal-jobs`. See [`plugins/terminal-jobs/README.md`](plugins/terminal-jobs/README.md) for commands, target-host requirements, status/retry operations, retention, and artifact cleanup.

### Create local environment files

This requires an installed and authenticated Doppler CLI. Create or replace `.env` in the current directory from a Doppler project and config:

```bash
doppler-to-env --project api-keys --config dev_personal OPENAI_API_KEY
```

Add more key names to write multiple entries. List the available names without exposing their values:

```bash
doppler-to-env --project api-keys --config dev_personal --list
```

Use `--output PATH` to select another file. The command writes only the requested keys, replaces the file atomically with `0600` permissions, and refuses to write a tracked or unignored file inside a Git repository. `scripts/link-home.sh` installs the tracked command from `bin/doppler-to-env` at `~/.local/bin/doppler-to-env`.

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

### Rotate Firstmate

From the Firstmate thread to replace, run:

```text
/rotate-firstmate
```

This manual-only skill creates a fresh thread in the same project and environment. It preserves the current title, parent or root relationship, provider, model, reasoning level, service tier, permission mode, visibility, section, and pinned or unpinned state. It moves all direct children, including hidden, archived, and cross-project children. Pin changes occur only when the old thread was pinned.

The handoff always names the absolute workspace queue path. A workspace `.bb/AGENTS.md` that supplies Firstmate rules remains the source of truth. Other workspaces bootstrap through the installed `firstmate` skill. The script does not copy the transcript or inspect another workspace's queue. A later failure triggers a best-effort rollback and reports exact thread IDs when manual recovery is necessary.

Test the lifecycle against the fixture stub. The test does not change live threads or start a model call:

```bash
tests/firstmate-skills.sh
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

Update the Destructive Command Guard binary separately:

```bash
$HOME/.dotfiles/scripts/update-dcg.sh
```

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

Pi defaults to `openai-codex/gpt-5.6-sol` with high reasoning.

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

Claude Code and Codex run the Destructive Command Guard before shell commands.

### MCP servers

The custom MCP set is the same for Claude Code, Codex, and Pi:

- `context7` provides current documentation for libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.
- `grep` finds real code examples in public GitHub repositories through grep.app.

The repository tracks one agent-specific representation of this set for each tool:

- `home/.claude/mcp.json`
- `bin/codex`
- `home/.pi/agent/mcp.json`

The installer links the Claude Code and Pi files into their agent directories. The Codex wrapper passes its MCP settings as command-line overrides.

Codex stores hook trust in its untracked `~/.codex/config.toml`. The wrapper does not use a writable tracked profile.

Pi uses `pi-mcp-adapter` to search cached tool metadata. It starts an MCP server only when the agent needs it.

An agent may expose its own built-in MCP servers. This repository does not configure or manage those servers.

The vendored draw.io repository only supplies the generated `drawio` skill. This setup does not enable its MCP server.

### Major skills

#### Firstmate operations

- `update-bb` runs the installed bb personal sync in a durable BB terminal.
- `firstmate` promotes an explicitly selected root thread to manage its workspace queue.
- `rotate-firstmate` replaces the current Firstmate thread without copying its transcript or changing its BB route.

Both skills run only when invoked as `/update-bb` or `/rotate-firstmate`.

#### Planning and delivery

- `grilling` stress-tests a plan, decision, or idea through focused questions.
- `wait-what` explains confusing code or concepts from first principles.
- `implement` runs the main implementation and review workflow described below.
- `review-panel` runs independent Codex, Claude Code, and Grok 4.5 reviews against one frozen snapshot. Its skill starts the review with one direct Terminal Jobs command; the review script also works in a local foreground shell.
- `test-quality` favors tests that prove observable behavior and protect against costly regressions.

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

Invoke the `implement` skill with a planning mode and explicit review counts:

```text
/implement <interview|direct> p<N> i<N> — <task or approved plan>
```

`interview` raises the few important design decisions and waits for the user. `direct` creates a plan when needed and proceeds when the task is clear. An existing approved plan is used without recreation.

`pN` and `iN` are the required numbers of successful plan-review and implementation-review cycles. Zero means no panel for that phase. The parent agent owns planning, review synthesis, and final validation. One BB child thread in the current environment remains the only implementation writer and receives the verified synthesis after each implementation review.
