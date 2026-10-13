# change-khan-feel

**Lane:** change
**Requested:** 2026-10-13, by the human: "Do more research to optimize how the video works. Watch a bunch of Khan Academy videos, identify different components to replicate ... style of the font, style of pictures, general movement, when something is drawn or instantly generated ... note down ways to improve the video generation software to make it more similar to Khan Academy. Then implement it."
**Status:** approved in advance by the human (2026-10-13, "Then implement it"); study done (design/02-khan-video-study.md, six Sal-narrated videos, timestamped); build started 2026-10-13 with three builders (timing/pen, handwriting/math/tables/lists, plots/sketches)

## Why
The look (black board, palette, cursor, voice) is done; the *feel* of how things appear over time, the handwriting, the math, and the pacing have not been compared against real Sal Khan videos.

## What changes
From design/02-khan-video-study.md §3–§4, in priority order:
1. **Natural-speed writing, then park.** Each element is drawn at handwriting speed (pen ≈ 550 px/s, with short micro-pauses between words and lines) and then the pen parks or hovers on it for the rest of the narration window, instead of stretching every stroke across the whole window. Talk-first: the first element starts ≈ 8 % into the audio by default rather than at 0.
2. **Hover-and-point cursor.** Between elements the pen travels with a short tween to the next start point; while narration continues with nothing new to draw, the pen hovers over the current element (Sal spends 30–50 % of a video pointing, not writing).
3. **Handwriting feel.** Glyphs reveal by a left-to-right sweep (a single stroke look) instead of outline-trace-then-fill; body text ≈ 38 px and notes ≈ 28 px on the 1600 board (Sal's cap height ≈ 45–50 px), a 6° shear and small per-glyph jitter (baseline ±1 px, size ±3 %, rotation ±2°), deterministic per element. Titles stay the same size as body and get an emphasis instead of a larger size where the author chooses.
4. **Handwritten-looking math.** MathJax keeps doing layout; alphanumerics and operators are rendered with the handwriting glyphs fitted into MathJax's glyph boxes, rules (fraction bars, radicals) stay as strokes; fallback if fitting proves unreliable: roughen the MathJax paths.
5. **Emphasis styles.** `highlight` gains `wavy` (underline), `box` and `double`; `strike` unchanged.
6. **Gridless tables.** Tables draw as underlined headers and one colour per row, no grid lines, matching Sal's tables.
7. **Marker-less lists.** Lists draw without bullets (indent only) unless `ordered`.
8. **Sal-style plots.** Two axis strokes with separate arrowheads, 2–5 integer ticks written one at a time, axis names at the ends, data points as dots with letter labels, an open circle for a hole (new optional `hole: [x, y]` on plot), curves in one sweep.
9. **Small sketches.** Sketches draw at Sal's doodle scale (60–120 px tall, centred in the slot rather than filling it) with a one-word label; new shapes: rock, ground, smiley, zigzag-path, arrow-curve.
Deferred to the backlog: scroll-board mode (L), `\color{accentN}` inside math (M).

## Spec deltas

### ADDED
- Under "6. Live playback model": "**Writing pace.** An element is drawn at handwriting speed (pen speed and micro-pauses in `layout-core` constants) and then the pen parks on it for the remainder of its narration window; it is never stretched to fill the window. The first element of a scene starts at about 8 % of the audio by default. Between elements the pen travels with a short tween; with nothing to draw it hovers over the current element."
- Under "4.4 Board grid, rendering, and elements": "**Handwriting rendering.** Glyphs appear with a left-to-right sweep; text is sheared ≈ 6° with small deterministic per-glyph jitter. `highlight.style` also accepts `wavy`, `box`, `double`. Tables draw gridless (underlined header, one colour per row). Lists draw without markers unless `ordered`. Plots draw axes with arrowheads, integer ticks, axis names at the ends, dots with letter labels, and an optional `hole` (open circle). Sketches draw at doodle scale (60–120 px) with new shapes rock, ground, smiley, zigzag, curve."

### MODIFIED
- Under "4.4 Board grid, rendering, and elements": replace "Fixed fonts (no other sizes exist): `title` 44 px, `body` 28 px, `note` 22 px, `code` 20 px monospace-handwriting." with "Fixed fonts (no other sizes exist): `title` 44 px, `body` 38 px, `note` 28 px, `code` 20 px monospace-handwriting. Word and line caps are re-derived from these sizes so every fixture still fits (the validator and renderer share the constants)."
- Under "6. Live playback model", the sentence "Draw-in durations per type are fixed in `layout-core` and clipped so an element finishes before the next begins." becomes "Draw-in durations come from handwriting speed; an element that cannot finish before the next begins is sped up only as a last resort (the yield-to-pen rule still holds at scene end)."

### REMOVED
- none

## Unchanged behavior
- Scene-script contract (khan-scene/1) and element vocabulary unchanged; new fields (`hole`, new highlight styles, new sketch shapes) are additive and optional; every existing fixture lesson stays valid and every drawable stays inside its slot.
- Audio clock remains the only clock; yield-to-pen rule unchanged.
- Token names unchanged.

## Risk
low–medium: visual timing and rendering changes; covered by the harness screenshots, timing e2e tests and a human viewing.

## Design assets
none
