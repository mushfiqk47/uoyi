# 08 — Design audit (Impeccable)

Run date: 2026-11-18. Targets: `npm run dev` at 1440×900 and 390×844, plus source scan of `src/`
and `index.html`. Detector: Impeccable bundled `detect`.

## Audit Health Score

| # | Dimension | Score | Key finding |
| --- | --- | --- | --- |
| 1 | Accessibility | 3 | Focus trapping added to dialogs; small icon buttons remain monitor-worthy. |
| 2 | Performance | 3 | Segment caching and memoized views; 934 KB bundle warning remains. |
| 3 | Theming | 4 | Full token system, three palettes, dynamic accent. |
| 4 | Responsive Design | 3 | Breakpoints at 900/980/1100px; editor is dense but usable at 390px. |
| 5 | Implementation Integrity | 4 | Rendered detector clean at both viewports; coherent product-specific system. |
| **Total** | | **17/20** | **Good** |

## Implementation Integrity verdict

Pass. The rendered scans at 1440×900 and 390×844 returned **zero findings** after the polish pass.
The implementation is recognizably a stream-editing tool: a four-lane timeline, a phone preview, a
single cyan instrument accent, and AI states that read as part of the workflow rather than decoration.

## Findings by severity

### Fixed in this pass
- **[P1] Colored glow shadow on primary buttons** — `src/styles/tokens.css`. Glint/Classic primary
  shadows used `rgba(var(--brand-rgb), 0.55)`, a zero-offset chromatic halo on dark surfaces.
  Replaced with neutral offset shadows (`0 2px 8px -2px rgba(0,0,0,0.55)`). Detector confirmed clear.
- **[P1] Icon tile stacked above empty-state heading** — `src/styles/base.css`. `.empty` was a
  centered flex column with a 52px badge above `h2`, the universal feature-card silhouette.
  Changed to a two-column grid so the icon sits beside the heading. Detector confirmed clear.
- **[P2] 10.5px functional text** — `.top .brand .beta` in `app.css`. Raised to 11px with tighter tracking.
- **[P2] Dialog focus could leave the modal** — `src/components/ui.tsx`. Added initial focus and a Tab
  cycle inside `role="dialog"`; Escape still closes.
- **[P3] Orphaned last word in modal copy** — `text-wrap: pretty` added to paragraphs in `base.css`.
- **[P3] Headings used the body face in the default palette** — `--display` now starts with Cal Sans,
  giving the interface a quiet display voice distinct from its dense body text.

### Intentional exceptions
- **[P3] Inter source warnings** — the detector flags literal `Inter` strings in `@font-face` and body
  rules. These are a self-hosted variable font used for dense operational text; display headings use
  Cal Sans. Treated as a deliberate Operate-mode choice, not a defect.
- **[P3] 30px icon-only buttons** — below 44px but above the WCAG AA 24px floor, with surrounding
  spacing. Monitor if touch usage grows.

### Remaining recommendations
- **[P2] Bundle size** — `vite build` reports a 934 KB main chunk. Route-level code splitting for
  Editor/Clips would improve first load. Suggested: `$impeccable optimize`.
- **[P2] Long-content states** — verify the Clip Finder modal and Settings model list with very long
  titles and offline endpoints. Suggested: `$impeccable harden`.
- **[P3] Motion coverage** — only page entrance and hover glint exist; a deliberate empty→populated
  transition in Clips could help. Suggested: `$impeccable animate`.

## Positive findings
- Token system is complete: surfaces, hairlines, brand ramp, status colors, radii, and button looks are all centralized.
- `prefers-reduced-motion` is respected globally with animation and transition removal.
- Focus-visible rings use the accent consistently; interactive controls expose accessible names.
- Detector-clean at both shipped viewport classes.
- Product language is consistent ("Clips", "Queue", "Facecam", "rolling buffer") across screens and docs.

## Per-dimension notes

### Layout
The editor's right-preview/left-tools split keeps the most important object isolated. Timeline lanes
are 40px with a 24px ruler; inspector groups use 16px padding and 12px gaps. Empty states now pair
icon and heading instead of stacking them.

### Spacing
The rhythm is 4/8/12/16/24px. Page content is capped at 1320px with 28/32px gutters. Related controls
sit 8px apart; distinct groups are separated by 24px. No spacing collisions were detected at either viewport.

### Typography
Cal Sans carries page/section headings; Inter Variable handles dense UI at 14px with 11px minimum
functional text. `text-wrap: pretty` removes stranded words. Tabular numerals are applied to timecodes,
counts, and meters.

### Color
One accent (Signal Cyan) with derived light/deep/soft/ink tokens. Status colors are reserved for
success, live, and warning. Shadows are now neutral. No colored-glow findings remain.

### Polish
Modal focus is contained, status text is announced, shadows are neutral, and empty states follow the
product's own language. The remaining work is performance and long-content hardening rather than
visual drift.
