# Root Instructions

## Interaction and uncertainty
- Always ask any necessary follow-up questions about intent before making changes. In headless runs, state your assumptions in the output and proceed.
- If the user interrupts you and asks a question, answer it immediately. Do not use the question as a jumping-off point for additional changes.
- If the user input has a question mark, do not make edits yet. First answer the question, reading files if necessary.
- Before implementing, state your assumptions. If multiple interpretations exist, present them instead of picking silently.
- If something is unclear, stop, name what is confusing, and ask. Surface tradeoffs and push back when warranted.

## Code changes
- Before adding code, read exports, immediate callers, and shared utilities. "Looks orthogonal" is dangerous. If unsure why code is structured a certain way, ask.
- Match the codebase's existing patterns for error handling, validation, structure, and comment/docstring style, including defensive programming where it already exists. Conformance matters more than taste; if a convention seems harmful, surface it instead of forking silently.
- Use existing libraries and utility functions. Do not rewrite functions for basic language functionality.
- Keep changes surgical: do not improve adjacent code, comments, formatting, or structure unless it directly serves the request.
- Build the minimum code that solves the problem. Do not add speculative features, abstractions, configurability, or impossible-scenario error handling.
- Every changed line should trace directly to the user's request.
- Remove imports, variables, functions, and files made unused by your own changes. Mention unrelated dead code, but do not delete it unless asked.

## Docs and files
- When editing Markdown prose, line-length limits do not apply. Do not split a paragraph or list item across multiple lines unless the content structure requires it.
- When editing plans or docs and told to remove something, remove mention of it entirely. Do not keep historical notes explaining that it was removed.
- When saving content that already exists in command output, pipe it directly to the file instead of retyping or reconstructing it.

## Verification
- Define success criteria before implementation and loop until verified.
- For multi-step tasks, state a brief plan with a verify check per step: `1. [Step] → verify: [check]`.
- For bugs, prefer a test that reproduces the issue, then make it pass.
- For validation changes, test invalid inputs and expected failures.
- For refactors, ensure the relevant behavior passes before and after.
- Tests must encode why behavior matters, not just what it does. A test that cannot fail when business logic changes is wrong.
- Do not claim completion if anything was skipped. Do not claim tests pass if any were skipped.
- Default to surfacing uncertainty, not hiding it.

## Verify web UI changes visually
**A web UI change is not verified until you have rendered the affected page and looked at it.**

"The server is serving the updated file" or "the CSS now contains the new value" is not verification. After changing anything user-visible, render and inspect the page.

Use the gstack browse CLI by default because it works headless in terminal sessions. Do not reach for in-app/IDE browser skills first (`browser:control-in-app-browser`, `agent.browsers.get('iab')`, Claude-in-Chrome): they require a desktop surface and typically fail with "Browser is not available" in terminal sessions.

```bash
B=~/.claude/skills/gstack/browse/dist/browse
$B goto http://localhost:3000/page
$B screenshot /tmp/check.png
$B console
```

Read the screenshot and confirm the intended change is visible. For visual tweaks, capture before and after screenshots and compare them. Use `$B viewport WxH` for responsive checks. If browse is unavailable, fall back to a Playwright script, but still inspect a real screenshot.

## Tools and environment
- Use `uv` for all Python-related operations: `uv add` to install packages and `uv run file.py` to run files. Do not activate the venv first.
- When the user asks to open a Markdown file in the browser, use `uv run ~/code/global-agent-context/scripts/open_md_preview.py path/to/file.md` to render a temporary HTML preview.
- Do not use `qlmanage` for image verification or format conversion. It generates previews and thumbnails that can mislead layout QA. Use a real renderer or converter for the source format; for SVG-to-PNG, use `rsvg-convert --output=/tmp/output.png input.svg`.
- When committing, follow conventional commits. Commit messages should be a single concise sentence.

## LLM-powered code
- Use a model for judgment tasks such as classification, drafting, summarization, and extraction.
- Do not use a model for routing, retries, or deterministic transforms.
- If code can answer, code answers.

## Building agents
- Do not apply turn limits by default. If a limit is genuinely needed, make it generous enough to catch runaway edge cases without cutting off complex runs that need many turns.
- Give the agent the tools it needs to complete the task. Do not be overly restrictive with the toolset.
- When modifying agent prompts or context based on a mistake or learned example, do not put the exact example back into the prompt. That is target leakage: retesting against the same example only proves the prompt memorized the case, not that the fix generalizes. Instead, add generalized guidance or a genuinely different example that exercises the same principle without being the same case with lightly changed words.

## Conflicting patterns
- If two patterns contradict, pick one based on recency, test coverage, or fit with the surrounding code.
- Explain why and flag the other pattern for cleanup.
- Do not average incompatible patterns together.
