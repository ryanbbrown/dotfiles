#!/bin/bash
set -euo pipefail

# Initialize project structure for spec-driven development workflow.
# Run from project root.

mkdir -p .specs .context .tickets

# .gitignore additions
touch .gitignore
for pattern in ".context/" ".env"; do
  grep -qxF "$pattern" .gitignore 2>/dev/null || echo "$pattern" >> .gitignore
done

# CLAUDE.md with workflow context
if [ ! -f CLAUDE.md ]; then
  cat > CLAUDE.md << 'EOF'
# Project Instructions

## Workflow

This project uses spec-driven development:
- Specs live in `.specs/` — domain-level requirements (committed)
- Plans live in `.context/` — implementation plans with code snippets (not committed)
- Tickets live in `.tickets/` — managed via `tk` CLI (committed)

Use `/spec`, `/plan`, and `/tickets` slash commands to generate these artifacts.

## Development

- Use red/green TDD: write failing tests first, then implement until they pass.
- Run tests and typecheck before considering work done.
- This project uses `tk` for task tracking. Run `tk help` for usage.
EOF
  echo "Created CLAUDE.md"
else
  echo "CLAUDE.md already exists, skipping"
fi

echo "Initialized: .specs/ .context/ .tickets/"
echo "Updated .gitignore with: .context/, .env"
