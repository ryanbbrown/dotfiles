---
name: rotate-firstmate
description: "Replace the current Firstmate thread with a fresh thread while preserving its BB route and relationships."
disable-model-invocation: true
---

# Rotate Firstmate

Replace the current thread. It can be root or parented, pinned or unpinned, and can have any title.

Run the deterministic script from the installed shared skill tree:

```bash
~/.agents/skills/rotate-firstmate/scripts/rotate-firstmate.sh
```

The script binds the replacement as the Firstmate Queue manager before its first session starts, then sends it a prompt that runs the `firstmate-queue` skill to open the queue panel. It transfers only unarchived direct children. It leaves archived children attached to the old thread; reparent one only if it is restored later.

Report its outcome plainly. Preserve every thread ID and recovery instruction from a failure. The script owns the full thread lifecycle, so stop after it fails.
