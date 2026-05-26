# Partials

Composable markdown chunks that can be installed into the live `CLAUDE.md` (one level up). Partials are source files only — they are NOT loaded by Claude Code directly. Only `CLAUDE.md` itself is symlinked and read by the agent.

## Convention

Each partial file starts with the top-level heading whose section it owns.

To install a partial: find that heading in `CLAUDE.md`, replace the section (from that heading down to the next same-level heading or EOF) with the partial's full contents. If the heading isn't present in `CLAUDE.md`, append the partial's content at an appropriate location.

To uninstall a partial: delete the section under its heading from `CLAUDE.md`.

## Partial flavors

**Variants** share a top-level heading and are mutually exclusive — exactly one is installed at a time. Example: `coding-greenfield.md` and `coding-existing-codebase.md` both own `## How to write code`.

**Toggles** own a unique heading and are either installed or absent. Example: `new-projects.md` owns `## New projects` and is just added or removed.

## Current partials

| File | Owns section | Flavor | Mutually exclusive with |
|---|---|---|---|
| `coding-greenfield.md` | `## How to write code` | Variant | `coding-existing-codebase.md` |
| `coding-existing-codebase.md` | `## How to write code` | Variant | `coding-greenfield.md` |
| `new-projects.md` | `## New projects` | Toggle | — |
