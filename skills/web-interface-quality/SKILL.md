---
name: web-interface-quality
description: Build or review rendered HTML/CSS product interfaces for accessibility, responsive layout, typography, color, motion, visual polish, and control or state microcopy. Use whenever the user asks to implement or polish a web page or component, says a UI feels off, or asks for a web accessibility, design-system, or interface review—even if they do not name design quality. This skill supplies web-interface criteria and can co-trigger with browser testing or React performance skills. Excludes native apps, diagrams, raster mockups, general prose, and software API or module interfaces.
---

# Web interface quality

Make the interface fit its product before making it fit a checklist. Preserve the project's components, tokens, vocabulary, browser support, and visual language unless the task changes them.

Read [`references/interface-checklist.md`](references/interface-checklist.md) before building or reviewing a rendered web interface. Apply only the sections that the task reaches, but inspect every relevant state.

## Work

1. **Find the system.** Inspect the existing design tokens, components, interaction patterns, copy vocabulary, supported browsers, and accessibility constraints. Reuse them.
2. **Trace the task.** Identify the user goal, rendered states, input methods, viewport range, content extremes, and failure states. Distinguish what source inspection can prove from what needs a browser.
3. **Apply the checklist.** Treat standards and safety as constraints, strong defaults as starting points, and optional taste as project-dependent polish. An established coherent system beats a conflicting default.
4. **Verify the result.** Check semantics and CSS in source. Check focus order, keyboard use, zoom, responsive layout, loading, empty, error, disabled, hover, active, and reduced-motion behavior where relevant. Report unverified behavior instead of assuming it works.
5. **Keep the seam.** Implement requested work directly. For a review, report concrete evidence, user impact, and the smallest fitting fix; do not repaint a coherent design system from personal taste.

## Adjacent skills

- Use `agent-browser` for browser navigation, interactions, screenshots, reproduction, and black-box evidence. This skill supplies the interface-quality rubric; it does not replace behavior testing.
- Use `vercel-react-best-practices` for React and Next.js performance. This skill owns rendered quality, not framework performance architecture.
- Use `plain-words` for broader prose, or `govuk-style` when explicitly requested. This skill owns labels, controls, state messages, and flow microcopy only.
- Follow host or product contracts first, including BB plugin tokens and components.

## Review output

Order findings by user impact. For each finding, give:

- the affected element or state
- the checklist tier and rule
- evidence from source or rendered behavior
- the user impact
- the smallest fix that preserves the project system

Separate verified findings from items that need browser, assistive-technology, device, or user testing. Do not call optional taste a defect.

Source provenance and the bundled MIT notice are in [`references/SOURCE-NOTICE.md`](references/SOURCE-NOTICE.md).
