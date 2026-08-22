---
name: update-bb
description: "Run the bb personal branch update in a durable BB terminal."
disable-model-invocation: true
---

# Update bb

Start the update through the installed skill launcher:

```bash
~/.agents/skills/update-bb/scripts/start-update-bb.sh
```

The launcher refuses a duplicate running terminal. Otherwise, it starts `sync-bb-personal` in a thread-scoped BB terminal and prints the terminal ID, durable log path, and final outcome-marker path.

After launch, wait for the terminal to exit with `bb terminal wait <terminal-id> --exit --timeout 7200`. The terminal is owned by the BB host daemon, so the update continues if this provider session is replaced while waiting.

When the wait ends, read `bb terminal show <terminal-id> --json` and the outcome marker. Report the confirmed result, exit status, and log path. If the marker is missing, report the terminal status and say that no final outcome was recorded; inspect the durable log for the last confirmed step. Do not infer success from an exited terminal alone.
