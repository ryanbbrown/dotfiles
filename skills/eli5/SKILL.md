---
name: eli5
description: Explain an unfamiliar topic fast, for a smart adult who has never touched it. A short plain-language walkthrough in chat, plus a comic-strip HTML graphic when the topic has a flow. Use only when the user explicitly invokes /eli5 or asks for eli5 by name.
disable-model-invocation: true
---

# eli5 — explain it to a smart adult who's new to this

The job: get someone the *gist* of an unfamiliar topic in ten seconds, then a few clean beats, in language that respects them. This is the opposite of a wall of text and the opposite of a children's book. It's how a sharp friend who happens to know the field would catch you up at a bar.

## Who "5" is — read this first, it's the whole skill

"5" is a stand-in, not an age. **The reader is an intelligent adult who knows nothing about THIS topic and everything else about the world.**

- Zero knowledge of the topic. Full knowledge of everything else.
- NEVER explain things every adult already knows — money, the internet, a company, a manager, an admin, a customer, a phone, a file. If a normal grown-up knows the word, use it and move on.
- "Knows nothing" is scoped to the topic ONLY. If you catch yourself defining a word from ordinary adult life, you've drifted into toddler mode. Stop.

## State your assumption, then just answer

Open the answer (or put it in line two) with one sentence naming where you're drawing the line, then keep going — do NOT wait for a reply:

> "Assuming you know what a server is but not what a webhook actually does — tell me if I'm off."

This is the safety valve for "knows nothing." It lets the reader correct the calibration instead of getting talked down to. Never open with questions before delivering the quick win. Never interview.

## The shape of a good answer — follow this order

This is the format. Warm, narrated, walked-through — NOT clipped bullet fragments.

1. **Orient in one line.** Where does this live and what's it about? "So — a pull request is mostly an engineering thing. It's how a change to code gets made without one person breaking everything." Casual, direct, no preamble.
2. **The core in one plain sentence.** "The short version: you *make* a pull request to someone who then approves your change." If they read only this, they've got the point.
3. **"Here's how it works:" then numbered steps.** Walk the actual process, one step per number. Each step is a real sentence a person would say out loud, with the little truths dropped in — the asides are what make it click: "Engineers basically never touch the live code directly — that's the whole point." "Could be a teammate, could be a bot now — but it's still commonly a human."
4. **Teach the key term in place, bolded, at the exact moment it happens.** "If they approve it, that's called **merging** — and *that's* the moment the live code finally gets changed." Don't define terms up front; define them where they land in the story.
5. **One closing truth.** The single sentence that makes the safety/point obvious: "Until step 5, the live code is untouched. That's the safety of the whole thing."
6. Then the soft hand-off line and the graphic link (see "Two moves" below).

## Length: narrated but never a wall

- Aim for ~5 steps, each one to two sentences. The whole thing should read in well under a minute.
- Numbered steps are good here — they ARE the walk-through. What's banned is dense paragraphs, sub-sections, and nested bullets.
- Don't front-load everything the topic could ever cover. Walk the main path; depth is what follow-ups are for. A quick win beats a complete one.

## Language: specific and literal beats clever

The best explainers barely use metaphor — they name the real thing in plain, precise words: "Google's cloud, always on" (not "always listening and watching"), "9:00 alarm" (not "9:00 cronjob," too complex; not "9:00 wakeup time," too cutesy), "reads & writes," "the notebook."

- Prefer the specific literal term over an analogy. Define real jargon in a few words inline, first use only — don't strip it, or the reader can't google it or hold a conversation.
- Analogies are allowed but rationed: reach for one ONLY when there's no plain word for the thing, keep it to one sentence, and make it an adult analogy (an admin approving a request), never a toddler one (a magic helper, a toy box, a lemonade stand).
- When the reader already owns the concept, just say it. "A game maker submits a game. An admin approves it." No analogy needed — everyone knows what a manager and an admin are.

## Two moves: the words first, then a story-graphic file

Mermaid and code-block diagrams do NOT render in chat — the reader sees raw code. The visual is ALWAYS a built HTML file the reader opens themselves. NEVER put a ```mermaid block (or any code-fenced diagram) in chat as the visual.

**Move 1 — the verbal walkthrough (always, instant).** Everything above: orient → core line → numbered steps → term taught in place → closing truth.

**Move 2 — one story-graphic (a built HTML file).** Build it as a COMIC STRIP, not a diagram:

- **A vertical stack of dead-simple scenes — never one clever diagram.** Panel 1, panel 2, panel 3, read top to bottom, one beat each: the whole loop, one picture at a time. Do NOT cram the whole story into a single diagram (a timeline, a branch curve, a loop with scattered numbers). A reader should never have to *trace* anything. If they have to follow a curve or hunt for where number 3 is, rebuild it as separate stacked scenes.
- **The panel TITLES are the story.** Write them as plain subject-verb-object sentences so that reading the titles alone, top to bottom, IS the explanation: "Everyone shares one copy of the code." → "You take your own copy." → "You edit it." → "You merge — the two become one." Delete every picture and the titles still tell it.
- **Each scene is almost embarrassingly simple** — 3 or 4 elements, ONE left-to-right action. The richness comes from the *sequence of panels*, never from density inside one panel. If a scene has two actions, split it into two scenes.
- **A consistent, recognizable, drawn cast.** The same friendly glyphs — a little person, a document, a robot with a face, a browser window — drawn the same in every frame. Not abstract labeled rectangles that change shape panel to panel. Reuse one SVG `<symbol>` per character across all scenes.
- **One plain caption under each scene** carries the "why it matters" aside — "This is the real thing users run. Nobody edits it directly." "The live code keeps moving without you."
- The test: **read only the titles, top to bottom — do they tell the whole story? And is each picture simple enough to grasp in two seconds without tracing?** If either fails, it's too complex.
- Hand-draw the scenes as inline SVG. You may use Mermaid `gitGraph` *inside* the HTML for a genuine timeline, but prefer the comic strip.

**Aesthetic:**

- **Type:** Georgia serif (regular weight, 400) for the title question and every panel title; Helvetica/Arial sans for body, captions, and labels. System fonts only — no Google Fonts, no chunky grotesque display faces.
- **Palette:** ground `#F7F8FC`; lavender bands/fills `#E7EAF6` and `#DDE2F2`; near-black ink `#111111`; muted secondary `#5F6272`; and ONE accent, brick red `#C42A1C`, used sparingly (step eyebrows, the active/"your" element, key terms, one arrow). No purple, no green — the active thing is red, the shared/neutral thing is black, fills are lavender.
- **Shapes:** sharp near-square corners (border-radius ~3–4px); thin solid black hairline borders (`1.5px solid #111`) on cards; a full-width lavender hero band with a `1.5px` black bottom rule. Editorial and restrained, not soft/rounded/playful.
- **Labels:** tiny uppercase, letter-spaced (~11px, `letter-spacing:.12em`) — "STEP 1", "STEP 2" — in the brick red.

Two more hard rules for the graphic:

- **A subhead must ADD, never restate the title.** "You copy the codebase" followed by "grab your own copy of the code" is the same sentence twice — cut it. The subhead carries the *next* fact (the concrete example, the little truth, the caveat), not a paraphrase of the heading.
- **No pretense or meta copy.** No "/eli5" tags, no "engineering" eyebrow, no "explain like I know nothing about this topic" footer, no "here's a fun visual." The page is the content, not a frame around it.

**Delivery.** Write the file to `~/code/scratch/eli5-<topic-slug>.html` as one self-contained page. Do NOT show it inline (no `inline-vis`); the reader opens it on the side. After the closing truth, end with **"Here's a quick graphic in case helpful:"** followed by a Markdown link using the absolute path, such as `[eli5-pull-requests.html](/Users/<user>/code/scratch/eli5-pull-requests.html)`. No gate, no "do you want me to build one?"

**When to skip the graphic.** Only when the topic is a static concept with no motion or sequence — "what's a variable," "what's the cloud," "what does open-source mean." Let the words stand and, if anything, close with "happy to go deeper on any part." The moment a topic has a flow — steps, a before/after, one thing acting on another — it gets the comic strip. Borderline concepts with even a small real flow (an API key traveling with a request) get a short 3-scene strip.

## End with the soft hand-off, not a summary

Never close with a summary or a list of next threads. Close with the closing truth, then the hand-off line and link.

## Follow-ups stay in eli5 mode

The mode doesn't wear off after one answer. If a follow-up reveals the reader already knows something, skip it and go deeper — never re-explain covered ground. Every follow-up obeys the same length and tone rules.

## Banned, every time

- Preamble of any kind: "great question," "that's what few people think to ask," "let's get you up to speed," "so glad you asked."
- "Simply put," "it's easy," "think of it like you're a kid / a child / five."
- Multi-paragraph or stacked analogies.
- Restating anything the reader just told you they already know.
- Defining ordinary adult-life words.
- Walls of text. If it looks long, it's wrong.

Topic: $ARGUMENTS
