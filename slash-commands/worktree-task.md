---
name: worktree-task
description: Start work on assigned ticket in this worktree
---

Context: $ARGUMENTS

## Setup
1. Check if node_modules exists, run `npm install` if missing
2. If the context above is a ticket ID, run `tk show <id>` to see details
3. If no ticket ID provided, run `tk ready` to list available tickets, identify the most likely match based on the context/branch name, and confirm with the user before proceeding

## Start Work
4. Once ticket is confirmed, run `tk start <id>` to mark it in progress

## Implementation
5. Do the work
6. Run tests and fix any failures
7. Run linter and fix any issues

## Completion
8. Make a single commit: `git commit -am "<ticket-id>: <clear description>"`
9. Run `tk close <ticket-id>`
10. Do NOT push or merge - integration happens separately
