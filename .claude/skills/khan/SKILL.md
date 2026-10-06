---
name: khan
description: Turn the explanation in Claude's last response into a live, narrated, Khan Academy style whiteboard lesson that plays in the browser (handwriting, boxes, arrows, code, diagrams, a voice). Use for /khan and for natural requests such as "khan, explain this", "khan explain that", "whiteboard this", "turn this into a video", "make this a lesson", "draw this out for me", "explain that on the board", "narrate this", "teach me this like Khan Academy", or any ask for a spoken or visual walkthrough of the previous answer. Optional free text narrows the focus ("just the caching part") or sets audience or length ("for a junior", "short").
argument-hint: "[focus, audience or length hints — empty means the whole last response]"
---

# khan — explain the last response as a narrated whiteboard lesson

You are the **producer**. You write a short outline and then one scene at a time as JSON through the `khan` CLI. A local server validates, voices and streams each scene to a browser player that draws it as handwriting and rough strokes while the narration plays. The user watches and can pause, rewind, or type a question; questions come back to you through `khan wait`. You never render, never touch audio, never read the lesson folder.

The CLI is `${CLAUDE_PROJECT_DIR}/bin/khan`. Every command prints exactly one JSON line; read it, do not pretty-print it. Below, `khan` means that path.

**Your turn stays open for the whole lesson.** The user interacts through the player, not the terminal. You end the turn only when `khan wait` says `finished` or `player-closed` (or the user interrupts with Esc). Keep context cost low: one Bash call per scene, one per wait, no extra commentary between them.

## 0. Interpret the argument

Argument: `$ARGUMENTS`

- **Empty** → explain the whole of your previous assistant response (the one the user is reacting to).
- **Free text** → it is a scope/focus ("just the caching part", "the second algorithm") and may carry audience hints ("for a junior", "for a product manager", "assume they know Rust") or length hints ("short", "two minutes", "thorough").
- Length hints map to scene counts: short ≈ 3–5 scenes, default ≈ 5–8, thorough ≈ 8–12. Never more than 12.

Print **one short line** stating the interpreted focus and audience before you start (e.g. `Lesson: the caching layer of the previous answer, for a working developer, about 6 scenes.`). Then start producing without asking for confirmation.

## 1. Start the server and check the voice

```sh
"${CLAUDE_PROJECT_DIR}/bin/khan" serve
```

Read the JSON: `{"ok":true,"port":7777,"url":"http://127.0.0.1:7777","tts":{"provider":"openai","ready":true|false,"reason":...},"spawned":...}`.

- If `tts.ready` is **false**: tell the user that khan needs an OpenAI key for narration — `OPENAI_API_KEY` must be exported in the environment the server starts from (quote `tts.reason`) — and **stop here. Do not write an outline or any scene.** To pick the key up later the server must be restarted: `kill <pid>` using the `pid` from the `khan serve` output, then `khan serve` again.
- If the command fails (`"ok":false`), report `message` and stop.

## 2. Plan the lesson and write the outline

Plan 3–12 scenes **grounded only in the response being explained** (and the user's focus). Every scene must correspond to something that response actually says; never introduce a concept, example, number or API the response did not contain. If the response is too thin for three scenes, say so and stop instead of padding.

Choose a **color map** now and keep it for the whole lesson: one accent token (`accent1`…`accent5`) per recurring concept, `muted` for scaffolding (axes, notes, containers). Same concept, same color, every scene.

Write the outline with a generated lesson id (`-`). The `scenes` list is the sidebar the user sees immediately:

```sh
cat <<'EOF' | "${CLAUDE_PROJECT_DIR}/bin/khan" outline -
{ "title": "...", "audience": "...", "focus": "...", "scenes": [ { "sceneId": "s001", "title": "...", "goal": "..." }, ... ] }
EOF
```

A complete outline:

```json
{
  "schema": "khan-outline/1",
  "lessonId": "20261006-101500-caching",
  "title": "How the response cache works",
  "audience": "working developer",
  "focus": "just the caching part",
  "scenes": [
    { "sceneId": "s001", "title": "The problem", "goal": "Why the same work is repeated" },
    { "sceneId": "s002", "title": "The lookup", "goal": "Hash, look up, serve on a hit" },
    { "sceneId": "s003", "title": "Hit or miss", "goal": "The two branches as a flow" },
    { "sceneId": "s004", "title": "Eviction", "goal": "Why memory must be bounded" },
    { "sceneId": "s005", "title": "Summary", "goal": "The mechanism in four points" }
  ],
  "producer": { "kind": "claude-code-skill", "version": "1" }
}
```

Rules: `sceneId`s run `s001, s002, …` in order; 3–12 of them; `lessonId` is generated when you pass `-` (the CLI fills it, and `schema`/`producer` too). The output `{"ok":true,"lessonId":"...","url":"..."}` gives you the **lessonId you use in every later command** and the URL; the browser opens by itself. Tell the user the URL in one line. On `"ok":false`, fix the outline per `details` and rerun.

## 3. Produce scenes with the wait loop

**Scene 1 first, immediately, and small** (two or three elements, 20–40 words of narration): first audio should reach the user within about eight seconds of the trigger. Then the remaining scenes one at a time, in order, each as one Bash call:

```sh
cat <<'EOF' | "${CLAUDE_PROJECT_DIR}/bin/khan" scene <lessonId> s002
{ ...scene JSON... }
EOF
```

The CLI fills in `schema`, `lessonId` and `sceneId` if you omit them, writes the file atomically and prints one line:
`{"ok":true,"sceneId":"s002","status":"ready|voicing|rejected|degraded","errors":[...],"readyAhead":2,"inbox":{"pending":0,"questions":0,"rejects":0},"notices":[...]}`.

- `rejected` → rewrite that same `sceneId` once, fixing the elements named in `errors` (see the error table in section 7); keep the narration if it was fine. Do not re-send an identical file.
- `degraded`, or a `notices` entry of kind `degraded` → the server dropped the listed `droppedElementIds` and will play the narration anyway. Do not rewrite; carry on and mention it in the final summary.

After **every** scene (including the final one) run:

```sh
"${CLAUDE_PROJECT_DIR}/bin/khan" wait <lessonId> --timeout 100
```

**Always pass `--timeout 100`.** Claude Code's Bash tool kills a command after 120 s by default (its per-call `timeout` parameter, in milliseconds, allows up to 600000), and a killed `wait` loses the event. A 100 s window always returns before that. Never use the CLI default (540 s) unless you also set the Bash tool's `timeout` parameter to at least 600000 on that same call. During production this costs nothing: `wait` returns at once with `continue` whenever fewer than 3 scenes are ready ahead, so the window only matters while the buffer is full or after the final scene, when `timeout` events every ~100 s are normal.

It blocks until something needs you and prints one object with `event` (and always `notices`). Act on it:

| `event` | Meaning | What you do |
|---|---|---|
| `continue` | the player's buffer has fewer than 3 ready scenes ahead | write the next scene, then `wait` again |
| `reject` | `sceneId` failed validation; `errors` has the codes | rewrite that scene (once), then `wait` again |
| `question` | the user typed `text` at `atSceneId` / `atTime`; `qId` is `q001`… | write 1–4 answer scenes (below), then `wait` again |
| `timeout` | nothing happened within the 100 s window (the buffer is full, or the final scene is written and the user is still watching) | run `wait` again immediately and silently: print nothing, do not tell the user, do not end the turn. Expect many in a row during a long lesson |
| `finished` | the lesson played to the end with no open questions; `summary` has counts | print the one-line summary and **end your turn** |
| `player-closed` | the browser tab has been gone for a while | print the one-line summary and **end your turn** |
| `error` | `code` `SERVER_DOWN` or similar | tell the user what happened and stop |

Order of work when several things are pending: answer a `question` before writing the next lesson scene (the user is waiting), fix a `reject` before adding more scenes.

After writing the **last** lesson scene (`"final": true`) keep calling `wait` — the user may still ask questions — until `finished` or `player-closed`. A long lesson means a long run of `timeout` events here; each one is just "call `wait` again". Only `finished`, `player-closed` and `error` end the loop.

### Answering a question

The player is paused and shows "khan is thinking". Write the answer as scenes with ids `qNNN-a01`, `qNNN-a02`, … where `qNNN` is the event's `qId`:

- the **first** answer scene must be `"board": {"mode": "wipe"}` (fresh board);
- every answer scene carries `"questionId": "<qId>"` and `"insertAfter": "<atSceneId from the event>"`;
- the **last** one carries `"final": true`; 1–4 scenes in total;
- ground the answer in the response being explained and in the lesson so far; if the response does not contain the answer, say so in the narration honestly rather than inventing one;
- `at` and element ids follow the same rules as lesson scenes (ids are unique since the last wipe, and the first answer scene wipes).

When the final answer scene has played, the player restores the interrupted board and resumes where it stopped. You just continue the loop.

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "q001-a01",
  "title": "Why hash the request?",
  "narration": "You asked why the request is hashed first. The hash turns a request of any size into a short fixed key, so the lookup costs the same whether the request is tiny or huge. Two identical requests always produce the same key, which is exactly what makes a hit possible.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "q", "type": "text", "slot": "A1:D1", "style": "title", "text": "Why hash the request?", "color": "accent1" },
    { "id": "pts", "type": "list", "slot": "A2:D3", "items": ["Any size in, fixed key out", "Same request, same key", "Lookup cost does not grow"], "color": "accent2" }
  ],
  "final": true,
  "questionId": "q001",
  "insertAfter": "s002"
}
```

### Ending

On `finished` or `player-closed`, run `khan status <lessonId>` and print one line from its `counts`: scenes played, degraded scenes, questions answered (and the URL, since `khan play <lessonId>` replays it later without you). Then end the turn.

## 4. Authoring rules

**Grounding.** Every scene explains something the response actually said. No new concepts, no invented numbers, no extra examples. If the user's focus names a part the response lacks, say so instead.

**One idea per scene.** A scene makes one point; its narration and its board say the same thing in two media. Three to twelve scenes per lesson.

**Narration** (the voice): 15–90 words of plain prose; second person, direct, present tense. No filler ("great question", "let's dive in", "as we can see"), no pleasantries, and never read the board aloud verbatim: the board shows, the voice explains why. No markdown of any kind: no backticks, no asterisks, no bullets, no headings, no links. **Code never goes in narration**; it goes in a `code` element. Identifiers that a voice would mangle are spelled or paraphrased ("the get method", "user id", "the T T L field") while the board shows the real token.

**Board.** Six columns A–F, four rows 1–4; a slot is one cell (`"B2"`) or a range (`"B2:D3"`). Prefer `region` scenes that build up a board — each adds elements in free cells the earlier scenes did not use — and switch to `wipe` when the topic changes. A region's `slots` must not touch any cell used since the last wipe, and every slotted element in that scene must sit inside `slots`. Arrows and highlights are exempt (they reference, they do not occupy). Keep boards airy: 1–8 elements, usually 2–4.

**Choosing a drawing type** — the tier order, take the first that fits: **sketch → diagram → plot → svg**. A `sketch` if the library has the shape (circle, cloud, database, server, document, stack, person, numberline, axes, grid); a `diagram` for anything with nodes and edges; a `plot` for anything with axes and a curve or points; `svg` only when none of those fit. Arrays are a one-row `table` with an index header row. Equations are `math`, never `text`. Steps are a `list`. Comparisons are a `table`.

**Color.** One accent per concept, fixed at outline time, used for that concept in every scene; `muted` for scaffolding; omit `color` for ordinary chalk.

**Ids and timing.** `id` matches `^[a-z][a-z0-9_]{0,23}$` and is unique across the board since the last wipe (so a region scene may not reuse an id from earlier scenes). `at` is optional: omit it and elements are spaced evenly across the first 85 % of the audio in list order; when you set it, keep values in `[0, 0.9]` and non-decreasing.

**Arrows and highlights** may point at elements drawn in earlier scenes since the last wipe (that is what region build-ups are for) or earlier in the same scene — never at an arrow or highlight, never at themselves, never at something not yet on the board.

## 5. Scene file (compact schema)

```text
{
  "schema": "khan-scene/1",             filled in by the CLI if omitted
  "lessonId": "<lessonId>",             filled in by the CLI if omitted
  "sceneId": "s003" | "q001-a02",       filled in by the CLI if omitted
  "title": "short title",
  "narration": "15 to 90 words of plain prose",
  "board": { "mode": "wipe" } | { "mode": "region", "slots": "A3:F4" },
  "elements": [ 1 to 8 elements, draw order ],
  "final": false,                       true on the last lesson scene / last answer scene
  "questionId": "q001",                 answer scenes only
  "insertAfter": "s004"                 answer scenes only
}
common element fields: "id", "type", "slot" (not on arrow/highlight), "color" (accent1..accent5 | muted), "at" (0..0.9)
```

## 6. Element cheat-sheet (every cap the validator enforces)

| type | required | optional | caps |
|---|---|---|---|
| `text` | `slot`, `text` | `style` title/body/note (default body), `color` | ≤ 10 words per cell, ≤ 40 total; `title` ≤ 8 words and at least 2 columns wide; must fit the slot when wrapped |
| `list` | `slot`, `items[]` | `ordered`, `itemAt[]`, `color` | 2–6 items, ≤ 8 words each; rows ≥ ceil(items / 3); items appear one at a time |
| `math` | `slot`, `lines[]` (LaTeX) | `color` | 1–5 lines, ≤ 60 chars each; MathJax with the **`base` and `ams` packages only**, math-mode markup only (no `$`, no text-mode environments); every macro that defines macros, loads packages, links, or styles is `BAD_MATH` (the full list is under `BAD_MATH` in section 7), as is anything from another package; each line must compile |
| `code` | `slot`, `lines[]` | `lang` | ≤ 7 lines per row, ≤ 14 total; ≤ 22 chars per column of width; no tabs; keep lines short |
| `table` | `slot`, `rows[][]` | `header`, `color` | ≤ 6 × 6, rectangular; each cell ≤ 3 words and ≤ 12 chars; columns ≥ ceil(cols / 3), rows ≥ ceil(rows / 4) |
| `box` | `slot` | `label` (≤ 6 words), `color` | an outline; elements whose slot lies inside it do not count as overlapping |
| `arrow` | `from`, `to` | `label` (≤ 4 words), `color` | ids of slotted elements already on the board; not itself; no slot |
| `highlight` | `target` | `style` circle/underline/strike/pointer, `line`, `color` | `line` (1-based) only when the target is `code`; `pointer` draws nothing, the pen rests there; no slot |
| `sketch` | `slot`, `shape` | `label` (≤ 4 words), `color` | shape ∈ circle, cloud, database, server, document, stack, person, numberline, axes, grid |
| `diagram` | `slot`, `mermaid` | — | `flowchart`/`graph` `TD` or `LR` only; ≤ 8 nodes, ≤ 12 edges; node label ≤ 4 words, edge label ≤ 3 words; slot at least 2 × 2 cells; no subgraphs, classes, clicks, styles |
| `plot` | `slot`, `fn` or `series[]` | `xRange`, `yRange`, `label`, `color` | `fn` in `x` with `+ - * / ^`, `sin cos tan exp log ln sqrt abs min max floor ceil`, `pi e`, explicit `*`; ≤ 3 fns/series; ≤ 50 points per series; ranges `[min, max]` finite; slot at least 2 × 2 cells |
| `svg` | `slot`, `svg` | — | ≤ 4 KB, must declare `viewBox`; tags `path line circle ellipse rect polyline polygon text g` only; `fill`/`stroke` are color tokens, `chalk` or `none`; no `style`, `class`, `id`, `href`, `on*`, `script`, `image`, `use`; ≤ 40 shapes; `text` ≤ 6 words; everything inside the viewBox |

Also: 1–8 elements per scene; narration 15–90 words; ids unique since the last wipe; `at` in `[0, 0.9]` non-decreasing; the first answer scene is a `wipe`.

## 7. Error codes → fixes

Every `errors[]` entry is `{elementId, code, message}`; `elementId` is `null` for scene-level codes. Fix the named element (or the scene) and resend the same `sceneId` once. The codes are exactly these:

| code | what it means | fix |
|---|---|---|
| `BAD_JSON` | the file was not valid JSON — usually a heredoc slip: an unescaped `"` inside a string, a trailing comma, a comment, or empty stdin (the CLI reports its own `BAD_JSON` with `"ok":false` before writing) | resend strict JSON; inside JSON strings escape `"` as `\"` and every backslash as `\\` (LaTeX `\frac` is written `\\frac`) |
| `BAD_SCHEMA` | `schema` is not exactly `khan-scene/1` (`khan-outline/1` for the outline), or the top level is not an object | omit `schema` (the CLI fills it) or set it exactly |
| `BAD_LESSON_ID` | `lessonId` in the file is malformed or is not the lesson being written (the CLI's `ID_MISMATCH` is the same slip caught before writing) | omit `lessonId` (the CLI fills it from the argument) and pass the exact `lessonId` the outline command printed |
| `BAD_SCENE_ID` | `sceneId` is malformed or does not match the argument; in an outline the ids do not run `s001, s002, …` | lesson scenes are `s001`…, answer scenes `qNNN-aNN`; omit `sceneId` in the file and pass it as the argument |
| `MISSING_FIELD` | a required field is absent: `narration`, `elements`; `id` or `type` on an element; `slot` on a slotted element; `text`, `items`, `lines`, `rows`, `shape`, `mermaid`, `svg`, `fn` or `series`, `from` and `to`, `target`; `questionId` and `insertAfter` on an answer scene | add the field the message names |
| `BAD_FIELD` | a field has the wrong type or is not allowed here: a `slot` on an arrow or highlight; `questionId`/`insertAfter` on a lesson scene (or a `questionId` that is not the `qNNN` prefix of the sceneId); tabs or line breaks inside `code` lines; ragged `table` rows; `itemAt` not an array of numbers; `xRange`/`yRange` not `[min, max]` with min < max; `final` not a boolean; an element or `elements` that is not an object/array; an empty `math` line | fix the type or remove the field |
| `BAD_ID` | an element `id` does not match `^[a-z][a-z0-9_]{0,23}$` (uppercase, hyphen, leading digit, longer than 24 chars) | rename it, and every `from`/`to`/`target` that points at it |
| `DUP_ID` | an `id` already used on the board since the last wipe (earlier scenes count) | pick a new id |
| `BAD_SLOT` | `slot` is not a cell `A1`…`F4` or a range `B2:D3` (lowercase letters, a column past `F`, a row past `4`, a range written backwards, a stray space) | write the slot as `<col><row>` or `<top-left>:<bottom-right>` within A–F × 1–4 |
| `SLOT_TOO_SMALL` | a `title` text needs ≥ 2 columns; `diagram` and `plot` need ≥ 2 × 2 cells; a `list` needs rows ≥ ceil(items / 3); a `table` needs columns ≥ ceil(cols / 3) and rows ≥ ceil(rows / 4) | widen the slot or shrink the content |
| `BAD_ENUM` | an unknown element `type`, or a wrong `style` (text: title/body/note; highlight: circle/underline/strike/pointer), `shape` (the ten sketch shapes), or `color` (`accent1`…`accent5`, `muted`) | use a listed value or omit the field for the default |
| `BAD_BOARD` | `board` is not `{mode:"wipe"}` or `{mode:"region", slots}`; `slots` missing, invalid, or present on a wipe; or the first answer scene (`a01`) is not a wipe | fix `board`; `a01` is always `{"mode":"wipe"}` |
| `BAD_NARRATION` | narration missing, outside 15–90 words, or containing markdown/code (backticks, `*`, `#`, bullets, links) | rewrite as 15–90 words of plain prose |
| `CAP_COUNT` | too many or too few of something: 1–8 elements, 2–6 list items, ≤ 6 × 6 table, ≤ 8 diagram nodes / ≤ 12 edges, ≤ 3 plot series / ≤ 50 points, ≤ 40 svg shapes, 3–12 outline scenes | cut content or split the scene |
| `CAP_WORDS` | a word cap: text 10 per cell / 40 total, title 8, list item 8, table cell 3, box label 6, arrow or sketch label 4, diagram node 4 / edge 3, svg text 6 | fewer words or (for text) a bigger slot |
| `CAP_CHARS` | a character cap: math line 60, table cell 12, code 22 per column of width, svg 4 KB | shorten, or widen the slot for code |
| `CAP_LINES` | math 1–5 lines; code ≤ 14 lines and ≤ 7 per row of height | cut lines or make the slot taller |
| `OVERFLOW` | the text (or list, table, code) does not fit its slot once wrapped and measured | fewer words or a bigger slot |
| `OVERLAP` | two slotted elements share a cell (elements inside a `box` are exempt) | move one |
| `OUT_OF_REGION` | a region scene's element lies outside the scene's `slots` | move it inside `slots` or enlarge `slots` |
| `REGION_OCCUPIED` | the region touches cells used since the last wipe | pick free cells or make the scene a `wipe` |
| `BAD_AT` | `at` (or an `itemAt` value) outside `[0, 0.9]`, or decreasing in element order | omit `at`, or keep values in range and non-decreasing |
| `BAD_REF` | an arrow or highlight points at an id not on the board (not yet drawn, wiped, or itself an arrow/highlight) | point at a slotted element drawn earlier (this scene or since the last wipe) |
| `SELF_REF` | an arrow's `from` equals its `to`, or an element points at itself | fix the reference |
| `BAD_LINE` | `highlight.line` on a target that is not `code`, not a positive integer, or beyond that code element's line count | target the code element with a 1-based line within range, or drop `line` |
| `BAD_MATH` | a math line uses a banned macro or does not compile under MathJax `base` + `ams`. Banned: `\def` `\edef` `\gdef` `\xdef` `\let` `\newcommand` `\newcommand*` `\renewcommand` `\providecommand` `\newenvironment` `\renewenvironment` `\DeclareMathOperator` `\input` `\include` `\includegraphics` `\usepackage` `\require` `\unicode` `\href` `\url` `\mathchoice` `\csname` `\expandafter` `\catcode` `\uppercase` `\lowercase` `\special` `\write` `\read` `\openout` `\closeout` `\class` `\cssId` `\style` `\html` `\data` `\begingroup` `\endgroup`; anything from a package other than base/ams fails to compile too | write plain math-mode LaTeX (`\frac`, `\sqrt`, `\sum`, `\text{}`, `\bar`, Greek letters, `aligned`), no macro definitions, no `$` |
| `BAD_MERMAID` | the diagram is not a `flowchart`/`graph` `TD` or `LR` of the supported subset (no subgraphs, classes, clicks, styles, other diagram kinds) | rewrite as a plain flowchart with `A[Label] --> B{Choice}` and `-->|edge label|` |
| `BAD_EXPR` | a plot `fn` does not parse: unknown function, implicit multiplication (`2x`), unbalanced parentheses, a variable other than `x` | use explicit `*` and only the listed functions and constants |
| `BAD_SVG` | the svg is not well formed, has no `viewBox`, uses a disallowed tag or attribute (`style`, `class`, `id`, `href`, `on*`, `script`, `image`, `use`), a non-token color, or draws outside the viewBox | simplify to the allowed tags with token colors inside the viewBox — or use a sketch/diagram/plot instead |
| `TTS_FAILED` | the voice could not be synthesized; the scene is still `ready` and plays silently for its estimated duration | not an authoring error: carry on and mention it in the final summary |

## 8. Worked examples (each is a complete, valid scene)

**text** — a wipe with a title, a body and a note:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s001",
  "title": "The problem",
  "narration": "Every request to this service recomputes the same expensive answer. The database is queried, templates are rendered, and the result is thrown away the moment it is sent. A response cache keeps that result for the next identical request.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "title", "type": "text", "slot": "A1:D1", "style": "title", "text": "Why the cache helps", "color": "accent1" },
    { "id": "problem", "type": "text", "slot": "A2:C3", "style": "body", "text": "Same request, same expensive work, every time. The answer is recomputed and discarded.", "color": "accent3" },
    { "id": "aside", "type": "text", "slot": "D2:F2", "style": "note", "text": "Most traffic repeats within a minute.", "color": "muted" }
  ],
  "final": false
}
```

**list** — ordered steps, revealed one at a time, with explicit timing:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s002",
  "title": "The lookup",
  "narration": "The lookup is three steps. Hash the request into a key, look that key up in the store, and if there is a hit return the stored response immediately without touching the application at all.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "steps", "type": "list", "slot": "A1:C2", "ordered": true, "items": ["Hash the request into a key", "Look the key up in the store", "On a hit, return it at once"], "itemAt": [0.1, 0.35, 0.6], "color": "accent2" },
    { "id": "why", "type": "text", "slot": "D1:F2", "style": "note", "text": "A hit skips the database and the rendering entirely.", "color": "muted", "at": 0.75 }
  ],
  "final": false
}
```

**math** — equations are always `math`, aligned on the equals sign:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s003",
  "title": "Hit rate",
  "narration": "The hit rate is the fraction of requests served from the cache. With a hit rate h and an origin cost c, the average cost per request falls to one minus h, times c.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "hitrate", "type": "math", "slot": "A1:D2", "lines": ["h = \\frac{\\text{hits}}{\\text{hits} + \\text{misses}}", "\\bar{c} = (1 - h)\\, c"], "color": "accent1" },
    { "id": "ex", "type": "text", "slot": "E1:F2", "style": "note", "text": "At ninety percent hits the origin does a tenth of the work.", "color": "muted" }
  ],
  "final": false
}
```

**code** with a **highlight** on one line — code lives only here, never in narration:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s004",
  "title": "The hit path",
  "narration": "Here is the whole lookup. Hash the request, ask the store, and on a hit return early on the third line. Only a miss reaches the compute call and the set that stores the result for next time.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "heading", "type": "text", "slot": "A1:C1", "style": "title", "text": "Lookup in six lines", "color": "accent2" },
    { "id": "code", "type": "code", "slot": "A2:D3", "lang": "js", "lines": ["const key = hash(req);", "const hit = store.get(key);", "if (hit) return hit;", "const res = await compute(req);", "store.set(key, res, ttl);", "return res;"] },
    { "id": "hitline", "type": "highlight", "target": "code", "style": "circle", "line": 3, "at": 0.6, "color": "accent1" }
  ],
  "final": false
}
```

**table** — comparisons, and arrays as a one-row table with an index header:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s005",
  "title": "Eviction policies",
  "narration": "Memory is finite, so something must be evicted. Least recently used drops what has not been touched for longest, least frequently used drops what is rarely asked for, and a time to live drops whatever has expired.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "policies", "type": "table", "slot": "A1:C2", "header": true, "rows": [["Policy", "Evicts", "Good for"], ["LRU", "oldest use", "recency"], ["LFU", "rarest", "hot keys"], ["TTL", "expired", "freshness"]], "color": "accent3" },
    { "id": "ages", "type": "table", "slot": "D1:F1", "header": true, "rows": [["0", "1", "2", "3"], ["4s", "8s", "15s", "16s"]], "color": "muted" }
  ],
  "final": false
}
```

**box** — a container; elements inside its slot do not overlap it:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s006",
  "title": "Bounded memory",
  "narration": "Think of the store as a box of fixed size. Entries go in as misses are computed, and when the box is full the eviction policy decides which entry leaves to make room for the next one.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "memory", "type": "box", "slot": "A1:C3", "label": "bounded memory", "color": "muted" },
    { "id": "entries", "type": "list", "slot": "A2:C3", "items": ["GET /users/42", "GET /home", "GET /search?q=cache"], "color": "accent2" },
    { "id": "rule", "type": "text", "slot": "D2:F3", "style": "body", "text": "Full box, one entry out, one entry in.", "color": "accent3" },
    { "id": "evict", "type": "arrow", "from": "memory", "to": "rule", "label": "evicts", "color": "accent3", "at": 0.7 }
  ],
  "final": false
}
```

**sketch** and **arrow** in a **region** scene — the library shapes, connected (this scene's region is free because it follows a wipe that used only rows 1–2):

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s007",
  "title": "Where the cache sits",
  "narration": "The cache sits between the client and the application. The client asks the cache, and only a miss travels on to the server, so most requests never reach anything expensive.",
  "board": { "mode": "region", "slots": "A3:F4" },
  "elements": [
    { "id": "client", "type": "sketch", "slot": "A3:A4", "shape": "person", "label": "client", "color": "accent4" },
    { "id": "cache", "type": "box", "slot": "B3:C4", "label": "cache", "color": "accent2" },
    { "id": "app", "type": "sketch", "slot": "D3:D4", "shape": "server", "label": "app", "color": "accent1" },
    { "id": "db", "type": "sketch", "slot": "E3:F4", "shape": "database", "label": "database", "color": "accent3" },
    { "id": "c2c", "type": "arrow", "from": "client", "to": "cache", "color": "accent4" },
    { "id": "c2a", "type": "arrow", "from": "cache", "to": "app", "label": "misses only", "color": "accent2" },
    { "id": "a2d", "type": "arrow", "from": "app", "to": "db", "color": "accent1" }
  ],
  "final": false
}
```

**highlight** — underline, strike and the resting pointer:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s008",
  "title": "What changes",
  "narration": "Compare the two paths. The slow path recomputes on every request, so strike it out. The fast path serves the stored answer, and that is the line to remember, so the pen rests there.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "slow", "type": "text", "slot": "A1:C1", "style": "body", "text": "Recompute on every request", "color": "accent3" },
    { "id": "fast", "type": "text", "slot": "A2:C2", "style": "body", "text": "Serve the stored answer", "color": "accent4" },
    { "id": "no", "type": "highlight", "target": "slow", "style": "strike", "at": 0.4, "color": "accent3" },
    { "id": "yes", "type": "highlight", "target": "fast", "style": "underline", "at": 0.6, "color": "accent4" },
    { "id": "rest", "type": "highlight", "target": "fast", "style": "pointer", "at": 0.85 }
  ],
  "final": false
}
```

**diagram** — anything with nodes and edges, as a small Mermaid flowchart:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s009",
  "title": "Hit or miss",
  "narration": "A diagram makes the branch obvious. On a hit the stored response is served at once. On a miss the application computes it, the cache stores it, and then it is served, so the next identical request is a hit.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "branch", "type": "diagram", "slot": "A1:D2", "mermaid": "flowchart LR\n  R[Request] --> C{In cache?}\n  C -->|hit| S[Serve]\n  C -->|miss| A[Compute]\n  A --> W[Store]\n  W --> S" },
    { "id": "legend", "type": "text", "slot": "E1:F2", "style": "note", "text": "Hits are cheap. Misses pay once and then become hits.", "color": "muted" }
  ],
  "final": false
}
```

**plot** — anything with axes; a function of `x`, or data points:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s010",
  "title": "Cost falls as hits rise",
  "narration": "Plotting the average cost against the hit rate gives a straight line from full cost at zero hits down to nothing at a perfect hit rate. The measured points from the response sit close to that line.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "costplot", "type": "plot", "slot": "A1:D2", "fn": "1 - x", "series": [[[0, 1], [0.25, 0.8], [0.5, 0.45], [0.9, 0.12]]], "xRange": [0, 1], "yRange": [0, 1], "label": "cost vs hit rate", "color": "accent2" },
    { "id": "read", "type": "text", "slot": "E1:F2", "style": "note", "text": "Ninety percent hits, a tenth of the cost.", "color": "muted" }
  ],
  "final": false
}
```

**svg** — the last resort, small and self-contained; coordinates live in its own `viewBox`:

```json
{
  "schema": "khan-scene/1",
  "lessonId": "20261006-101500-caching",
  "sceneId": "s011",
  "title": "Staleness",
  "narration": "A cached response can go stale. A time to live bounds how old an answer may be, trading a little freshness for a lot of saved work. Everything left of the line is fresh, everything right of it has expired.",
  "board": { "mode": "wipe" },
  "elements": [
    { "id": "ttl", "type": "svg", "slot": "A1:C2", "svg": "<svg viewBox=\"0 0 100 50\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"5\" y1=\"40\" x2=\"95\" y2=\"40\" stroke=\"muted\"/><rect x=\"10\" y=\"15\" width=\"30\" height=\"20\" stroke=\"accent4\" fill=\"none\"/><text x=\"25\" y=\"30\" font-size=\"8\" text-anchor=\"middle\" fill=\"accent4\">fresh</text><rect x=\"55\" y=\"15\" width=\"30\" height=\"20\" stroke=\"accent3\" fill=\"none\"/><text x=\"70\" y=\"30\" font-size=\"8\" text-anchor=\"middle\" fill=\"accent3\">stale</text><line x1=\"47\" y1=\"10\" x2=\"47\" y2=\"45\" stroke=\"chalk\"/></svg>" },
    { "id": "ttlnote", "type": "text", "slot": "D1:F2", "style": "body", "text": "A time to live caps how stale an answer may be.", "color": "accent4" }
  ],
  "final": true
}
```

## 9. What you never do

- Never read the lesson folder, its scene files, audio, or playlist. Your only inputs are the JSON lines printed by `khan scene`, `khan wait`, `khan status` (the server mirrors everything into `control/inbox.json`, which the CLI summarizes for you).
- Never sleep-poll or loop in Bash; `khan wait` blocks for you.
- Never write a scene the response does not support, never pad to reach a scene count, never put code or markdown in narration.
- Never keep going after `finished`, `player-closed`, or an `error`.
