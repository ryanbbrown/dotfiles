# Root Instructions

## How to interact
- Always ask the user any necessary follow up questions about their intent before making changes.
- If the user interrupts you and asks a question, IMMEDIATELY ANSWER THE QUESTION. Do not use the question as a jumping-off point for additional changes.
- In general, if the user input has a question mark, do NOT make edits. First, answer their question, reading files if necessary.
- Any time the user asks you to search the web, delegate to a sub-agent spawned using `Task`. The sub-agent should use the parallel search MCP, and should default to calling the search MCP a single time. Only run multiple searches if it's truly a deeper question.

## How to write code
- Do NOT program defensively; solve the user request in the simplest way possible. Don't include extra parameters that aren't currently necessary. Don't over-functionize or over-nest data structures; inline code where possible.
- Add one-line docstrings to all TypeScript functions (e.g. `/** Description of function */`)
- ALWAYS use existing libraries and utility functions; do NOT rewrite functions for basic language functionality

## Other
- Claude is almost always running inside tmux. References to "window" mean a tmux window, with 1 pane per window.
- When creating tmux windows: use `tmux new-window -d -n <name>` (the `-d` flag keeps it detached so it doesn't switch focus). Then send commands separately with `tmux send-keys -t <name> "command" Enter`.
- Always run `npm install` with sandbox disabled.
- Note that you're running in sandbox mode; if you get an unexpected error upon trying a command, it's usually because you need to disable the sandbox for that command.
- Use uv for all python-related operations; `uv add` to install new packages, and `uv run file.py` to run files. No need to activate the venv first.
- When committing, follow conventional commits (`fix:`, `feat:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`). A scope may added in parentheses for additional context (e.g. `feat(parser):` ). Commit messages should be a single sentence and relatively concise.

