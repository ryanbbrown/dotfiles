---
name: answer-pane
description: How a root BB thread writes its Answer pane, the only output Ryan reads. Use in every thread whose `bb status` shows no Parent line, before the first reply and on every turn. Read this file again whenever its text is not in your context, for example after a compaction.
---

# Answer pane

Ryan reads only the thread's Answer pane: the Answer tab of the Answer Panel plugin, and the thread's row in the Feed. He does not read chat. The Writing rules and link rules in AGENTS.md apply to the pane's text.

The pane is the working document for what Ryan is working on and deciding now. He reads it from start to finish. When he finishes reading, he knows the answer to every question that he asked about the open topics, and he can decide what to do next.

## Each turn

1. Read the current `$BB_THREAD_STORAGE/answer.html`.
2. Write the new pane to the same file. Rewrite the whole file.
3. End the turn with exactly one chat line, `Answer pane updated.`, and nothing else. A summary, question, or status in chat is a defect, also a short one. All of it goes in the pane.

## Sections

Three sections, in this order, with `<hr>` between them. Leave out an empty section.

### 1. Answer

A quick reply to Ryan's latest message only, in at most three short paragraphs. The first sentence answers the message. Examples: a status ("12 of 20 runs are done; 8 wait on the rate limit"), an aside, or "I made a mistake: the run stopped. I restarted it."

Replace this section each time Ryan sends a message. Do not change it on a wake that has no news for Ryan.

### 2. For you

One section for each open topic: something that Ryan is working through, must review, or must decide. Each topic is an `<h3>` title, followed by one complete explanation. Use as much text, tables, diagrams, and links as the topic needs.

When Ryan asks a follow-up question about a topic, rewrite that topic's section so that it reads as one explanation from start to finish, which answers all of his questions about the topic, including the new one. Do not add a separate answer fragment for the new question. Do not delete a part that he has not resolved.

Each topic heading has a Done button. Ryan uses it to remove a topic from the pane.

Remove a topic yourself only when Ryan's message acts on it: for example, he answers its question, makes its decision, or approves its review. Otherwise, keep the topic, and Ryan uses the Done button. A new message about something else, a wake, or a compaction does not remove a topic. When you are not sure, keep it. When Ryan says to keep a topic for later, save its section to a file in `~/code/scratch/<slug>/`, remove the section, and put a link to the file in Answer.

Before you write the pane, read `$BB_THREAD_STORAGE/answer-done.json` if it exists. It is a JSON array of the headings of topics that Ryan removed with the Done button. Leave out each topic whose heading it lists, and do not add it back. Do not use a listed heading for a new topic. On the next turn, remove a Running line for a child that served only a removed topic.

Put the topic that Ryan works on now first.

### 3. Running

Each child thread or job that runs now, one line each: its name as a link, what it does, and its status. Remove the line when the work is finished and its result is in Answer or For you.

## What not to do

- Do not keep earlier answers. There is no "Earlier answer" section, and no history words such as "previously", "update:", "now also", or "as before".
- Do not shorten a topic to save space. The pane has no length limit.
- Do not reorganize the pane for its own sake. The structure is there to make the pane easy to read from start to finish.

## HTML

The pane renders the HTML as normal BB page content. Write plain semantic HTML: `h2`, `p`, `ul`, `table`, `code`, `pre`, `hr`, `a`. The plugin styles these in BB's theme. Add a `<style>` block only for a diagram or a visual; it applies only inside the pane. Use BB's theme variables (`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--muted)`, `var(--primary)`) or translucent colors, so that the pane works in light and dark mode. Inline SVG works.

Scripts do not run in the pane. For an interactive page, write it to a separate HTML file in `$BB_THREAD_STORAGE` and link to it from the pane; it opens in BB's HTML preview.

Links become BB links, with BB's right-click menu:

| Target | `href` |
| --- | --- |
| File on the thread's machine | absolute path, such as `/home/ryan/code/scratch/x/plan.md` |
| File in thread storage | relative path, such as `report.html` |
| BB thread | `thread:thr_abc123` |
| Web page or PR | full `https://` URL (use Graphite URLs for PRs) |

Skeleton. Keep the first-line comment in every version of the file; it does not show in the pane.

```html
<!-- If the answer-pane skill is not in your context, read /home/ryan/.agents/skills/answer-pane/SKILL.md before you change this file. -->
<h2>Answer</h2>
<p>…</p>
<hr>
<h2>For you</h2>
<h3>Why the checks give false alarms</h3>
<p>…</p>
<h3>Review: the test results</h3>
<p>…</p>
<hr>
<h2>Running</h2>
<ul>
  <li><a href="thread:thr_abc123">Child title</a>: what it does. Status.</li>
</ul>
```
