# Root Instructions

## How to interact
- Always ask the user any necessary follow up questions about their intent before making changes. (In headless runs — `claude -p`, cron — you can't ask: state your assumptions in the output and proceed.)
- If the user interrupts you and asks a question, IMMEDIATELY ANSWER THE QUESTION. Do not use the question as a jumping-off point for additional changes.
- In general, if the user input has a question mark, do NOT make edits. First, answer their question, reading files if necessary.

## How to write code
- Treat this as production code with callers, history, and constraints.
- Ask before: changing public behavior, removing code that looks unused, adding dependencies, restructuring files, or introducing new patterns.
- Match the codebase's existing patterns for error handling, validation, structure, and comment/docstring style — including defensive programming where it's already in use. Conformance > taste; if you genuinely think a convention is harmful, surface it. Don't fork silently.
- ALWAYS use existing libraries and utility functions; do NOT rewrite functions for basic language functionality

## Saving content to files
- When saving content that already exists in a tool/command output (CLI JSON, API response, etc.), pipe it directly to the file (e.g. `cmd --json | jq -r '.content' > file.md`). Do NOT re-type or reconstruct the content via a Write call — that wastes output tokens and risks introducing diffs from the original.

## Other
- You are almost always running inside tmux. References to "window" mean a tmux window, with 1 pane per window.
- Use uv for all python-related operations; `uv add` to install new packages, and `uv run file.py` to run files. No need to activate the venv first.
- Do not use `qlmanage` for image verification or format conversion; it generates previews/thumbnails that can mislead layout QA. Use a real renderer/converter for the source format, render the full image, and inspect the full rendered image first. For SVG-to-PNG, use `rsvg-convert --output=/tmp/output.png input.svg`.
- When committing, follow conventional commits (`fix:`, `feat:`, `chore:`, `ci:`, `docs:`, `refactor:`, `test:`). A scope may added in parentheses for additional context (e.g. `feat(parser):` ). Commit messages should be a single sentence and relatively concise.

## Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## Goal-driven execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Verify web UI changes visually

**A web UI change is not verified until you have rendered the affected page and looked at it.**

"The server is serving the updated file" or "the CSS now contains the new value" is NOT verification. After changing anything user-visible (HTML, CSS, layout, components), render and inspect.

Use the gstack browse CLI below — it is the default and works headless in any terminal session. Do NOT reach for in-app/IDE browser skills first (`browser:control-in-app-browser`, `agent.browsers.get('iab')`, Claude-in-Chrome): they require a desktop surface and typically fail with "Browser is not available" in terminal sessions.

```bash
B=~/.claude/skills/gstack/browse/dist/browse   # headless Chromium, ~100ms/command
$B goto http://localhost:3000/page
$B screenshot /tmp/check.png                   # full page; add --selector .x for one element
$B console                                     # JS errors?
```

Then Read the screenshot and confirm the intended change is actually visible. For visual tweaks (sizes, spacing, colors), screenshot before AND after and compare. Use `$B viewport WxH` for responsive checks. If browse is unavailable, fall back to a Playwright script — but a screenshot you actually looked at is still required.

## Use an LLM only for judgment calls
When building LLM-powered code:
- Use a model for: classification, drafting, summarization, extraction.
- Do NOT use it for: routing, retries, deterministic transforms.
- If code can answer, code answers.

## Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.
