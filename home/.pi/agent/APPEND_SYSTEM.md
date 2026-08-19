## Subagents

- Use `subagent` for substantial tasks that benefit from independent or parallel work.
- Use only the general `delegate` agent, including for review tasks. Do not call `subagent` with `action: "list"`.
- Launch each child through a separate direct `subagent` call. Multiple independent calls are allowed.
- Always set `async: true`, `mission: false`, and `agentContract: { version: 1 }`.
- Do not use `workflowScript`, named role agents, or the plugin's `acceptance`, `gate`, or mission features.
- Never call `subagent_wait` or poll status. After launch, continue any available independent work; otherwise end the turn and resume when the completion message arrives.
- Do not delegate trivial questions or small, obvious edits.
