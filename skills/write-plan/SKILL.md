---
name: write-plan
description: Write an implementation plan file for a task.
disable-model-invocation: true
---

# Write plan

Read the code the task touches before you write. Write the plan to `.plans/<slug>.md`, or to the repository's plan directory and name pattern when it has one.

The reader is an implementation writer that sees only this file and the repository. Give it decisions, files, and tests. Leave names, function bodies, exact queries, and error text to the writer.

## Sections

Use these headings in this order. Add an optional section only when this plan has content for it.

### Goal

One paragraph: what is true for the user or operator after the change, and why. Name a nearby change that the plan does not authorize when the writer would plausibly make it.

### Current state (optional)

Facts about the existing code that shape the decisions, each with a file path. Include a measurement when the goal is performance.

### Decisions

One bullet for each design choice the writer must not reopen. State the end state in one or two lines. Add a reason only when it changes what the writer does. Resolve an open choice before you write: ask the user, or choose the simplest option that meets the requirement and state it.

### Changes

One numbered `###` unit per independently testable piece of work, in implementation order. Each unit has:

- **Files**: repo-relative paths to create, modify, and test.
- **Change**: what each file does afterwards, at the level of responsibilities and data flow. Give an interface name and shape only when another unit or a caller depends on it.
- **Tests**: the scenarios the writer must cover, one per line, each naming the input and the expected outcome.

Name files that stay unchanged only when the writer would plausibly edit them.

### Acceptance checks

Observable behaviours that are true when the work is complete, each verifiable from the repository.

### Validation

The repository's exact commands the writer runs before it reports completion.

### Deferred (when any)

Work noticed during planning that this plan does not do: adjacent cleanups, nice-to-haves, and mechanisms with no observed need yet.

## Minimal build

Plan the basic version that meets the goal. A mechanism for failure, scale, concurrency, durability, or compatibility, such as a retry, fallback, lock, checkpoint, resume path, timeout, or validation layer, appears in Decisions only with the observed failure it answers: a log line, a failing test, a reproduced case, or a user report. Without one, the behaviour is to stop with a clear error, and the mechanism goes to Deferred. Apply the same test to a reviewer finding that proposes one.

## Size

The plan grows only with the number of decisions and units. A one-decision task has a one-paragraph goal, one decision, one unit, and one validation command. Content that does not change what the writer does stays out.
