# Brief 03 — Renderer: picture elements (sketch, diagram, plot, svg)

Size: L. Depends on: **foundation only** (brief 00 `done`). Runs in parallel with 01, 02, 04, 05.

Project: khan. Spec: `/Users/sanjivp27/Documents/projects/agent_pipeline/khan/spec.md` (approved 2026-10-05). Relevant parts: §4.4 (rows `sketch`, `diagram`, `plot`, `svg`; rendering paragraph), §2 (no freehand, no image tracing), §8 tier order (why svg is last resort), §11 rows "svg quality", "svg as an injection surface", "plot/math executing code", "Mermaid … nondeterminism or overflow". Foundation contracts: repo `README.md` and `briefs/00-foundation.md` §C1 (subset grammars), §C4 (Drawable), §C5 (harness).

## Tech stack (from the spec)
Vanilla JS ES modules in the browser, rough.js for all shapes, no build step, no CDN. Parsers are foundation-owned and shared with the validator: `shared/mermaid-subset.js`, `shared/expr.js`, `shared/svg-subset.js`; you consume their ASTs — you never parse Mermaid, expressions, or SVG text yourself. Labels are handwriting via `shared/handwriting.js`. Strokes via `shared/strokes.js`. Node unit tests on pure `prepare`; Playwright 1.54.x (pinned) via the harness. You may vendor one layout library for diagrams (e.g. dagre, MIT) under `vendor/dagre/` with its LICENSE if you choose not to write your own layered layout; no npm dependency, no Mermaid runtime (the spec's "Mermaid" is satisfied by Mermaid *syntax*, parsed by the shared subset parser — this is an orchestrator decision; see report). Git: commit to the working copy of https://github.com/sanjivp2703/khan-whiteboard-agent.

## The specific feature
`prepare(element, ctx) → Drawable` (interface C4) for exactly `sketch`, `diagram`, `plot`, `svg`, registered in `player/renderer/pictures/index.js`.

**`sketch`** — a pre-authored library of ten shapes, keyed by the enum in `shared/layout-core/constants.js`: `circle, cloud, database, server, document, stack, person, numberline, axes, grid`. Each is authored by you as a small set of normalized paths (unit box 0..1) in `player/renderer/pictures/sketch-library.js`, scaled to fit the slot inner rect preserving aspect ratio, roughened with the seeded rough wrapper, drawn stroke by stroke, optional `label` hand-written beneath (or inside, for `document`/`server`) in the element color. The library file is the single place to add shapes later; adding one must not require touching any other file except the enum.

**`diagram`** — from the AST `{direction, nodes, edges}`: deterministic layout (layered: TD or LR; equal-rank nodes spaced evenly; edges routed as straight or single-elbow rough lines with arrowheads; edge labels hand-written at the midpoint), scaled to fit the slot inner rect (≥ 2×2 cells guaranteed by validation). Node shapes map to rough primitives: `[ ]` rect, `( )` rounded rect, `([ ])` stadium/ellipse, `{ }` diamond, `(( ))` circle. Node labels hand-written in `body` or `note` size (pick `note` when more than 4 nodes). Parts: nodes first (in source order), then edges. The result must be identical for identical source (if you vendor dagre, fix every option that affects determinism and assert it).

**`plot`** — axes first (rough lines with small ticks and hand-written min/max labels at ends), then each `fn`/series as a rough polyline: `fn` sampled with `shared/expr.evaluate` at 50 evenly spaced x over `xRange` (skip non-finite points, break the line there), `series` points as given; `yRange` given or auto from the data with 10 % padding; optional `label` hand-written at the top-right inside the slot. Each fn/series is one part, drawn progressively along x. Color token per element (series 2 and 3 use `accent` tokens rotated from the element's color — document the rule). Everything inside the slot inner rect; clip values outside `yRange` (don't draw them).

**`svg`** — from the AST `{viewBox, shapes}`: compute the uniform scale + translate that fits the viewBox into the slot inner rect (letterbox, centered), convert each shape to one or more rough path strokes (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` via the rough wrapper; `g` applies its allowed transform to children; `text` becomes handwriting at `note` size or the shape's `font-size` scaled, capped to `body`), honoring `fill` only as a light rough hachure in the given token color when `fill` is a token name (ignore other values), `stroke` token or chalk. **Never create DOM, never insert the SVG string anywhere, never use `<image>`/`<use>`** (they don't exist in the AST, but your code must not have any path that would render unknown tags — ignore and count them in a test hook). Each shape is one part.

Common: `bounds` = exact union of drawn strokes, inside the slot rect for all four (they are all slotted). `tipAt(u)` follows the current stroke. `naturalMs = strokes.naturalMs(paths)`. Seeds from `ctx.seed(element.id)`.

### Boundary
- The eight writing types → slice 02. Don't register them.
- Pen, scheduling, state machine → slice 04.
- Parsing, validation, caps, the sketch enum, tokens, stroke kit → foundation. If a parser's AST lacks something you need (e.g. `transform` on `g`), build a tiny adapter inside your directory and report the gap; never edit `shared/`. Assume validated input: a hostile SVG cannot reach you; still, your code must only switch on the allowlisted tag names and ignore anything else (defense in depth, tested).
- No image generation, no bitmap drawing (`drawImage` is forbidden in your directory — grep test).

Files you own: `player/renderer/pictures/**` (incl. `pictures.css`), optional `vendor/dagre/**`, `test/renderer-pictures/**`, `e2e/renderer-pictures-*.spec.js`, new fixtures `fixtures/lessons/fx-pic-*` (must pass the validator).

## End goal
In the harness, `fx-type-sketch` shows all ten library shapes clearly recognizable in chalk; `fx-type-diagram` shows hand-drawn flowcharts with readable labels and arrows that end on node edges, identical every reload; `fx-type-plot` shows axes then curves drawn left to right; `fx-type-svg` shows the model-written SVGs roughened and fitted inside their slots. None of them escape their cells, and all are revealed as strokes over `u`.

## Acceptance criteria
1. Exactly the four types registered at import of `player/renderer/pictures/index.js`.
2. **Containment:** `prepare(...).bounds` inside `slotRect(slot)` for every `sketch`/`diagram`/`plot`/`svg` element in every fixture lesson present (Node sweep).
3. **Determinism:** two `prepare` calls → deep-equal paths/bounds/partStarts/naturalMs; for `diagram`, 20 repeated layouts of the 8-node/12-edge near-cap fixture are identical (if dagre is used, this is where nondeterminism would show).
4. **Monotonic reveal** (as in brief 02 criterion 4) for all four types.
5. `sketch`: all ten enum values produce a non-empty Drawable; an unknown shape name throws a clear error (cannot happen post-validation, but must not silently draw nothing); aspect ratio preserved (a `circle` in a 2×1 slot has equal width and height within 2 px); label present/absent both render.
6. `diagram`: node count and edge count of parts equal the AST's; every edge's endpoints lie on its source/target node boundary (±2 px) and outside both interiors; no two node rects overlap; node labels fit inside their node (label `bounds` ⊂ node rect); TD lays ranks top→bottom, LR left→right (assert ordering of node centers); edge labels are drawn when present; the 8-node/12-edge fixture fits a 2×2 slot and a 4-node one fits 2×2 with larger text.
7. `plot`: axes are the first part; `fn` with a discontinuity (`1/x` over [-2,2]) produces a broken line (no stroke crosses the asymptote: assert no segment spans x≈0 with |Δy| > slot height); non-finite points skipped; 3 series = 4 parts (axes + 3); points clipped to `yRange`; axes tick labels hand-written and inside the slot; `label` present renders in the top-right inside the slot.
8. `svg`: for every valid `fx-type-svg` element, the number of drawn shape-parts equals the number of AST shapes (≤ 40); a shape at the viewBox edge is drawn exactly at the slot inner edge (±2 px) — letterboxing correct for both wide and tall viewBoxes; `g transform="translate(...)"` moves children; `text` renders as handwriting and counts as one part; `fill="accent2"` produces a hachure, `fill="none"` none; unknown tag names in a synthetic AST are ignored and counted in `window.__khan.rendererPictures.ignored` / a returned `ignored` list in Node — never thrown, never drawn.
9. `paint` never creates DOM: after painting all four fixture lessons in the harness, `document.querySelectorAll('svg, img, foreignObject').length === 0`; grep of your directory for `innerHTML`, `DOMParser`, `drawImage`, `createElementNS`, `eval`, `Function(` → none.
10. No literal hex colors in your directory (token names only), as in brief 02.
11. Browser smoke: every fixture scene of your types paints with zero console errors; screenshots per `fx-type-*` lesson saved to `test-results/renderer-pictures/` for human review; `nonBackgroundPixelCount()` > 0 at u=1.
12. Performance: `prepare` of the heaviest picture scene < 150 ms in Node (dagre layout included); `paint(ctx,1)` < 50 ms in Chromium (loose).
13. `node --check` over your directory; `npm test` and `npm run test:e2e` green; if you vendored dagre, its LICENSE is present and README gains a one-line "vendored libraries" entry (this is your one permitted README edit).

## Required tests
Spec §11 puts medium-severity risk on svg quality/injection and on Mermaid/plot overflow and nondeterminism — test accordingly:
- Node (`test/renderer-pictures/`): per-type files covering criteria 2–10; an all-fixtures containment + determinism sweep (auto-covers later fixtures); diagram layout edge cases: single node, two nodes one edge, self-loop (`a --> a` — is it rejected by the validator? if the subset parser allows it, draw a small loop; if not, document), long chain of 8 nodes in LR (must fit width by shrinking), fan-out 1→7; plot edge cases: constant fn, steep fn (`exp(x)` on [0,10] with auto range), series with 1 point (draw a dot), 50 points; svg edge cases: viewBox with non-zero origin, viewBox aspect 10:1 and 1:10, nested `g`, 40 shapes, `text` of 6 words, zero-size rect (skip, no NaN), path with arcs (`A`) and curves (`C Q`).
- Defense-in-depth: a synthetic AST with tags `script`, `image`, `use`, `foreignObject` → ignored, counted, nothing drawn (criterion 8).
- Playwright (`e2e/renderer-pictures-*.spec.js`): criteria 9, 11, 12; one test reloads `fx-type-diagram` three times and compares `drawableOf(id).paths` string-equal across reloads.
- Add fixtures `fx-pic-dense` (all four types at near-cap on one board) and `fx-pic-shapes` (the sketch library in every slot aspect ratio: 1×1, 2×1, 1×2, 3×2).

## Depends on
Foundation only.

## Design-asset dependencies
None gated. Look depends on token values (pipeline-status row `design-tokens`, placeholders now); tests assert structure only. The sketch library is *your* authored geometry, not a design asset — it ships in this slice.

## Rules reminder
3-attempt stop rule; never weaken a test. Update your `pipeline-status.md` row. Commit and push. Report gaps in `shared/` parsers rather than editing them.
