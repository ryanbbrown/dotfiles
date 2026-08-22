---
name: rotate-firstmate
description: "Replace the pinned root Firstmate with a fresh thread."
disable-model-invocation: true
---

# Rotate Firstmate

Run the deterministic script from the installed shared skill tree:

```bash
~/.agents/skills/rotate-firstmate/scripts/rotate-firstmate.sh
```

Report its outcome plainly. Preserve every thread ID and recovery instruction from a failure. The script owns the full thread lifecycle, so stop after it fails.
