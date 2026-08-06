---
name: test-quality
description: Evaluate, write, or review tests for real confidence instead of shallow coverage. Use when adding tests, reviewing test suites, deciding what kind of test to write, checking for tautological or low-value tests, handling bug-fix regression tests, or pushing back on tests that only prove mocks, framework behavior, snapshots, truthiness, or implementation details.
---

# Test Quality

Use tests to prove behavior a user, caller, operator, or maintainer actually depends on. A test is useful when it can fail for a real regression. A test is slop when it passes by construction, checks the framework, checks a mock, or only mirrors the implementation.

## Default Workflow

1. Identify the behavior under test from requirements, the diff, and any claims you plan to make to the user.
2. Name the seam: the public boundary where the behavior is invoked and observed. Prefer user-facing or caller-facing interfaces over private methods and internal collaborators.
3. Choose the cheapest test layer that proves the behavior: unit for pure decisions and transformations, integration for wiring and persistence boundaries, E2E for critical user workflows.
4. Define an independent oracle: a known literal, spec example, fixture, invariant, or observable side effect that was not computed the same way as the implementation.
5. Check sensitivity: explain what bug would make this test fail. For bug fixes, run the regression test before the fix and confirm it fails for the right reason.
6. Keep or add only tests that increase confidence. Delete or rewrite tests that cannot fail meaningfully.

## TDD Stance

Do not force strict red-green-refactor unless the user asked for TDD or the local codebase already requires it.

Use test-first strongly for bug fixes: reproduce the bug, watch the test fail for the right reason, fix the code, then watch it pass. Without the failing run, the test may only prove current behavior.

For new features, write tests alongside the work and make sure they exist before claiming completion. Prefer writing the test first when behavior is clear enough to specify. If the implementation already exists, review the test for sensitivity rather than pretending the process was TDD.

## Good Tests

- Test observable behavior through public interfaces.
- Read like a specific capability: `rejects duplicate email`, not `test validateUser`.
- Assert outcomes, state, returned values, emitted events, persisted data, or user-visible UI.
- Use real internal objects where practical; mock only external boundaries such as third-party APIs, payment, email, time, randomness, or expensive infrastructure.
- Cover meaningful risk: requirements, bug history, edge cases, error paths, permissions, boundaries, concurrency, serialization contracts, and silent failures.
- Are DAMP rather than DRY: readable setup is better than a helper maze that hides intent.
- Pin both presence and absence when the field set is a contract.

## Slop Detectors

- **Tautological assertion**: expected value is computed the same way as the implementation, compares a value to itself, or asserts `sorted(xs) == sorted(xs)`.
- **Implementation echo**: checks private methods, internal call counts, exact helper order, or `repo.save()` when the contract is "the user can be retrieved."
- **Mock theater**: mocks the system under test, asserts a mock component exists, or verifies mock calls without proving real behavior.
- **Framework test**: proves the router routes, ORM saves, or test library works instead of proving project logic.
- **Assertion-free exercise**: calls code and only checks it does not throw when correctness requires a specific result.
- **Over-broad matcher**: uses `toBeTruthy`, `toBeDefined`, snapshots, or loose shape checks when the contract needs exact values or fields.
- **Snapshot-only approval**: commits generated output without reading it or without behavioral assertions around what matters.
- **Test-only production hook**: adds `reset`, `clearState`, `setTestMode`, or lifecycle methods only because tests need them.
- **Incomplete fake**: mock data includes only fields the test author noticed, not the full real shape downstream code consumes.
- **Vacuous collection check**: `every` or `all` passes because the collection was never populated.
- **Wrong entry point**: constructs an already-normalized object below the parser, serializer, or adapter where the bug lives.
- **Synchronous fake for timing logic**: same-tick fake hides races that happen with real latency.
- **Simulator-in-test**: defines a mini implementation inside the test and asserts that simulator returns the expected answer.

## Pushback Rules

Push back when a requested test only increases coverage numbers. Explain the missing confidence in concrete terms: what regression would still pass, what system path is bypassed, or what assertion is circular.

If a test is hard to write because everything must be mocked, first consider whether the test is at the wrong layer or the code is too coupled. Prefer moving the test to a better seam over adding more mocks.

Do not test every function by default. Test behavior with risk, public contracts, bug history, nontrivial branching, data transformations, and integration boundaries. Simple pass-through code can remain covered indirectly unless the codebase has an explicit coverage policy.

## Verification Checklist

- The test would fail if the behavior broke.
- The expected value comes from an independent source of truth.
- The test enters through the same seam production uses.
- Mocks are only at boundaries and preserve required side effects.
- Failure paths are observable, not silently swallowed.
- The test name states expected behavior.
- The test can run reliably without hidden shared state.
- For a bug fix, the test failed before the fix and passed after it.
