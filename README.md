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
- `bin/` contains small shared commands, including `papercut` for recording workflow friction, `doppler-to-env` for creating local dotenv files, and `sync-bb-personal` for updating the bb `personal` branch from upstream.
- `tests/` contains the checks for the commands in `bin/`.

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
  ~/.pi/agent/APPEND_SYSTEM.md

Other
  ~/.local/bin/claude
  ~/.local/bin/codex
  ~/.local/bin/doppler-to-env
  ~/.local/bin/papercut
  ~/.local/bin/sync-bb-personal
```

Codex and Pi discover `~/.agents/skills`. Claude Code discovers `~/.claude/skills`. Both locations resolve to the same `skills/` directory.

The installer preserves an existing file or directory with a `.pre-dotfiles` suffix. It stops rather than overwrite an existing backup.

Pi installs configured package contents under `~/.pi/agent`. Claude Code and Codex also retain their own runtime state outside this repository.

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

The review panel reads `FIREWORKS_API_KEY` from `~/.dotfiles/.env`. Create that shared file with:

```bash
doppler-to-env --project api-keys --config dev_personal --output ~/.dotfiles/.env FIREWORKS_API_KEY
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
5. Hands the rest to the installed Codex CLI, once, non-interactively with full permission. Codex gets the unresolved set, the merge base, and the commit history of both sides. It owns the whole job from there: resolve the conflicts, read the repository's own instructions and package scripts, install dependencies, run the repository checks, repair what the merge broke anywhere in the tree, and repeat until the checks pass.
6. Rejects the merge if Git still reports an unresolved path, if any file the merge touched still holds conflict markers, or if Codex fails.
7. Commits everything Codex left in the worktree, then runs the same repository checks again to confirm the result independently.
8. Fast-forwards the real `personal` branch onto the tested merge, but only if `personal` is still at the commit the merge started from and is still clean.

The command holds no opinion about which files conflict or what a conflict in them means, so it keeps working as the repository changes. A run that does not reach the end leaves the rerere cache exactly as it found it, so a resolution it could not verify is never replayed later. The temporary worktree is always removed. Nothing is ever pushed: the push URL of every remote is broken through the environment for the duration of the resolver, rather than by restricting what Codex may run.

Run the checks:

```bash
tests/sync-bb-personal.sh
tests/firstmate-skills.sh
```

The tests build throwaway state and stub `bb`, `codex`, and `pnpm`. They never touch the real bb checkout, run `sync-bb-personal`, change live threads, or start a model call.

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
| [`pi-openai-server-compaction`](https://github.com/ryanbbrown/pi-openai-server-compaction) | Preserves more old context through OpenAI server compaction, including custom wake messages, with higher token and downstream context costs. |
| [`pi-processes`](https://github.com/aliou/pi-processes) | Runs servers, watchers, builds, and review panels as managed background processes. |
| [`pi-subagents`](https://github.com/nicobailon/pi-subagents) | Adds focused child agents for scouting, implementation, review, research, and second opinions. |
| [`pi-goal`](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal) | Keeps Pi working toward a session goal until it completes, pauses, or reaches a safety limit. |

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

#### Planning and delivery

- `grilling` stress-tests a plan, decision, or idea through focused questions.
- `wait-what` explains confusing code or concepts from first principles.
- `implement` runs the main implementation and review workflow described below.
- `review-panel` runs independent Codex, Claude Code, and GLM reviews against one frozen snapshot.
- `test-quality` favors tests that prove observable behavior and protect against costly regressions.

#### Firstmate operations

- `/sync-bb-personal` runs the installed personal branch sync and reports its outcome.
- `/rotate-firstmate` moves the current Firstmate and all direct children to a fresh pinned root thread.

Both skills require explicit user invocation. `scripts/link-home.sh` exposes them through the shared `skills/` link with the other skills.

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

`pN` and `iN` are the required numbers of successful plan-review and implementation-review cycles. Zero means no panel for that phase. The parent agent owns planning, review synthesis, and final validation. One implementation subagent remains the only implementation writer and receives the verified synthesis after each implementation review.
