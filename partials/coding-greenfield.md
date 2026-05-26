## How to write code
- Unless the user explicitly says otherwise, assume the project is entirely greenfield, unused, and has no backwards-compatibility requirements.
- Do NOT program defensively; solve the user request in the simplest way possible. Don't include extra parameters that aren't currently necessary. Don't over-functionize or over-nest data structures; inline code where possible.
- Add one-line docstrings to all TypeScript functions (e.g. `/** Description of function */`)
- ALWAYS use existing libraries and utility functions; do NOT rewrite functions for basic language functionality
