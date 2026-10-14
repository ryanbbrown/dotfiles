---
name: browser-verify
description: Verify a built change in a real browser with agent-browser, with UI, log, and database evidence, and write a verdict. Use when a brief names a readiness file to verify.
---

# Browser verify

You are the evidence, not the author. Read the readiness file the brief names, then `agent-browser skills get core` and `agent-browser skills get dogfood`. Edit no file and run no command that changes the repository, the database schema, or the services; the caller fingerprints the worktree and a change voids your verdict.

## Input

The readiness file, `.reviews/verify/<slug>/readiness.md`, has these headings:

- **Flows**: every user-facing flow to walk, one per line, with the entry URL, steps, expected UI result, and tables written.
- **Services**: URL and port per service, and the health check that passed for each.
- **Login**: the dev or test login path and credentials source, or "none needed".
- **Logs**: the teed log file paths.
- **Database**: how to open a query shell and the tables the flows write.
- **Previous round** (round 2 and later): the last verdict's issues, now claimed fixed.

## Method

1. The app is already running. Use the services as given; a service that is not reachable is a FAIL with the reason, and you stop there.
2. Log in through the login path when a flow needs it.
3. Walk each flow as a user would: navigate, fill, click, and read what the UI shows. Record it as [Recording](#recording) describes. When recording, trimming, or the combined video fails, walk the flow anyway and report the failure under Issues.
4. After each step, read the browser console for errors, list failed network requests with the response body, and read the tail of each log.
5. For every create, update, or delete, query the affected table before and after and confirm the row changed with the expected values.
6. After the last flow, run `agent-browser close --all`, also on FAIL.
7. Build the combined video as [Combined video](#combined-video) describes, also on FAIL.

A flow passes only when the UI, the logs, and the data agree. A flow you could not reach, or checked only through curl, tests, or source reading, is a FAIL.

## Recording

Record each flow as a video. Before its first action, run `agent-browser record start .reviews/verify/<slug>/videos/<flow>.mp4 [entry URL] --cursor --contact-sheet`, with `<flow>` a short kebab-case name. Run each click as one command, `agent-browser hover <ref> && agent-browser wait 250 && agent-browser click <ref>`, so the video shows the pointer on the target before the click. At the end, wait for the end state itself with `wait --url` or `wait --text`, then `wait 1000` so the video holds it, take a screenshot with `mkdir -p .reviews/verify/<slug>/shots && agent-browser screenshot ./.reviews/verify/<slug>/shots/<flow>.png` (without `./`, agent-browser reads the path as a CSS selector), then run `record stop`. Trim the static spans with `python3 <this skill's directory>/scripts/trim-video.py .reviews/verify/<slug>/videos/<flow>.mp4 .reviews/verify/<slug>/videos/<flow>.trimmed.mp4`. All files stay on disk.

## Combined video

The reader watches one video, not one per flow. Write `.reviews/verify/<slug>/videos/combined.json` in the format at the top of `<this skill's directory>/scripts/make-combined-video.py`, with every flow in the readiness file's order:

- `title`: what the flow tests.
- `look_for`: the result the viewer must see, in one sentence.
- `captions`: a short caption at each action and each result the flow checks. Take the times from the flow's contact sheet; the script maps them onto the trimmed video.
- `holds`: the time of each state that shows for less than a second, such as "Sharing...", so its frame stays on screen.
- `existing_bug`: true for a flow that shows a bug that main also has and this change does not fix.

Run `python3 <this skill's directory>/scripts/make-combined-video.py .reviews/verify/<slug>/videos/combined.json .reviews/verify/<slug>/videos/combined.mp4`. It prints the timeline and saves one frame per card, flow, and caption to `videos/combined-frames/`. Look at every frame: each card is legible, each caption sits in the bar under the video and matches the frame, and each flow frame shows the cursor. Fix the spec and rebuild until every frame passes.

## Report

Write the verdict to the path the brief names:

```
# Verdict: PASS | FAIL

Video: .reviews/verify/<slug>/videos/combined.mp4

## Walkthrough
For each flow: the steps taken, what the UI showed, the log lines and the before and after rows that confirmed it, and the paths of the screenshot, the trimmed video, and the contact sheet.

## Issues
Each broken, unreachable, or unverifiable flow with the exact observation. "None" on PASS.
```

The walkthrough is published in the PR body, so it reports observations, never what the code implies. A PASS with an empty walkthrough is invalid.
