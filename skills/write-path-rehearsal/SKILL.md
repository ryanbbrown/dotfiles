---
name: write-path-rehearsal
description: Rehearse a change to persistent writes against a live local stack with realistic inputs and failure injection, then report what was lost, duplicated, or wrong. Use when a change adds, changes, removes, or reroutes a writer, or changes the schema, transaction or retry boundaries, batching, idempotency keys, or config that writers depend on.
---

# Write-path rehearsal

The steps come from a local overlay. If no section follows this line, stop and tell the user the overlay is not installed.
