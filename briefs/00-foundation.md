# Brief 00 — Foundation (BLOCKING — build first, alone, before any other slice starts)

**Status: blocking.** Every other brief (01–05) assumes this slice is `done` in `pipeline-status.md`. Nothing in 01–05 may start until it is. Build it sequentially, as one builder. It is large (L); commit in stages (see "Suggested order") so a partial foundation is still reviewable.

Project: khan — a Claude Code skill that turns Claude's last response into a live, interruptible, Khan Academy style narrated whiteboard lesson. Spec: `/Users/sanjivp27/Documents/projects/agent_pipeline/khan/spec.md` (approved 2026-10-05; authoritative). Background: `decisions.md`. Cross-project lessons: `/Users/sanjivp27/Documents/projects/agent_pipeline/lessons.md`.

## Tech stack (from the spec — do not substitute)

- Node >= 20, plain ES modules (`"type": "module"`), **no build step**, no transpiler, no bundler.
- Player: vanilla JS + rough.js in the browser. Canvas 1600×900 logical px, letterboxed to the window.
- Rendering libraries vendored locally under `vendor/` with their LICENSE files (licenses must permit redistribution): rough.js (MIT), opentype.js or equivalent font-path extractor (MIT), MathJax 3 (Apache-2.0) with SVG output, a handwriting-style font (OFL or similar). **No CDN, ever.** Mermaid is NOT vendored by this slice (see `shared/mermaid-subset.js`).
- Unit tests: `node --test` (built-in `node:test`), zero test-framework dependencies.
- E2E: `@playwright/test` **pinned to 1.54.x** (exact: `"@playwright/test": "1.54.2"` or the latest 1.54.x available) — Playwright >= 1.62 has no Chromium build for macOS 13, which this machine runs (lessons.md). Record the reason in `README.md` and in the foundation row of `pipeline-status.md` so nobody "upgrades" it.
- TTS: provider interface + `silent` provider only in this slice. OpenAI provider is slice 01.
- Git: the project folder `/Users/sanjivp27/Documents/projects/agent_pipeline/khan` is the working copy of the public repo https://github.com/sanjivp2703/khan-whiteboard-agent. Commit your work there with clear messages. Never commit secrets; `.khan/` stays gitignored (lessons, cache, config, pidfile).

## What this slice builds

Everything that more than one later slice depends on. Spec §3 names it: scene-script schema + validator; `layout-core` shared by validator and renderer; lesson folder layout; fixture lessons covering every element type; server skeleton (watch → validate → playlist → SSE) with the `silent` provider. This brief adds the concrete seams the parallel slices need (module ownership, interfaces, test harness) so they can build without touching each other's files.

### Boundary — what is NOT in this slice

- OpenAI TTS (slice 01). You build the provider interface, the audio cache, provider selection, and `silent`.
- Element drawables for the twelve types (slices 02, 03). You build the stroke kit, the registry, the fallback drawable, and the harness page.
- The player engine: state machine, clock, controls, question UI, sidebar, transcript, pen cursor (slice 04). You build the shell page, a no-op engine stub, and the test hooks namespace.
- `khan` CLI and `SKILL.md` (slice 05). Your server is started with `node server/index.js`; the CLI wraps it later.

## Repo layout you must create (frozen — later slices own the directories marked for them)

```
package.json                     type:module; scripts: test, test:e2e, check, serve
README.md                        how to run tests, pin reasons, layout, contracts summary
.gitignore                       add: .khan/  test-results/  playwright-report/  node_modules/
playwright.config.js             starts server (KHAN_TTS=silent, KHAN_NO_OPEN=1, temp lessons dir, random port)
server/                          FOUNDATION ONLY (slice 01 adds exactly one file: server/tts/openai.js)
  index.js                       startServer({port, lessonsDir, host}) → {port, close()}; CLI-less entry (`node server/index.js --port N --lessons-dir D`)
  lesson-store.js  watcher.js  ingest.js  playlist.js  control.js  wait.js  http.js  sse.js  lifecycle.js
  tts/index.js (selection + interface)  tts/silent.js  tts/cache.js
shared/                          FOUNDATION ONLY; environment-agnostic ESM (runs in Node AND browser unchanged); served at /shared/
  layout-core/constants.js       ALL numeric caps, grid, fonts, line heights, pen speed, slot padding — the ONE constants file (§4.4 last para)
  layout-core/tokens.js          color token NAMES (frozen) with placeholder values; board bg, chalk, font family
  layout-core/grid.js            parseSlot, slotRect, slotCells, slotSpan, cell helpers
  layout-core/occupancy.js       occupancy set (cells + element ids since last wipe), intersect, apply scene
  layout-core/timing.js          resolveTiming(scene) → per-element {id, at, end} windows (default spacing, itemAt check helpers)
  layout-core/measure.js         text/code/list/table fit measurement (wrap, line count) using handwriting metrics — pure, deterministic
  layout-core/index.js
  schema/errors.js               stable error codes (list below)
  schema/shape.js  content.js  layout.js  validate.js   validateScene(scene, occupancySet, {lessonId}) → {ok, errors, occupancy}
  handwriting.js                 loadFont(source) ; measure(text, style) ; glyphPaths(text, style, x, y) → ordered SVG path strings per glyph
  math.js                        texToSvg(lines, opts) via vendored MathJax (restricted macros) → per-line SVG strings; same output Node/browser
  mermaid-subset.js              parse(source) → {direction, nodes[], edges[]} for the flowchart/graph TD|LR subset only; throws BAD_MERMAID
  expr.js                        parse(src) → AST; evaluate(ast, x) ; safe arithmetic grammar, no eval/Function
  svg-subset.js                  parse(svgText) → {viewBox, shapes[]} with allowlist, size, bounds checks; throws BAD_SVG
  strokes.js                     path sampling (length, pointAt), partial-draw helper, rough.js generator wrapper with seed(elementId), naturalMs(paths)
player/                          shell = FOUNDATION ONLY
  index.html                     <canvas id="board" width=1600 height=900> + <canvas id="pen"> overlay + <div id="engine-root"> + debug panel (hidden unless ?debug=1)
  app.js                         imports ./registry.js, ./renderer/core/index.js, ./renderer/pictures/index.js, ./engine/index.js; applies tokens to :root
  tokens.css                     CSS custom properties mirrored from layout-core/tokens.js (one source of truth: JS; app.js sets vars)
  registry.js                    element drawable registry + fallback drawable + Drawable JSDoc typedef (interface below)
  harness.html  harness.js       renderer test page (below)
  renderer/core/index.js         SLICE 02 owns this directory. Foundation creates index.js registering nothing (comment only)
  renderer/pictures/index.js     SLICE 03 owns this directory. Same stub
  engine/index.js                SLICE 04 owns this directory. Foundation stub: connects SSE, logs playlist to debug panel, nothing else
vendor/                          rough/ opentype/ mathjax/ fonts/ (+ LICENSE in each). Slice 03 may add vendor/mermaid or vendor/dagre
fixtures/lessons/<lessonId>/     valid fixture lessons (outline.json + scenes/*.json) — list below. Slices add their own under prefixes fx-core-, fx-pic-, fx-eng-, fx-cli-
fixtures/invalid/<name>.json + <name>.expected.json     single invalid scenes with expected error codes
fixtures/degrade/<lessonId>/     lessons containing scenes that must be rejected then degraded
test/foundation/*.test.js        your unit tests (slices use test/<slice>/)
e2e/foundation-*.spec.js         your Playwright tests (slices use e2e/<slice>-*.spec.js)
.claude/skills/khan/             SLICE 05 (do not create)
bin/                             SLICE 05 (do not create)
```

Ownership rule for parallel safety (lessons.md): slices never edit `player/index.html`, `player/app.js`, `player/registry.js`, `shared/**`, `server/**` (except slice 01's single new file), `package.json` (except slice 05 adding `bin`), or `playwright.config.js`. They add files only inside their own directories. So `app.js` must already import the three slice entry points, and `index.html` must already link `player/engine/engine.css`, `player/renderer/core/core.css`, `player/renderer/pictures/pictures.css` (create them empty). Test hooks: slices attach only under their own namespace: `window.__khan.engine`, `window.__khan.rendererCore`, `window.__khan.rendererPictures`, `window.__khan.harness`. Foundation creates `window.__khan = {}` in app.js/harness.js.

## Contracts you define (frozen interfaces; copy them into README)

### C1. Scene-script contract — exactly spec §4 (`khan-scene/1`, `khan-outline/1`)
All regexes, caps, modes, and the twelve element types as written in §4.1–§4.4. Caps live only in `shared/layout-core/constants.js`; you may tune numeric values if measurement proves a cap unworkable, but names and the §4.4 semantics are fixed. Record any tuned value in README with the reason.

Grid math: canvas 1600×900, margin 50, so the board inner area is 1500×800; 6 columns of 250 px (A–F), 4 rows of 200 px (1–4). Cell (c, r) with c∈0..5, r∈0..3 has x = 50 + 250c, y = 50 + 200r. `slotRect("B2:D3")` = x 300, y 250, w 750, h 400. Content inset `SLOT_PAD` (your constant, ~12 px) is applied uniformly by measurement and drawables.

Fixed fonts: `title` 44 px, `body` 28 px, `note` 22 px, `code` 20 px. There is no monospace handwriting font requirement beyond this: `code` is drawn with the handwriting font at a **fixed per-character advance** (constant `CODE_CHAR_ADVANCE`), so measurement is trivial and deterministic. Line heights are constants per style.

Colors: token names `accent1`…`accent5`, `muted` are the only legal `color` values. Also define (not element-selectable) `chalk` (default stroke/text), `boardBg`. Placeholder values: dark board, chalk off-white, five distinguishable chalk-like accents, muted grey. Token names are frozen now (contract-first rule in CLAUDE.md); values are placeholders until a design pass — there is no design agent planned yet. Font family token `fontHand` names the vendored font.

Validator I/O (spec §5): `validateScene(scene, occupancySet, {lessonId}) → { ok, errors: [{elementId|null, code, message}], occupancy: newOccupancySet, effective: scene }`. Deterministic, < 100 ms per scene, no randomness. Stable codes — implement at least: `BAD_JSON, BAD_SCHEMA, MISSING_FIELD, BAD_FIELD, BAD_LESSON_ID, BAD_SCENE_ID, BAD_ID, DUP_ID, BAD_ENUM, BAD_BOARD, BAD_NARRATION, CAP_COUNT, CAP_WORDS, CAP_CHARS, CAP_LINES, BAD_AT, BAD_SLOT, SLOT_TOO_SMALL, OVERFLOW, OVERLAP, OUT_OF_REGION, REGION_OCCUPIED, BAD_REF, SELF_REF, BAD_LINE, BAD_MATH, BAD_MERMAID, BAD_EXPR, BAD_SVG`. Element-level validation lives here and nowhere else (lessons.md): the player and playlist assume validated scenes.

Pipeline per scene: parse → shape → content → layout, exactly §5. Notes that §4.4/§5 leave implicit and that you must implement this way:
- `at` default: elements without `at` are spaced evenly across [0, 0.85] in list order; explicit `at` values must be non-decreasing in list order (else `BAD_AT`). Element window = its `at` to the next element's `at` (0.95 for the last). `itemAt[]` (list) must be ascending and inside the window.
- `region` scenes: `slots` must not intersect occupancy; every slotted element must be inside `slots`. Arrows and highlights are exempt from containment but their `from/to/target` must resolve to element ids on the board (occupancy ids ∪ earlier elements of this scene). An element id may not repeat since last wipe (`DUP_ID`).
- `box` containment: other elements whose slot is entirely inside a box's slot do not count as overlapping it; everything else overlapping is `OVERLAP`.
- Occupancy after a `wipe` scene = cells+ids of that scene only. After `region`: union.
- Math: lines compile with `shared/math.js` under restricted macros (reject `\def`, `\newcommand`, `\input`, `\include`, `\href`, `\url`, `\require`, `\unicode`, anything that loads packages or defines macros). Reject on compile error → `BAD_MATH`.
- Mermaid subset grammar (`shared/mermaid-subset.js`): first line `flowchart TD|LR` or `graph TD|LR`; node forms `id[label]`, `id(label)`, `id([label])`, `id{label}`, `id((label))`, bare `id`; edges `-->`, `---`, `-.->`, `==>`, with optional `|label|` or `-- label -->`; chained edges `a --> b --> c`; `;` or newline separators; comments `%%`. Anything else (subgraphs, classDef, click, style, other diagram types) → `BAD_MERMAID`. Caps per §4.4. Node ids `^[A-Za-z][A-Za-z0-9_]*$`.
- `plot` expression grammar (`shared/expr.js`): numbers, `x`, `+ - * / ^`, unary minus, parentheses, functions `sin cos tan exp log ln sqrt abs min max floor ceil`, constants `pi e`. A tokenizer + recursive-descent parser; the evaluator walks the AST. **No `eval`, no `new Function`, no property access on user input.** Validator also samples the expression over `xRange` (≤ 50 points) and requires finite results for at least 2 points (else `BAD_EXPR`). `xRange`/`yRange` default [-10, 10] / auto; given ranges must be finite with min < max.
- `svg` (`shared/svg-subset.js`): a small strict tokenizer/parser for the allowlisted subset (do not use DOMParser — this must run in Node and must never create live DOM). Allowed tags: `svg, g, path, line, circle, ellipse, rect, polyline, polygon, text`. Allowed attributes: geometry (`d x y x1 y1 x2 y2 cx cy r rx ry width height points viewBox transform` — `transform` limited to `translate`/`scale`/`rotate`), `stroke`, `stroke-width`, `fill` (color token name or `none`), `font-size`, `text-anchor`. Any `href`, `xlink:*`, `on*`, `style`, `script`, `foreignObject`, `image`, `use`, entities, processing instructions, CDATA, or namespace prefixes → `BAD_SVG`. ≤ 4 KB, must declare `viewBox`, ≤ 40 shapes, `text` ≤ 6 words, every shape's bounding box inside the viewBox (compute from geometry; for `path`, from parsed segment points incl. control points — conservative is fine). Output: `{viewBox:{x,y,w,h}, shapes:[{tag, attrs, children?}]}`.

Degrade semantics (§5, made concrete): first invalid ingest of a `sceneId` → status `rejected`, write `control/reject-<sceneId>.json`, mirror in inbox. Rewrite (same file overwritten) → re-validate; if invalid again → **degrade**: drop every element with an element-level error, re-validate the remainder (repeat ≤ 8 times until clean, since dropping an arrow's target cascades), keep narration, set `degraded: true` and record `droppedElementIds`. If a scene-level error remains (narration, board/region intersect, bad ids) on the second attempt, degrade to a **narration-only** scene: `elements: []`, `board` unchanged if valid else `{mode:"region", slots:<a free single cell or none>}` — i.e. never wipe the board as a side effect of degrading. Orchestrator default, flagged to the human: if no rewrite arrives within **30 s** of a reject, degrade the first attempt the same way so the lesson never stalls.

### C2. Lesson folder — exactly spec §4.1
Root `.khan/lessons/` inside the repo, overridable with `--lessons-dir` / `KHAN_LESSONS_DIR` (tests use a temp dir). Server ignores `*.tmp`. Watcher must tolerate a file written in two chunks (only reacts after rename / stable size + valid JSON; re-read on change). `audio/<sceneId>.<ext>` — the `silent` provider writes a real **silent WAV** (PCM 16-bit mono 8 kHz, duration = words/150 wpm, min 1.5 s) so the player's `<audio>` element remains the only clock under tests; extension is carried in `audioUrl`. `state/playlist.json` persisted on change (debug/replay).

`control/inbox.json` (server → producer; the one file the producer reads):
```json
{ "schema": "khan-inbox/1", "lessonId": "...", "updatedAt": "ISO",
  "pending": [ {"kind":"question","qId":"q001","text":"...","atSceneId":"s004","atTime":12.3,"createdAt":"ISO"},
               {"kind":"reject","sceneId":"s003","attempt":1,"errors":[{"elementId":"t1","code":"OVERFLOW","message":"..."}]} ],
  "notices": [ {"kind":"degraded","sceneId":"s003","droppedElementIds":["t1"]} ],
  "player": {"connected": true, "position": {"sceneId":"s002","event":"end"} },
  "buffer": {"readyAhead": 2},
  "tts": {"provider":"silent","voice":null,"ready":true,"reason":null},
  "producerLastWriteAt": "ISO|null" }
```
A `question` pending entry is cleared when a scene with that `questionId` is ingested; a `reject` is cleared when that `sceneId` is rewritten (or degraded). `control/question-<qId>.json` and `control/reject-<sceneId>.json` are also written individually.

### C3. HTTP + SSE API (server ↔ player ↔ CLI). Host `127.0.0.1` only; default port 7777.
- `GET /lesson/:lessonId` → `player/index.html`. `GET /harness/:lessonId` → `player/harness.html`. Static: `/player/*`, `/shared/*`, `/vendor/*`.
- `GET /api/lesson/:lessonId/outline` → outline.json (404 if absent).
- `GET /api/lesson/:lessonId/playlist` → Playlist snapshot (below).
- `GET /api/lesson/:lessonId/scene/:sceneId` → the **effective** scene (validated; degraded scenes have offending elements removed). 404 until validated/degraded.
- `GET /api/lesson/:lessonId/audio/:sceneId` → audio file with correct `Content-Type`; 404 if none.
- `GET /api/lesson/:lessonId/events` → SSE. Events: `playlist` (full snapshot, sent on connect and on every change), `heartbeat` every 15 s. Snapshot-only; no deltas.
- `POST /api/lesson/:lessonId/position` `{sceneId, event:"start"|"end", t?}` → 204. Server derives buffer depth and `ended`.
- `POST /api/lesson/:lessonId/question` `{text, atSceneId, atTime}` → `{qId}`. `text` 1–500 chars. Assigns `q001`, `q002`…
- `GET /api/lesson/:lessonId/wait?timeout=<seconds>` → long-poll; one JSON object; semantics below.
- `GET /api/lesson/:lessonId/status` → `{lessonId, title, tts, producer:{lastWriteAt, lastWriteAgeMs}, counts:{planned, scenes, ready, degraded, rejected, answerScenes, questions, svgElements}, buffer:{readyAhead}, player:{connected, position}, ended}`.
- `GET /api/health` → `{ok:true, port, lessonsDir, tts}`.
- Every `:lessonId` / `:sceneId` is checked against the §4.1 regexes before touching the filesystem (400 otherwise; `../` can never reach a path). Any request carrying an `Origin` header that is not `http://127.0.0.1:<port>` (or `http://localhost:<port>`) → 403. Requests without `Origin` (curl, CLI) are allowed.

Playlist snapshot:
```json
{ "lessonId":"...", "title":"...", "ended":false,
  "tts":{"provider":"silent","voice":null,"ready":true,"reason":null},
  "producer":{"lastWriteAt":"ISO|null","lastWriteAgeMs":1234},
  "outline":{ ...outline.json... },
  "entries":[ {"sceneId":"s001","kind":"lesson|answer","position":0,"status":"pending|validating|voicing|ready|rejected|degraded",
               "title":"...","board":{"mode":"wipe"},"final":false,"questionId":null,"insertAfter":null,
               "audioUrl":"/api/lesson/<id>/audio/s001|null","durationMs":12000,"degraded":false,"errors":[]} ],
  "questions":[ {"qId":"q001","text":"...","atSceneId":"s004","atTime":12.3,"createdAt":"ISO","answeredBy":["q001-a01"],"complete":false} ] }
```
Status transitions: `pending → validating → voicing → ready`, or `validating → rejected`, or `validating → degraded → voicing → ready` (keep `degraded: true` once `ready`). **TTS failure** (orchestrator default; spec is silent): after the provider gives up, the entry becomes `ready` with `audioUrl: null`, `durationMs` = 150-wpm estimate, `errors` += `{code:"TTS_FAILED"}` — the player skips it with a visible note (slice 04).

Ordering = §4.1: lesson scenes by number; answer scenes immediately after their `insertAfter`, grouped by `qId` in `a` order; later questions on the same `insertAfter` after earlier ones. `ended` becomes true when the player reports `end` for the last playlist entry AND the last lesson scene present has `final: true` AND every question has a `final` answer scene present. A new question sets `ended=false` again.

`wait` semantics (§7): on each call, in this order: (1) if a `pending` inbox entry has not yet been delivered by `wait`, return it (`{"event":"question",...}` or `{"event":"reject",...}`; oldest first; mark delivered); (2) if `ended` → `{"event":"finished","summary":{...counts}}`; (3) if the player had an SSE client and none has been connected for > 15 s → `{"event":"player-closed"}`; (4) if the lesson has no `final` lesson scene yet AND `buffer.readyAhead < 3` → `{"event":"continue","readyAhead":n,"notices":[...]}` immediately; (5) otherwise block until one of (1)–(4) becomes true or `timeout` seconds elapse → `{"event":"timeout"}`. `readyAhead` = ready entries after the player's last `start` position (all ready entries if the player has not started). `notices` (degradations) are included in every response and cleared once sent.

Lifecycle (§6): server opens the browser to `/lesson/<id>` when a new `outline.json` appears (macOS `open`, else `xdg-open`; suppressed by `KHAN_NO_OPEN=1`, always set in tests). Server exits 10 min after `ended` or 10 min after the last SSE client disconnected (if any ever connected); configurable `KHAN_IDLE_EXIT_MS` for tests. On startup it ingests any lesson folders already present (that is how replay works: `khan play` later just starts the server on an existing folder; audio comes from the cache).

TTS provider interface (`server/tts/index.js`): `selectProvider(env, config) → provider`; `KHAN_TTS=silent` → silent; otherwise `openai` (slice 01) which requires `OPENAI_API_KEY`; missing key → provider with `ready() → {ok:false, reason:"OPENAI_API_KEY not set"}` and the server still starts; playlist/status/inbox carry `tts.ready=false` and `reason`. Provider shape: `{ name, voice, ready(), synthesize({text}) → Promise<{bytes:Uint8Array, mime, ext, durationMs}> }`. Cache (`server/tts/cache.js`): `.khan/cache/tts/<sha256(provider|voice|text)>.<ext>` + `.json` sidecar with `durationMs`; a hit never calls `synthesize`; `audio/<sceneId>.<ext>` in the lesson folder is a copy of the cached file. Config: `.khan/config.json` `{ "tts": {"voice": "..."}, "port": 7777 }` or env `KHAN_TTS_VOICE`, `KHAN_PORT`. Secrets only from env; the key must never be written to the lesson folder or served.

### C4. Drawable interface (renderer slices ↔ engine), `player/registry.js`
```js
registry.register(type, prepare)          // prepare(element, ctx) → Drawable ; slices 02/03 call this at import time
registry.get(type)                         // → prepare fn or registry.fallback
registry.fallback                          // foundation: dashed slot rect + id/type label drawn with plain canvas text
// ctx = { slotRect(slot) → Rect, boardRects: Map<elementId, Rect> (every element on the board since last wipe, incl. earlier
//         elements of this scene), elementsById: Map<id, element>, tokens, constants, font (loaded handwriting font), seed(elementId) }
// Drawable = {
//   id, type,
//   bounds: Rect,            // {x,y,w,h} in board px; for slotted elements MUST lie inside slotRect(slot)
//   parts: number,           // ≥ 1; list items, math lines, table cells, diagram nodes+edges, plot series…
//   partStarts: number[],    // normalized [0,1) start of each part within the element's draw window (even spacing or itemAt)
//   naturalMs: number,       // minimum believable draw time = strokes.naturalMs(paths) (pen speed constant)
//   paths: string[],         // SVG path strings in draw order (for retrace/idle); may be empty for pointer highlights
//   paint(ctx2d, u),         // draw the state at normalized progress u ∈ [0,1] on a cleared canvas; u=1 is the final, deterministic image
//   tipAt(u) → {x,y}|null    // pen tip position at progress u (null when nothing is being drawn)
// }
```
`prepare` must be **pure and DOM-free** (Node-testable): all measurement via `shared/handwriting.js`, paths via `shared/strokes.js`, never canvas `measureText`. Only `paint` may touch a 2D context. Also export `boardRectsFor(scenes, upToIndex)` helper in registry.js that builds `boardRects` from slot rects (arrows/highlights have no slot and contribute no rect).

`shared/strokes.js` must provide: `pathLength(d)`, `pointAt(d, fraction)`, `partialPath(d, fraction)` or `drawPartial(ctx2d, d, fraction)`, `rough(seed)` → a wrapper over rough.js's generator producing path strings for `rectangle, line, ellipse, circle, polygon, path, arc` with fixed options (roughness, bowing, strokeWidth from constants) and a deterministic seed, and `naturalMs(paths)` = total length / `PEN_PX_PER_S`.

`shared/handwriting.js`: `loadFont(source)` (Node: file path / Buffer; browser: ArrayBuffer from fetch of `/vendor/fonts/...`), `measure(text, style) → {width, ascent, descent}`, `wrap(text, style, maxWidth) → lines[]`, `glyphPaths(text, style, x, y) → [{char, d, advance}]`. Code style uses the fixed advance. Must produce identical numbers in Node and browser (test: snapshot of measurements, compared from the harness).

`shared/math.js`: `texToSvg(lines, {restricted:true}) → [{svg, width, height, eqX|null}]` where `eqX` is the x of the first `=` for alignment (null when none). Same vendored MathJax code path in Node and browser (node-main / tex-svg component with the identical configuration). Test compares Node output vs browser output on the math fixtures.

### C5. Harness page (for renderer slices' tests): `player/harness.html?lesson=<id>&scene=<sceneId>&u=<0..1>`
Loads the playlist and effective scenes from the API, computes the board at scene start (all scenes since last wipe, u=1) then the named scene at progress `u`, using the registry (fallback for unregistered types). Exposes `window.__khan.harness = { ready: Promise, drawSceneAt(sceneId, u), drawnIds(), boundsOf(id), drawableOf(id), nonBackgroundPixelCount() }`. No audio, no SSE, no controls. This is foundation-owned; slices use it, never edit it.

## Fixtures (committed under `fixtures/`; the server can be pointed at `fixtures/lessons` as a lessons dir for replay/E2E)

Each valid fixture lesson has an `outline.json` with ≥ 3 planned scenes and matching scene files; every scene must pass the validator (a test enforces this for all of them, including the slices' later additions).
- `fx-type-text`, `fx-type-list`, `fx-type-math`, `fx-type-code`, `fx-type-table`, `fx-type-box`, `fx-type-arrow`, `fx-type-highlight`, `fx-type-sketch` (all ten library shapes), `fx-type-diagram`, `fx-type-plot`, `fx-type-svg` — one lesson per type: basic use, every style/option, and **near-cap** variants (max words, max items, max lines, max nodes/edges, 40-shape svg, 3 series, 6×6 table…).
- `fx-build-region`: `wipe` then several `region` scenes building one board, arrows and highlights referencing earlier scenes' elements, explicit `at` and `itemAt`, a second `wipe`.
- `fx-answer-insert`: lesson s001–s004 (`final` on s004) plus `q001-a01` (wipe), `q001-a02` (final) with `insertAfter: s002`, and `q002-a01` (wipe, final) with `insertAfter: q001-a01` (nested depth 2).
- `fx-long-stroke`: last scene whose narration is short (15 words) and whose last element has a very long natural draw time (e.g. 40-word body text + 6×6 table) so audio ends before strokes finish.
- `fx-full-tour`: all twelve types across 8–12 scenes; the QA demo lesson.
- `fixtures/invalid/*.json` with `.expected.json` `{ "codes": ["OVERFLOW"] }` — at least one per error code, and specifically: overflow text; two overlapping slots; element outside region; region intersecting occupancy (needs an occupancy sidecar `.occupancy.json`); arrow to missing id; self-arrow; highlight `line` out of range / on non-code; duplicate id; bad id; 0 and 9 elements; narration 14 and 91 words; narration with `**`, backticks, `- ` bullets; bad color; title 9 words; title in a 1-column slot; list 7 items / 1 item / rowSpan too small / itemAt descending; math `\def`, `\href`, `\input`, `\newcommand`, 6 lines, 61 chars, unbalanced braces; code with a tab, 15 lines, line too long for colSpan; table ragged rows, cell 13 chars, 7 cols; diagram `sequenceDiagram`, `subgraph`, `click`, 9 nodes, 13 edges, slot 1×2, node label 5 words; plot `x; process.exit()`, `constructor.constructor("return 1")()`, `__proto__`, `x.toString`, `Infinity` range, min > max, 4 fns, 51 points; svg with `<script>`, `onload=`, `href`, `xlink:href`, `<image>`, `<foreignObject>`, `<style>`, `<use>`, entity `&xxe;`, 4.1 KB, missing viewBox, circle outside viewBox, 41 shapes, text of 7 words; `lessonId` mismatch; unknown element type; `at` 0.95; `at` decreasing; `wipe` answer rule violated (first answer scene `region`).
- `fixtures/degrade/fx-degrade-flow`: a lesson whose s002 is invalid (one bad element among good ones) for the reject → rewrite → degrade tests (tests supply the rewrite).

## End goal

A builder of any later slice can: clone, `npm install`, `npm test` (green, offline), `npm run test:e2e` (green, offline, Playwright 1.54.x), start `node server/index.js --lessons-dir fixtures/lessons`, open `http://127.0.0.1:7777/lesson/fx-full-tour` and see the shell page with the debug panel listing every scene reaching `ready` under the silent provider; open `/harness/fx-full-tour?scene=s001&u=1` and see fallback rectangles for every element; and run `node --test test/foundation` to see the validator reject every invalid fixture with the expected code.

## Acceptance criteria (qa-tester checks these)

1. `npm test` and `npm run test:e2e` pass offline with no model and no network; `KHAN_TTS=silent` is set by the test setup, not by hand.
2. Every valid fixture scene validates `ok`; every `fixtures/invalid/*.json` fails with exactly the codes in its `.expected.json` (order-insensitive, extra codes allowed only if listed under `"alsoAllowed"`).
3. Validation of any fixture scene takes < 100 ms (test asserts over `fx-full-tour`), and validating the same input twice yields deep-equal results.
4. Property test: 200 randomly generated valid scenes (generator in the test) all pass; the same scenes with one injected fault each (shift a slot to overlap, point an arrow at a missing id, exceed a word cap, move an element outside the region) fail with the matching code.
5. Measurement agreement: `shared/handwriting.js` `measure`/`wrap` snapshot values produced in Node equal those produced in the browser (Playwright test via the harness page) for a fixed list of strings in all four styles.
6. Math agreement: `texToSvg` output for every `fx-type-math` line is identical in Node and browser (string compare after whitespace normalization), and each line has a non-null `eqX` when it contains `=`.
7. Hostile input never executes: the `plot` fixtures containing JS, `__proto__`, `constructor` are rejected with `BAD_EXPR` and a test asserts `shared/expr.js` source contains neither `eval` nor `Function(`; hostile svg fixtures are rejected with `BAD_SVG`; math `\def`/`\href`/`\input` rejected with `BAD_MATH`.
8. Server ingest: copying `fx-build-region` into a temp lessons dir leads to every scene `ready` in order; the SSE stream delivers a `playlist` snapshot on connect and after each change; `GET .../scene/s002` returns the effective scene.
9. Partial writes: writing a scene file in two chunks with a pause (no rename) does not produce a `rejected` entry; the final content is ingested once complete. A `.tmp` file is ignored.
10. Reject → rewrite → degrade: `fx-degrade-flow` s002 produces `rejected` + `control/reject-s002.json` + inbox entry; overwriting with a valid file → `ready`; overwriting instead with another invalid file → `degraded: true`, offending element dropped, narration kept, `notices` carries `droppedElementIds`, the effective scene omits the element; no rewrite for 30 s → degraded as well.
11. `wait`: returns `continue` immediately when fewer than 3 ready scenes are ahead and no final lesson scene exists; blocks and returns `question` within 1 s of a `POST /question`; returns `reject` for an invalid scene; returns `finished` after the last `end` position is posted on a final lesson; `timeout` after the given seconds; `player-closed` after an SSE client disconnects for > 15 s (threshold configurable for the test).
12. Answer scene ordering: `fx-answer-insert` playlist order is `s001, s002, q001-a01, q002-a01, q001-a02, s003, s004`; the first answer scene of a question must be `wipe` (fixture `invalid/answer-not-wipe` → `BAD_BOARD`).
13. Routes reject `lessonId`/`sceneId` not matching §4.1 regexes with 400 (test includes `..%2F`, `../`, `s1`, uppercase); a `POST /question` with `Origin: http://evil.local` → 403; same request with the server's own origin → 200; without `Origin` → 200.
14. No key: with `KHAN_TTS` unset and `OPENAI_API_KEY` unset the server starts, `/api/health` and the playlist report `tts.ready=false` with a reason, and scenes still validate (status stops at `voicing` → then `ready` with `audioUrl:null` and `TTS_FAILED`, per C3) — the lesson never hangs.
15. Silent provider writes a playable WAV whose duration (parsed from the header) equals the 150-wpm estimate ±50 ms; the cache hits on a second ingest of the same text (provider `synthesize` not called — assert via a counting wrapper).
16. Lifecycle: with `KHAN_IDLE_EXIT_MS=2000`, the server process exits ~2 s after `ended` and ~2 s after the only SSE client disconnects; `KHAN_NO_OPEN=1` prevents any browser launch (test asserts the opener is not invoked).
17. Shell and harness pages load with zero console errors in Chromium; `window.__khan.harness.drawnIds()` for `fx-full-tour` s001 lists every element id of that scene; `boundsOf(id)` for fallback drawables equals the slot rect.
18. `node --check` passes for every `.js` file in `player/`, `server/`, `shared/` (script `npm run check`), including the three slice stub `index.js` files and `app.js`.
19. `README.md` documents: layout and ownership table above, all five contracts (C1–C5), how to run tests, the Playwright pin and reason, tuned constants (if any), token names and that values are placeholders.
20. `.khan/` is gitignored; no fixture or test writes outside the temp dir or `.khan/`.

## Required tests (risk-weighted — the validator is where the spec puts the rigor)

Unit (`node --test`, `test/foundation/`):
- `grid`: parseSlot (single, range, reversed range → error, out of bounds), slotRect numbers for all 24 cells and several ranges, span/cells.
- `occupancy`: wipe vs region accumulation, intersection, id tracking.
- `timing`: default spacing (n elements over [0,0.85]); explicit `at`; windows; `itemAt` validation helper.
- `measure`: wrap determinism; words-per-cell caps; overflow detection at the boundary (one word under/over).
- `validate`: one test per error code; the full invalid-fixture sweep (criterion 2); all-valid sweep; performance (criterion 3); determinism; the property test (criterion 4); box containment exception; region exemption for arrows/highlights; cross-scene `BAD_REF` to an id from before a wipe.
- `math`: compiles valid fixtures; rejects each banned macro; 61-char and 6-line caps; `eqX` present.
- `mermaid-subset`: every supported node/edge form; chained edges; caps; each unsupported directive rejected; label word caps.
- `expr`: parse/evaluate table (precedence, unary minus, `^` right-assoc, functions, constants); rejects identifiers other than `x`, member access, semicolons, strings, brackets; sampling finite check; no `eval`/`Function` in source.
- `svg-subset`: accepts every allowlisted tag with legal attributes; rejects every banned tag/attribute individually; size cap at 4096 bytes exactly; viewBox missing; bounds outside for each shape kind (incl. path control points); 41 shapes; text 7 words; nested `g` with transform; a **fuzz test** mutating valid fixture SVGs with 300 random insertions of banned tokens/attributes — every mutant must be rejected or still pass the allowlist (never throw an unexpected error type).
- `strokes`: path length and pointAt against known shapes (a 100 px line, a rect); seeded rough output is identical across two calls and differs for another seed; naturalMs math.
- `handwriting`: measurement snapshots; code fixed advance; wrap breaking rules (never splits a word unless longer than the line, then hard-splits with `OVERFLOW` surfaced by measure).
- `tts/cache` and `tts/silent`: criterion 15; key never written (grep of lesson dir + playlist JSON for a sentinel key value).
- `playlist`: ordering (criterion 12), status transitions, `ended` derivation incl. re-opening on a new question.
- `wait`: criterion 11 against an in-process server (use `startServer` on port 0).
- `http`: criterion 13 (regex guards, Origin), 404s, `Content-Type` of audio.
- `watcher`/`ingest`: criteria 8, 9, 10.
- `lifecycle`: criterion 16 (spawned child process).

E2E (`e2e/foundation-*.spec.js`, Playwright 1.54.x, Chromium):
- Shell page loads for `fx-full-tour`, zero console errors, debug panel shows all scenes `ready`.
- Harness: criterion 17; criteria 5 and 6 (browser vs Node agreement).

Exit gates: all tests green; `npm run check` green; README written; `pipeline-status.md` foundation row set to `done` with a note (commit hash, Playwright pin reason, tuned constants); all committed and pushed.

## Suggested order (commit after each)

1. Scaffolding, vendoring, `layout-core` constants/tokens/grid/occupancy/timing, handwriting + measure, tests. 2. `expr`, `svg-subset`, `mermaid-subset`, `math`, tests. 3. Validator (shape → content → layout), error codes, fixtures (valid + invalid), sweeps and property test. 4. Server: store, watcher, ingest, degrade, playlist, TTS interface + silent + cache, control files, HTTP, SSE, wait, lifecycle, tests. 5. Player shell, registry + fallback, strokes kit, harness, stub entry points, Playwright config and E2E, README, status row.

## Depends on
Nothing. Everything else depends on this.

## Design-asset dependencies
None. Token names are frozen here with placeholder values (pipeline-status row `design-tokens`); no test in this slice depends on final token values. Nothing is gated.

## Rules reminder
3-attempt stop rule (CLAUDE.md); never weaken or delete a failing test to pass. Report honestly what you could not finish; a partially built foundation must be clearly marked `in progress` / `blocked` in `pipeline-status.md`, never `done`.
