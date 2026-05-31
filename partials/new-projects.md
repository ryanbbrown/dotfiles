## New projects
- When creating a new side-project repo, run `/Users/ryanbrown/code/global-agent-context/scripts/init-repo.sh` from an empty project root to create `.plans/`, `.reviews/`, `.html/`, `.gitignore`, `CLAUDE.md`, `AGENTS.md`, `README.md`, the initial commit, and the GitHub repo.
- For shell access from any directory, add this to `~/.zshrc`: `init-repo() { /Users/ryanbrown/code/global-agent-context/scripts/init-repo.sh "$@"; }`
