# khan — narrated whiteboard lessons from Claude's last response

A Claude Code skill that turns the explanation in Claude's last response into a live, interruptible,
Khan Academy style narrated whiteboard lesson played in a local browser. Claude writes a scene
script; a deterministic renderer draws it as handwriting and rough strokes; a TTS voice narrates it.
Spec: `spec.md` (approved 2026-10-05, authoritative). Slice briefs: `briefs/`. Status: `pipeline-status.md`.

This README is the contract summary for the parallel slices (01–05). The foundation slice (brief 00)
built everything described here.

## Stack

Node >= 20, plain ES modules (`"type": "module"`), **no build step**, no bundler, no CDN. Player is
vanilla JS + rough.js. Rendering libraries are vendored under `vendor/` with their licenses
(`vendor/README.md`): rough.js 4.6.6 (MIT), opentype.js 2.0.0 (MIT), MathJax 3.2.2 (Apache-2.0),
Patrick Hand font (SIL OFL 1.1). `vendor/mathjax/package.json` scopes the CommonJS MathJax bundles
out of the root `type: module`.

## Running

```sh
npm install                       # only dev dependency: @playwright/test 1.54.2 (see pin below)
npm test                          # node --test "test/**/*.test.js"  — offline, no model, no key (silent TTS)
npm run test:e2e                  # playwright test (Chromium) — starts the server itself, silent TTS, temp lessons dir
npm run check                     # node --check every .js under player/, server/, shared/
npm run serve -- --lessons-dir fixtures/lessons   # node server/index.js; then open http://127.0.0.1:7777/lesson/fx-full-tour?debug=1
```

Manual look: start the server on `fixtures/lessons`, open `/lesson/fx-full-tour?debug=1` (the debug
panel lists every scene reaching `ready`) and `/harness/fx-full-tour?scene=s001&u=1` (fallback
rectangles for every element until the renderer slices register drawables).

**Playwright pin.** `@playwright/test` is pinned to **1.54.2** on purpose: Playwright >= 1.62 has no
Chromium build for macOS 13, which this machine runs (lessons.md). Do not "upgrade" it until the OS is.

**Test environment.** Tests set `KHAN_TTS=silent` and `KHAN_NO_OPEN=1` themselves
(`test/foundation/helpers/server.js`, `playwright.config.js`); nothing is set by hand. Every test
writes only under a temp dir. `.khan/` (lessons, cache, config, pidfile) is gitignored.

## Repo layout and ownership (frozen)

```
package.json  README.md  .gitignore  playwright.config.js        foundation (slice 05 may add "bin" to package.json)
server/                                                          FOUNDATION ONLY — slice 01 adds exactly server/tts/openai.js (+ mp3-duration.js)
  index.js lesson-store.js watcher.js ingest.js playlist.js control.js wait.js http.js sse.js lifecycle.js
  tts/index.js tts/silent.js tts/cache.js
shared/                                                          FOUNDATION ONLY; environment-agnostic ESM, served at /shared/
  layout-core/{constants,tokens,grid,occupancy,timing,measure,index}.js
  schema/{errors,shape,content,layout,validate}.js
  handwriting.js math.js mermaid-subset.js expr.js svg-subset.js strokes.js
player/                                                          shell = FOUNDATION ONLY
  index.html app.js tokens.css registry.js harness.html harness.js harness-track.js
  renderer/core/index.js  core.css                               SLICE 02 owns renderer/core/**
  renderer/pictures/index.js  pictures.css                       SLICE 03 owns renderer/pictures/** (may add vendor/dagre)
  engine/index.js  engine.css                                    SLICE 04 owns engine/**
vendor/                                                          rough/ opentype/ mathjax/ fonts/ (+ LICENSE each)
fixtures/lessons/<lessonId>/   valid lessons; slices add theirs under fx-core-*, fx-pic-*, fx-eng-*, fx-cli-*
fixtures/invalid/<name>.json + <name>.expected.json (+ <name>.occupancy.json)
fixtures/degrade/fx-degrade-flow/
test/foundation/**             foundation unit tests (slices use test/<slice>/); helpers in test/foundation/helpers/
e2e/foundation-*.spec.js       foundation Playwright tests (slices use e2e/<slice>-*.spec.js)
.claude/skills/khan/  bin/  cli/                                 SLICE 05
```

Slices never edit `player/index.html`, `player/app.js`, `player/registry.js`, `player/harness*.js`,
`shared/**`, `server/**` (except slice 01's new files), `package.json` (except slice 05's `bin`) or
`playwright.config.js`. `app.js` already imports the three slice entry points and `index.html`
already links `engine.css`, `core.css`, `pictures.css`. Test hooks live only under a slice's own
namespace: `window.__khan.engine`, `.rendererCore`, `.rendererPictures`; the foundation owns
`window.__khan.harness` and creates `window.__khan = {}` plus `lessonId`, `tokens`, `constants`,
`registry`, `boardRectsFor`. A gap in a shared module is reported, never patched in place.

## C1. Scene-script contract (`khan-scene/1`, `khan-outline/1`) — spec §4

Exactly spec §4.1–§4.4. All caps live in **`shared/layout-core/constants.js`** (the one constants
file) and both the validator and the drawables import it. Token names live in
`shared/layout-core/tokens.js`.

**Grid.** Canvas 1600×900, margin 50 → inner 1500×800; columns A–F (250 px), rows 1–4 (200 px).
`slotRect("B2:D3") = {x:300, y:250, w:750, h:400}`. Content inset `SLOT_PAD = 12` px is applied
uniformly by measurement (`measure.js`) and must be by drawables (`grid.rectInset`,
`grid.slotInnerRect`).

**Fonts.** `title` 44 / `body` 28 / `note` 22 / `code` 20 px; line heights 54 / 36 / 28 / 24.
`code` uses a fixed per-character advance `CODE_CHAR_ADVANCE = 10` px. One font: Patrick Hand
(`tokens.fontHand`, file `tokens.fontHandFile`), loaded through `shared/handwriting.js`.

**Colors.** Element `color` accepts exactly `COLOR_TOKENS = accent1 … accent5, muted`. Also defined
(not element-selectable): `chalk` (default stroke/text), `boardBg`, chrome tokens `pageBg`,
`panelBg`, `panelText`, `panelMuted`. **Names are frozen; values are placeholders** until a design
pass (pipeline-status row `design-tokens`). `player/tokens.css` mirrors them as `--khan-*` custom
properties and `app.js`/`harness.js` write the JS values onto `:root` at load (JS is the source of
truth). Never hard-code a color; read `tokens`.

**Timing (`layout-core/timing.js`).** `at ∈ [0, 0.9]`. Omitted `at` values: `0.85 · i / n` in list
order (an omitted run between two anchors is spread evenly between them). Explicit values must be
non-decreasing (`BAD_AT`). Window = own `at` → next element's `at` (0.95 for the last). List
`itemAt[]` must be strictly ascending and inside the window; `partStarts(count, window, itemAt)`
gives normalized part starts.

**Validator (`shared/schema/validate.js`).**
```js
await validateScene(scene, occupancySet, { lessonId })
  → { ok, errors: [{elementId|null, code, message}], occupancy: newOccupancySet, effective: scene|null, artifacts }
await prepareValidator()            // loads the font and warms MathJax once (then < 100 ms per scene)
validateSceneText(text, occ, opts)  // JSON.parse first → BAD_JSON
validateOutline(outline, { lessonId }) → { ok, errors }
dropElements(scene, ids)            // used by the degrade path
```
`validateScene` is async because MathJax initialises lazily; after `prepareValidator()` it is
synchronous-fast. Pipeline: shape → content → layout; an element failing an earlier stage is
skipped later (one fault → one code). Occupancy (`layout-core/occupancy.js`) is
`{cells: Set<"B2">, elements: Map<id, {type, slot?, lineCount?}>}` with `toJSON/fromJSON`;
after a `wipe` it holds that scene only, after a `region` the union. When `ok` is false the input
occupancy is returned unchanged.

Stable codes (`shared/schema/errors.js`): `BAD_JSON BAD_SCHEMA MISSING_FIELD BAD_FIELD BAD_LESSON_ID
BAD_SCENE_ID BAD_ID DUP_ID BAD_ENUM BAD_BOARD BAD_NARRATION CAP_COUNT CAP_WORDS CAP_CHARS CAP_LINES
BAD_AT BAD_SLOT SLOT_TOO_SMALL OVERFLOW OVERLAP OUT_OF_REGION REGION_OCCUPIED BAD_REF SELF_REF
BAD_LINE BAD_MATH BAD_MERMAID BAD_EXPR BAD_SVG TTS_FAILED` (the last is a playlist status, not a
validation code). Content problems always use their `BAD_*` code (e.g. a 9-node diagram is
`BAD_MERMAID`, a 41-shape svg `BAD_SVG`); shape caps use `CAP_*`; invalid ranges/fields `BAD_FIELD`.

Rules made concrete: region `slots` must not intersect occupancy (`REGION_OCCUPIED`, scene-level);
every slotted element of a region scene must lie inside `slots` (`OUT_OF_REGION`); arrows and
highlights are exempt from containment but `from/to/target` must resolve to a **slotted** element
in occupancy ∪ *earlier* elements of this scene (`BAD_REF`; `from === to` → `SELF_REF`);
`highlight.line` only on a `code` target and within its lines (`BAD_LINE`); an id may not repeat
since the last wipe (`DUP_ID`); elements whose slot is entirely inside a `box`'s slot do not overlap
it, everything else that shares a cell is `OVERLAP` (reported on the later element); `text` words
≤ min(10 × cells, 40) (`CAP_WORDS`), titles ≤ 8 words and colSpan ≥ 2 (`SLOT_TOO_SMALL`); fit is
measured (`OVERFLOW`) with `layout-core/measure.js`: text/list wrap at body/note sizes, code uses
the fixed advance (22 chars × colSpan, 7 lines × rowSpan → `CAP_CHARS`/`CAP_LINES`), tables use
equal column widths with note-size cells wrapped to ≤ 2 lines, math uses the compiled SVG size at
`MATH_LAYOUT.fontPx = 28`. The first answer scene (`qNNN-a01`) must be a `wipe` (`BAD_BOARD`).

Subset grammars (shared by validator and renderers):
- `shared/math.js` — `await texToSvg(lines, {restricted:true}) → [{svg, width, height, eqX|null, viewBox}]`;
  `width/height` in em (viewBox units / 1000), `eqX` = x (em) of the centre of the first top-level `=`.
  Vendored MathJax 3 with packages `base, ams` only, `fontCache: 'none'` (inline glyph paths),
  `formatError` throws → `MathError` (`BAD_MATH`). Banned before compile (`BANNED_MACROS`): `\def`,
  `\newcommand`, `\renewcommand`, `\let`, `\input`, `\include`, `\href`, `\url`, `\require`,
  `\unicode`, `\usepackage`, … Output is canonicalized (`normalizeSvg`: attributes sorted,
  inter-tag whitespace removed, `aria-hidden` dropped) so Node (`es5/node-main.js`) and browser
  (`es5/tex-svg.js`) strings compare equal. `checkMathCaps(lines)` gives the shape-level caps.
- `shared/mermaid-subset.js` — `parse(src) → {direction:'TD'|'LR', nodes:[{id,label,shape}], edges:[{from,to,label,style}]}`;
  `parseStrict` adds caps. Shapes: `rect` `id[l]`, `round` `id(l)`, `stadium` `id([l])`, `diamond`
  `id{l}`, `circle` `id((l))`; edge styles `arrow -->`, `line ---`, `dotted -.->`, `thick ==>`, with
  `|label|` or inline `-- label -->` / `-. label .->` / `== label ==>`; chains; `;`/newline
  separators; `%%` comments. Self-loops, subgraphs, classDef/class/click/style/linkStyle and every
  other diagram type → `MermaidError` (`BAD_MERMAID`). No Mermaid runtime is vendored; slice 03 lays
  out the AST itself (optionally with dagre).
- `shared/expr.js` — `parse(src) → AST`, `evaluate(ast, x)`, `sample(ast, xRange, n)`, `check(src, xRange)`.
  Grammar: numbers, `x`, `+ - * / ^` (right-assoc), unary minus, parentheses, `sin cos tan exp log ln
  sqrt abs min max floor ceil`, `pi e`. `log` is base 10, `ln` natural. No implicit multiplication.
  No `eval`/`Function` (a test greps the source). The validator samples 50 points over `xRange`
  (default `[-10, 10]`) and needs ≥ 2 finite values.
- `shared/svg-subset.js` — `parse(svgText) → {viewBox:{x,y,w,h}, shapes:[{tag, attrs, children?, text?}], shapeCount, bytes}`.
  Strict tokenizer (never DOMParser). Tags `svg g path line circle ellipse rect polyline polygon
  text`; attributes `d x y x1 y1 x2 y2 cx cy r rx ry width height points viewBox transform stroke
  stroke-width fill font-size text-anchor` (+ `xmlns` on the root); `transform` only
  `translate/scale/rotate`; `fill`/`stroke` a color token, `chalk` or `none`; ≤ 4096 bytes, ≤ 40
  shapes, `text` ≤ 6 words, every shape (incl. path control points, after transforms) inside the
  viewBox. Anything else (`href`, `xlink:*`, `on*`, `style`, `class`, `id`, `script`,
  `foreignObject`, `image`, `use`, entities other than the five XML ones, comments, DOCTYPE, CDATA,
  PIs, namespace prefixes, `matrix(...)`) → `SvgError` (`BAD_SVG`). `applyTransforms(ops, [x,y])`
  is exported for renderers.

Foundation-chosen constants (not spec caps; see `constants.js`): `SLOT_PAD 12`, `CODE_CHAR_ADVANCE
10`, line heights above, `PEN_PX_PER_S 1500`, `ROUGH_OPTIONS {roughness 1.2, bowing 1, strokeWidth
2.5}`, `LIST_LAYOUT {bulletIndent 34, itemGap 6}`, `TABLE_LAYOUT {cellPad 6, style note, maxCellLines
2}`, `MATH_LAYOUT {fontPx 28, lineGap 10}`. **No spec cap value was tuned.**

## C2. Lesson folder — spec §4.1

Root `.khan/lessons/` (override `--lessons-dir` / `KHAN_LESSONS_DIR`; tests use a temp dir). Per lesson:
`outline.json`, `scenes/<sceneId>.json` (producer, atomic write: `.tmp` then rename),
`audio/<sceneId>.<ext>` (server; `silent` writes a real PCM-16 mono 8 kHz WAV, duration = words / 150
wpm, min 1.5 s), `control/inbox.json`, `control/question-<qId>.json`, `control/reject-<sceneId>.json`
(server), `state/playlist.json` (server, debug/replay). The watcher ignores `*.tmp` and any file
whose name is not `<sceneId>.json`; it ingests a file once its size and mtime have been stable
(default 250 ms, `KHAN_WATCH_STABLE_MS`) **and** it parses as JSON, retrying an unparsable file for
10 s before reporting `BAD_JSON` — so a file written in two chunks is never rejected. Poll interval
300 ms (`KHAN_WATCH_INTERVAL_MS`); `fs.watch` only triggers an early scan.

`control/inbox.json` (`khan-inbox/1`, the ONE file the producer reads):
```json
{ "schema": "khan-inbox/1", "lessonId": "...", "updatedAt": "ISO",
  "pending": [ {"kind":"question","qId":"q001","text":"...","atSceneId":"s004","atTime":12.3,"createdAt":"ISO"},
               {"kind":"reject","sceneId":"s003","attempt":1,"errors":[{"elementId":"t1","code":"OVERFLOW","message":"..."}]} ],
  "notices": [ {"kind":"degraded","sceneId":"s003","droppedElementIds":["t1"]} ],
  "player": {"connected": true, "position": {"sceneId":"s002","event":"end"}},
  "buffer": {"readyAhead": 2},
  "tts": {"provider":"silent","voice":null,"ready":true,"reason":null},
  "producerLastWriteAt": "ISO|null" }
```
A `question` entry is cleared when a scene with that `questionId` is ingested; a `reject` entry is
cleared when that `sceneId` is rewritten or degraded. The inbox is rewritten (atomically) on every
state change; readers should tolerate a momentarily stale file.

**Degrade semantics (spec §5).** First invalid ingest of a `sceneId` → `rejected` +
`control/reject-<sceneId>.json` + inbox entry. A rewrite (same file overwritten) re-validates; if
invalid again → **degrade**: drop every element with an element-level error, re-validate (≤ 8
passes, dropping cascades such as an arrow whose target vanished), keep the narration, set
`degraded: true`, record `droppedElementIds`, add a `degraded` notice. If scene-level errors remain
(narration, board, region intersect) → **narration-only**: `elements: []`, board kept if valid,
otherwise `{mode:"region", slots:<first free cell, or "A1" when none>}` — never a wipe as a side
effect. If no rewrite arrives within **30 s** (`KHAN_REJECT_GRACE_MS`) the first attempt is degraded
the same way, so the lesson never stalls. Status then runs `degraded → voicing → ready` and
`degraded: true` stays on the entry.

Occupancy chain: lesson scenes are validated in number order, each against the effective occupancy
left by the previous one; a question's answer scenes form their own track starting from `a01`
(a wipe). Rewriting an earlier scene re-validates the later scenes on its track whose input
occupancy changed.

## C3. HTTP + SSE API — host `127.0.0.1`, default port 7777

| Route | Behaviour |
|---|---|
| `GET /lesson/:lessonId` | `player/index.html` (`?debug=1` shows the debug panel) |
| `GET /harness/:lessonId?scene=&u=` | `player/harness.html` |
| `GET /player/* /shared/* /vendor/*` | static files (correct `Content-Type`, path traversal blocked) |
| `GET /api/lesson/:id/outline` | outline.json (404 if absent) |
| `GET /api/lesson/:id/playlist` | playlist snapshot (below) |
| `GET /api/lesson/:id/scene/:sceneId` | the **effective** scene (degraded scenes have offending elements removed); 404 until validated/degraded |
| `GET /api/lesson/:id/audio/:sceneId` | audio file with its `Content-Type` (`audio/wav` for silent); 404 if none |
| `GET /api/lesson/:id/events` | SSE: `playlist` (full snapshot on connect and on every change), `heartbeat` every 15 s; snapshot-only |
| `POST /api/lesson/:id/position` `{sceneId, event:"start"\|"end", t?}` | 204; drives `buffer.readyAhead` and `ended` |
| `POST /api/lesson/:id/question` `{text, atSceneId, atTime}` | `{qId}`; text 1–500 chars; ids `q001, q002…` |
| `GET /api/lesson/:id/wait?timeout=<s>` | long-poll, one JSON object (semantics below) |
| `GET /api/lesson/:id/status` | `{lessonId, title, tts, producer:{lastWriteAt, lastWriteAgeMs}, counts:{planned, scenes, ready, degraded, rejected, answerScenes, questions, svgElements}, buffer:{readyAhead}, player:{connected, position}, ended}` |
| `GET /api/health` | `{ok:true, port, host, lessonsDir, tts}` |

Every `:lessonId` / `:sceneId` is checked against the §4.1 regexes before anything else (400
otherwise). A request carrying an `Origin` header other than `http://127.0.0.1:<port>` or
`http://localhost:<port>` → 403; requests without `Origin` (curl, CLI) are allowed. Bodies ≤ 64 KB.

Playlist snapshot:
```json
{ "lessonId":"...", "title":"...", "ended":false,
  "tts":{"provider":"silent","voice":null,"ready":true,"reason":null},
  "producer":{"lastWriteAt":"ISO|null","lastWriteAgeMs":1234},
  "outline":{ ...outline.json... },
  "entries":[ {"sceneId":"s001","kind":"lesson|answer","position":0,"status":"pending|validating|voicing|ready|rejected|degraded",
               "title":"...","board":{"mode":"wipe"},"final":false,"questionId":null,"insertAfter":null,
               "audioUrl":"/api/lesson/<id>/audio/s001|null","durationMs":12000,"degraded":false,"droppedElementIds":[],"errors":[]} ],
  "questions":[ {"qId":"q001","text":"...","atSceneId":"s004","atTime":12.3,"createdAt":"ISO","answeredBy":["q001-a01"],"complete":false} ],
  "buffer":{"readyAhead":2}, "player":{"connected":true,"position":{"sceneId":"s002","event":"end"}} }
```
Statuses: `pending → validating → voicing → ready`, or `validating → rejected`, or
`validating → degraded → voicing → ready`. **TTS failure** (provider not ready, or `synthesize`
rejects): the entry becomes `ready` with `audioUrl: null`, `durationMs` = 150-wpm estimate and
`errors += {code:"TTS_FAILED"}`; the player skips it with a visible note (slice 04).

Ordering (spec §4.1): lesson scenes by number; each question's answer scenes immediately after their
`insertAfter` scene, grouped by `qId` in `a` order, nested answers after the answer scene they
interrupt, later questions on the same `insertAfter` after earlier ones. For `fx-answer-insert`:
`s001, s002, q001-a01, q002-a01, q001-a02, s003, s004`. `ended` = the player posted `end` for the
last playlist entry AND the last lesson scene present has `final: true` AND every question has a
`final` answer scene present; a new question sets `ended = false`.

`wait` semantics: on each call, in order — (1) an undelivered inbox entry → `{"event":"question",…}`
/ `{"event":"reject",…}` (oldest first, marked delivered); (2) `ended` → `{"event":"finished",
"summary":{…counts}}`; (3) the player had an SSE client and none for > 15 s
(`KHAN_PLAYER_CLOSED_MS`) → `{"event":"player-closed"}`; (4) no `final` lesson scene yet and
`readyAhead < 3` → `{"event":"continue","readyAhead":n}` immediately; (5) otherwise block until one
of (1)–(4) or `timeout` seconds → `{"event":"timeout"}`. `readyAhead` = ready entries after the
player's last `start` (all ready entries before any start). Every response carries `notices`
(degradations), cleared once sent.

Lifecycle: the server opens the browser at `/lesson/<id>` when a new `outline.json` appears (macOS
`open`, else `xdg-open`; suppressed by `KHAN_NO_OPEN=1`). It exits 10 min after `ended`, or 10 min
after the last SSE client disconnected (if any ever connected); `KHAN_IDLE_EXIT_MS` overrides. On
startup it ingests every lesson folder already present (that is how `khan play` replays; audio comes
from the cache). `startServer({port, host, lessonsDir, cacheDir, env, config, opener, exitOnIdle,
idleExitMs}) → {port, host, url, lessonsDir, cacheDir, tts, store, ingest, lifecycle, provider,
cache, wait, close()}`; `node server/index.js --port N --lessons-dir D [--cache-dir C] [--host H]`
prints one JSON line `{"ok":true,"port":…,"url":…,"lessonsDir":…,"tts":{…}}` on start.

**TTS provider interface (`server/tts/index.js`).**
`await selectProvider(env, config)`: `KHAN_TTS=silent` → silent; otherwise `openai`, which the
foundation resolves by `import('./openai.js')` (slice 01). That module must export
`createOpenAIProvider({ apiKey, voice, env }) → provider`, whose `ready()` returns
`{ok:false, reason:"OPENAI_API_KEY not set"}` without a key. Until the file exists a stub with the
same `ready()` semantics is returned, so the server always starts and `tts.ready=false` with a
reason is carried by health/playlist/status/inbox. Provider shape:
`{ name, voice, ready() → {ok, reason}, synthesize({text}) → Promise<{bytes:Uint8Array, mime, ext, durationMs}> }`.
Voice: `KHAN_TTS_VOICE` > `.khan/config.json` `{ "tts": {"voice": "..."}, "port": 7777 }` > provider
default (`null`). Cache (`server/tts/cache.js`): `<cacheDir>/<sha256(provider|voice|text)>.<ext>` +
`.json` sidecar `{durationMs, mime, ext, provider, voice}`; a hit never calls `synthesize`;
concurrent identical requests share one call; `audio/<sceneId>.<ext>` is a copy. Cache dir
`.khan/cache/tts` (`KHAN_CACHE_DIR` / `--cache-dir`). Secrets only from env; the key is never
written to the lesson folder, cache or any response (tested with a sentinel).

Environment variables: `KHAN_TTS`, `KHAN_TTS_VOICE`, `OPENAI_API_KEY`, `KHAN_PORT`, `KHAN_HOST`,
`KHAN_LESSONS_DIR`, `KHAN_CACHE_DIR`, `KHAN_NO_OPEN`, `KHAN_IDLE_EXIT_MS`, `KHAN_REJECT_GRACE_MS`,
`KHAN_PLAYER_CLOSED_MS`, `KHAN_WATCH_INTERVAL_MS`, `KHAN_WATCH_STABLE_MS`.

## C4. Drawable interface — `player/registry.js`

```js
import { registry, boardRectsFor, makeDrawCtx } from '/player/registry.js';
registry.register(type, prepare)   // prepare(element, ctx) → Drawable ; slices 02/03 call this at import time
registry.get(type)                 // → prepare fn or registry.fallback (dashed slot rect + "id · type" label)
registry.has(type); registry.types()
boardRectsFor(scenes, upToIndex)   // Map<elementId, Rect> of every slotted element since the last wipe (arrows/highlights contribute none)
makeDrawCtx(scenes, index, {font, tokens}) // convenience: a ctx for scene `index`
// ctx = { slotRect(slot) → Rect, boardRects: Map<id, Rect>, elementsById: Map<id, element>, tokens, constants, font, seed(elementId) }
// Drawable = { id, type, bounds: Rect (slotted: inside slotRect(slot)), parts ≥ 1, partStarts: number[] in [0,1),
//              naturalMs = strokes.naturalMs(paths), paths: string[] (draw order; may be empty for pointer highlights),
//              paint(ctx2d, u) (u ∈ [0,1]; u = 1 final and deterministic), tipAt(u) → {x,y}|null }
```
`prepare` must be pure and DOM-free (Node-testable): measurement via `shared/handwriting.js`
(`measure`, `wrap`, `glyphPaths(text, style, x, y) → [{char, d, advance, x}]`), paths via
`shared/strokes.js`, never canvas `measureText`. Only `paint` touches a 2D context.

`shared/strokes.js`: `parsePath(d)`, `pathPoints(d)`, `pathBounds(d)`, `flatten(d)`, `pathLength(d)`,
`pointAt(d, fraction)`, `partialPath(d, fraction)`, `drawPartial(ctx2d, d, fraction)`,
`seedFor(elementId)`, `rough(seedOrId) → { rectangle, line, ellipse, circle, polygon, linearPath,
curve, path, arc }` (each returns SVG path strings; pass `{fill: token}` to append hachure paths;
fixed `ROUGH_OPTIONS`; deterministic per seed), `naturalMs(paths)` = total length / `PEN_PX_PER_S` ms.
Curves are flattened with a fixed 12-step subdivision; arcs are converted to cubics.

`shared/handwriting.js`: `await loadFont(source?)` (Node: path/Buffer, default = the vendored
file; browser: URL via fetch — `tokens.fontHandFile` — or an ArrayBuffer), `loadFontFromBytes`,
`measure(text, style) → {width, ascent, descent, lineHeight}`, `wrap(text, style, maxWidth)`,
`wrapDetailed(...) → {lines, hardSplit}`, `glyphPaths(...)`, `textWidth`. One glyph per character
(no ligatures), kerning on, widths rounded to 1/1000 px — identical numbers in Node and the browser
(E2E-verified against `test/foundation/fixtures/measurement-snapshot.json`).

## C5. Harness page — `player/harness.html?scene=<sceneId>&u=<0..1>` (served at `/harness/<lessonId>`)

Loads the playlist and effective scenes from the API, draws the board at the start of the named
scene (every scene since the last wipe on its track at u = 1) then the named scene at progress `u`
through the registry (fallback for unregistered types). No audio, no SSE, no controls.
`window.__khan.harness = { ready: Promise, drawSceneAt(sceneId, u), drawnIds(), boundsOf(id),
drawableOf(id), nonBackgroundPixelCount(), modules: {handwriting, math, layoutCore, strokes, registry} }`.
Lesson scenes draw on the lesson track, answer scenes on their question's track
(`player/harness-track.js`). Foundation-owned; slices use it, never edit it.

## Fixtures

`fixtures/lessons/`: `fx-type-{text,list,math,code,table,box,arrow,highlight,sketch,diagram,plot,svg}`
(basic use, every option, near-cap variants), `fx-build-region` (wipe + region build-up with
cross-scene references, explicit `at`/`itemAt`, second wipe), `fx-answer-insert` (nested answers,
depth 2), `fx-long-stroke` (15-word narration + 40-word text + 6×6 table), `fx-full-tour` (all
twelve types in 10 scenes — the QA demo). `fixtures/invalid/`: 100 single-scene cases with
`.expected.json` `{codes, alsoAllowed?}` (+ `.occupancy.json` sidecars) — at least one per code.
`fixtures/degrade/fx-degrade-flow`: s002 has one bad element among good ones. The sweep tests in
`test/foundation/validate.test.js` and `registry.test.js` cover every fixture lesson present,
including ones later slices add (`fx-core-*`, `fx-pic-*`, `fx-eng-*`, `fx-cli-*`). Test helpers:
`test/foundation/helpers/fixtures.js` (`listFixtureLessons`, `validateLesson`, …) and
`helpers/server.js` (`startTestServer`, `openSse`).

## TTS — OpenAI provider (slice 01, `server/tts/openai.js`)

The only user-facing voice is OpenAI speech synthesis; `silent` exists for tests (`KHAN_TTS=silent`).
`selectProvider` picks `openai` whenever `KHAN_TTS` is not `silent`.

**Defaults.** Model `tts-1` (`DEFAULT_MODEL`), voice `alloy` (`DEFAULT_VOICE`). Request:
`POST https://api.openai.com/v1/audio/speech` with `Authorization: Bearer $OPENAI_API_KEY` and JSON
`{model, voice, input, response_format: "mp3"}`; 20 s timeout per attempt; up to 3 attempts on
network errors / 408 / 429 / 5xx with 1 s then 3 s backoff. 401/403 fail at once with
`code: "TTS_AUTH"`, other 4xx with `"TTS_BAD_REQUEST"`, a non-audio or empty or undecodable body
with `"TTS_BAD_RESPONSE"`; after the last retry the rejection carries `code: "TTS_FAILED"` and
`cause`. The foundation then marks the scene `ready` with `audioUrl: null` and a `TTS_FAILED` entry
in `errors` (brief 00 C3), so a voice outage never stalls a lesson.

**Changing the voice.** Precedence (same order as the foundation): `KHAN_TTS_VOICE` env >
`.khan/config.json` `{ "tts": { "voice": "nova" } }` > default `alloy`. The model follows the same
pattern: `KHAN_TTS_MODEL` > `tts.model` in the config > `tts-1` (e.g. `tts-1-hd`). The provider
exposes the voice it actually sends (`tts.voice` in health/playlist/status/inbox is never `null`
for `openai`), and the audio cache key is `sha256(provider|voice|text)`: changing the voice
re-voices every scene on its next ingest, the old voice's files stay in `.khan/cache/tts/`, and
switching back is a pure cache hit with zero requests. Pick the voice by listening during QA —
nothing else needs to change.

**Duration.** `durationMs` is measured from the returned MP3 bytes by `server/tts/mp3-duration.js`
(ID3v2/ID3v1 skipped, MPEG 1/2/2.5 layers I–III, CBR and VBR, Xing/Info frame count, LAME gapless
delay+padding trimmed, truncated final frame ignored; garbage → `Mp3Error` `BAD_MP3`). No ffmpeg.
Fixtures: `fixtures/audio/short.mp3` (CBR) and `short-vbr.mp3` (Xing VBR), both 2011.43 ms —
provenance and the independent `afinfo` check are in `fixtures/audio/LICENSE.md`.

**Key hygiene.** The key is read from `env.OPENAI_API_KEY` at call time inside a closure — it is not
a property of the provider (`JSON.stringify(provider)` never contains it), it is never logged
(logs carry provider, voice, model, text length, duration, bytes, attempt count), and any echo of
the key in an OpenAI error body is redacted (`[redacted]`) before the message reaches the playlist.
With no key the server still starts; `ready()` is `{ok:false, reason:"OPENAI_API_KEY not set"}`
and every scene becomes `ready` with `audioUrl: null` and no network call is made.

**Logging and test knobs.** `KHAN_TTS_LOG=1` prints one `[khan tts] …` line per attempt/result to
stderr. `KHAN_TTS_TIMEOUT_MS` and `KHAN_TTS_BACKOFF_MS="1000,3000"` override the timing (used by
the integration tests, which inject zero delays through the foundation's `selectProvider`).
Tests: `test/tts/` — unit (recording `fetch` mock), `mp3-duration`, integration against the
in-process server with a sentinel key, and a live smoke test skipped unless `KHAN_LIVE_TTS=1`:
`KHAN_LIVE_TTS=1 OPENAI_API_KEY=sk-… node --test test/tts/live.test.js`.
