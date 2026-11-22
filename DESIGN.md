---
name: Clipweave
description: Local-first stream-to-short editor with GPU AI, in a restrained dark operational shell.
colors:
  primary: "#38bdf8"
  primary-light: "#7dd3fc"
  primary-deep: "#0b7fbf"
  primary-ink: "#04121a"
  primary-soft: "rgba(56, 189, 248, 0.14)"
  neutral-bg: "#0a0a0a"
  neutral-chrome: "#18181b"
  neutral-card: "#161719"
  neutral-pill: "#1a1a1a"
  neutral-fg: "#fafafa"
  neutral-muted: "rgba(255, 255, 255, 0.5)"
  hairline: "rgba(255, 255, 255, 0.09)"
  success: "#22c55e"
  live: "#ff4d4f"
  gold: "#f5a623"
typography:
  display:
    fontFamily: "Cal Sans, Inter Variable, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Cal Sans, Inter Variable, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0"
rounded:
  sm: "12px"
  md: "16px"
  lg: "20px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  button-ghost:
    backgroundColor: "{colors.neutral-pill}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.sm}"
    padding: "10px 18px"
  card:
    backgroundColor: "{colors.neutral-card}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.neutral-pill}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  chip:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-light}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: Clipweave

## Overview

**Creative North Star: "The Quiet Cutting Room."**

Clipweave is an operator's tool, not a marketing page. The interface behaves like a dim editing
suite: near-black surfaces, one cyan instrument light, dense but breathable panels, and controls
that stay out of the footage. Every screen exists to keep the user's eye on the preview, the
timeline, and the next decision.

The visual voice is restrained and precise. Cal Sans gives headings a quiet, considered character;
Inter Variable carries dense operational text without fuss. Accent is used as a signal — playhead,
primary action, live AI state — never as decoration. Depth is flat by default; a single neutral
shadow lifts only the controls that demand action.

**Key Characteristics:**
- Near-black chrome with a single cyan accent, never a rainbow.
- Side-by-side icon and heading in empty states — no stacked feature-card template.
- Flat surfaces; neutral shadows only, never colored halos.
- Compact 12–16px radii, 8px rhythm, 11px minimum functional text.
- Motion is one authored page entrance, not scattered effects.

## Colors

A monochrome operational palette with one instrument accent.

### Primary
- **Signal Cyan** (#38bdf8): Primary actions, playhead, focus, live AI state. Rarity is the point.
- **Light Cyan** (#7dd3fc): Secondary text on tinted surfaces and hover lifts.
- **Deep Cyan** (#0b7fbf): Gradient underside of primary buttons; never a text color.

### Neutral
- **Room Black** (#0a0a0a): App background beneath all chrome.
- **Chrome Graphite** (#18181b): Top bar, timeline ruler, sticky headers.
- **Card Slate** (#161719): Cards, panels, inspector.
- **Pill Graphite** (#1a1a1a): Inputs, chips, secondary buttons.
- **Paper White** (#fafafa): Primary text.
- **Soft White** (rgba(255,255,255,0.5)): Muted copy and metadata.

### Status
- **Ready Green** (#22c55e), **Live Red** (#ff4d4f), **Signal Gold** (#f5a623): Status only, never decoration.

**The One Light Rule.** Cyan marks the current action or live state. If everything is cyan, nothing is.

## Typography

**Display Face:** Sora (self-hosted variable, with Inter Variable fallback)
**Body Face:** Inter Variable (self-hosted variable font)

**Character:** Sora gives headings a crisp, considered geometry; Inter Variable is neutral and
legible at small sizes. Both are self-hosted variable faces with no synthetic weights or text effects.

### Hierarchy
- **Page title** (400, 26px, Cal Sans): Screen identity, e.g. "Clips".
- **Section title** (650, 20px, Cal Sans): Empty-state and modal headings.
- **Panel heading** (650, 13px, Inter Variable): Inspector sections.
- **Body** (400, 14px, Inter Variable, 1.5 line-height): Explanatory copy, max 52–75ch.
- **Label/meta** (600, 11–12px, Inter Variable): Controls, chips, timecodes, tabs.

**The No Tiny Text Rule.** Functional text never drops below 11px; 10.5px was a drift, not a style.

## Layout

Three regions: top bar (68px), work area, and a fixed timeline where relevant. The editor places the
preview/phone on the right and the inspector + timeline on the left. Pages use a 1320px content
max-width with 28/32px outer padding. The spacing rhythm is 4/8/12/16/24px; related controls sit 8px
apart, distinct groups 24px. Empty states use a two-column grid with the icon beside the heading,
not above it.

Responsive behavior is pragmatic: below 1100px the editor sidebar narrows; below 980px top-bar
labels collapse to icons; settings switch from two columns to one below 900px.

## Elevation & Depth

Flat by default. Surfaces are separated by 1px hairlines and tonal steps, not shadows. The only
recurring elevation is a neutral, soft, offset shadow on interactive controls (`0 2px 8px -2px
rgba(0,0,0,0.55)`). The Mono theme adds a subtle inset edge to cards.

**The Neutral Shadow Rule.** Shadows are black and offset. A colored glow means a lighting bug.

## Shapes

Small controls use a 12px radius; cards use 16px; dialogs and large shells use 20px. Pills are
reserved for tabs, chips, and status dots. Icon tiles are 12px-radius squares, never circles except
status and switch knobs.

## Components

### Buttons
- **Shape:** 12px radius, pill for icon-only controls in some themes.
- **Primary:** Signal Cyan background, dark ink, 10px/18px padding, neutral soft shadow.
- **Hover / Focus:** brightness lift or glint sweep; focus ring is 2px cyan with 2px offset.
- **Ghost:** Pill Graphite surface, hairline border, Paper White text; disabled at 45% opacity.

### Chips
- **Style:** Tinted surface with lighter tinted text; 11.5px semibold; 22px tall.
- **State:** Status variants for success, warning, danger, live.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Card Slate with a hairline border.
- **Shadow Strategy:** None at rest; Mono theme adds a hairline/inset edge.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** Pill Graphite fill, hairline border, 10px radius, 13px text.
- **Focus:** Cyan border plus a 3px soft cyan ring.
- **Error / Disabled:** Warning/danger text or 45% opacity.

### Navigation
- **Style:** Pill group, 36px tall buttons, 14px labels; active tab gets cyan text via a sliding pill.
- **Mobile:** Labels hide below 980px, icons remain.

### Timeline
- **Style:** 40px lanes, 24px ruler, cyan 2px playhead with a grip.
- **Blocks:** Video blue-grey, Text violet, Captions cyan tint, Audio green — color is a track legend.

## Do's and Don'ts

### Do:
- **Do** use `--brand` and its derived tokens for every accent surface.
- **Do** keep icon and heading side-by-side in empty states.
- **Do** use `text-wrap: pretty` on paragraphs so no single word is stranded.
- **Do** keep minimum functional text at 11px.

### Don't:
- **Don't** use colored glow shadows or zero-offset chromatic halos on dark surfaces.
- **Don't** stack an icon tile above a heading as the page structure.
- **Don't** introduce a second accent hue for decoration.
- **Don't** animate layout properties for casual state changes.
