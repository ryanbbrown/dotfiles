# Agent instructions

## Interaction

- DNC means "do not change." If a message includes DNC, answer its question or concern without making or continuing code changes.
- Treat corrections as constraints on authorized work. Ask for confirmation before performing a materially new action that only you proposed.
- Use no more than three short paragraphs unless the user requests detail or the task clearly requires a longer answer. Do not add caveats, headings, or summaries unless they change the answer. Use a longer structured response only when the user's request clearly calls for one.

## Implementation

- Do not preserve backward compatibility unless the user requests it or the project declares a compatibility requirement. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Use dependencies already in the project before writing a new implementation or adding a package. Check their documentation and types before assuming they lack a needed capability.

## Writing

- Always talk in ASD-STE100 Simplified Technical English.
- Always talk to me like I have ADHD.

## Comments and documentation

- Code, comments, tests, and documentation must describe the current state. Do not narrate how the implementation changed; commits and pull requests record that history.
- Add a comment only when it conveys information the code cannot express clearly. Keep it to one line when possible and two lines when necessary.
- Comments may explain a current constraint or the reason it exists. They must not describe the edit history.

## BB

- You run inside BB. Put user-facing content only in the final assistant response; use intermediate messages only for operational coordination.
- Use BB child threads instead of in-process subagents. Spawn them with `bb thread spawn --project "$BB_PROJECT_ID" --parent-self --provider pi --model openai-codex/gpt-5.6-sol --reasoning-level high`; use `--new-environment worktree` when a task needs isolated edits.
- Keep each child brief focused on the objective, relevant constraints, expected result, and validation. Return control after spawning; BB reports child blockers and completion to the parent.
- Use `bb thread tell <id> "..." --mode steer` to redirect active work and `bb thread stop <id>` to stop stuck work. Do not poll or wait for child threads.
- Use `bb terminal create --thread "$BB_THREAD_ID" --title "..." --command "..."` for servers, watchers, and other long-running commands so they remain visible and stoppable in BB.

## Other

- Store global coding-agent skills, instructions, settings, hooks, themes, extensions, and shared tools in `~/code/dotfiles`.
- Store project-specific agent configuration, including MCP servers, in the project that uses it.
- Projects should use `.env` for API keys and sensitive values. If it does not exist, run `doppler-to-env --help`.
- When you encounter small workflow friction—a failed tool call, unclear setup, flaky command, stale cache, misleading error, or unexpected gotcha—log it immediately with `papercut "what you were doing; what got in the way"`. Log non-blocking friction too; repeated papercuts reveal where the workflow needs improvement.
