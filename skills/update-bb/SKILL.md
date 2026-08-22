---
name: update-bb
description: "Start the bb personal branch update in the background."
disable-model-invocation: true
---

# Update bb

Use the managed `process` tool so Firstmate stays available during the update.

1. Call `process` with `action: "list"` and `statuses: ["running"]`.
2. If a process named `update-bb` is already running, report that the update is already in progress and return.
3. Call `process` with these values:
   - `action: "start"`
   - `name: "update-bb"`
   - `command: "sync-bb-personal"`
   - `notify.onSuccess: "turn"`
   - `notify.onFailure: "turn"`
   - `notify.onKilled: "turn"`
4. Return as soon as the process starts. Let its notifications bring you back; do not wait, poll, or read output while it runs.
5. When the completion event arrives, report success. When a failure or kill event arrives, read the managed process output once and report the exit result and useful error text.
