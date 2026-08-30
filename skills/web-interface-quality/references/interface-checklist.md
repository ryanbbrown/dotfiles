# Interface checklist

Use the labels as decision weight, not as claims of universal truth:

- **Standards and safety** — native-platform behavior, accessibility criteria, or interaction safety. Verify the applicable standard and project target before declaring conformance.
- **Strong default** — a reliable starting point. Keep an established project rule when it is coherent and accessible.
- **Optional taste** — visual preference. Apply only when it fits the product and existing system.

A design value in this checklist is not proof that another value is wrong.

## Interface polish

- **Strong default:** Use concentric radii for nested rounded surfaces: inner radius is approximately outer radius minus the inset. Check the rendered geometry rather than forcing a token that does not fit.
- **Optional taste:** Align by optical weight when geometric centering looks wrong. Small icon or glyph adjustments are local, tested nudges.
- **Optional taste:** When images need separation, a neutral `1px` inset outline can add consistent depth. The source recipe uses pure black at 10% in light mode and pure white at 10% in dark mode. Treat those values as a recipe, not a universal token; preserve a coherent project surface system.

## Motion and interaction

- **Strong default:** Name transitioned properties. Avoid `transition: all`, which watches unrelated changes and makes future style edits animate by accident.
- **Optional taste:** Press feedback may use `scale(0.96)` with `150ms ease-out`. Keep it off controls where movement distracts, and keep a coherent existing interaction system.
- **Optional taste:** For contextual icon swaps, cross-fade opacity while scale moves `0.25 → 1` and blur moves `4px → 0`; reverse those values on exit. These are source recipe values, not correctness thresholds.
- **Strong default:** Use transitions for interruptible state changes and keyframes for staged, one-run sequences.
- **Strong default:** Suppress color, background, border, and shadow transitions during a theme flip, then restore them after the new theme paints.
- **Strong default:** Stagger only infrequent entrances where sequence communicates hierarchy. Prefer semantic chunks at about `100ms`; individual words can fit a title at about `80ms`. Keep routine interactions unstaggered.
- **Strong default:** Give high-frequency interactions instant feedback or a restrained opacity or color transition of `150ms` or less. Reserve custom motion for infrequent moments.
- **Standards and safety:** Put optional motion inside `@media (prefers-reduced-motion: no-preference)`. Under reduced motion, replace slides and scales with opacity crossfades where state continuity still needs a cue; stop parallax and autoplay.
- **Strong default:** Treat `will-change` as a last-mile response to observed first-frame stutter. Limit it to compositable properties such as `transform`, `opacity`, and `filter`; remove it when no longer needed. Do not use a random 1–2px shift as a general trigger without reproducing the cause.

## Typography

- **Strong default:** Serve `.woff2` on the web. Use `.woff` only for a supported very-old-browser fallback; `.ttf` and `.otf` are uncompressed desktop formats.
- **Strong default:** Use `font-variant-numeric: tabular-nums` for values that change, such as timers, counters, and prices. Use it for numeric table columns when alignment needs it. A monospace face already has equal-width digits.
- **Strong default:** Keep long-form text near 60–75 characters per line.
- **Strong default:** Use `text-wrap: balance` for short headings and `text-wrap: pretty` selectively for descriptions. Skip both for long-form text, and consider `pretty`'s layout cost on large text blocks.
- **Standards and safety:** Use `overflow-wrap: break-word` where long words, links, or identifiers can escape. Use `white-space: nowrap` only where a wrapped label or badge would be less usable; keep content reachable.
- **Optional taste:** On macOS, root-level `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale` can make text look lighter. This is a non-standard rendering choice, not a universal quality fix. Apply it once, only when it matches the intended type rendering.
- **Strong default:** Store copy in natural case and use `text-transform` for presentation.
- **Strong default:** Use curly quotes, an en dash for ranges, an em dash for asides, and the single ellipsis character where the language and locale support them.
- **Strong default:** Pull underline position and thickness from font metrics with `text-underline-position: from-font` and `text-decoration-thickness: from-font`. Use `text-decoration-skip-ink: auto` as tuning when descenders need clearance.
- **Standards and safety:** When truncation hides meaningful text, keep the full value available through an accessible expansion, disclosure, or tooltip that works for keyboard and touch.

## Color

- **Strong default:** Give every palette step a consumed role. Do not generate steps that no component or state uses.
- **Strong default:** Components consume semantic role tokens, not primitive hue steps. Preserve the project's existing token tiers and notation.
- **Strong default:** Name semantic tokens for roles, not current appearance or first use. Prefer a role such as `--color-accent-solid` over `--color-blue-button`.
- **Strong default:** Use one word for each concept. If `primary` already means body text or the most prominent item in a group, use a distinct established term for brand color. Do not rename a coherent system only to adopt `accent`.
- **Strong default:** Add a role token instead of borrowing an unrelated token whose present value happens to match.
- **Standards and safety:** Measure foreground contrast against the background it actually renders on, including opacity, images, and gradients. Report the measured pair and applicable threshold; change design values only within the task's authority.
- **Strong default:** Build dark appearance as its own ramp; do not mechanically reverse the light ramp.
- **Strong default:** Use one switching mechanism throughout. `prefers-color-scheme` fits system-only choice; a `.dark` class fits a user override; `light-dark()` fits systems that set `color-scheme`. Do not split token control across competing mechanisms.
- **Optional taste:** Choose gradient interpolation for the intended look: `in oklab` for even brightness, `in oklch` for a vivid hue-wheel path, or sRGB for a muted midpoint. Check the middle hues; `oklch` can travel through colors the design did not request.

## Accessibility and input

- **Standards and safety:** Prefer native semantics: `<button>` for actions and `<a href>` for navigation. Links retain Cmd/Ctrl/middle-click behavior. Use ARIA only to supply semantics native HTML does not provide.
- **Standards and safety:** Style `:focus-visible` while preferring the browser indicator. A custom ring needs verified contrast against every adjacent color, sufficient visible area, and forced-colors support. Replace `outline: none` only with a verified visible indicator.
- **Standards and safety:** Use `tabindex="0"` for natural tab order and `tabindex="-1"` for programmatic focus. Use roving `0/-1` for composite widgets. Positive values break the natural order.
- **Standards and safety:** Give icon-only buttons a descriptive accessible name. Keep visible label text in the accessible name. Apply `aria-hidden="true"` to decorative content, never to a focusable element.
- **Standards and safety:** Write alt text by purpose. Functional images name the action or destination; informative images convey meaning; decorative images use `alt=""`.
- **Standards and safety:** Give every input a real label. Add a meaningful `name`, suitable `autocomplete`, `type`, and `inputmode`. A placeholder is not a label.
- **Standards and safety:** Keep paste available, including for passwords and one-time codes.
- **Standards and safety:** A native disabled control is not focusable, so its tooltip cannot explain the state to keyboard or touch users. Put the explanation in visible text, or use `aria-disabled="true"` when focus must remain and block pointer, keyboard, and form behavior in code.
- **Standards and safety:** Keep submit enabled until the request starts. Then disable it with a spinner and the original label. Validate on submit; set `aria-invalid="true"`, connect inline errors with `aria-describedby`, and focus the first invalid field.
- **Standards and safety:** WCAG 2.2 target-size minimum is 24×24 CSS pixels or an applicable spacing, equivalent-control, inline, user-agent, or essential exception. Aim for 44×44 on primary touch controls and 40×40 on desktop where density permits. Smaller controls are not automatic failures. Extended hit areas do not overlap.
- **Standards and safety:** Give decorative overlays such as glows and gradient scrims `pointer-events: none` so controls remain clickable, and `aria-hidden="true"` so they stay out of the accessibility tree.
- **Standards and safety:** Gate hover-only styling with `@media (hover: hover)` so touch does not retain a false selected state.
- **Standards and safety:** Use `aria-describedby` for field-specific validation. Use a stable polite live region or `role="status"` for non-urgent updates not tied to a control. Use `role="alert"` only for urgent untied errors, and test target screen readers.
- **Standards and safety:** Do not carry state or meaning through color alone. Add a persistent icon, text label, shape, pattern, or underline.
- **Standards and safety:** Make “Skip to content” the first focusable element when repeated navigation precedes the main content. Give anchored headings enough `scroll-margin-top` to clear sticky chrome.

## Layout

- **Strong default:** Make the gap between groups at least twice the gap within a group when that relationship communicates structure, such as 8px within and 16px between.
- **Standards and safety:** Use logical properties for direction-dependent layout. Reserve physical left and right for genuinely physical geometry.
- **Standards and safety:** Let text containers grow and wrap. Avoid fixed widths sized to one language and fixed heights that clip text; use `max-width` or `min-height` where a bound is needed. Test zoom, text resize, narrow viewports, and representative translated strings.

## Interface microcopy

- **Strong default:** Start action labels with a verb that names the action. Use “Save draft” or “Delete project,” not “OK” or a bare “Yes” for a consequential action.
- **Standards and safety:** Repeat the consequence in a destructive confirmation button, paired with a clear escape such as “Cancel.”
- **Strong default:** Use one term for each step in a flow. Pick “Continue” or “Next”; do not alternate synonyms for the same action.
- **Standards and safety:** Make link text describe its destination or result without relying on nearby prose, such as “Read installation docs” instead of “Click here.”
- **Strong default:** Apply one capitalization rule per element type. Sentence case is a safe default and localizes cleanly.
- **Strong default:** Label a toggle for the state it turns on, such as “Send read receipts.” Avoid negative labels that create a double negative.
- **Strong default:** An empty state explains what belongs there, how it becomes populated, and one useful next action. A search state can say “No results for ‘quarterly’” when it also offers an exit such as “Clear filters”; avoid a bare “No results.”
- **Strong default:** In instructional copy, address the reader as “you,” not “the user.” Keep an established first-person voice in low-stakes product copy when it is clear; use direct, neutral wording for errors.
