# QA — integration report 01 (khan, main @ a9497cd)

Date: 2026-10-06. Tester: qa-tester (read-only on code). Environment: macOS 13, Node v22.5.1, Playwright 1.54.2 (Chromium), `KHAN_TTS=silent` throughout — no OpenAI key was available, so every audio path below is the silent WAV provider. Items that need a key or a live Claude Code session are listed under "Needs human" at the end.

Verdict: **failed** — the automated gate is red (2 E2E failures, both obsolete test assumptions rather than product defects) and the integration run found one genuine major defect in the question flow (finding 1). Everything else at the seams held up better than expected.

## Numbers

| Gate | Result |
|---|---|
| `npm test` (idle machine) | 257 tests: **256 pass, 0 fail, 1 skipped** (live OpenAI smoke), ~16 s |
| `npm test` while `npm run test:e2e` runs | run 1: 255/1 fail (`degrade visibility` #15); run 2: 256/0; run 3: 255/1 fail (same test, same line) |
| `npm run test:e2e` | 49 tests: **47 pass, 2 fail** (failures A and B below); identical result in 3 further runs, including 2 under full unit-suite load — no additional E2E flakes |
| `npm run check` | clean |
| Renderer/validator sweep (own script, all 22 fixture lessons, both renderers) | 208 elements prepared: **0 bounds outside slot rect, 0 arrow/highlight bounds outside the canvas, 0 `NaN` in any drawable path, 0 throws** |

## Summary table

| Area | Result |
|---|---|
| Engine ↔ real renderers (math, dense, full tour): console errors, pending/blank math, prepare/paint failures | pass (0 errors, 0 pending drawables, 0 `prepare-failed`/`paint-failed` events) |
| Board plan on resume after a question, real renderers, nested to depth 3 (fx-full-tour copy) | pass — all three resumes restore exact `t` (Δ < 2 µs) and the planned drawn set; Ask disabled at depth 3; summary questions = 3 |
| Continue after resume (what plays after the interrupted scene ends) | **fail** — the answer scenes replay (finding 1) |
| Rewind/skip across region and wipe scenes, all twelve types (fx-full-tour, fx-core-dense, fx-core-arrows, fx-pic-dense, fx-pic-shapes, fx-build-region) | pass — drawn set after every jump equals `planBoardAt` history exactly (no extra, no missing ids); pixels > 0 whenever history is non-empty |
| CLI ↔ server ↔ player with the silent provider (serve/reuse, outline, scene, wait events continue/reject/question/timeout/finished/player-closed, status, play) | pass |
| Degrade path (element drop and narration-only), end summary, `khan status` | pass (summary degraded = 2, status counts.degraded = 2, sidebar + transcript markers) |
| Validator ↔ renderer agreement (containment for every fixture) | pass (sweep above) |
| Security: Origin check, `..%2F`, static traversal, body cap, hostile SVG, key in logs/state | pass (see finding 11 for the body-cap nuance) |
| Empty states / edge cases (outline only, early open, question while stalled, question after ended, tiny viewports, keyboard-only, no-key server) | pass with two minor notes (findings 7, 10) |
| E2E failure A (`foundation-harness` criterion 17) | fail — obsolete test (finding 2) |
| E2E failure B (`engine-clock` criterion 4) | fail — stale test assumption, engine behaves per spec (finding 3) |
| Flaky unit test under load | reproduced 2/3 — real stale-read race in `khan scene` output (finding 4) |
| Known issues reported by builders (1)–(5) | (1) confirmed, (2) confirmed, (3) confirmed, (4) needs human, (5) confirmed no Range support — needs human for Safari/Firefox |
| SKILL.md self-consistency | pass with minor gaps (finding 12) |
| First real `/khan` run, voice choice, latency, inter-scene gaps | needs human |

## Findings (most severe first)

### 1. major — player-engine: after a question is answered and the interrupted scene finishes, the answer scenes replay before the lesson continues
Owner: slice 04 `player/engine/index.js` (`nextLessonEntry` → `onSceneComplete`). Brief 04 items 5 and 11; spec §7 step 5.

Repro (silent provider, any browser):
1. `KHAN_HOME=/tmp/qa KHAN_TTS=silent KHAN_NO_OPEN=1 KHAN_PORT=7911 ./bin/khan serve`; copy `fixtures/lessons/fx-eng-short` into `/tmp/qa/lessons/`.
2. Open `http://127.0.0.1:7911/lesson/fx-eng-short`, Start, press `?` during s001 at t ≈ 1 s, type anything, Enter.
3. Write `scenes/q001-a01.json` (copy of s003 with `sceneId: "q001-a01"`, `board: {mode:"wipe"}`, `final: true`, `questionId: "q001"`, `insertAfter: "s001"`).
4. Watch after the answer: s001 resumes at t ≈ 1 s and plays to its end — then **q001-a01 plays again**, then s002, s003.

Observed (`window.__khan.engine.events` scene-start sequence): `s001@0, q001-a01@0, s001@1.05 (resume), q001-a01@0, s002@0, s003@0`; position posts contain `start q001-a01 / end q001-a01` twice. With the depth-3 scenario on the full tour the whole answer cascade (q001-a01, q002-a01, q003-a01, q002-a02, q001-a02) replayed before s004 — roughly five extra scenes the user had just watched.

Expected: after the resumed scene completes, the next *lesson* scene plays (s002). Playlist order (spec §4.1) places answers after their `insertAfter` for replay/rewind purposes; live advance after a resume should skip answer scenes already played in this question's lifetime (the engine already tracks `played`). The existing E2E (criterion 10/11) stops asserting right after the resume, so this is uncovered; the end-summary count is unaffected because `played` is a Set.

### 2. major (gate) — foundation: `e2e/foundation-harness.spec.js` "criterion 17" is obsolete now that renderers are registered
Owner: slice 00 (test). Diagnosis confirmed: the test asserts fallback drawables (`bounds` equal to the slot rect, `parts === 1`, `paths === 1`). With slice 02 registered, the title text in `fx-full-tour` s001 (`A1:D1`, slot `{50,50,1000,200}`) prepares to `bounds {x:64.42, y:70.77, w:466.53, h:45.23}` — correctly *inside* the slot. Nothing in the product is wrong. Fix is test-side: assert containment (`rectContainsRect(slotRect, bounds)`) and drop the fallback-shape assertions, or unregister the renderers for that test. The rest of that file (measurement and math agreement) passes.

### 3. major (gate) — player-engine test: `e2e/engine-clock.spec.js` "criterion 4" second half assumes fallback stroke lengths
Owner: slice 04 (test). Characterization with real renderers, `fx-long-stroke` s003 (15-word narration → D = 6000 ms):

| element | window (ms) | real `naturalMs` (ms) |
|---|---|---|
| `para` (40-word body text) | 2550 | 8099 |
| `grid` (6×6 table) | 3150 | 12361 |

Timeline end = 14 911 ms, i.e. 8.9 s past audio end — exactly what this fixture is designed to do (brief 00: "audio ends before strokes finish"). The engine holds for the cap and snaps: observed `scene-complete − audio-ended = 1507 ms` (cap 1500 + one frame); the scene does reach `complete`, all ids are drawn, state goes to `ended`. The first half of the test (×20 stretch, expects cap engagement) passes; the second half asserts `≤ 200 ms` because the *fallback* rectangles (`naturalMs ≥ 300 ms`) finished inside their windows. So: test-assumption problem, not an engine defect. Suggested rewrite: assert cap engagement for both halves, or use a fixture whose strokes fit (e.g. `fx-eng-short`) for the "no yield" half.

Related observation (informational): at playbackRate 1, five fixture scenes have strokes that outrun their audio with real renderers — `fx-core-dense/s001` +572 ms, `fx-type-sketch/s002` +1782 ms (past the 1.5 s cap → snap), `fx-type-sketch/s003` +1429 ms, `fx-type-plot/s002` +1069 ms, `fx-long-stroke/s003` +8911 ms (by design). Near-cap boards with short narration will be snapped; the SKILL.md could advise matching narration length to board density (spec declines draw-time validation).

### 4. minor (flaky test, real race) — skill-cli: `khan scene` summarizes `control/inbox.json` before the server has written it
Owner: slice 05 `cli/commands/scene.js` + `cli/lesson.js readInboxSummary` (the server's inbox write is queued asynchronously in `server/control.js`; README C2 already warns "readers should tolerate a momentarily stale file").

Evidence: `npm test` concurrently with `npm run test:e2e` → `not ok 15 - degrade visibility (criterion 7)` at `test/cli/production.test.js:129`, `assert.equal(first.json.inbox.rejects, 1)` → actual `0`. Reproduced in 2 of 3 full-suite loaded runs; 0 of 3 when `production.test.js` ran alone under E2E load; 0 of 1 idle. The playlist poll sees `status: rejected` (in-memory) a few ms before the inbox file lands on disk. Impact on the skill is low — `status`/`errors` come from the playlist and are correct — but `inbox.*` counts in `khan scene` output can be one write stale. Fix options: derive `inbox` counts from the HTTP snapshot, or wait until `inbox.updatedAt ≥ playlist.producer.lastWriteAt`.

Other timing-bound assertions (flaky candidates under load, not observed failing): `test/cli/wait.test.js:20` (`< 1500 ms` incl. node startup), `:34` (`< 1000 ms`), `:61` (1900–4500 ms); `test/foundation/wait.test.js:26,45` (`< 1000 ms`), `:35` (900–3000 ms), `:109` (`< 2500 ms`); `test/foundation/validate.test.js:103` (`< 100 ms` per scene); `test/renderer-core/sweep.test.js:137` and `test/renderer-pictures/sweep.test.js:102` (`< 150 ms` prepare); `test/foundation/lifecycle.test.js:96,110` (1800–7000 ms); `test/tts/openai-provider.test.js:217,229` (`< 2000`, `< 1500 ms`); `test/cli/production.test.js:215` (`< 10 s`); E2E: `engine-clock` 400–900 ms beat window, `engine-question` ±0.25 s audio offset, `renderer-*-harness` paint `< 150 ms`. The CLI's 3 s playlist poll (`cli/lesson.js pollPlaylist`, `--timeout-ms` default 3000) is the mechanism most likely to turn load into a wrong `status` in `khan scene` output.

### 5. major (foundation), mitigated by the CLI — the server opens a browser tab for every lesson folder present at startup
Owner: slice 00 `server/ingest.js ingestOutline` (`first && !lesson.opened → onNewOutline`). Confirmed with an opener spy: `startServer` over a copy of `fixtures/lessons` → **22 opener calls** within 3 s of start. The CLI spawns the server with `KHAN_NO_OPEN=1` and opens the tab itself, so `./bin/khan …` is safe; but the README "Running" and "Manual look" instructions (`npm run serve -- --lessons-dir fixtures/lessons`) will open 22 tabs. Fix: only open for outlines whose file mtime is newer than server start, or never open during the startup scan.

### 6. minor — foundation: a previously valid scene that is rewritten invalid is degraded immediately, with no reject/rewrite round
Owner: slice 00 `server/ingest.js finishInvalid` (`entry.attempts <= 1` counts every ingest, including valid ones). Repro: ingest a valid s003, then overwrite it with a scene-level-invalid one (e.g. `region A1:C1` over occupied cells) → status goes `validating → degraded → ready` with `REGION_OCCUPIED`, never `rejected`; no `control/reject-s003.json`, no `reject` event for the producer. Spec §5 says rejected scenes get one rewrite before degrading. Low impact (producers rarely rewrite ready scenes; degrading is the safe direction) but the counter should count consecutive invalid attempts.

### 7. minor — foundation: `GET /api/lesson/:id/events` (and outline/playlist) 404 until the folder is ingested → 2 console errors on an early open
Known issue (3) confirmed: opening `/lesson/<id>` before the folder exists logs two `Failed to load resource: 404` console errors; the engine's SSE reconnect (1 s → 10 s backoff) recovers, the sidebar fills from the outline and playback starts when s001 arrives. The CLI (`khan outline`) waits for ingest before opening, so the real path never hits this. Cosmetic.

### 8. minor — foundation: `shared/handwriting.glyphPaths` emits `NaN` coordinates
Known issue (2) confirmed and larger than reported: over every string in the fixtures × 4 styles × 4 x-offsets, **4 903 of 231 584 glyphs (2.1 %)** contain `NaN` in `d` (e.g. `y`, `i`, `q`, `e`, `.`, `t`, `r`, `s`, `n` at fractional x). Both renderer slices serialize outlines themselves, so no `NaN` reaches any drawable (sweep: 0). Any future consumer of `glyphPaths` (or the harness fallback) would be bitten; vendored opentype `roundDecimal` is the cause.

### 9. minor (latent) — player-engine does not await `window.__khan.rendererCore.ready` nor call `warm(scene)`
`prepareMath` returns an empty `pending` drawable when MathJax is not initialised, and the engine caches drawables per scene start. Not reproducible: `mathReady()` was `true` at Start in every run, even with `/vendor/mathjax/**` delayed 4 s, because the module graph loads MathJax before the engine boots. Noted so nobody is surprised if MathJax initialisation ever becomes slower than the Start click.

### 10. minor — player-engine: 18 px horizontal overflow at a 320 px wide viewport
Letterboxing is correct at 400×300 (board 400×225), 320×640 (320×180), 3000×400 (711×400, centred); Start/Pause/Ask stay visible and inside the viewport. At 320×640 `document.scrollWidth` is 338 (toolbar buttons overflow the board). Cosmetic.

### 11. minor — foundation: request bodies over 64 KB are dropped by destroying the socket (no HTTP status)
`POST /position` with a 70 KB body on a known lesson → `curl` exit with no response (`000`). Defensible, but a `413` would be friendlier. All other limits behave: 501-char question → 400, bad `atSceneId` → 400, `Origin: http://evil.local` and `Origin: null` → 403, own origin → 200/204, `..%2F` in lessonId/sceneId → 400, `/player/../server/index.js`, `%2e%2e`, `%252e`, `..%5c` → 404, hostile SVG (`<script>`, `onload`, `<image href>`, `<foreignObject>`) → `rejected` with `BAD_SVG` then degraded to narration-only on the second write. No `sk-` or `Bearer` string in `.khan/**`, `test-results/**`, or either server log.

### 12. minor — skill-cli: SKILL.md error-code table and macro list are incomplete; everything else is consistent
Checked against `shared/layout-core/constants.js` and `shared/schema/errors.js`: every cap in the §6 cheat-sheet matches `CAPS` exactly (10 words/cell, 40 max, title 8 words/2 cols, list 2–6 × 8, rows ≥ ceil(n/3), math 1–5 × 60, code 7/row 14 max 22/col, table 6×6 3 words/12 chars ≥ ceil(cols/3)/ceil(rows/4), labels 6/4/4, diagram 8/12/4/3 ≥ 2×2, plot 3/50 ≥ 2×2, svg 4 KB/40/6). Argument contract matches spec §1 (empty = whole last response; free text = focus + audience/length). The wait loop names all six events plus `error`; answer rules (`wipe` first, `questionId`, `insertAfter`, `final`) match. `test/cli/skill.test.js` runs in `npm test` and validates all 13 fenced JSON blocks (1 outline, 12 scenes incl. the answer scene). Gaps: §7 "Error codes → fixes" omits `BAD_LINE` (highlight `line` out of range / on non-code — a plausible Claude mistake), `BAD_SLOT`, `BAD_ID`, `BAD_FIELD`, `MISSING_FIELD`, `BAD_JSON`, `BAD_SCHEMA`, `BAD_LESSON_ID`, `BAD_SCENE_ID`; the math row lists 5 banned macros while `BANNED_MACROS` has ~35 (fine as "math-mode only", but `\DeclareMathOperator`, `\text`-adjacent `\class`/`\style` are worth a mention). Section 1 "kill <pid> then khan serve again" is correct given the CLI's pidfile logic.

### 13. minor — foundation: `GET /api/lesson/<unknown>/wait` materialises a phantom lesson
`khan wait zzzz-not-here-either --timeout 1` → `{"event":"continue","readyAhead":0}` and afterwards `GET /api/lesson/zzzz-not-here-either/playlist` returns 200 with an empty lesson (the route calls `store.ensure`). A typo in the skill's lessonId would loop on `continue` instead of failing; `khan scene` would then fail with `NO_LESSON`, so the loop self-corrects, but `wait` should 404 like `status` does.

### Known issues reported by builders — status
1. Browser tab per lesson folder at startup — **confirmed** (finding 5), 22 tabs over the fixtures dir; CLI workaround verified (`spawned` server gets `KHAN_NO_OPEN=1`, `khan outline` opens once after ingest, `khan play` opens once; `--no-open`/`KHAN_NO_OPEN=1` honoured).
2. opentype `NaN` — **confirmed** (finding 8), 2.1 % of glyphs in `shared/handwriting.glyphPaths`, 0 in drawables.
3. `events` 404 before ingest — **confirmed** (finding 7), two console errors, recovers.
4. `khan wait --timeout 540` vs the Bash tool's 120 s default — **needs human** (below). Note `cli/http.js` deliberately uses `node:http` with a `(timeout + 30) s` client timeout so the CLI itself survives 540 s; the tool-level timeout is the open question.
5. Audio served without Range support — **confirmed**: `GET …/audio/s001` with `Range: bytes=0-99` returns `200` with the full 96 044-byte body and no `Accept-Ranges`; Chromium seeks fine on WAV. Safari/Firefox with real MP3s need a human with a key.

## What passed (so the fixes above can be trusted not to regress silently)
- CLI end to end: `serve` spawns detached and is reused (`spawned:false`, same pid); `outline -` slug: `"Ünïcödé — Caching: the \"fast\" path!! …"` → `20261006-023802-unicode-caching-the-fast-path-and-a-very-very-ve` (64 chars exactly); 2-scene and non-sequential outlines rejected with `CAP_COUNT` / `BAD_SCENE_ID`, exit 1; `scene` fills ids, refuses `ID_MISMATCH`, rejects `s4`; `wait` → `continue` in 149 ms wall, `reject` with the error list, `question` delivered to a blocked `wait` within the same second with the degraded notice riding along, `--timeout 2` → `timeout` in 2.16 s, `finished` with `summary.degraded = 1` after the fake player posted the last `end`, repeated `wait` after `finished` keeps returning `finished`, a late question flips `ended` back to false and is delivered, `player-closed` 16 s after the only SSE client dropped; `status` → `UNKNOWN_LESSON` exit 1; `play fx-full-tour` → URL + `ingested:true`; `play --lessons-dir <other>` while a server runs → `LESSONS_DIR_MISMATCH`; `play` unknown → `NO_LESSON`.
- Degrade in the player: fx-degrade-flow s002 `rejected` (sidebar badge "rejected, not ready") → second invalid write → `ready · degraded`, transcript "degraded · 1 element dropped"; s003 written twice as `REGION_OCCUPIED` → narration-only effective scene `{mode:"region", slots:"C1"}` with 0 elements (board kept, never wiped), plays with the previous board visible; summary `scenes 3 / degraded 2`; `khan status counts.degraded = 2`, `ended:true`.
- Question while `stalled`: caption "khan is thinking…" (stall) → empty while typing → "khan is thinking…" after submit; pen `idle`; answer plays; resume lands back on s001 at `t = D`, which completes immediately; then the lesson continues when s002/s003 arrive (subject to finding 1).
- No-key server (real `openai` provider, no key): `tts.ready:false, reason "OPENAI_API_KEY not set"`, scenes `ready` with `audioUrl:null` and `TTS_FAILED`, player shows "OpenAI key required — OPENAI_API_KEY not set", Start disabled, click + Space do not arm, sidebar badges "no audio"; server log contains no key material.
- Outline-only lesson: planned rows `s001:planned, s002:planned, s003:planned`, title shown, Space arms (`armed`, hint "Waiting for the first scene…"), Ask disabled in `waiting`/`armed`, auto-plays when s001 lands.
- Keyboard: Space arm/pause, `?`, Esc, arrows all verified in the engine E2E and probes; `→` on the last scene is a no-op.
- Visual spot-check of screenshots (`test-results/renderer-core/*.png`, `test-results/renderer-pictures/*.png`, plus my probe shots): legible chalk handwriting, math glyphs rendered (not blank), pen glyph present, sidebar/transcript overlays readable on the dark board.

## Not tested
- Anything with real audio: OpenAI synthesis, MP3 duration in the playlist, seeking real MP3s on resume (Safari/Firefox), voice choice, cache hits on replay with a key.
- A live Claude Code `/khan` session (skill triggering, Bash tool timeouts, context cost, grounding quality, inter-scene gaps).
- Firefox and Safari (Playwright here is Chromium only).
- Idle exit after 10 min (covered by the unit test with `KHAN_IDLE_EXIT_MS=2000`; not re-verified at the real 10 min).
- Degrade after the 30 s reject grace with no rewrite (covered by `test/foundation/ingest.test.js`; not re-run manually).

## Needs human

1. **First real `/khan` run (OpenAI key).** In a terminal: `cd /Users/sanjivp27/Documents/projects/agent_pipeline/khan` (cwd must be this repo — the skill lives in this folder's `.claude/skills/khan/` and uses `${CLAUDE_PROJECT_DIR}/bin/khan`; launching Claude Code from `agent_pipeline/` will not find it); `export OPENAI_API_KEY=sk-…`; make sure no silent server is running (`cat .khan/server.json`, kill its pid, or `rm .khan/server.json`); start `claude`. Ask any explanatory question (something with a list, a code block and a small equation makes all renderers show up), then type `/khan`. Expect: one "Lesson: …" line, `khan serve` JSON with `tts.ready:true`, the browser opening on the lesson. **Measure:** (a) wall time from pressing Enter on `/khan` to the first audible word (target ≤ 8 s, spec §6); (b) for each scene boundary, the gap between scene N's end and N+1 starting — stalls show as the `stalled` state and, after 10 s, the caption "khan is thinking…"; the spec's §11 trigger for building the option-2 producer is **gaps > 5 s typical**. Easiest instrumentation: open the lesson with `?debug=1`, or after the run read `.khan/lessons/<id>/state/playlist.json` and compare `producer.lastWriteAt`-style stamps, or in DevTools dump `window.__khan.engine.events.filter(e => e.type === 'transition')` (each has `at` in ms) and look at `playing → stalled → playing` spans. Also note degraded scenes (sidebar marker) and the `svg elements` count in the end summary (spec §11 "svg quality" row). Then ask a typed question mid-scene and confirm: Claude's turn stays open, `khan wait` returns the `question`, answer scenes insert, and — until finding 1 is fixed — the answer will replay once after the interrupted scene ends. Finally confirm Claude prints the one-line summary and ends its turn; replay with `./bin/khan play <lessonId>` (zero network if cached).
2. **Bash tool timeout vs `khan wait` (known issue 4).** The skill runs `khan wait <id>` with the default 540 s; Claude Code's Bash tool default timeout is 120 s (`BASH_DEFAULT_TIMEOUT_MS`, max `BASH_MAX_TIMEOUT_MS`, and a per-call `timeout` parameter up to 600 000 ms). During a buffered lesson (≥ 3 ready scenes ahead, final scene written) `wait` blocks until a question or the end, so a 2-minute tool kill is likely. Check in the real run whether Claude sets the tool timeout itself; if not, either set `BASH_DEFAULT_TIMEOUT_MS=600000` in the session environment or have SKILL.md instruct `--timeout 100` and loop on `timeout`.
3. **Voice** (brief 01): listen to `alloy` vs `nova`/`onyx`/… via `KHAN_TTS_VOICE` or `.khan/config.json`; the cache re-voices cleanly on change and hits on switching back.
4. **Real MP3 seeking on resume** (known issue 5): with a key, ask a question mid-scene in Safari and Firefox and check the resume offset (`position.t` vs audible position). The server sends no `Accept-Ranges`; if seeking misbehaves, Range support in `server/http.js serveFile` is the fix.
5. **Content and look judgement** on 3 real responses (spec §11 rows "Content correctness", "svg quality", "Chatty narration"): grounding, no reading the board aloud, identifier paraphrase, whether `svg` elements were needed at all.
6. **60 s "generation seems stuck" caption** with a real producer (only seen with shrunk thresholds in tests).

## Repro aids
Server used for all manual probes: `KHAN_HOME=<scratch> KHAN_TTS=silent KHAN_NO_OPEN=1 KHAN_PORT=7911 ./bin/khan serve` with fixture lessons copied into `<scratch>/lessons`. Browser probes were run with Playwright's Chromium from `node_modules/playwright` against `window.__khan.engine` hooks (`events`, `position`, `resumeStack`, `drawnElementIds()`, `planBoardAt`); the exact scene-start sequence for finding 1 is `window.__khan.engine.events.filter(e => e.type === 'scene-start')`.
