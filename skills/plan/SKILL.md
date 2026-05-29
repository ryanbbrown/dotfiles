---
name: plan
description: Generate an implementation plan. Use when the user asks for a phased plan, rollout plan, implementation plan, or step-by-step execution plan.
argument-hint: "[feature or domain]"
---

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

## Test Strategy

Describe the minimum set of test strategies needed to cover the feature before implementation starts.

### 1. <Strategy name>
- **Purpose**: What class of behavior this strategy is meant to verify.
- **Tests**: The kinds of behavior this strategy should cover.
- **How**: The harness or method used to verify it.
- **Likely misses**: (optional; only when there are realistic false-pass risks)
- **Manual check**: (optional; yes/no + what to inspect when automation is low-value)
- **DOES NOT**: Only include when it prevents a likely misunderstanding about coverage.

## Spec Coverage Map

- `<Acceptance criteria category>` -> `<Strategy name(s)>`
- `<Acceptance criteria category>` -> `<Strategy name(s)>`

## Considerations
Tradeoffs, alternatives considered, things that could go wrong.
```

## Guidelines

### Scope

- Reference the spec for requirements but don't repeat them — the plan is about *how*, not *what*.
- Ask the user clarifying questions before creating the plan.
- Keep it concise. The plan is a thinking tool, not documentation.

### Steps

- Steps should be ordered by dependency. Note which steps can be done in parallel.
- Each step should be independently verifiable — describe what "working" looks like after that step.
- Include file paths that will be modified or created.
- Include code snippets for non-trivial parts: reference implementations, tricky integrations, API usage that's hard to discover. Don't include code for straightforward work the agent can figure out. You shouldn't be writing out entire 50+ line files.

### Test Strategy

- The goal is to make it super explicit how behavior will be verified--this may require iteration until there's sufficient confidence that the tests **will prove** that the implementation is correct
- Keep the number of test strategies low. Prefer the minimum set of strategies that cover the different verification layers, rather than one strategy per tiny requirement.
- Include `**DOES NOT**` only when it prevents a real misunderstanding about coverage. Do not add filler exclusions.

### Spec Coverage

- Map each acceptance-criteria category in the spec to the test strategies that cover it.
- If different parts of the same acceptance-criteria category require different verification approaches, break that category into sub-cases instead of forcing one coarse mapping.
- The purpose of the coverage map is to surface missing verification before coding starts. If an acceptance-criteria category does not map cleanly to a strategy, call that out explicitly.

### Format

- Do not manually wrap lines. Write each sentence as a single line.
