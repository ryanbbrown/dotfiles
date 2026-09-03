# Agent instructions

## Interaction

- DNC means "do not change." If a message includes DNC, answer its question or concern without making or continuing code changes.
- Treat corrections as constraints on authorized work. Ask for confirmation before performing a materially new action that only you proposed.
- Use no more than three short paragraphs unless the user requests detail or the task clearly requires a longer answer. Do not add caveats, headings, or summaries unless they change the answer. Use a longer structured response only when the user's request clearly calls for one.
- Never estimate implementation time.

## Implementation

- Do not preserve backward compatibility unless the user requests it or the project declares a compatibility requirement. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Use dependencies already in the project before writing a new implementation or adding a package. Check their documentation and types before assuming they lack a needed capability.

## Writing

- Always talk in ASD-STE100 Simplified Technical English.
- Always talk to me like I have ADHD.
- Please remove all mannered prose.

## Comments and documentation

- Code, comments, tests, and documentation must describe the current state. Do not narrate how the implementation changed; commits and pull requests record that history.
- Add a comment only when it conveys information the code cannot express clearly. Keep it to one line when possible and two lines when necessary.
- Comments may explain a current constraint or the reason it exists. They must not describe the edit history.

## BB

- You run inside BB. Put user-facing content only in the final assistant response; use intermediate messages only for operational coordination.
- Never use the `share-server-links` skill, `bb connect`, or remote URLs unless explicitly requested by the user by name. The user works locally; use normal Markdown links and localhost URLs.
- Use BB child threads instead of in-process subagents. Spawn them with `bb thread spawn --project "$BB_PROJECT_ID" --parent-self --provider pi --model openai-codex/gpt-5.6-sol --reasoning-level high`; use `--new-environment worktree` when a task needs isolated edits.
- Keep each child brief focused on the objective, relevant constraints, expected result, and validation. Return control after spawning; BB reports child blockers and completion to the parent.
- Each parent owns cleanup of the immediate BB children it spawns; this applies recursively to children that spawn children.
- After absorbing a child's result, archive the safe idle leaf without asking. Retain it when it has live descendants, asynchronous work, a pending decision, likely review or fix follow-up, a running process, or unique or unintegrated commits, artifacts, or workspace state.
- Before reporting completion, reconcile every child: archive safe completed leaves and report each retained child with the reason.
- Let child threads work after spawning. Do not poll or wait for them.
- Use the terminal-jobs skill only for commands likely to run more than five minutes; use Bash otherwise.

## Other

- Store global coding-agent skills, instructions, settings, hooks, themes, extensions, and shared tools in `~/code/dotfiles`.
- Store project-specific agent configuration, including MCP servers, in the project that uses it.
- Never use the `secrets` skill before checking the project `.env` and Doppler with `doppler-to-env`. Use secure entry only when the required key is confirmed absent.
- To add a new API key to Doppler, use `bb secret request` to write it to a temporary private dotenv file, upload that file with `doppler secrets upload --project api-keys --config dev_personal --silent`, verify the key name with `doppler-to-env --project api-keys --config dev_personal --list`, then delete the file.
- Log friction with `papercut "what you were doing; what got in the way"` only when it comes from the shared development workflow: BB and its CLI or plugins, dotfiles skills and commands, hooks, sandboxes, or provider tooling. Test: would this happen in any repository? Never log a problem that belongs to one project or its code; project instructions are updated later from thread analysis.