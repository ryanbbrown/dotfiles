Generate a specification document for: $ARGUMENTS

Read any existing .specs/ files for context. Explore the codebase enough to understand what exists today, but write the spec as the ideal state — not a description of current implementation. If the user provides additional context (a roadmap, feature list, conversation notes, etc.), use that as input but don't depend on any specific file existing.

## Output

Write the spec to `.specs/<name>.md` where `<name>` is a short lowercase slug for the domain (e.g. `sessions`, `input`, `rendering`).

## Spec structure

Follow this structure exactly:

```
# <Domain Name>

## Overview
One paragraph: what is this area of the product and why does it matter to the user?

## User stories
Bullet list of what users need, written as:
- A user can _____ so that _____.
- When _____, the system should _____.

## Acceptance criteria
Group by sub-area using ### headings. Each criterion is a GIVEN/WHEN/THEN scenario:
- GIVEN [precondition], WHEN [action], THEN [expected result].
- Cover happy path, edge cases, and error cases.

## Constraints
Bullet list of hard boundaries:
- What this does NOT do (explicit scope limits).
- Non-functional requirements (performance, security, accessibility).
- Business rules that must hold.

## Open questions
Use [NEEDS CLARIFICATION] prefix for anything ambiguous. Don't guess — flag it.
```

## Guidelines

- No implementation details — no tech stack, no file paths, no API design, no code.
- One file per domain. Keep it concise — don't over-specify.
- Write for a human reviewer — if a person can't read and approve this, it's not ready.
- Acceptance criteria should be specific enough to derive tests from.
- Don't duplicate what's already in another spec — reference it instead.
- If the user hasn't specified what to spec, ask them what domain to cover.
- Do not manually wrap lines. Write each sentence or bullet as a single line and let markdown handle wrapping.
