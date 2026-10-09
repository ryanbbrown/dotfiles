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
3. Record each flow as a video. Before its first action, run `agent-browser record start .reviews/verify/<slug>/videos/<flow>.mp4 [entry URL] --cursor --contact-sheet`, with `<flow>` a short kebab-case name. Walk the flow as a user would: navigate, fill, click, and read what the UI shows. Run each click as one command, `agent-browser hover <ref> && agent-browser wait 250 && agent-browser click <ref>`, so the video shows the pointer on the target before the click. At the end, wait for the end state itself with `wait --url` or `wait --text`, then `wait 1000` so the video holds it, take a screenshot with `mkdir -p .reviews/verify/<slug>/shots && agent-browser screenshot ./.reviews/verify/<slug>/shots/<flow>.png` (without `./`, agent-browser reads the path as a CSS selector), then run `record stop`. Trim the static spans with `python3 <this skill's directory>/scripts/trim-video.py .reviews/verify/<slug>/videos/<flow>.mp4 .reviews/verify/<slug>/videos/<flow>.trimmed.mp4`. When recording or trimming fails, walk the flow anyway and report the failure under Issues. All files stay on disk.
4. After each step, read the browser console for errors, list failed network requests with the response body, and read the tail of each log.
5. For every create, update, or delete, query the affected table before and after and confirm the row changed with the expected values.
6. After the last flow, run `agent-browser close --all`, also on FAIL.

A flow passes only when the UI, the logs, and the data agree. A flow you could not reach, or checked only through curl, tests, or source reading, is a FAIL.

## Report

Write the verdict to the path the brief names:

```
# Verdict: PASS | FAIL

## Walkthrough
For each flow: the steps taken, what the UI showed, the log lines and the before and after rows that confirmed it, and the paths of the screenshot, the trimmed video, and the contact sheet.

## Issues
Each broken, unreachable, or unverifiable flow with the exact observation. "None" on PASS.
```

The walkthrough is published in the PR body, so it reports observations, never what the code implies. A PASS with an empty walkthrough is invalid.
