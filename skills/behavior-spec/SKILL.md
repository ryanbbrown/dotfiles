---
name: behavior-spec
description: Break a product project into capabilities and write behavior scenarios for Ryan to review and use to direct implementation. Use when creating a capabilities document, defining changes from main, or revising scenarios for staged releases. Draft in Markdown for review. Not an implementation plan or a code inventory.
---

# Behavior spec

Write **capabilities and scenarios** for a product project: a document Ryan can understand, correct, and use to direct implementation. A capability groups related outcomes; a scenario explains one situation and its result.

Read the sibling `../plain-words/SKILL.md` before writing. The reader understands the product goal but may not know the existing screens, data model, or code. The document supplies that context where needed.

The default is to define conceptual behavior before implementation: who acts, what they want to do, which rules apply, and what happens. Gathering context can vary: use the conversation, customer examples, another engineer's notes, designs, or existing behavior. Code can establish a baseline or help reconstruct an implemented feature; it is not the outline for the document. Neither an existing implementation nor an ERD is required.

Keep user flows and product rules here; review screen design separately in Figma or screenshots. Name a screen or control only when that distinction changes the behavior being agreed. Button labels, form layout, navigation steps, and prefilled inputs usually belong to UI design. A concrete scenario names the person, information, and result without prescribing how the interface delivers it.

The spec is not an implementation plan. Leave out file paths, modules, flags, env files, job or entry counts, which code changes, and how `main` implements the current behavior. Those belong in the plan. A refactor that keeps behavior the same gets a short spec or none; "works the same as on main" is one line in "Does not change," not a scenario per job or command.

Calibrate length against the approved examples listed under Approved examples, when it lists any.

## 1. Establish what the document covers

Use the user's stated scope. Ask only when a missing choice would change the document.

- **Default:** include only observable behavior that changes from the product's `main` in the project or phase being reviewed. Check current `main` to establish the existing behavior, then describe the intended changes. If implementation already exists, use it as evidence without copying its screen-by-screen mechanics. Record the baseline commit and any inspected implementation commits in working notes. Unchanged setup can appear in Before; unchanged behavior does not need its own scenario. New features count as changes from main.
- **If Ryan explicitly asks for a full behavior reference:** cover the agreed scope, including unchanged behavior.
- **Approved design doc:** when an approved proposal, ticket, or design doc already defines the behavior, write scenarios only for what it leaves open or contradicts. If it leaves nothing open, write no spec; report the open product questions instead.
- **Staged delivery:** include the eventual behavior even when its code is absent or temporarily removed. Explain different delivery outcomes within the same scenario.

Write a short scope sentence in the document. Keep release status and implementation history out of the scenarios unless they affect the outcome the user is reviewing.

Use code to establish existing behavior or reconstruct behavior the user asks to document. Use explicit product decisions to establish intended changes. A stale design does not override newer code when the task is to describe that code; code does not override an explicit target decision when the task is to specify desired behavior. Label unresolved conflicts rather than silently choosing or reopening every past decision.

**Done when:** scope, baseline if needed, and which delivery outcomes to describe are clear.

## 2. Break the project into capabilities

Build one hierarchy based on **the outcomes the product provides**. Apply these rules:

1. Extract concrete behavior claims from the available context: who acts, what happens, and what result matters.
2. Group claims by result, at the same level of detail. A capability is broader than one operation and narrower than the whole product. Ask “what result does this step serve?” to combine mechanisms; ask “what distinct results are hidden here?” to split a vague heading.
3. Name each category with a familiar verb and a concrete object. Add one sentence describing the included results. Mention a neighboring category only where the boundary could be confusing.
4. Assign each behavior decision one primary home. An end-to-end flow can cross categories; that does not mean the same decision belongs in both. Use short references for dependencies instead of duplicating the rule.
5. Split categories when they contain independently explainable outcomes. Merge categories when their only difference is a channel, source, screen, file format, or implementation component.
6. Order categories so earlier concepts help explain later ones. Delivery order is a separate decision.

Aim for a reviewable outline, often 6–12 categories for a substantial project. Derive the count from the behavior; smaller projects can have fewer. Each category can contain many scenarios, and categories need not have equal numbers.

A source or channel can appear in a title when it clarifies the outcome. For example, “Connect Slack to a workspace” describes a setup result; “Slack” alone does not. “Notify people about issue updates” describes a different result, even when Slack delivers the message. Derive the categories for each project rather than copying another project's categories.

Test the outline before expanding it:

- **Prediction:** can the reader tell what belongs under each title and description without reading the scenarios?
- **Overlap:** for several concrete decisions, is there one clear primary category? If two fit equally well, revise their boundaries.
- **Coverage:** does every known in-scope result have a home?
- **Level:** are the categories peers, rather than a mixture of whole workflows and tiny steps?

When starting from scratch, show the bare outline for review before writing a large scenario set, unless the user requests a complete first draft. Preserve accepted category wording when expanding or publishing it. A change-only document may retain an accepted category with “No changes in this release” rather than inventing scenarios.

**Done when:** the outline passes these checks and any requested outline review is complete.

## 3. Write scenarios under each capability

Use stable IDs and situation-specific titles. Keep the capability's description identical wherever it appears.

```markdown
## 2. Find people

Find saved people by their names and profile details. Changes to those details belong under Keep person details current.

### 2.1 A user searches for words in a person's description

- **Before:** Jordan Lee's description says “Handles contract renewals.”
- **Action:** A user searches for people using “renewals.”
- **After:** The search finds Jordan. On main, search does not look at descriptions.
```

Examples illustrate the format, not approved requirements for another project. Use a completed project as a reference only after Ryan approves it as an example; preserve the method, not that project's categories or decisions. The files listed under Approved examples are approved.

- **Before:** the facts needed to understand the decision. State who has access, what is already saved, or which source supplied a value when that changes the result.
- **Action:** the named person or system does one concrete thing. Say “a workspace administrator” or “Okta,” not “someone.” State when a step is manual. Describe “a user adds a person to an issue,” rather than the buttons and forms used.
- **After:** what is saved, shown, sent, allowed, blocked, or left unchanged. Include the rule behind a surprising result. For a blocked action, state the reason communicated to the user and what remains unchanged; exact error copy belongs to UI design.

Scenarios state behavior, not UI. Leave out lists, progress indicators, dialogs that open or close, toasts and messages, disabled or locked controls, and labels. The UI a project copies or follows is an implementation detail for the plan, not the spec.

- **UI:** The files show in a list with names and sizes. Maya clicks "Upload 30 documents"; each row shows a spinner, and the dialog closes when all are done.
- **Behavior:** Maya can remove files before the upload starts. After the upload, the bank has one new source per file.

One scenario should let the reader decide whether one rule is right. Split cases when their conditions or outcomes differ enough to deserve separate review. Merge cases whose only difference is a channel, source, screen, file format, or input method, as for categories. Keep several consequences together when they explain the same action; do not force the reader to assemble its meaning from scattered fragments.

For staged outcomes, use four bullets in one scenario:

```markdown
### 3.2 A contract names a new signer

- **Before:** A contract linked to Beta Corp names Priya Shah as a signer. Priya is not saved in Directory.
- **Action:** The product processes the contract.
- **After — Initial:** The product adds Priya as a person at Beta Corp and lists Priya on the contract.
- **After — Review Queue:** The product saves a proposal with the contract and Priya's name in Needs Review. An administrator decides whether to add Priya. Until then, Priya is not added to Directory or listed on the contract.
```

Use the project's actual delivery names, such as **After — Initial** and **After — Review Queue**. Use one **After** when both deliveries behave the same. The initial result can match the baseline if the later result changes it. Write the result explicitly; “same as main” alone is not an explanation. Do not create duplicate scenarios for old, temporary, and final versions of one rule.

In a change-focused document, add a short baseline comparison only where it helps the reader see the change. Verify that comparison. “Before” describes the example's starting conditions, not a paragraph of code history.

In a change-focused document, every scenario describes behavior that differs from main. Put unchanged behavior the reader needs as context in a short "Does not change" list after the scope sentence, never in a scenario or an After bullet. Within that rule, cover the important variations: successful actions, missing or ambiguous information, conflicting updates, permission boundaries, repeated actions, deletion, and relevant failures. Choose cases that could change a product decision, not every combination of inputs. Give risky or surprising behavior more explanation; straightforward behavior can be short.

If an outcome needs a preference the user has not supplied, label it **Proposed** or **Decision needed** at that outcome. Put the concrete question in an Open questions section and refer to the scenario ID. Fill in the known parts rather than making the whole scenario vague. Never present a proposed answer as agreed.

**Done when:** each known in-scope changed rule has a scenario or an explicit open question, without duplicate homes or conflicting outcomes.

## 4. Check whether a human can understand it

Apply these checks yourself before asking for another reviewer:

- Can the reader identify the actor, trigger, and outcome without knowing the code?
- Would the scenario still describe the same requirement if the screens were redesigned? Retain a screen-specific detail only when removing it would change the product rule or meaningful user flow.
- Are concepts explained before rules about them? Explain that combining two records keeps one record before discussing when combining is allowed.
- Are vague nouns replaced with the actual information? Use “Slack user ID and the channel or direct message to send to,” not “account and delivery information.”
- Does every reference name an existing scenario or clearly named concept?
- Can the reader explain why the result follows from the stated conditions?
- Does each included scenario meet the document's scope, rather than merely describe a changed table or helper?
- Do initial and later results describe coherent behavior, without treating temporary implementation gaps as requirements?

Keep prose bullets as the default. Use enough words to explain the result; do not compress meaning to fit a table. A later format conversion preserves approved wording, even when cells become long.

Use a focused independent review when uncertainty warrants it: ask the reviewer to find missing actors, unexplained terms, contradictory outcomes, category overlap, or unsupported claims. Repeated broad reviews are not a substitute for these checks.

Keep source links, code paths, baseline commits, and coverage notes in a separate working file unless the user requests them in the document. The behavior document should stand alone.

## 5. Draft locally, then edit where review happens

Write the document in `~/code/scratch/<project>-capabilities.md` unless Ryan names an existing document to edit. Keep evidence in a separate `<project>-capabilities-evidence.md` file. The Markdown file is the document; apply review changes to it directly with targeted edits.

“Reply to comments” authorizes replies, not body edits. “Comments only” and “no changes” keep the document unchanged. Preserve the wording of user-approved changes instead of rewriting adjacent sections for style.

**Done when:** the requested document is saved and the user has a working link. Report remaining decisions without claiming the draft is approved or exhaustive beyond the checked scope.

## From scenarios to implementation

Categories organize behavior; phases organize delivery. One phase may implement scenarios across several categories. When asked to plan implementation, map work to scenario IDs, dependencies, and priorities rather than turning each category into a phase.

Agreed scenarios are requirements for implementation and review, not proof that the code meets them. Agents can choose engineering details and UI mechanics within those requirements; Figma and screenshot review handle the interface design. Ask the user when reasonable alternatives require an unstated product preference or would change an agreed outcome, not merely because a different screen or control could deliver it.

## Approved examples

None yet.
