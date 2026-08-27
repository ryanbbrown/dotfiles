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

The launcher refuses a duplicate running terminal. Otherwise, it owns one `terminal-job run` call for `sync-bb-personal` and prints the job ID, terminal ID, update-specific durable log path, and final outcome-marker path. Invoke the launcher directly; do not wrap it in another terminal job.

Return control after launch. The terminal-jobs plugin sends the queued completion notice. When it arrives, read `bb terminal-job show <job-id> --json` and the update outcome marker. Report the confirmed result, exit status, and log path. If the marker is missing, report the terminal-job status and say that no final update outcome was recorded; inspect the durable log for the last confirmed step. Do not infer success from an exited terminal alone.
