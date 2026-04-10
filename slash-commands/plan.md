Generate an implementation plan: $ARGUMENTS

## Input

Read the relevant spec in `.specs/` if one exists. Read any existing plans in `.context/` to avoid overlap. Explore the codebase to understand current architecture, patterns, and conventions.

If the user provides reference code, open source examples, or research findings, incorporate them into the plan as the preferred approach.

## Output

Write the plan to `.context/plan-<name>.md`. If a spec exists for this domain, reference it at the top.

## Plan structure

```
# Plan: <Title>

Spec: .specs/<domain>.md (if applicable)

## Overview
1-2 sentences: what we're building and how the pieces fit together.

## Steps

### 1. <Step title>
What this step accomplishes and why.

<Code snippets showing the approach, reference implementations, key API usage, or non-obvious patterns. Include file paths that will be modified.>

**Verify:** <How to confirm this step works — test commands, manual checks, expected output.>

### 2. <Step title>
...

## Considerations
Tradeoffs, alternatives considered, things that could go wrong.
```

## Guidelines

- Reference the spec for requirements but don't repeat them — the plan is about *how*, not *what*.
- Include code snippets for non-trivial parts: reference implementations, tricky integrations, API usage that's hard to discover. Don't include code for straightforward work the agent can figure out.
- Include file paths that will be modified or created.
- Each step should be independently verifiable — describe what "working" looks like after that step.
- Steps should be ordered by dependency. Note which steps can be done in parallel.
- Keep it concise. The plan is a thinking tool, not documentation.
- Ask the user clarifying questions before creating the plan.
- Do not manually wrap lines. Write each sentence as a single line.
