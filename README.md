# Global Agent Context

A single repo for all global coding agent configurations. Add/modify files here and run the script to symlink them to the proper locations. Currently supports Claude Code and Codex.

## What Gets Linked

- **Instructions** (`CLAUDE.md` / `AGENTS.md`) → `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
- **Plugins** (`plugins/`) → `~/.claude/plugins/<name>` for Claude plugin discovery
- **Plugin skills** (`plugins/*/skills/*`) → `~/.codex/skills/<skill-name>` with real paths under plugin roots so names can appear as `<plugin>:<skill>`

The `skill-creator` skill was cloned from [anthropics/skills](https://github.com/anthropics/skills.git) and modified for local use (removed packaging-related scripts + documentation). The `.upstream` file in the skill directory tracks the original source.

`plugins/` is the source organization for local and wrapped third-party skills.

## Setup

1. Clone this repo
2. Install Vercel skills (from the repo root, so they land in `.agents/skills/`):
   ```bash
   npx skills add vercel-labs/agent-skills -y
   ```
3. Clean up editor-specific dirs created by the installer (these are gitignored):
   ```bash
   rm -rf .claude .cursor
   ```
4. Edit `create-links.sh` to enable/disable linking for Claude or Codex
5. Run `./create-links.sh`

### Plugins (run these in Claude Code)

Install the SwiftUI Expert plugin:
```
/plugin marketplace add https://github.com/AvdLee/SwiftUI-Agent-Skill.git
/plugin install swiftui-expert@swiftui-expert-skill --scope user
```

Install the Code Simplifier plugin:
```
/plugin install code-simplifier@claude-plugins-official --scope user
```

### MCP Servers

[parallel.ai](https://parallel.ai) is my current search MCP of choice.

```bash
claude mcp add --transport http --scope user "Parallel-search-mcp" https://search-mcp.parallel.ai/mcp
```
