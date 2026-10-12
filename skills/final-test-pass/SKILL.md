---
name: final-test-pass
description: Run the existing tests once when the code is done, and sort every failure. Use when the code for a task or stack is complete and not yet pushed, or when AGENTS.md or the ship skill names the final test pass.
---

# Final test pass

The existing tests are a regression check on finished code, not feedback during the build. Run this pass once, on the top branch of the stack, after the code is done and before the push.

## Steps

1. **Select.** From the repository root, on the top branch, run `python3 <this skill's directory>/select-tests.py "$(git merge-base HEAD "$(git rev-parse --abbrev-ref origin/HEAD)")"`. If `origin/HEAD` is not set, run `git remote set-head origin --auto` first. It prints the unit-test files in each changed package that import a changed file, directly or through other files in that package. It leaves out E2E, integration, live, and Docker tests. Done when you have the list. An empty list ends the pass: report "no tests selected".
2. **Run.** Run the selected files once, per package, with that package's own test command and flags. Read the package's `test` script for its preload files and options, and pass the selected files to it. For Python, run `uv run --no-sync pytest -q -m "not db and not live_llm and not integration" <files>` from the package directory, and add the package's own markers for tests that need services. Done when every selected file ran and every failing test is listed.
3. **Sort.** Put each failing test in one group, with a one-line reason:
   - **Intended**: the test checks behavior the stack changed on purpose. Cite the plan step, spec item, or commit. Update the test to the new behavior.
   - **Structural**: the behavior is the same, and the test broke on internal shape, such as a mock signature, a renamed internal, or a moved module. Change the test as little as possible to make it pass.
   - **Unexpected**: behavior changed that the stack did not intend. Keep the test as it is, and stop for the user with the test, the failure output, and the commit you suspect.

   A failure in a file the stack did not touch is unexpected until you show which intended change caused it. Done when every failure has a group and a reason.

4. **Fix.** Make each test edit on the lowest branch that caused the failure, then restack. Rerun only the files that failed, once. Done when those files pass, or only unexpected failures remain.
5. **Report.** Write a table: test (file and name), group, action, reason. Add the structural rows to the PR body of the branch they belong to, under the test plan.

## Limits

The selection misses changes with no import edge (config, schema, fixtures, environment), dynamic imports, and consumers in other packages. CI on each PR covers these. A CI failure this pass missed gets one fix round, sorted the same way.
