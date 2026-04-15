---
name: handoff
description: Spawn a new agent session in a tmux window with full context handoff
argument-hint: [task description for the new session]
---

## Step 1: Derive a slug

From the task description (user argument or conversation context), derive a short slug for the handoff:
- Under 10 characters, lowercase, hyphens allowed
- Abbreviate words freely (e.g. "obsidian-diff" -> "odiff", "auth bugfix" -> "auth-fix", "database migration" -> "db-migr")
- Should be recognizable at a glance in a tmux status bar

This slug is used for both the filename and the tmux window name.

## Step 2: Write the handoff document

Create a handoff file at `.context/handoffs/<timestamp>-<slug>.md` in the current project directory (create the directories if they don't exist). The timestamp should be in the format `YYYYMMDD-HHmmss`.

The handoff document should contain:

```
# Handoff

## Task
[What the new session should work on. Use the user's argument if provided: $ARGUMENTS]

## Current State
[Summarize the current state of the work — what's been done, what files were changed, any relevant decisions made]

## Key Files
[List the most important files the new session needs to know about, with brief descriptions]

## What To Do Next
[Clear, actionable instructions for the new session]

## Context
[Any other relevant context — gotchas, constraints, things that were tried and didn't work]
```

Be thorough but concise. The new session starts with zero context, so include everything it needs.

## Step 3: Spawn the new session

Run a detached tmux window with a fresh agent session.

IMPORTANT: Shell aliases (like `cds`) do not expand in non-interactive shells. Always use the full command:
- If you are Claude Code, use `claude --dangerously-skip-permissions`
- If you are Codex, use `codex --search --dangerously-bypass-approvals-and-sandbox`

Command shape:

```
tmux new-window -d -n "<slug>" -c <project-directory> "claude --dangerously-skip-permissions 'Read the handoff file at <absolute-path-to-handoff-file> and follow the instructions in it.'"
```

Tell the user the handoff is complete, the handoff file path, and which tmux window name to switch to.
