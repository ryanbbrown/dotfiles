---
name: rules-spec
description: Write a rules spec for Ryan to review and use to direct implementation; numbered rules that say how a system decides, each compared with main. Use when Ryan or another skill asks for a rules spec. Draft in Markdown. Not an implementation plan.
---

# Rules spec

Write **numbered rules** for a system: a document Ryan can read, correct, and use to direct implementation. A rule is one decision the system makes the same way for every input, stated so a reader can say "yes, that is right" or "no" without reading code.

Read the sibling `../plain-words/SKILL.md` before writing.

## 1. Set the scope and baseline

Write one scope sentence: which system, and which decisions. Record the `main` commit the rules compare against. The default is change-only: every rule states a decision that differs from main, and unchanged context goes in "Does not change."

**Done when:** the scope sentence and baseline commit are written.

## 2. Define the terms

Start the document with a **Terms** list: every noun the rules depend on, one line each. One word, one meaning: when two things need names, give them two words, and use each word only for its thing in every rule.

When the change removes a concept, say so once under the terms, so readers stop looking for it.

**Done when:** every noun a rule depends on has a one-line definition, and no word carries two meanings.

## 3. Write the rules

Group rules under short headings in reading order, so each concept is explained before rules that use it. Number them `R1`, `R2`, … across the whole document. IDs are stable: a rule added during review gets a letter suffix (`R4a`), and a dropped rule keeps its number as "Removed."

Each rule has this shape:

```markdown
**R3. An order of $50 or more ships free.**
The total is measured after discounts and before tax.
Main: free shipping starts at $75, measured before discounts.
```

- **Bold line:** one decision, as a plain statement in the present tense. It must be testable: an input either follows it or does not.
- **Body** (optional, 1–3 lines): the consequence or the reason, when the bold line alone would surprise the reader. Settle the edge cases the rule touches: missing values, errors, ties, empty sets, boundaries (≥ or >).
- **Main:** what the system does today, verified against the baseline. Write "Main: does not exist" for a new rule.

A rule with several cases uses bullets under the bold line, one case and its result per bullet. A rule that replaces several old mechanisms lists what each one becomes.

Keep implementation out: no file paths, function names, or which module changes. Names the user sees or sets (config keys, labels, metric names) belong in rules.

If a rule needs a preference the user has not given, mark it **Proposed** or **Decision needed** at the rule and add the question to Open questions with the rule ID.

**Done when:** every decision in scope has exactly one rule, each rule has a Main line, and no two rules contradict.

## 4. Close the document

- **Does not change:** a short list of nearby behavior the reader might expect to move.
- **Later:** decisions deliberately deferred, one line each, so they are not mistaken for gaps.
- **Open questions:** each with the rule ID it blocks.

## 5. Check it

- Can a reader who knows the product, not the code, say whether each rule is right?
- Does each rule settle its edge cases, or name them as open?
- Is every term in a rule defined in Terms, and used with one meaning?
- Does every Main line match the baseline? Verify; do not recall.

## 6. Draft locally

Start in `~/code/scratch/<project>/rules-spec.md` unless Ryan names a document. Keep evidence (code paths, commits, counts) in a separate notes file. Preserve the wording of rules Ryan approved; add or revise rules by ID.

**Done when:** the file is saved and Ryan has a link. Report open questions without claiming the spec is approved.

## From rules to implementation

Agreed rules are the acceptance criteria. A plan maps every rule ID to the steps that deliver it, and code review checks each branch against the rules it claims.
