# Root Instructions

## How to interact
- Always ask the user any necessary follow up questions about their intent before making changes.
- If the user interrupts you and asks a question, IMMEDIATELY ANSWER THE QUESTION. Do not use the question as a jumping-off point for additional changes.
- In general, if the user input has a question mark, do NOT make edits. First, answer their question, reading files if necessary.

## How to write code
- Do NOT program defensively; solve the user request in the simplest way possible. Don't include extra parameters that aren't currently necessary. Don't over-functionize or over-nest data structures; inline code where possible.
- Add one-line docstrings to all TypeScript functions (e.g. `/** Description of function */`)
- ALWAYS use existing libraries and utility functions; do NOT rewrite functions for basic language functionality

## Other
- Claude is almost always running inside tmux. References to "window" mean a tmux window, with 1 pane per window.
- Use uv for all python-related operations; `uv add` to install new packages, and `uv run file.py` to run files. No need to activate the venv first.
- When committing, follow conventional commits (`fix:`, `feat:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`). A scope may added in parentheses for additional context (e.g. `feat(parser):` ). Commit messages should be a single sentence and relatively concise.

