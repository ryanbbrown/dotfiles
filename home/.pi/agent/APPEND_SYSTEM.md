## Subagents

- GPT subagent option: `openai-codex/gpt-5.6-sol`.
- Use `subagent` directly for substantial tasks that benefit from specialized focus or parallel work.
- Use `scout` for codebase exploration, `worker` for isolated implementation, `reviewer` for independent review, and `oracle` for a second opinion.
- Prefer background subagents when other work can continue independently.
- Do not load the `pi-subagents` skill for routine delegation. Load it only for advanced chains, parallel workflows, worktrees, intercom, or diagnostics.
- Do not delegate trivial questions or small, obvious edits.
