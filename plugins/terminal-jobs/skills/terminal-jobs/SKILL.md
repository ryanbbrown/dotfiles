---
name: terminal-jobs
description: Run any agent-started command that can outlive the current tool call. Use for finite jobs, servers, watchers, and other durable terminal work when bb terminal-job is installed.
---

# Terminal jobs

Use `bb terminal-job run` for each new durable command. Follow a specialized skill's durable launch command when it has one. A skill can call Terminal Jobs directly or provide a domain launcher; use only the path that skill specifies.

For a finite command in the current thread:

```bash
bb terminal-job run --title "TITLE" --artifact-root "$BB_THREAD_STORAGE/terminal-jobs" -- COMMAND ARG...
```

For a server or watcher, use the same command without shell background syntax. The job remains `observing` while the command runs. Stop it through its BB terminal when the user asks.

Use an explicit scope only when needed:

```bash
bb terminal-job run --title "TITLE" --thread THREAD --notify-thread "$BB_THREAD_ID" --artifact-root /absolute/path -- COMMAND ARG...
bb terminal-job run --title "TITLE" --environment ENVIRONMENT --notify-thread "$BB_THREAD_ID" --artifact-root /absolute/path -- COMMAND ARG...
bb terminal-job run --title "TITLE" --machine HOST --cwd /absolute/path --notify-thread "$BB_THREAD_ID" --artifact-root /absolute/path -- COMMAND ARG...
```

Arguments after literal `--` belong to the command. Pass each argument separately. Put secrets in environment variables or mode-0600 files, not argv.

Register an existing terminal only when its durable log path is already known:

```bash
bb terminal-job watch TERMINAL_ID --notify-thread "$BB_THREAD_ID" --log /absolute/path
```

`watch` does not recover scrollback and has no runner outcome. Prefer `run` for new work.

Return control after launch. The plugin sends an at-least-once queued completion message with a stable marker. Inspect or retry it with:

```bash
bb terminal-job show JOB_ID --json
bb terminal-job retry-notification JOB_ID --json
```

A retry after uncertain delivery can duplicate the same stable marker.
