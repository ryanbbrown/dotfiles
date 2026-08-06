# dotfiles

Personal coding-agent configuration and skills for Ryan Brown.

This repository is the durable source for Claude Code, Codex, and Pi. It gives all three agents shared instructions and one flat skill set. It also tracks agent-specific settings, hooks, themes, and extensions.

The repository does not track credentials, sessions, caches, trust decisions, or other runtime state.

## How the repository works

### Layout

- `home/` contains global instructions and durable settings for Claude Code, Codex, Pi, and cmux.
- `skills/` contains the skills exposed to all three coding agents.
- `vendor/` contains complete upstream repositories as Git submodules.
- `scripts/` contains installation, project setup, and source update commands.
- `bin/` contains small shared commands, including `papercut` for recording workflow friction.

Each entry under `skills/` is one of:

- an authored personal skill
- a generated wrapper around selected upstream material
- a link to a skill in an upstream repository under `vendor/`

Skills use flat names such as `implement`, `browse`, and `test-quality`. They do not use agent-specific plugin namespaces.

### Install

Initialize the upstream sources after cloning:

```bash
git submodule update --init --recursive
```

Then install the home links:

```bash
scripts/link-home.sh
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
  ~/.claude/hooks/cmux-session.sh

Codex
  ~/.codex/hooks.json
  ~/.codex/dotfiles-mcp.config.toml
  ~/.codex/cmux-feed.sh
  ~/.codex/notify.sh

Pi
  ~/.pi/agent/settings.json
  ~/.pi/agent/mcp.json
  ~/.pi/agent/APPEND_SYSTEM.md
  ~/.pi/agent/themes
  ~/.pi/agent/extensions/cmux-session.ts
  ~/.pi/agent/extensions/pi-minimal-toolcall
  ~/.pi/agent/extensions/subagent

Other
  ~/.config/cmux/cmux.json
  ~/.local/bin/claude
  ~/.local/bin/codex
  ~/.local/bin/papercut
```

Codex and Pi discover `~/.agents/skills`. Claude Code discovers `~/.claude/skills`. Both locations resolve to the same `skills/` directory.

The installer preserves an existing file or directory with a `.pre-dotfiles` suffix. It stops rather than overwrite an existing backup.

Pi installs configured package contents under `~/.pi/agent`. Claude Code and Codex also retain their own runtime state outside this repository.

### Update upstream skill sources

Run:

```bash
$HOME/.dotfiles/scripts/update-skill-sources.sh
```

The script updates known submodules and rebuilds generated wrappers. It currently regenerates the `browse` and `drawio` skills.

Pass `--commit` to commit known source changes. Pass `--push` to commit and push them from `main`.

The daily cron uses:

```bash
$HOME/.dotfiles/scripts/update-skill-sources.sh --push
```

Update the Destructive Command Guard binary separately:

```bash
$HOME/.dotfiles/scripts/update-dcg.sh
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

Claude Code, Codex, and Pi also publish activity through cmux. They share the `agentrun` status and report tool activity where the host supports it.

### Pi

Pi defaults to `openai-codex/gpt-5.6-sol` with high reasoning. It hides thinking blocks.

The custom `dark-no-tool-bg` theme starts from Pi's dark theme and removes the tool backgrounds.

The tracked Pi settings install these packages:

| Package | Purpose |
| --- | --- |
| [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | Discovers MCP tools on demand and keeps large tool catalogs out of the prompt. |
| [`pi-web-access`](https://github.com/nicobailon/pi-web-access) | Adds web search, source checks, page extraction, repository fetching, and video analysis. |
| [`pi-fixed-editor`](https://github.com/tifandotme/pi-extensions/tree/master/packages/pi-fixed-editor) | Keeps the editor and footer fixed while the transcript scrolls. |
| [`pi-openai-server-compaction`](https://github.com/algal/pi-openai-server-compaction) | Adds OpenAI server compaction while retaining a portable Pi text summary. |
| [`pi-minimal-toolcall`](https://github.com/ryanbbrown/pi-minimal-toolcall) | Groups and collapses tool calls to reduce terminal noise. |
| [`pi-processes`](https://github.com/aliou/pi-processes) | Runs servers, watchers, builds, and review panels as managed background processes. |
| [`pi-subagents`](https://github.com/nicobailon/pi-subagents) | Adds focused child agents for scouting, implementation, review, research, and second opinions. |

The local `cmux-session.ts` extension connects Pi lifecycle events to cmux. It updates status, sends completion notifications, publishes tool events, and records resume bindings.

The Pi extension configuration keeps subagent output compact. It also gives core file and shell tools a minimal display.

### Claude Code and Codex

Claude Code uses the shared skills plus several Claude-specific plugins:

- Code Simplifier
- SwiftUI Expert
- Swift LSP
- Readwise
- OpenAI Codex

Claude Code and Codex run the Destructive Command Guard before shell commands. Both send status and approval events to cmux. Codex also sends tool activity.

### MCP servers

The custom MCP set is the same for Claude Code, Codex, and Pi:

- `context7` provides current documentation for libraries, frameworks, SDKs, APIs, CLI tools, and cloud services.
- `grep` finds real code examples in public GitHub repositories through grep.app.

The repository tracks one agent-specific representation of this set for each tool:

- `home/.claude/mcp.json`
- `home/.codex/dotfiles-mcp.config.toml`
- `home/.pi/agent/mcp.json`

The installer links each file into its agent directory. The Claude Code and Codex launch wrappers load their linked files.

Pi uses `pi-mcp-adapter` to search cached tool metadata. It starts an MCP server only when the agent needs it.

An agent may expose its own built-in MCP servers. This repository does not configure or manage those servers.

The vendored draw.io repository only supplies the generated `drawio` skill. This setup does not enable its MCP server.

### Major skills

#### Planning and delivery

- `interview` asks focused questions and writes the answers into a plan or specification.
- `implement` runs the main implementation and review workflow described below.
- `review-panel` runs independent Codex, Claude Code, and GLM reviews against one frozen snapshot.
- `test-quality` favors tests that prove observable behavior and protect against costly regressions.

#### Review and browser QA

- `browse` drives a headless browser for product testing and site dogfooding.
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
- `writing-great-skills` provides the design principles used to write predictable agent skills.

## Main implementation flow

The `implement` skill is the standard delivery path after a plan is complete and approved. The parent agent owns scope, decisions, review synthesis, and final validation.

1. Identify the approved plan, acceptance checks, repository, stable feature name, and any user-specified review-round count.
2. Resolve any open product or architecture decision before implementation starts.
3. Launch one implementation subagent as the only writer for the active worktree.
4. Inspect the implementation handoff and require its listed validation to pass.
5. Run `review-panel` as a managed background process against one frozen repository snapshot.
6. Read the Codex, Claude Code, and GLM reports. Verify each finding against the snapshot instead of counting votes.
7. Write a versioned synthesis beside the reports. This file becomes the authoritative fix list.
8. Resume the same implementation subagent with the plan and synthesis. Do not send raw reviewer reports for reinterpretation.
9. Run exactly the number of rounds the user requests. Without a requested count, default to one and repeat only after broad or high-risk fixes.
10. Inspect the final diff and validation. Report deferred findings and residual risks.

This flow keeps one writer responsible for the implementation. It also separates independent review from the decision about what to change.
