# Spec — khan

Approved 2026-10-05. Repo: https://github.com/sanjivp2703/khan-whiteboard-agent (this folder is its working copy).

A Claude Code skill that turns the explanation in Claude's last response into a live, interruptible, Khan Academy style narrated whiteboard lesson, played in a local browser. Claude writes a scene script; a deterministic renderer draws it as handwriting and rough strokes; an OpenAI TTS voice narrates it. The user can pause, rewind, and ask typed questions mid-lesson.

Responds to research/01-problems.md: long answers vanish from the terminal (A1–A4); copying out is painful (B6–B7); AI explainer videos fail on layout and correctness (E17–E18); chatty or robotic narration tires technical listeners (E20–E21); passive reading retains poorly (C10).

## 1. What it does

1. **Trigger.** `/khan` (skill at `.claude/skills/khan/SKILL.md`), or natural language matching the skill description ("khan, explain this", "whiteboard this", "turn this into a video"). No argument = explain the last response. Free-text argument = scope/focus and optional audience or length hints ("just the caching part, for a junior, short").
2. **Produce.** Inside the Claude Code session, the skill makes Claude (a) start the local server if not running, (b) write `outline.json`, then (c) write one scene file at a time into the lesson folder, in order, grounded only in the response being explained.
3. **Serve.** A local Node server watches the lesson folder, validates each scene (shape, then layout), synthesizes narration audio for it, measures the audio duration, and publishes it to the player over SSE. Rejected scenes are reported back to the producer for one rewrite; if still invalid they are played degraded (narration kept, offending elements dropped).
4. **Play.** The browser player draws each scene progressively — text as handwriting revealed stroke by stroke, shapes via rough.js — timed to that scene's audio. Playback starts as soon as scene 1 is ready; later scenes are produced while earlier ones play. If the buffer runs dry, the pen idles and narration rests on a natural beat; it reads as thinking, not buffering.
5. **Interact.** Pause/resume; rewind to any earlier scene (or skip to a ready later one); ask a typed question at any time. On a question, khan stops, visibly thinks, plays one or more inserted answer scenes on a fresh board, then restores the interrupted board and resumes exactly where it stopped.
6. **Replay.** Any finished lesson folder can be replayed later without Claude (`khan play <lessonId>`). This is also how the server and player are tested: fixture lesson folders, the `silent` provider, no model, no network.

## 2. What it explicitly does NOT do

- No mp4 / video file export (later slice).
- No `UserPromptSubmit` hook trigger (held in reserve). No `@agent-khan` subagent (rejected: fresh context cannot see the response).
- No generative video, no image generation, no Manim, no recording of a real GUI, no model training or fine-tuning.
- No image generation traced into strokes. It is compatible with the `svg`-in-a-slot contract and may be added later as another producer, but is not built here.
- No scrolling board; the board is one fixed 1600×900 canvas, wiped or built up by region.
- No pasted photos, screenshots, or maps. No freehand paths or free-form drawing primitives; the vocabulary is exactly the twelve element types in §4.4.
- No speech input. Questions are typed. Speech is output only.
- No `say` or other local TTS for users; an OpenAI key is required. A `silent` provider exists for tests only.
- No direct Claude API calls from the server (option 2 is the fallback producer; this spec keeps the contract producer-agnostic but does not build option 2).
- No multi-user, remote access, accounts, or cloud storage. Local machine only.
- No word-level audio alignment; element timing is fractional per scene.

## 3. Architecture and ownership (read this first, orchestrator)

Three processes, one shared contract:

| Component | Runs where | Owns |
|---|---|---|
| **Producer** (skill, Claude in-session) | Claude Code | Writing `outline.json` and `scenes/*.json`; reading `control/inbox.json`; answering questions with inserted scenes. Knows nothing about audio or the player. |
| **Server** (Node) | local process | Lesson folder watching; scene shape + layout validation (single owner, see §5); TTS; playlist and per-scene status; `control/` files; question ids; producer liveness; static player; SSE + REST. |
| **Player** (browser) | local tab | Playback position (sceneId, t), state machine (§6), resume stack (§7), rendering, all user controls. Reports position to the server at scene boundaries only. |

**Shared (foundation, built first):** the scene-script JSON schema and validator; `layout-core` (grid constants, font metrics, text wrapping and measuring, caps, sketch library enum, color tokens) used by BOTH the validator (server) and the renderer (player) so "validator says fits" implies "renderer fits"; the lesson folder layout; fixture lessons covering every element type; the server skeleton (watch → validate → playlist → SSE) with the `silent` TTS provider. **Independent after foundation:** OpenAI TTS provider; renderer (handwriting strokes, rough.js shapes, math/diagram/plot/svg rendering, idle/thinking animations — expected to be its own slice or two, orchestrator decides); player controls and question UI; the skill (`SKILL.md`, `khan` CLI with `serve`, `wait`, `play`, `scene`).

Stack (decided): Node >= 20, plain ES modules, player is vanilla JS + rough.js, no build step. Rendering libraries (handwriting font + path extraction, MathJax SVG output, Mermaid with hand-drawn look) are vendored locally; no CDN.

## 4. Scene-script contract (frozen interface, `khan-scene/1`)

### 4.1 Lesson folder

```
.khan/lessons/<lessonId>/          inside the repo working copy, gitignored
  outline.json                     producer → server, written first
  scenes/<sceneId>.json            producer → server, one file per scene, atomic write (write .tmp, rename)
  audio/<sceneId>.mp3              server-owned, generated
  control/inbox.json               server → producer; the ONE file the producer reads
  control/question-<qId>.json      server → producer; also mirrored in inbox
  control/reject-<sceneId>.json    server → producer; also mirrored in inbox
  state/playlist.json              server-owned, for debugging/replay only
```

`lessonId`: `^[a-z0-9-]{8,64}$`, e.g. `20261005-142207-caching`. `sceneId`: lesson scene `^s\d{3}$` (`s001`…); answer scene `^q\d{3}-a\d{2}$` (`q001-a01`…). File name = `<sceneId>.json`. Ordering rule (server-owned playlist): lesson scenes by number; answer scenes placed immediately after their `insertAfter` scene, grouped by `qId`, in `a` order; later questions on the same `insertAfter` go after earlier ones.

Swapping the producer (option 2 program) changes only who writes these files. Server and player never know who the producer is.

### 4.2 outline.json

```json
{
  "schema": "khan-outline/1",
  "lessonId": "20261005-142207-caching",
  "title": "How the response cache works",
  "audience": "working developer",            // optional free text
  "focus": "just the caching part",           // optional, echo of the argument
  "scenes": [ { "sceneId": "s001", "title": "The problem", "goal": "one sentence" } ],
  "producer": { "kind": "claude-code-skill", "version": "1" }
}
```
3–12 planned scenes. The player shows this as the sidebar immediately, before any audio exists. Producer may end early (`final: true` on an earlier scene) but may not add lesson scenes beyond the outline without rewriting `outline.json` (allowed; server re-reads it).

### 4.3 Scene file

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261005-142207-caching",
  "sceneId": "s003",
  "title": "Cache lookup",
  "narration": "Plain prose, 15 to 90 words. No markdown, no code fences, no bullet symbols.",
  "board": { "mode": "wipe" }  |  { "mode": "region", "slots": "A3:F4" },
  "elements": [ ...ordered, 1 to 8 elements... ],
  "final": false,                 // true on the last scene of its track (lesson or one answer)
  "questionId": "q001",           // answer scenes only
  "insertAfter": "s004"           // answer scenes only: the scene that was interrupted
}
```

### 4.4 Board grid, rendering, and elements

Canvas 1600×900 logical px, scaled to the window. Grid: columns **A–F** (6), rows **1–4** (4); 24 cells, each ~250×200 px after a 50 px margin. A `slot` is one cell (`"B2"`) or a rectangular range (`"B2:D3"`), top-left to bottom-right.

**Rendering (the Khan look comes from the renderer, not the data).** All text — `text`, `list`, `table` cells, `code`, `math`, labels — is drawn as handwriting: a bundled handwriting-style font converted to outline paths and revealed stroke by stroke. Boxes, arrows, sketches, diagram nodes/edges, plot axes and curves, and `svg` shapes are roughened with rough.js and animated as strokes. There is no element that lets the producer draw freehand.

Fixed fonts (no other sizes exist): `title` 44 px, `body` 28 px, `note` 22 px, `code` 20 px monospace-handwriting. **Colors:** five accent tokens `accent1`…`accent5` plus `muted` (foundation design tokens); `color` accepts only these names. Skill rule: same concept, same color for the whole lesson.

Common fields on every element: `id` (`^[a-z][a-z0-9_]{0,23}$`, unique across the board since the last wipe), `at` (number in [0, 0.9], fraction of the scene's audio at which the draw-in begins; omitted = evenly spaced across the first 85 % of the audio in list order). Multi-part elements (list items, math lines, table cells, diagram nodes then edges, plot series) reveal their parts evenly across the element's draw window, which runs from its `at` to the next element's `at` (or 0.95 for the last).

| type | required | optional | hard caps / rules (one line) |
|---|---|---|---|
| `text` | `id`, `slot`, `text` | `style` title/body/note, `color`, `at` | words ≤ 10 × cells, max 40; `title` ≤ 8 words and colSpan ≥ 2; must fit by measured wrap |
| `list` | `id`, `slot`, `items[]` | `ordered`, `color`, `at`, `itemAt[]` | 2–6 items, ≤ 8 words each, rowSpan ≥ ceil(items/3); items revealed one at a time; `itemAt[]` overrides per-item fractions, must be ascending within the draw window |
| `math` | `id`, `slot`, `lines[]` (LaTeX) | `color`, `at` | 1–5 lines, ≤ 60 chars each; lines aligned on `=` and appear in turn; LaTeX restricted to math-mode markup (no `\def`, `\input`, `\href`, `\url`, `\include*`); must compile in the validator |
| `code` | `id`, `slot`, `lines[]` | `lang`, `at` | lines ≤ 7 × rowSpan, max 14; chars/line ≤ 22 × colSpan; no tabs |
| `table` | `id`, `slot`, `rows[][]` | `header` (bool), `color`, `at` | ≤ 6 cols × ≤ 6 rows, rectangular; cell ≤ 3 words / 12 chars; colSpan ≥ ceil(cols/3), rowSpan ≥ ceil(rows/4); drawn cell by cell; an array = `header: true` index row + one data row |
| `box` | `id`, `slot` | `label` (≤ 6 words), `color`, `at` | an outline; other elements may sit inside its slot range without counting as overlap |
| `arrow` | `id`, `from`, `to` | `label` (≤ 4 words), `color`, `at` | `from`/`to` are element ids currently on the board (this scene or earlier since last wipe); never points at nothing; self-arrow rejected |
| `highlight` | `id`, `target` | `style` circle/underline/strike/pointer, `color`, `at`, `line` | `target` on board; `line` (1-based) only when target is `code`, within its lines; `pointer` draws nothing, the pen parks over the target until the next element |
| `sketch` | `id`, `slot`, `shape` | `label` (≤ 4 words), `color`, `at` | `shape` from the pre-authored library enum in `layout-core`: circle, cloud, database, server, document, stack, person, numberline, axes, grid; library is extendable without a contract change |
| `diagram` | `id`, `slot`, `mermaid` | `at` | `flowchart`/`graph` (TD or LR) only; ≤ 8 nodes, ≤ 12 edges, node label ≤ 4 words, edge label ≤ 3 words; slot ≥ 2×2 cells; validator parses and rejects any other directive; deterministic layout engine, hand-drawn look |
| `plot` | `id`, `slot`, `fn` or `series[]` | `xRange`, `yRange`, `label`, `color`, `at` | `fn` is an expression in `x` from a safe arithmetic grammar (no eval); ≤ 3 fns/series total; ≤ 50 points per series; ranges finite; slot ≥ 2×2 cells; axes drawn first |
| `svg` | `id`, `slot`, `svg` | `at` | ≤ 4 KB; must declare `viewBox`; allowlisted tags only: path, line, circle, ellipse, rect, polyline, polygon, text, g; banned: script, foreignObject, image, style, any `href`/`xlink:*`, any `on*` attribute; ≤ 40 shapes; `text` ≤ 6 words; every shape's bounds inside the viewBox; scaled into the slot |

Board modes: `wipe` clears the board, then this scene's elements may use any cells. `region` restricts every slotted element in this scene to cells inside `slots`, and `slots` must not intersect cells occupied since the last wipe. Arrows and highlights are exempt from region containment (they reference, they do not occupy). The **first answer scene of a question must be `wipe`**.

Exact numeric caps are initial values; the foundation slice may tune them but they live in one constants file in `layout-core`, and validator and renderer both import it.

## 5. Validation (server; single owner of element-level validation)

Per lessons.md: the server's ingest path is the one place that validates both the container and **every element**. Downstream (playlist, TTS, player) assume validated scenes and must not re-validate or guess. The player must still survive a missing/corrupt audio file (skip scene with a visible note), but never a malformed element.

Pipeline per scene file: parse JSON → **shape** (schema id, ids, regexes, required fields, enum values, caps above, `lessonId` matches the folder, element count 1–8, narration 15–90 words, no markdown tokens) → **content** (math compiles under the restricted subset; mermaid parses to a supported flowchart within caps; plot expression parses in the safe grammar; svg passes the allowlist, size, viewBox and bounds checks) → **layout** (slot syntax and bounds; minimum slot sizes; region containment; occupancy intersection against the board occupancy set since last wipe; element-vs-element overlap within the scene except box containment; measured text/code/list/table fit using `layout-core` wrapping; arrow/highlight reference and `line` resolution) → ok or an error list `[ {elementId|null, code, message} ]` with stable codes (`OVERFLOW`, `OVERLAP`, `OUT_OF_REGION`, `BAD_REF`, `CAP_WORDS`, `BAD_MATH`, `BAD_MERMAID`, `BAD_EXPR`, `BAD_SVG`, …).

Validator input is (scene, occupancySet); output is (result, newOccupancySet). That is what makes validation scene-local: later scenes cannot collide with earlier ones because the region rule is enforced against the set, not by re-laying-out earlier scenes. There is no draw-time validation rule (explicitly declined); timing is handled in §6.

Failure handling: write `control/reject-<sceneId>.json` and mirror into inbox; the producer rewrites the same `sceneId` (overwrite triggers re-validation). After the second rejection the server **degrades**: keeps narration, keeps the valid elements, drops the offending ones, marks `degraded: true` in the playlist, and plays it. The lesson never stalls on layout. Degradations are counted and shown in the player's end-of-lesson summary and in `khan wait` output so the human sees them.

Performance: shape + content + layout < 100 ms per scene; deterministic (same input, same result, no randomness in measurement).

## 6. Live playback model

**Scene statuses (server):** `pending → validating → voicing → ready` or `rejected` / `degraded→voicing→ready`. Published to the player over SSE as the playlist changes.

**Player states:** `waiting` (outline shown, scene 1 not ready) → `armed` (user has clicked once; audio unlocked) → `playing` → `paused` | `stalled` | `thinking` → `playing` → `ended`.

**Buffer-gated start.** Scene 1 plays as soon as (a) it is `ready` and (b) the user has clicked anywhere once (browser autoplay policy requires a gesture; the player shows one "Start" button during `waiting`, and if it was already clicked, playback begins the moment scene 1 is ready). Target: first audio within 8 s of the trigger (≈4 s for outline + scene 1 from Claude, ≈2–3 s TTS). No further gating: scene N+1 starts when scene N is complete and N+1 is `ready`.

**Clock.** The audio element's `currentTime` is the only clock for drawing; wall clock is never used for sync. Element start = `at × duration`.

**Audio yields to the pen.** A scene is complete when both its audio has ended and its last stroke has finished. If narration ends before the last element finishes drawing, the player holds silence until the stroke completes, capped at ~1.5 s (beyond the cap the remaining strokes complete instantly), then advances. The pen never cuts off mid-stroke to chase the audio.

**Stall.** If scene N completes and N+1 is not `ready`: state `stalled`; pen idles (hover, slow re-trace of the last highlight or box); no spinner, no "buffering" text, audio silent. After 10 s a quiet caption "khan is thinking…"; after 60 s "generation seems stuck" with the producer's last-write age from the server. When N+1 becomes ready, a 400 ms beat, then play. Ordinary expectation: buffer grows, since producing a 30 s scene takes 5–10 s.

**Position reporting.** Player `POST /position {sceneId, event: "start"|"end"}` at scene boundaries only. The server derives buffer depth (ready scenes ahead) and "playback finished" from this.

**Lifecycle.** Server starts on `khan serve` (or by the skill), opens the browser to `http://127.0.0.1:7777/lesson/<id>`, and exits 10 min after the lesson ended or the last SSE client disconnected.

## 7. Interactivity

**Pause/resume** (space or button): pauses audio, freezes drawing. Player-only.

**Rewind / skip** (sidebar click, ←/→): jump to the start of any scene in the playlist (forward only if `ready`). Board at the start of scene K = deterministic instant render of all scenes since the last wipe up to K−1; then K plays normally. Answer scenes already in the playlist are replayed in position. Player-only; the producer is not involved.

**Ask a question** (`?` key or button, any state except `waiting`; typed only):
1. Player pauses immediately, snapshots `(sceneId, t)` onto the **resume stack**, shows a text field. Enter sends `POST /question {text, atSceneId, atTime}`. Player state → `thinking` (pen idles, caption "khan is thinking…").
2. Server assigns `qId` (`q001`…), writes `control/question-q001.json` and the inbox entry, and wakes the blocked `khan wait` (below).
3. Producer writes `q001-a01.json` … (first one `wipe`, each with `questionId`, `insertAfter: atSceneId`, last one `final: true`), 1–4 scenes.
4. Server validates/voices them as normal; player plays each as it becomes ready (stall rules apply, under the `thinking` caption).
5. When the `final` answer scene completes, the player pops the resume stack: instantly renders the interrupted scene's board at time `t` (elements with start < t drawn complete), resumes audio from `t`. If the lesson had already ended, answer scenes simply append and the lesson ends again.
6. Questions during an answer are allowed (`insertAfter` = the answer scene interrupted); stack depth capped at 3; beyond that the Ask button is disabled until the stack unwinds.

**Question-return mechanism (decided): blocking `khan wait`.** After writing each scene, and after the final scene, the skill runs `khan wait --lesson <id> --timeout 540` via the Bash tool. The command blocks until the server reports one of: `question` (with text and position), `reject` (with error list), `finished` (lesson played through, no pending questions), `player-closed`, or `timeout`; it prints one JSON line and exits. The skill acts on it: answer, rewrite, or loop again. During production the wait returns immediately with `continue` whenever the buffer is below 3 ready scenes ahead, so production is never delayed by waiting. One tool call per event instead of a sleep loop: near-zero context cost, sub-second question latency, no extra API key. Claude keeps its turn open for the lesson's duration; the user interacts via the player, not the terminal. The skill ends its turn on `finished`, `player-closed`, or Esc in the terminal, printing a one-line summary (scenes, degradations, questions answered).

## 8. Producer (skill) behavior

- SKILL.md tells Claude: ground every scene only in the response being explained; never introduce concepts not in it; put code in `code` elements, never in narration; narration is direct, second person, no filler ("great question", "let's dive in"), no reading the board aloud verbatim, spell or paraphrase identifiers that TTS would mangle; one idea per scene; outline first; 3–12 scenes; prefer `region` scenes that build up a board, `wipe` when the topic changes.
- **Drawing-type tier order** (choose the first that fits): `sketch` if a library shape exists → `diagram` for anything with nodes and edges → `plot` for anything with axes → `svg` only when none of the above fit. Arrays are a one-row `table` with an index header. Equations are `math`, never `text`.
- **Color consistency:** pick one accent per concept at outline time and keep it for the whole lesson; `muted` for scaffolding.
- Writes files through the `khan` CLI so one Bash call per scene does the atomic write, inbox check, and wait. Reads only `control/inbox.json` (or the `khan wait` output), never the directory.
- `khan` CLI commands: `serve [--port]`, `play <lessonId>`, `scene <lessonId> <sceneId>` (stdin JSON, atomic write, prints inbox summary), `wait <lessonId> [--timeout]`, `status <lessonId>`.

## 9. Data model basics

- **Lesson**: `lessonId`, `title`, `audience?`, `focus?`, `createdAt`, `producer`, ordered **Outline entries** (`sceneId`, `title`, `goal`). One folder. Written by producer, read by server/player.
- **Scene**: `sceneId`, `lessonId`, `title`, `narration`, `board` (`wipe` | `region slots`), ordered **Elements**, `final`, `questionId?`, `insertAfter?`. One file. Written by producer; validated and voiced by server.
- **Element**: `id`, `type` (one of twelve), type-specific fields (§4.4), `at?`, `color?`. Lives inside a Scene; ids unique per board since last wipe.
- **Playlist entry** (server): `sceneId`, `status`, `audioUrl?`, `durationMs?`, `degraded`, `errors[]`, `position` (resolved order). Derived; persisted only for debugging/replay.
- **Question** (server): `qId`, `text`, `atSceneId`, `atTime`, `createdAt`, `answeredBy[sceneIds]`, `complete`.
- **Resume stack entry** (player): `sceneId`, `t`. In-memory only.
- **Board occupancy** (server validator; recomputed by player renderer): set of cells and element ids present since the last wipe.
- **Config** (server, `.khan/config.json` or env): `tts.voice`, `port`; secrets only from env.

## 10. Non-functional constraints

- Local only: server binds `127.0.0.1`, no auth; rejects requests whose `Origin` is not its own origin (anti-CSRF from other local sites). `OPENAI_API_KEY` comes from env, never written to the lesson folder or served. No key → the server starts, the player shows a clear "OpenAI key required" message, and the skill reports it instead of producing scenes.
- TTS: OpenAI (tts-1 class) is the only user-facing provider. The voice is a config setting (`tts.voice`), chosen during QA by listening; the audio cache is keyed by hash of (provider, voice, text) so rewinds and replays never re-synthesize and a voice change re-voices cleanly. The `silent` provider (duration estimated at 150 wpm) is selectable only via `KHAN_TTS=silent` for tests and fixtures.
- Node >= 20; no build step; vanilla JS player + rough.js; handwriting font, MathJax (SVG output), and Mermaid (hand-drawn look) vendored locally with licenses permitting redistribution; no CDN. Works in current Chromium, Safari, Firefox. Canvas 1600×900 letterboxed to the window. Dark board, five-accent chalk palette (foundation tokens).
- Latency: first audio ≤ 8 s from trigger; scene validation < 100 ms; TTS ≤ 4 s per scene typical.
- Cost: TTS only; ≈ $0.05–0.15 per lesson on tts-1 class pricing.
- Accessibility: all controls keyboard-operable (space, ←, →, ?); a live transcript of the current narration is visible under the board; no flashing.
- Testing: server and player are fully testable from fixture lesson folders (one per element type plus near-cap and invalid cases) with the `silent` provider, no model, no network. E2E via Playwright pinned to 1.54.x on this machine (macOS 13; see lessons.md). Any file no test imports gets a `node --check` gate.

## 11. Risks

**Overall: medium-low.** No money, no accounts, no other people's data; only secret is the OpenAI key in env. The real exposure is a bad lesson, not a breach. Rigor should go to the validator (especially `svg`, `math`, `diagram`, `plot` content checks) and the interactivity state machine.

| Risk | Where it lives | Severity | Mitigation / test focus |
|---|---|---|---|
| Layout failure (overlap, overflow, arrows to nothing) — the dominant failure mode in research | validator + layout-core | high (product), low (harm) | shared measurement module; property-style tests over random valid/invalid scenes; degrade path tested; fixtures of near-cap elements for all twelve types |
| Validator and renderer disagree on fit | layout-core | medium | single constants file, both import it; renderer test asserts no element exceeds its slot rect for every fixture |
| `svg` quality: model-written SVG may be crude, mis-scaled, or wrong | producer + svg renderer | medium (product) | tier order in §8 makes svg the last resort; allowlist and viewBox bounds check in the validator; judged by a human in QA on real lessons; count of svg elements per lesson surfaced in the end summary |
| `svg` as an injection surface | validator | medium | tag/attribute allowlist, no `href`/`on*`/`style`/`script`/`foreignObject`/`image`; rendered into the canvas pipeline, never inserted as live DOM; fuzz tests with hostile SVG |
| `plot` expression or `math` source executing code | validator | medium | safe arithmetic grammar, no eval; MathJax run with restricted macros; tests with `\def`, `\href`, JS in expressions |
| Mermaid/MathJax rendering nondeterminism or layout overflow inside a slot | diagram/math renderer | medium | deterministic layout settings; node/edge/line caps; renderer scales result to the slot rect and tests assert containment |
| Scene gaps / stalls in option 1 (Claude's per-scene latency, tool overhead) | producer loop | medium | measure in QA; if gaps > 5 s typical, that is the trigger to build option 2 (the contract already allows it) |
| Resume after question restores wrong board or wrong time | player state machine + resume stack | medium | deterministic `renderBoardAt(sceneId, t)` unit-tested; E2E: ask mid-scene, verify audio offset and element set after answer; nested depth 2 |
| Audio/drawing drift; pen cut off by audio end | player clock + yield rule | low | audio `currentTime` is the only clock; yield-to-pen cap tested with a long last element under `silent` |
| Partial file reads by the watcher | lesson folder | low | atomic rename via `khan scene`; server ignores `.tmp`; test writes in two chunks |
| Browser autoplay block → lesson never starts | player start gate | medium (UX) | explicit one-click arm; E2E covers "clicked before ready" and "clicked after ready" |
| Path traversal / id injection via `sceneId` in URLs | server routes | low-medium | regexes from §4.1 enforced on every route; test `../` |
| Cross-site POST to localhost `/question` | server | low | Origin check; test rejected origin |
| Content correctness / hallucinated concepts (research 16–17) | skill prompt | medium, not automatable | grounding instructions; outline visible before audio; end summary; human judges in QA with 3 real responses |
| Chatty or mangled narration (research 20–21) | skill prompt + TTS | low | style rules in SKILL.md; identifier paraphrase rule; voice chosen by listening in QA |
| Session occupied during `khan wait` | skill | accepted trade-off | Esc ends turn; summary printed |
| Context cost of the production loop | skill | low | one Bash call per scene; inbox summarized to one line |
