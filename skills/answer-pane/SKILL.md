---
name: answer-pane
description: How a root BB thread writes its Answer pane, the only output Ryan reads. Use in every thread whose `bb status` shows no Parent line, before the first reply and on every turn.
---

# Answer pane

Ryan reads only the thread's Answer pane: the Answer tab of the Answer Panel plugin, and the thread's row in the Feed. He does not read chat. The pane is your reply, so every rule in AGENTS.md applies to its text: the Interaction length limits, the Writing rules, and the link rules.

## Each turn

1. Write the pane to `$BB_THREAD_STORAGE/answer.html`. Rewrite the whole file from the current state of the work. Do not append to it.
2. Prune: for each line, ask "Does Ryan need this now?" Delete the lines that he does not need: answered questions, reviewed or merged items, finished work, and text that a newer answer replaces.
3. End the turn in chat with only `Answer updated.`, or `No change.` when the pane did not change (for example, after a wake with no news). Write nothing else in chat: no summary, question, or status.

The turn is done when the pane holds the current answer, every open item, and every running job, and holds no line that Ryan no longer needs.

## Sections

Three sections, in this order, with `<hr>` between them. Leave out an empty section.

1. **Answer:** the answer to Ryan's latest message. The first sentence answers it. At most three short paragraphs. Replace this section each time Ryan sends a message; it is short-lived.
2. **For you:** each open item that waits on Ryan, one line each:
   - a question or decision, with the options and your recommendation;
   - something to review (a PR, a file, a finding), with a link.
   Remove an item when Ryan has dealt with it or it no longer applies. This section lasts across messages.
3. **Running:** each child thread or job that runs now, one line each: its name as a link, what it does, and its status. Remove it when it is finished and its result is in Answer or For you.

Put a diagram or an explainer inside the section that it belongs to. Change the structure only when the content needs it.

Keep the pane short enough to read on one screen, unless Ryan asks for detail. When it gets too long, shorten or remove items in For you; keep Answer complete.

Write only the current state. History words such as "previously", "update:", "now also", or "as before" do not go in the pane.

## HTML

Write plain semantic HTML: `h2`, `p`, `ul`, `table`, `code`, `pre`, `hr`, `a`. The plugin styles these in BB's theme. Add CSS only for a diagram or a visual. Use BB's theme variables (`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--muted)`, `var(--primary)`) or translucent colors, so that the pane works in light and dark mode.

Links open in BB:

| Target | `href` |
| --- | --- |
| File on the thread's machine | absolute path, such as `/home/ryan/code/scratch/x/plan.md` |
| File in thread storage | relative path, such as `report.html` |
| BB thread | `thread:thr_abc123` |
| Web page or PR | full `https://` URL (use Graphite URLs for PRs) |

Skeleton:

```html
<h2>Answer</h2>
<p>…</p>
<hr>
<h2>For you</h2>
<ul>
  <li>…</li>
</ul>
<hr>
<h2>Running</h2>
<ul>
  <li><a href="thread:thr_abc123">Child title</a>: what it does. Status.</li>
</ul>
```
