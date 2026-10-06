# Brief 02 — Renderer: core elements (text, list, code, table, math, box, arrow, highlight)

Size: L. Depends on: **foundation only** (brief 00 `done`). Runs in parallel with 01, 03, 04, 05.

Project: khan. Spec: `/Users/sanjivp27/Documents/projects/agent_pipeline/khan/spec.md` (approved 2026-10-05). Relevant parts: §4.4 (rendering paragraph, fonts, colors, element table rows for your eight types, timing of multi-part elements), §6 ("audio yields to the pen" — you supply `naturalMs`), §11 rows "Layout failure", "Validator and renderer disagree on fit", "Mermaid/MathJax … overflow inside a slot". Foundation contracts: repo `README.md` and `briefs/00-foundation.md` §C1, §C4, §C5.

## Tech stack (from the spec)
Vanilla JS ES modules in the browser, rough.js for shapes, no build step, no new npm dependencies, no CDN. Everything you draw comes from the vendored handwriting font (via `shared/handwriting.js`), vendored MathJax (via `shared/math.js`), and the foundation stroke kit (`shared/strokes.js`). Unit tests in Node (`node --test`) against the pure `prepare` functions; browser tests via Playwright 1.54.x (pinned — do not change) using the foundation harness page. Git: commit to the working copy of https://github.com/sanjivp2703/khan-whiteboard-agent.

## The specific feature
The Khan look for the "writing" half of the vocabulary. You implement `prepare(element, ctx) → Drawable` (interface C4) for exactly these types and register them in `player/renderer/core/index.js`:

| type | what it looks like |
|---|---|
| `text` | handwriting, wrapped by `shared/handwriting.wrap` to the slot inner width, style `title`/`body`/`note`, color token; revealed glyph by glyph as strokes (each glyph outline is drawn as a pen stroke, in reading order) |
| `list` | items one at a time; bullet (rough small circle/dash) or hand-written number for `ordered`; `partStarts` from `itemAt[]` when present else even; item text wraps within the slot width |
| `code` | handwriting at fixed advance (`CODE_CHAR_ADVANCE`), lines in order, a faint rough frame around the slot inner rect in `muted`; `lang` is accepted and ignored visually (no syntax colors — one chalk color) |
| `table` | rough grid lines (`muted`) first, then cells written cell by cell row-major; `header: true` row underlined/heavier; column widths proportional to the slot, text centered |
| `math` | each line from `shared/math.texToSvg` converted to strokes (SVG paths → path strings, scaled to the body size), lines aligned so their `=` glyphs share one x (`eqX`), appearing in turn; lines without `=` are left-aligned to the common start |
| `box` | rough rectangle around the slot rect (inset by `SLOT_PAD`/2), optional label hand-written at the top-left inside the stroke, in the element color |
| `arrow` | rough line (gentle curve allowed) from the edge of `boardRects.get(from)` to the edge of `boardRects.get(to)` — anchors on the nearest facing edges' midpoints, never from/to centers, never overlapping either rect interior; rough arrowhead; optional label hand-written at the midpoint offset perpendicular to the line |
| `highlight` | `circle`: rough ellipse around the target's rect (or, for `code` with `line`, around just that line); `underline`: rough line under the target's last text line (or the given code line); `strike`: rough line through the target rect's vertical middle (or code line); `pointer`: draws nothing, `paths = []`, `tipAt(u)` returns a point just left of the target (or line) for every u so the pen parks there |

Each Drawable's `tipAt(u)` follows the stroke currently being drawn (use `strokes.pointAt`), `paths` lists all strokes in draw order, `naturalMs = strokes.naturalMs(paths)`, `bounds` is the exact union of drawn strokes (for `arrow`/`highlight` it may exceed any slot — they have none — but for all slotted types it must lie inside `ctx.slotRect(slot)`).

Reveal semantics (§4.4): a Drawable's `u` ∈ [0,1] maps to parts via `partStarts`; within a part, strokes are drawn progressively in order, proportionally to path length. `paint(ctx2d, 1)` must equal the complete, deterministic image (same input → same strokes; seeds come from `ctx.seed(element.id)`).

### Boundary
- `sketch`, `diagram`, `plot`, `svg` → slice 03. Do not register them, even as placeholders.
- The pen cursor, idle/thinking animations, retrace during stalls, scheduling, the audio clock, state machine, controls → slice 04 (it consumes your `tipAt`/`paths`/`naturalMs`).
- Font loading, measurement, wrapping, glyph outlines, MathJax compile, stroke sampling, rough wrapper, slot math, tokens → foundation `shared/*`. If something you need is missing there, build the minimum in your own directory (`player/renderer/core/`) and report it in your status note — do not edit `shared/`.
- Validation: assume validated input (foundation is the single owner). Never re-validate, never guess at missing fields; a missing required field is a bug upstream — throw a clear error so tests catch it.

Files you own: `player/renderer/core/**` (incl. `core.css`, created empty by foundation), `test/renderer-core/**`, `e2e/renderer-core-*.spec.js`, and new fixture lessons under `fixtures/lessons/fx-core-*` (they must pass the validator — the foundation sweep test enforces this).

## End goal
Open `http://127.0.0.1:<port>/harness/fx-full-tour?scene=<any>&u=1` (and the `fx-type-*` lessons for your eight types) and see legible chalk handwriting, hand-drawn boxes and arrows that attach to the right things, math lines lining up on `=`, and tables that stay inside their cells. Dragging `u` from 0 to 1 reveals strokes in reading order with no element ever drawn outside its slot. The engine (slice 04) can drive all eight types through the registry without knowing anything type-specific.

## Acceptance criteria
1. All eight types are registered at import of `player/renderer/core/index.js`; no other type is.
2. **Containment:** for every element of your eight types in every fixture lesson (foundation's and yours), `prepare(...).bounds` lies inside `slotRect(slot)` for slotted types (Node test, no browser). Arrows/highlights: bounds lie inside the 1600×900 canvas.
3. **Determinism:** `prepare` twice on the same element yields deep-equal `paths`, `bounds`, `partStarts`, `naturalMs`; a different `seed` yields different rough paths but identical `bounds` within 2 px and identical text glyph paths.
4. **Monotonic reveal:** for u increasing 0→1 in 0.05 steps, the count of fully drawn strokes is non-decreasing and reaches `paths.length` at u=1; `tipAt(u)` is non-null whenever 0 < u < 1 and a stroke is in progress.
5. `list`: with `itemAt`, item k becomes visible exactly when u crosses `partStarts[k]`; without, parts are evenly spaced; `ordered` draws numbers 1..n; 6 near-cap items of 8 words each fit a `rowSpan ≥ 2` slot (fixture).
6. `math`: for every multi-line `fx-type-math` element containing `=` on each line, the rendered `=` x-positions agree within 0.5 px; lines appear in turn; a 60-char line fits the slot (fixture).
7. `code`: 14 lines × `22 × colSpan` chars at the near-cap fixture fit; characters advance by exactly `CODE_CHAR_ADVANCE`; a tab never appears (validated away — but your renderer must not crash on `\t` either: render as 2 spaces).
8. `table`: 6×6 near-cap fixture fits; cells are revealed row-major; header row visibly distinct (test: header row has one extra stroke — the underline — per column span).
9. `arrow`: endpoints lie on the boundary of `from`/`to` rects (±2 px) and never inside; an arrow between two elements that are in the same column attaches top/bottom edges; the label (if any) does not overlap either rect; an arrow whose `from` is from an earlier scene (via `boardRects`) renders.
10. `highlight`: `circle` bounds enclose the target rect (or code line) with margin ≤ 20 px; `underline` lies within 12 px below the target's last line; `strike` crosses the vertical middle; `pointer` has `paths.length === 0`, `naturalMs === 0`, and `tipAt(u)` is constant and adjacent to the target; with `line`, all of these use only that line's y-range.
11. `text`: `title` 44 px, `body` 28, `note` 22 (assert glyph heights scale accordingly); a 40-word body text in a 4-cell slot (near-cap fixture) wraps to fit; colors resolve to token values from `tokens.js` (never literal hex in your code — test greps your directory for `#[0-9a-f]{3,6}` and expects none except in comments).
12. Browser smoke (harness, Chromium): every fixture scene of your types paints with zero console errors; `nonBackgroundPixelCount()` > 0 at u=1 and equals 0 at u=0 for a scene with a single text element; a screenshot per `fx-type-*` lesson is saved to `test-results/renderer-core/` for the human to eyeball (not asserted pixel-exact).
13. `paint` never calls `measureText`, never creates DOM, never inserts SVG into the document (test: after painting all math fixtures, `document.querySelectorAll('svg').length === 0`; grep your directory for `measureText`, `innerHTML`, `DOMParser` → none).
14. Performance: `prepare` for the heaviest fixture scene (`fx-full-tour`'s densest scene restricted to your types) completes in < 150 ms in Node; `paint(ctx, 1)` for that scene < 50 ms in Chromium (assert loosely, ×3 margin on CI-like variance).
15. `node --check` on every file in your directory; `npm test` and `npm run test:e2e` green.

## Required tests
Risk here is "renderer disagrees with validator" and "layout overflow" — spec §11 says the renderer must assert containment for every fixture. So:
- Node unit tests (`test/renderer-core/`): one file per type covering criteria 2–11 and 13's grep, plus the all-fixtures containment sweep and determinism sweep (criteria 2–4) run over every fixture lesson present at test time (so later-added fixtures are covered automatically).
- Edge cases to include: empty-ish inputs that validation allows (single-word text, 2-item list, 1-line math, 1-line code, 2×1 table with `header`), longest allowed inputs, `box` with another element inside it (both render, no crash), `highlight` of an element from a previous scene (via `boardRects`), `arrow` label of 4 words, text with punctuation/quotes/digits the font may lack (fallback glyph: draw a small rough square, never throw).
- Playwright (`e2e/renderer-core-*.spec.js`): criteria 12–14 via the harness; one test drags `u` across 0→1 for `fx-type-list` and asserts item visibility order via `drawableOf(id)`.
- Add fixtures `fx-core-dense` (your eight types at near-cap in one board) and `fx-core-arrows` (arrows in all four edge relationships, labels, highlights of each style incl. `line`).

## Depends on
Foundation only.

## Design-asset dependencies
None gated. Your look depends on the token *values* in `shared/layout-core/tokens.js` (pipeline-status row `design-tokens`: placeholders now, final values later); every test here asserts structure (bounds, counts, order, token *names*), never specific colors, so nothing waits. Do not hard-code colors; read tokens so a later value change needs no renderer edit.

## Rules reminder
3-attempt stop rule; never weaken a test. Update your `pipeline-status.md` row. Commit and push. If a shared primitive turns out to be wrong (e.g. `handwriting.wrap` disagrees with `measure`), do not patch `shared/` — report it; that is a foundation bug and the human decides.
