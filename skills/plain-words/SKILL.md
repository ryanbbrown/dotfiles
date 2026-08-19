---
name: plain-words
description: Write or edit non-code prose to be plain, concise, specific, free of filler and of unexplained jargon, and explicit enough that a reader with no context follows every sentence. Use for markdown notes, plans, summaries, comments, launch copy, emails, or when asked to make writing less verbose, generic, corporate, or AI-sounding.
---

# Plain words

Write useful words. Cut the rest.

## Default shape

- Start with the point.
- Prefer bullets for notes, findings, plans, and status.
- Prefer short paragraphs for explanations.
- Use tables only when comparing several items.
- Keep headings literal and specific.
- Use links, dates, counts, file paths, commands, and examples when they matter.
- If a fact is missing, say so directly. Do not write around it.

## Cut

- filler
- throat-clearing
- generic advice
- hype
- corporate language
- academic padding
- repeated points
- fake balance
- rhetorical questions
- long setup before the answer
- sections that exist only because a template expects them

## Replace

- "it is worth noting that" -> say the thing
- "in order to" -> "to"
- "utilize" -> "use"
- "leverage" -> "use"
- "robust" -> name the actual property
- "seamless" -> name what gets easier
- "empower" -> name what the person can do
- "delve into" -> "look at" or a more specific verb
- "landscape", "ecosystem", "unlock", "game-changing" -> concrete nouns and verbs

## Keep

- facts
- decisions
- evidence
- caveats that change the decision
- direct links
- exact dates and numbers
- clear next actions

## Natural prose

- Match a supplied writing sample's vocabulary, sentence rhythm, punctuation, and tone. Keep the active instructions as the boundary.
- Preserve every supported fact and qualification. Add a specific fact only when the source or the user supplies it.
- Name the person or system that acts. Prefer direct forms such as "is" and "has" when they are accurate.
- State the claim directly. Replace inflated significance, empty `-ing` analysis, scripted contrasts, and generic conclusions with a concrete effect, fact, or next action.

## Reader does no work

Write for a reader with none of your context. Any sentence that only parses if the reader already knows the answer is a bug.

- A word is jargon if the intended reader would have to ask what it means: "dereference," "idempotent," "backpressure" fail even for technical readers.
- Define every term of art at first use, in the same sentence. If the definition feels too expensive, the term is wrong for this document.
- Name things; do not point at them. A reference fails if the reader must pause, reread, or guess: "it" with two candidate nouns, "the pair" for fields never named. When in doubt, repeat the noun. Never point at content elsewhere ("the lists below") unless it is literally there.
- Spell out the chain. If the point is A therefore C, write the B the reader would otherwise have to derive.
- When you coin a term, rank things, or make a judgment call, say so where it happens, and say why.
- Prefer named instances to the category: "a REST API, a flat file, an SFTP batch drop," not "the range of integrations."
- Words that remove reader work are not filler. Cut throat-clearing, never steps of reasoning. When shorter fights clearer, clearer wins.

## Markdown rules

- One bullet per item unless detail is needed.
- Keep bullets to one line when practical.
- Do not add summary sections that repeat the document.
- Do not explain obvious headings.
- For private notes, optimize for retrieval over polish.

## Final check

- Does every sentence add information?
- Is the first useful point at the top?
- Could a shorter word say the same thing?
- Did I invent advice or structure the user did not ask for?
- Did I state missing facts directly?
- Could someone with no background in the subject follow every sentence?
- Does any sentence only parse if the reader already knows the answer?
- Did I cut a step of reasoning the reader will have to rebuild?
- Did I add a fact, name, number, date, quote, or citation that the source does not support?
- If the user supplied a writing sample, does the result match its vocabulary, rhythm, and tone within the active instructions?
