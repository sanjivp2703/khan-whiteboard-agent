# Brief 04 — Player engine: playback, controls, questions, resume

Size: L. Depends on: **foundation only** (brief 00 `done`). Runs in parallel with 01, 02, 03, 05. You do NOT need the renderer slices: the foundation's fallback drawable (dashed rect + id) stands in for every element type, and all your tests assert by data (ids, states, times), never by pixels.

Project: khan. Spec: `/Users/sanjivp27/Documents/projects/agent_pipeline/khan/spec.md` (approved 2026-10-05). Relevant parts: §1 items 4–5, §3 (Player row), §6 entire (statuses, states, buffer-gated start, clock, yield rule, stall, position reporting), §7 entire (pause, rewind/skip, questions, resume stack), §9 (Resume stack entry, Board occupancy recomputed by player), §10 (accessibility, no-key message, letterboxing), §11 rows "Resume after question", "Audio/drawing drift", "Browser autoplay block". Foundation contracts: repo `README.md` and `briefs/00-foundation.md` §C3 (API/SSE/playlist), §C4 (Drawable), §C5.

## Tech stack (from the spec)
Vanilla JS ES modules in the browser, no framework, no build step, no CDN, no new npm dependencies. Node `node --test` for pure logic (state reducer, scheduler, board-at-time planner — keep these DOM-free in their own modules so they are unit-testable). Playwright 1.54.x (pinned) for E2E with the foundation server under `KHAN_TTS=silent`. Git: commit to the working copy of https://github.com/sanjivp2703/khan-whiteboard-agent.

## The specific feature
Everything the user experiences besides the drawn strokes themselves: the lesson page's UI chrome, the playback engine, and all interactivity. Files you own: `player/engine/**` (incl. `engine.css`), `test/engine/**`, `e2e/engine-*.spec.js`, fixtures `fixtures/lessons/fx-eng-*`. You mount your UI inside `#engine-root` and draw the board on `#board`, the pen on `#pen` (foundation `index.html`; never edit it). Test hooks under `window.__khan.engine` only.

Build, per spec:
1. **Sidebar** from `outline` the moment the page loads (titles, planned scenes, per-scene status badge, degraded marker); answer scenes appear in position as they arrive. Click = jump (§7).
2. **Start gate** (§6): state `waiting` shows one `Start` button; clicking anywhere arms audio (`armed`); playback begins when scene 1 is `ready` AND armed, in either order.
3. **Scheduler/clock**: the current scene's `<audio>` `currentTime` is the only clock. From `shared/layout-core/timing.resolveTiming(scene)` and `durationMs`, element start = `at × D`, window end = next `at × D` (0.95 D last). Per element: `drawEnd = start + max(windowEnd − start, drawable.naturalMs)`; `u = clamp((t − start)/(drawEnd − start))`. Repaint on `requestAnimationFrame` reading `currentTime`; never wall-clock. Elements of earlier scenes since the last wipe are painted at u=1 (cache them to an offscreen canvas).
4. **Audio yields to the pen** (§6): scene complete when audio ended AND last stroke done; if strokes outrun audio, hold silence up to `YIELD_CAP_MS` (1500, from constants or your config) then snap remaining strokes to complete; then advance. Never cut a stroke to chase audio.
5. **Scene advance**: N complete and N+1 `ready` → play N+1. Not ready → `stalled`.
6. **Stall** (§6): pen idles (hover wobble; slow retrace of the last highlight/box drawable's `paths` if any); no spinner, no "buffering"; after 10 s caption "khan is thinking…"; after 60 s "generation seems stuck" + producer last-write age from the playlist; on ready: 400 ms beat, then play. Thresholds configurable via `window.__khan.engine.config` before start (tests shrink them).
7. **Pen** on the `#pen` overlay: a small chalk/pen glyph at `drawable.tipAt(u)` of the element currently drawing; parked at the `pointer` highlight's tip; idle animation in `stalled`/`thinking`; hidden in `waiting`/`ended`.
8. **Position reporting**: `POST /position {sceneId, event:"start"|"end"}` at scene boundaries only (also after rewind/skip `start`).
9. **Pause/resume** (space, button): pauses audio and freezes drawing (no repaint advances).
10. **Rewind/skip** (sidebar click, ←/→): forward only if `ready`; jump = instant deterministic `renderBoardAt(sceneK, 0)` = all scenes since last wipe up to K−1 at u=1, then K plays from 0 (audio `currentTime = 0`).
11. **Questions** (`?` key or button; any state except `waiting`; disabled when resume-stack depth = 3): pause, push `{sceneId, t}`, show text field (Esc cancels and resumes), Enter → `POST /question`; state `thinking` (pen idles, caption). Answer scenes play as they become `ready` in playlist order for that `qId` (first is `wipe` by contract). When the `final` answer scene completes: pop stack → `renderBoardAt(sceneId, t)` (elements with `start < t` painted at u=1, others absent) → set audio `currentTime = t` → `playing`. If lesson had `ended`, answer scenes append and the lesson ends again. Nested questions during an answer: `atSceneId` is the answer scene interrupted; depth ≤ 3.
12. **Transcript** under the board: current scene's narration (live region), updated at scene start.
13. **Notes and messages**: `tts.ready=false` → prominent "OpenAI key required" message (with `reason`) and no Start gate progress; a `ready` scene with `audioUrl:null` or an audio element error → skip the scene with a visible inline note "scene skipped: audio unavailable" and continue; `degraded` scenes get a small marker in the sidebar and transcript.
14. **End** (`ended`): summary panel — scenes played, degraded count, svg element count (count from effective scenes), questions answered; stays visible; Ask still works (appends).
15. **Letterboxing**: the 1600×900 canvases scale uniformly to the window, centered, on resize.
16. **Accessibility** (§10): space, ←, →, `?`, Esc; all buttons focusable with labels; transcript is an `aria-live="polite"` region; no flashing.
17. **Debug/test hooks**: `window.__khan.engine = { state, position:{sceneId,t}, resumeStack, drawnElementIds(), playlist, config, events: [] (last 200 transitions), renderBoardAt(sceneId,t) }`.

Frozen `data-testid`s (QA and the manual test plan use these; add more as you like but keep these): `start-button`, `pause-button`, `ask-button`, `question-input`, `sidebar`, `sidebar-item-<sceneId>`, `transcript`, `caption`, `summary`, `tts-missing-note`, `scene-skipped-note`, `state` (an element whose text is the current state).

### Boundary
- Drawing of any element type → slices 02/03 via the registry; you call `registry.get(type)(element, ctx)` and the Drawable methods, nothing type-specific. Build `ctx` with `registry.boardRectsFor(...)`, `slotRect`, tokens, constants, the loaded font (`shared/handwriting.loadFont` from `/vendor/fonts/...`), `seed`.
- Server logic (ordering, `ended`, wait, questions ids) → foundation; you consume the playlist. Validation → foundation; never guard element fields beyond what the Drawable interface needs.
- The CLI/skill → slice 05.
- The harness page is foundation's; don't modify it.

## End goal
With the foundation server on `fixtures/lessons`, a user opens `/lesson/fx-answer-insert`, clicks Start, watches scenes play with placeholder rectangles (real strokes once slices 02/03 land — no change needed here), pauses, rewinds, skips, asks a typed question mid-scene, sees "khan is thinking…", watches the inserted answer scenes, and lands back exactly where they left off; at the end, a summary shows counts. All keyboard-operable.

## Acceptance criteria
1. Sidebar lists every outline scene before any scene is `ready`; badges track playlist status via SSE; `data-testid="state"` reads `waiting`.
2. Start gate both orders: (a) click Start before scene 1 is ready → state `armed`, then auto-`playing` the moment it is ready, audio element `paused === false`; (b) scene 1 ready first, then click → `playing` immediately.
3. Clock: during playback `drawnElementIds()` grows in `at` order; an element never appears before `at × D` of its scene's audio (test samples `audio.currentTime` and drawn set 10 times during `fx-build-region` s001).
4. Yield rule (`fx-long-stroke`): the last scene completes no earlier than audio end and no later than audio end + `YIELD_CAP_MS` + 200 ms; all element ids drawn at completion; then `ended`.
5. Advance: when N completes and N+1 is ready, `POST /position end` for N then `start` for N+1 are received by the server in that order (assert via `/status` or a test-side proxy counter), and nothing else is posted mid-scene.
6. Stall: test ingests only s001 of `fx-build-region`, plays it through with `config.stallCaptionMs=1000, stuckCaptionMs=3000`: state `stalled`, caption empty for 1 s, then "khan is thinking…", then "generation seems stuck" with an age string; no element with text "buffering"/no spinner element; after the test drops s002 in, `playing` resumes within 400–900 ms.
7. Pause/resume: space toggles; while paused `audio.paused === true`, `currentTime` unchanged over 500 ms, `drawnElementIds()` unchanged; resume continues from the same time.
8. Rewind: during s003 of `fx-build-region` (region scenes), click `sidebar-item-s002`: `drawnElementIds()` equals exactly the element ids of all scenes since the last wipe up to s001 (test computes expected set from the effective scenes), audio of s002 at `currentTime` < 0.2 s, `position start s002` posted. Jump to a `wipe` scene → set equals ∅ before its first element.
9. Skip: → on a not-ready later scene does nothing (state unchanged); on a ready one jumps.
10. Question flow (`fx-answer-insert`, test acts as producer): press `?` at t≈3 s of s002 → state `thinking`, `resumeStack.length === 1` with `{sceneId:"s002", t≈3}`, `question-input` focused; Enter posts `{text, atSceneId:"s002", atTime≈3}`; test copies `q001-a01.json`/`q001-a02.json` (editing `insertAfter` as needed) into the lesson → they play in order; after `q001-a02` completes: state `playing`, current scene `s002`, `audio.currentTime` within ±0.25 s of the snapshot, `drawnElementIds()` equals the set of s002 elements with `start < t` plus all earlier elements since last wipe, and nothing from the answer scenes.
11. Nested: ask during `q001-a01` → stack depth 2, `atSceneId:"q001-a01"`; after `q002-a01` (final) → returns to `q001-a01` at its t; after `q001-a02` → returns to `s002`. Depth 3 reached → `ask-button` disabled and `?` ignored; unwinds re-enable it.
12. Esc in the question field cancels: stack popped, resumes at the same t, no POST.
13. Ask after `ended`: answer scenes play, state returns to `ended`, summary updates `questions answered`.
14. Missing audio: a playlist entry with `audioUrl:null` (test uses the foundation's TTS-failed path or a stubbed playlist via a test-only fixture) → `scene-skipped-note` visible, next scene plays, position `start`/`end` still posted for the skipped scene (so `ended` can derive).
15. No key: with `tts.ready=false` in the playlist → `tts-missing-note` visible containing the reason; Start button disabled.
16. End summary: after `fx-full-tour` plays through, `summary` shows scenes = count of played entries, degraded = 0, svg elements = number of `svg` elements across effective scenes, questions = 0; after a `fx-degrade-flow` run with a degraded scene, degraded = 1 and the sidebar item is marked.
17. Keyboard: space, ←, →, `?`, Esc all work with focus on body; buttons have accessible names; `transcript` has `aria-live`; transcript text equals current scene narration at each scene start.
18. Letterbox: at viewport 1000×1000 the board's rendered box is 1000×562 (±2) centered vertically; at 2000×900 it is 1600×900 centered horizontally.
19. Zero console errors across all E2E runs; `node --check` over `player/engine/`; `npm test`, `npm run test:e2e` green.

## Required tests
This slice owns a spec-flagged medium risk ("Resume … wrong board or wrong time") and the start-gate UX risk — test deeply:
- Node unit (`test/engine/`): `reducer` (state machine as a pure function: every legal transition in §6 table plus illegal ones rejected: question in `waiting`, skip to not-ready, resume with empty stack); `scheduler` (u/drawEnd math incl. yield cap and natural-duration override, default `at` spacing, last window 0.95); `boardPlan` = pure `planBoardAt(playlist, scenesById, sceneId, t)` → `[{id, u}]` with cases: first scene, mid-region, after a wipe, t=0, t past last element, degraded scene (dropped elements absent), answer scenes excluded from the lesson board; `resumeStack` push/pop/cap 3.
- Playwright E2E (`e2e/engine-*.spec.js`), silent provider, temp lessons dir per test, test helpers that copy fixture scenes in one at a time to simulate production: criteria 1–19 each as its own test; question flow with nesting depth 2 (criterion 11) is mandatory per spec §11.
- Add fixtures `fx-eng-skip` (lesson where one scene's narration is replaced at test time to force a TTS failure — or document the stub approach you used) and `fx-eng-short` (3 very short scenes for fast E2E).

## Depends on
Foundation only.

## Design-asset dependencies
None gated. UI chrome and pen use token values from `shared/layout-core/tokens.js` (pipeline-status row `design-tokens`, placeholders now); no test asserts a color. Keep your markup contracts (`data-testid`s, class names) stable so a later design pass is additive (CLAUDE.md contract-first rule).

## Rules reminder
3-attempt stop rule; never weaken a test. Update your `pipeline-status.md` row. Commit and push. If the playlist/API contract turns out insufficient (e.g. you need `svg` counts server-side), do not edit `server/`; compute client-side or report the gap.
