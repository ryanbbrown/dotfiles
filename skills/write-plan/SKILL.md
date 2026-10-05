---
name: write-plan
description: Write an implementation plan for one phase of a project from its behavior spec. Use when the user invokes /write-plan or when a skill names it.
---

# Write plan

What planning is for: understand the codebase deeply, record the evidence that grounded the plan, and produce a plan good enough that implementation is mechanical. Do NOT implement the feature during planning — product-code changes belong after approval. Web research stays available — use it.

The behavior spec for the phase is the acceptance criteria. Plan and build directly against it. Read it in full before the steps below; every scenario ID it contains must appear in `## Acceptance criteria mapping`.

Do this:

1. **Map the territory.** Identify the entry points, modules, routes, components,
   and data models the request touches. Read them. Trace the call paths end to end.
   For broad sweeps, delegate a read-only BB child thread and ingest its
   summary instead of reading everything into your own context.
2. **Search for existing similar code.** Before planning new functions, logic,
   API routes, hooks, components, schemas, queries, jobs, or utilities, grep for
   exact identifiers and search by behaviour to find prior implementations of
   the same or adjacent behavior. Prefer reusing, extending, or calling existing
   code over duplicating it. If reuse is not appropriate, explain why in the plan.
3. **Learn the conventions.** How does this repo structure code, handle errors,
   validate input, write tests, and name things? Mirror them — don't invent new
   patterns.
4. **Find the seams.** Locate the central **logger**, the **data/DB layer**, auth,
   config/env, feature flags, and the **build / run / test** commands (check
   `package.json` scripts, `Makefile`, `pyproject.toml`, `README`, CI config).
5. **Audit and red-team the request.** What's ambiguous? What edge cases, failure
   modes, race conditions, migration/back-compat concerns, security and
   performance risks exist? What existing behavior could regress?
   **Parity requests get an effect inventory:** when the request asks to
   replicate or reach parity with an existing feature, read the reference
   implementation and enumerate its observable side effects (API calls, DB
   writes, entity links/associations, record naming, notifications) — EVERY one
   must map to a plan step or an explicit `## Out of scope` entry. And for
   every new field/key the plan writes to a persisted store, name the code that
   reads it: data written with no consumer is a planning defect, not progress.

Then write the plan to `.plans/<slug>.md` using Markdown `##` section headings.
**The plan must contain these exact sections:**

- `## Goal` — one paragraph restating the feature and the acceptance criteria,
  naming the behavior spec document and phase.
- `## Planning evidence` — the concrete local reads/searches/child threads and external
  sources that grounded the plan.
- `## Affected files/areas` — concrete paths, with what changes in each and why.

- `## Existing similar code scan` — paths and APIs/functions/components found,
  whether they will be reused/extended, and why any apparent duplicate should not
  be reused.
- `## Step-by-step implementation` — ordered, each step independently checkable.
  Give EVERY step its own `Verify:` line stating how you will confirm that step
  worked, and sketch the exact signature of each new function/API/component the
  plan introduces (committing to interfaces exposes wrong assumptions early).
- `## Data/DB` — schema or query changes, migrations, and the exact CRUD operations
  the feature will perform.
- `## Test & verification plan` — the user flows you'll walk in the browser, and the
  before/after DB checks for each CRUD step.
- `## Risks & edge cases` — from your audit, with how the plan handles each.
- `## Out of scope` — every requested or parity-implied behavior this plan
  deliberately does NOT implement, each with why (write `None.` if nothing is
  excluded). This section is shown VERBATIM to the human at the approval gate
  and embedded in the PR body — recording a scope decision anywhere else (an
  "Assumption:" line, hedged wording in a step) is a planning defect the plan
  review will block on.
- `## Open questions` — anything you need the human to decide.
- `## Acceptance criteria mapping` — map EVERY scenario in the behavior spec, by
  ID, to the plan step(s) that implement it and the verification that proves it.
  Map the scenario as WRITTEN, not a narrowed restatement of it — narrowing
  belongs in `## Out of scope` where the human sees it. A scenario the plan
  cannot, should not, or does not satisfy goes in `## Open questions` with its
  ID and the reason; never map it to a step that does not deliver it.
- `## PR split` — the steps grouped into PRs in merge order, one line per PR
  naming its steps, under the PR split rule below.

Finally, post exactly three sections to the human, verbatim and nothing else:
`## PR split`, `## Out of scope`, and `## Open questions`. Then stop and wait
for the human. Any open question that names a spec scenario blocks approval
until the human answers it.

> Writes during planning are for notes, scratch files, and child-thread
> artifacts — not the feature. If you think you must change product code to
> understand something, you almost never do — read it instead; prototypes you
> do write must be called out in the plan.

## PR split rule

One PR undoes one thing when reverted. If reverting the PR would undo more than one thing a user or another system does, it is more than one PR. "All writers use the new service" reverts six separate behaviours (a form, an API, a sync sweep, an intake path, a document processor, a dev seed); each can break alone and is verified alone, so each is a PR. "Create returns a candidate when no company resolves" reverts exactly one thing.

A pure addition that nothing calls yet (a new module, a new table) is one thing: it exists. There is no smaller revert that leaves something useful, so it stays whole whatever its size.

Always separate:

- A database migration. Different approver, applied to prod before merge, different lifecycle. It carries only the SQL, the checksum file, the regenerated schema files, and the tests that prove the SQL. Code that uses it goes in the PR above.
- Dark changes from live changes. Dark: nothing runs it yet (new table, unused service, a view nobody reads). Live: alters what users or other systems see today. A reviewer must know which lines need care.

Do not mix change types in one PR. New code reads top to bottom. Modified code needs old-versus-new on every line, at several times the effort per line. Mechanical edits (a hundred `from` clauses) are skimmed. Generated files are ignored. A PR of one type is fine at any reasonable size; a PR that mixes types is hard at any size.

Each PR must leave main working if nothing above it merges. When two PRs depend on order (add the replacement before removing the old path), the plan states the order.

Lines of code are a late warning, not the rule. Reviewer identity is not a rule; it may pick the reviewer, not the boundary.
