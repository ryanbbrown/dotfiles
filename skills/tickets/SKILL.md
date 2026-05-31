---
name: tickets
description: Break an implementation plan into tickets. Use when the user wants a plan converted into tracked tasks or ticket dependencies.
argument-hint: "[plan file]"
---

Break a plan into tickets: $ARGUMENTS

This project uses `tk` (wedow/ticket) for git-native ticket tracking.

## Input

Read the plan file specified by the user (usually in `.plans/`). If no file is specified, ask which plan to use. Also read the corresponding spec in `.specs/` if one exists, to pull in acceptance criteria.

## Process

1. Read the plan and identify each discrete step.
2. For each step, create a ticket using `tk create` with:
   - A clear title (imperative mood, e.g. "Add title generation utility")
   - `--type`: feature, bug, task, or chore as appropriate
   - `--description`: a short summary of what this step accomplishes, plus a reference to the plan file and step number for full context (e.g. "See .plans/plan-sessions.md, Step 3")
   - `--acceptance`: concrete done criteria pulled from the plan step and/or the spec's GIVEN/WHEN/THEN scenarios
   - `--tags`: relevant domain tags (e.g. sessions, ui, backend)
3. After creating all tickets, wire up dependencies with `tk dep <id> <dep-id>` based on the ordering in the plan. Steps that can be done in parallel should NOT have dependencies between them.
4. Print a summary: ticket IDs, titles, and dependency graph.

## Ticket content

Tickets are pointers to work, not the work itself. They contain:
- **Context**: why this work exists (1-2 sentences)
- **Deliverable**: one concrete outcome
- **Acceptance criteria**: binary pass/fail conditions
- **Plan reference**: where to find implementation detail (code snippets, file paths, approach)
- **Verification commands**: exact commands to run to confirm it works

Tickets do NOT contain code snippets, file paths, or implementation approach — that lives in the plan. The ticket description should reference the plan step so the implementing agent can read the full context.

## Guidelines

- One ticket per plan step. Don't split steps further or combine them.
- Acceptance criteria should be specific enough that an agent can verify its own work.
- If a plan step maps to a specific GIVEN/WHEN/THEN from the spec, include that scenario verbatim in the acceptance criteria.
- Tag all tickets with the spec domain name (e.g. `sessions` if the plan came from `.specs/sessions.md`).
- Do not manually wrap lines. Write each sentence as a single line.
