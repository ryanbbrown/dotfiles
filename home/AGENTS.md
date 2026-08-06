# Agent instructions

## Interaction

- If the user interrupts with a question, objection, or uncertainty that could change the next action, stop after answering and wait for confirmation. Do not treat a correction that you proposed as permission to execute it. If the answer cannot change the authorized work, answer and continue.
- Answer direct questions directly. Use no more than three short paragraphs unless the user requests detail or the task clearly requires a longer answer. Do not add caveats, headings, or summaries unless they change the answer. Use a longer structured response only when the user's request clearly calls for one.

## Implementation

- Do not preserve backward compatibility unless the user requests it or the project declares a compatibility requirement. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Use dependencies already in the project before writing a new implementation or adding a package. Check their documentation and types before assuming they lack a needed capability.

## Writing

Apply these ASD-STE100 Simplified Technical English principles to all prose, including chat responses, plans, documentation, comments, and user-facing text:
- Use active voice. Use the imperative form for instructions.
- Put only one instruction in each sentence.
- Limit procedural sentences to 20 words and descriptive sentences to 25 words.
- Use one term for each concept. Do not use synonyms only to add variety.
- Remove unnecessary jargon. Define a necessary technical term when it first appears.
- Do not write a sequence of more than three nouns. Use connecting words to make the relationships clear.
- Keep each paragraph about one topic and to no more than six sentences.

## Comments and documentation

- Code, comments, tests, and documentation must describe the current state. Do not narrate how the implementation changed; commits and pull requests record that history.
- Add a comment only when it conveys information the code cannot express clearly. Keep it to one line when possible and two lines when necessary.
- Comments may explain a current constraint or the reason it exists. They must not describe the edit history.

## Other

- Make all durable changes to coding-agent skills, instructions, settings, hooks, themes, extensions, and shared tools in `~/code/dotfiles`.
- When you encounter small workflow friction—a failed tool call, unclear setup, flaky command, stale cache, misleading error, or unexpected gotcha—log it immediately with `papercut "what you were doing; what got in the way"`. Log non-blocking friction too; repeated papercuts reveal where the workflow needs improvement.
