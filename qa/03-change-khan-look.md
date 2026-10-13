# QA — change-scoped report 03 (khan, change-khan-look, main @ ac91386)

Date: 2026-10-12/13. Tester: qa-tester, change-scoped mode (read-only on code; nothing committed). Change under test: `changes/change-khan-look/` (merge d87ba23; `ac91386` on top is README-only, `git diff d87ba23..ac91386 --stat` = README.md 4+/2−). Baseline from `tasks.md`: main 3543afc, unit 273 tests: 272 pass / 1 skipped / 0 fail; e2e 51 pass; check clean.

Environment: macOS 13, Node v22.5.1, Playwright 1.54.2 (Chromium). A human-owned khan server was live on 127.0.0.1:7777 for the whole session (not stopped, not written to; the only request it received from me was one `GET /api/lesson/nolesson/wait`, which 404s without side effects per QA 02 finding 13). Everything I started ran from isolated `KHAN_HOME` temp dirs under the session scratchpad on random ports (37502, 2xxxx) and was stopped afterwards; `lsof` shows nothing of mine listening.

**Verdict: passed (automated); human gate pending (audition + first real lesson).** No blocker or major finding. Two unit failures are environmental (the live 7777 server; proof below) and are reported separately. Three timing-tolerance flakes appeared only under load, in tests this change did not touch.

## Summary

| Area | Result |
|---|---|
| Ratchet (pass count, skips, no weakened tests) | pass: unit 272 → 291 effective (+19 new), e2e 51 → 52 (+1), skipped 1 → 1, 0 tests deleted or weakened |
| Token values (8 approved) in `tokens.js` and `tokens.css` | pass: exact match, CSS mirror equal, pinned by `test/foundation/tokens.test.js` |
| Chrome contrast | pass: test math re-derived by hand (panelMuted/panelBg = 5.66:1) |
| Pen = arrow with hotspot at tip | pass: unit polygon test + e2e pixel test + screenshots (arrow tip sits on the stroke end) |
| strokeWidth 3.2 / glyph widths | pass: `ROUGH_OPTIONS.strokeWidth 3.2`, `PEN.glyphEdge 1.3`, `PEN.glyphProgress 2.6` |
| TTS defaults, instructions gating, cache key | pass: code + 2 new tests + integration test; replay seam exercised by hand |
| `khan audition` | pass: in `--help`, no-key → exit 1 `TTS_NOT_READY`, mocked per-voice failure, auth short-circuit, retry per voice |
| SKILL.md rules + 13 JSON examples | pass: `test/cli/skill.test.js` (5/5) |
| Unchanged behavior list (8 lines) | pass: every line has a test, all run (table below); 2 lines additionally covered by my own sweeps |
| Seams (pen/engine, strokes/validator, chrome, cache/replay) | pass: 0 containment violations over 22 fixtures / 205 elements; replay with old cache entries: no crash, no re-synthesis loop |
| Screenshots (black board, five accents, muted grid/frames, hachure) | pass: nothing invisible on black |
| Environmental | 2 CLI tests fail at their final "server down" step only because 7777 is occupied |
| Flakes | 3 (all pre-existing timing tolerances, under load only) |

## Ratchet numbers

| Run | Conditions | `npm test` | `npm run test:e2e` | `npm run check` |
|---|---|---|---|---|
| baseline (tasks.md, 3543afc) | — | 273 tests: 272 pass / 0 fail / 1 skipped | 51 pass | clean |
| 1 | unit idle | 292 tests: **289 pass / 2 fail (env) / 1 skipped**, 20.1 s | — | — |
| 2 | e2e running, unit started 20 s into it (unit under e2e load, e2e under unit load) | 292: 288 pass / 3 fail (2 env + 1 flake) / 1 skipped, 61.5 s | 52 tests: **50 pass / 2 fail** (flakes, see below), 2.3 min | — |
| 3 | idle | 292: 289 / 2 (env) / 1, 18.5 s | 52 tests: **52 pass / 0 fail**, 2.1 min | clean ×2 (65 files, exit 0) |

- Passing count: 272 → 289 measured, 291 effective (the two environmental tests pass up to their last assertion, and pass outright when no server sits on 7777 — see Environmental). Either way ≥ 272. The +19 are: `test/foundation/tokens.test.js` 4, `test/engine/pen.test.js` 5, `test/cli/audition.test.js` 8, `test/tts/openai-provider.test.js` +2.
- Skipped: 1 → 1 (`test/tts/live.test.js`, live TTS; unchanged).
- e2e: 51 → 52 (+`e2e/look.spec.js`).

### Test files touched by the change (`git diff 3543afc..d87ba23 -- test e2e`, 7 files, 660+/20−)

| File | Kind | What changed / why it is legitimate |
|---|---|---|
| `e2e/look.spec.js` | new | board pixel = `tokens.boardBg` = (0,0,0); arrow body white (min channel > 200, alpha > 150) at tip+(3,8); nothing at tip−6 px; two screenshots to `test-results/look/` |
| `test/cli/audition.test.js` | new | 8 tests: arg parsing, help, no-key, mocked API per voice, flags, failure handling, `playFile` argv hygiene, direct call |
| `test/engine/pen.test.js` | new | 5 tests against a recording 2D context: API, hidden, draw polygon (first vertex = hotspot, nothing left of / above it, 22–30 px tall), redraw/park, idle |
| `test/foundation/tokens.test.js` | new | 4 tests: eight approved values pinned, names frozen, CSS mirror equal, contrast contract |
| `test/cli/args.test.js` | modified-and-why | "six commands" → "seven" in two tests: adds `audition` to the asserted command list and `COMMANDS` length 6 → 7. Additive (the six old names are still asserted); matches the ADDED delta (§8 CLI list) |
| `test/tts/integration.test.js` | modified-and-why | cache-key helper moved to the 5-arg form (`keyOf`), and **adds** assertions that the wire body carries `model` and `instructions` and the sidecar records `model` + a 64-hex `instructionsHash`. Nothing removed; matches the MODIFIED §10 cache-key delta |
| `test/tts/openai-provider.test.js` | modified-and-why | asserted defaults `alloy`/`tts-1` → `ash`/`gpt-4o-mini-tts` (MODIFIED §10 delta); wire body `deepEqual` gains `instructions`; provider key list gains `instructions`; +2 new tests (instructions gating/precedence; cache key over model+instructions). The 20 deleted lines are all these replaced assertions; no assertion was dropped without a stronger successor |

No test was deleted, no tolerance loosened, no `skip`/`todo` added.

## Spec deltas — verification

| Delta | How verified | Result |
|---|---|---|
| Eight token values (§4.4 ADDED) | Read `shared/layout-core/tokens.js` and `player/tokens.css`: `boardBg #000000, chalk #FFFFFF, accent1 #FFE066, accent2 #65D0FA, accent3 #FF8D71, accent4 #59F3CE, accent5 #FB73BE, muted #717378` — identical to design/01 "Proposed token values" and to `APPROVED` in `tokens.test.js`; CSS `:root` mirrors every key (test asserts `deepEqual(inCss, cssVars(tokens))`) | pass |
| Chrome contrast (`tokens.test.js` contract test) | Re-derived WCAG relative luminance by hand for panelMuted `#9A9CA3` (L = 0.3328) on panelBg `#21242C` (L = 0.0177): (0.3328+0.05)/(0.0177+0.05) = **5.66:1** ≥ 4.5 as the test asserts. Also computed: panelText/panelBg 12.77, panelMuted/pageBg 7.13, muted/board 4.43 (≥ 3 required), accents on black 8.30–16.11 | pass |
| Pen: white arrow, dark outline, ~1.3×, hotspot at tip (§6 ADDED) | `player/engine/pen.js`: `ARROW_SHAPE[0] = [0,0]` drawn at `(tip.x, tip.y)` with no transform, `ARROW_SCALE 1.35`, fill `#FFFFFF`, outline `#000000` 1.6 px; engine `index.js:638-650` feeds `drawable.tipAt(u)` straight into `setTip`. Unit test asserts the polygon's first vertex equals the tip and the bounds hang down-right; e2e samples pixels. Screenshots `test-results/look/shell-paused-s001.png` (arrow tip on the end of the half-written "How the re") and `shell-playing-s002.png` (arrow tip on the "r" of the sketch label being written) | pass |
| Thicker strokes (§6 ADDED) | `shared/layout-core/constants.js` `ROUGH_OPTIONS.strokeWidth 3.2` (was 2.5); `player/renderer/core/drawable.js` `PEN.glyphEdge 1.3` (was 1.0), `glyphProgress 2.6` (was 2.2) | pass |
| TTS defaults, instructions, precedence (§10 MODIFIED) | `server/tts/openai.js`: `DEFAULT_MODEL 'gpt-4o-mini-tts'`, `DEFAULT_VOICE 'ash'`; `resolveInstructions` env > config > `DEFAULT_INSTRUCTIONS`; `INSTRUCTIONS_UNSUPPORTED_MODELS = ['tts-1','tts-1-hd']`; body spreads `instructions` only when `resolvedInstructions !== null`; `provider.instructions` is `null` for those models. Default text names no person (test asserts no `khan`/`sal`). Covered by the new "instructions (design cycle 1)" test (both legacy models, env/config/explicit precedence, `selectProvider` pass-through) and `integration.test.js` through the server | pass |
| Cache key over (provider, voice, model, instructions, text) (§10 MODIFIED) | `server/tts/cache.js`: `sha256(provider|voice|model|sha256(instructions)|text)`; `cacheKeyFor(provider, text)` reads `provider.model/instructions ?? null`; sidecar stores `model` and `instructionsHash`; `lookup` tolerates sidecars lacking the new fields (spread). New test asserts each factor changes the key, 3-arg form still works, tts-1 instructions do not enter the key | pass |
| `tts.model`, `tts.instructions` config (§9 MODIFIED) | `server/tts/index.js` now passes `config` to `createOpenAIProvider`; test `viaFoundation` asserts `tts.model`/`tts.instructions` from config take effect | pass |
| `khan audition` (§8 ADDED) | `cli/commands/audition.js` + `cli/args.js` + `cli/main.js`. Ran `./bin/khan --help` → line `audition  hear the candidate voices (needs OPENAI_API_KEY); adopt one with KHAN_TTS_VOICE=<voice>`; `./bin/khan audition --help` → usage with `--text --voices --out --no-play --pretty`, exit 0. `env -u OPENAI_API_KEY KHAN_HOME=<tmp> ./bin/khan audition --no-play` → `{"ok":false,"code":"TTS_NOT_READY","message":"OPENAI_API_KEY not set",...}` exit 1, nothing written. Mocked tests cover: cedar 400 → per-voice `TTS_BAD_REQUEST`, others continue and are played in order; all voices fail → `AUDITION_FAILED` exit 1; 401 on the first voice → remaining voices skipped with no further requests and the key redacted; 500×3 on one voice → that voice `TTS_FAILED`, next voice gets a fresh attempt budget; `afplay` spawned with an argv array, `shell:false` | pass |
| SKILL.md color defaults + narration style (§8 ADDED) | Diff read: new "Narration style" paragraph (conversational, think out loud, introduce a term then use it, address the viewer, concrete numbers, place `highlight`/`pointer` when referring to the board; "no filler praise"); "Color" paragraph (body text/lists/tables/math/code labels take the concept's accent, chalk for neutral connecting text; yellow/blue/coral/teal+pink defaults); examples re-coloured to one shared map. `grep -c '```json'` = 13; `test/cli/skill.test.js` 5/5 passed in every run (every block validates in a fresh occupancy; all 30 error codes and 38 banned macros still listed; `wait --timeout 100` rule intact) | pass |
| README | "Design: the Khan Academy look", "TTS" (defaults, precedence, audition) and "CLI and skill" sections updated; ac91386 drops the "placeholder" wording | pass |

## Unchanged behavior — coverage

| Proposal line | Test(s) that exercise it | Run / result |
|---|---|---|
| Token names unchanged; `color` accepts exactly accent1…5 + muted; validator caps/codes unchanged | `test/foundation/tokens.test.js` "token NAMES are frozen" (asserts `COLOR_TOKENS` and the 15 token keys); `test/foundation/validate.test.js`; `test/cli/skill.test.js` (all 30 `ERROR_CODES` still present) | pass in all 3 unit runs |
| Every drawable's bounds inside its slot for every fixture (validator ↔ renderer) | `test/renderer-core/sweep.test.js` criterion 2; `test/renderer-pictures/sweep.test.js` containment; `e2e/foundation-harness.spec.js` criterion 17. Plus my sweep (`scratchpad/sweep.mjs`): 22 lessons, 82 scenes, 0 invalid; 123 core + 82 picture elements prepared, 0 pending, **0 containment violations** | pass |
| Pen module API unchanged; engine needs no change | `test/engine/pen.test.js` "API" test; `git diff 3543afc..d87ba23 -- player/engine/index.js` is empty (only `pen.js` changed); all 19 `e2e/engine-*` tests pass | pass |
| Yield rule, stall captions, resume depth 3, rewind/skip, answer-replay fix | yield: `e2e/engine-clock.spec.js` criterion 4 + `test/engine/scheduler.test.js`; stall: `engine-clock` criterion 6; depth 3: `e2e/engine-question.spec.js` criterion 11 + `test/engine/reducer.test.js` + `resume-stack.test.js`; rewind/skip: `e2e/engine-jump.spec.js` criteria 8–9 + `test/engine/board-plan.test.js`; answer replay: `engine-question` criterion 10b + `board-plan` `nextEntryAfter`. Plus my rewind sweep (`scratchpad/rewind-sweep.mjs`, fx-full-tour, fx-core-dense, fx-core-arrows, fx-pic-dense, fx-pic-shapes, fx-build-region at 2×): **42 jumps, 0 drawn-set vs `planBoardAt` mismatches, 0 console errors** | pass (criteria 7 and 11 flaked once under load, see Flakes; passed idle) |
| `ready()` without a key → `{ok:false, reason:"OPENAI_API_KEY not set"}`; `TTS_FAILED` handling and key redaction; silent provider drives tests | `test/tts/openai-provider.test.js` (no-key, key hygiene, redaction, new test's last assertion); `test/foundation/tts.test.js` criterion 14 (server without key: `tts.ready=false`, `audioUrl:null`, `TTS_FAILED`) and silent-provider WAV test; `e2e/engine-notes.spec.js` criteria 14–15; every e2e and CLI test runs on `KHAN_TTS=silent` | pass |
| All 13 SKILL.md JSON examples validate; error-code and macro lint | `test/cli/skill.test.js` | pass |
| `khan serve/outline/scene/wait/status/play` as before; `wait --timeout 100` loop | `test/cli/serve.test.js`, `outline-scene.test.js`, `wait.test.js`, `production.test.js`, `atomic.test.js`, `inbox-sync.test.js`, `args.test.js`; `skill.test.js` asserts the `--timeout 100` invocation and the silent re-wait rule | pass, except the two environmental final steps (below) |
| Muted scaffolding (axes, grid, faint code frames) and hachure visible on black | no pixel test; screenshot inspection (this report) + **human smoke test**. `tokens.test.js` guards the floor (muted ≥ 3:1 on the board; measured 4.43) | pass by inspection |

## Seams this change touches

- **Engine ↔ pen (hotspot vs `tipAt`).** `index.js:638` → `safeTip(d,u)` → `pen.setTip(p)`; `pen.js` draws vertex 0 of the arrow at exactly `(tip.x, tip.y)`. Screenshots after a fresh `npm run test:e2e`: `test-results/look/shell-paused-s001.png` shows the arrow tip on the end of the stroke in progress; `shell-playing-s002.png` shows it on the label glyph being written under the database sketch. The e2e pixel probe (`inside = tip+(3,8)` white, `outside = tip−6` empty) passed in both e2e runs.
- **Bolder strokes vs validator fit.** Sweep over all 22 fixtures: 0 violations (bounds are computed from the flattened rough paths, so jitter is included). The tightest elements are 12 `box` drawables inset exactly 2 px from their slot edge; with strokeWidth 3.2 the ink's outer edge is 0.4 px inside the slot (was 0.75 px at 2.5). See finding 3.
- **Chrome tokens vs sidebar / transcript / question form.** `shell-paused-s001.png`: sidebar (`panelBg #21242C`) with `panelText` titles and `panelMuted` ids/badges legible; transcript bar legible on the board. My own capture (`scratchpad/qa3-question-form.png`, fx-eng-short, Ask pressed): question form with the light-blue frame, yellow focus ring, Cancel and hint text all legible; letterbox bars in `pageBg #0B0C0F`. No chrome text falls below 4.5:1 (test) and nothing looked washed out.
- **Cache key vs `khan play` replay (silent provider).** `scratchpad/cache-seam.sh`: fresh `KHAN_HOME`, copy of `fixtures/lessons`, cache pre-seeded with v0.1.0-format entries `sha256('silent||'+text)` for the three fx-type-text scenes **and** one entry under the *new* key for s001 carrying an old sidecar (no `model`/`instructionsHash`). `khan play fx-type-text --lessons-dir <copy> --port 37502`: `ok:true, spawned:true, ingested:true`; playlist `s001:ready s002:ready s003:ready` with audio; `khan status` ready 3/3; `server.log` 0 errors. Cache went 8 → 170 files (85 wav + 85 json): the server voices every lesson folder it serves (82 scenes) and **reused** the s001 new-key entry with the old sidecar (81 new pairs, not 82). Old-key files sit unused, as the proposal says. Kill, `khan play` again on the same home: all ready, cache still 170 files → no re-synthesis loop, no crash.

## Findings

No blocker, no major.

1. **minor (test infrastructure, pre-existing) — timing tolerances fail under CPU load.** Repro: start `npm run test:e2e`, then `npm test` 20 s later. Observed once each: `e2e/engine-clock.spec.js:177` criterion 7 `expect(a3.currentTime - a1.currentTime).toBeLessThan(0.5)` got 1.159; `e2e/engine-question.spec.js:129` criterion 11 `expect(|r3.live.audio - top3.t|).toBeLessThanOrEqual(0.25)` got 1.835; `test/cli/production.test.js:207` `assert.equal(r.json.ingested, true)` got false (`waitForOutline` 5 s budget in `cli/lesson.js:144` exceeded while `khan play` spawned under load). All three passed in every idle run (e2e 52/52, unit twice). None of these tests was touched by this change. Suggest the builders' "fast tier" note, or looser budgets, when the two suites are run concurrently.
2. **minor (cost, behaviour note for the human) — first server start after this change re-voices every lesson already in the lessons dir.** The server voices every lesson folder it serves at startup (observed: replaying one fixture produced 82 cache entries for all 22 fixtures). Because the key now includes model and instructions, every existing `.khan/lessons/*` scene misses the cache once and is re-synthesized with `gpt-4o-mini-tts`/`ash` on the first restart (≈ $0.05–0.15 per lesson per the spec's own estimate). Not a defect against the proposal ("old entries go unused"), but worth a line in the release notes; moving old lesson folders out of `.khan/lessons` before restarting avoids it.
3. **informational — box ink margin is now 0.4 px.** Boxes are inset 2 px from the slot rect and bounds exclude line width, so at strokeWidth 3.2 the ink edge lies 0.4 px inside the slot. Containment holds for all fixtures; any future width above 4 px would cross the slot edge into the neighbouring cell. Recorded so the next "even bolder" request knows the ceiling.
4. **informational — `modelSupportsInstructions` is exclusion-based.** Any model name other than `tts-1`/`tts-1-hd` (including typos) gets `instructions`; a non-instructable model would surface as `TTS_BAD_REQUEST` 400 rather than a silent omission. Correct for the current catalogue; noted for when the list changes.
5. **informational (pre-existing, v1 design) — while paused the open sidebar overlays the top-left of the board** (`shell-paused-s001.png`: the half-written title sits under the translucent panel). The sidebar collapses to a 22 px strip while playing. Unchanged by this change; listed only because the screenshot is new.

## Environmental failures (reported separately, not counted against the ratchet)

- `test/cli/outline-scene.test.js:130` ("scene …", final step) and `test/cli/wait.test.js:83` ("wait …", step e) fail with `1 !== 2` in every unit run: after the test's own server is closed, the CLI falls back to the default port (`cli/paths.js:36` "--port > KHAN_PORT > config.port > 7777") and finds the human's live server there, so it returns `HTTP_404 unknown lesson` exit 1 instead of `SERVER_DOWN` exit 2. Both tests pass every earlier assertion (stack traces point only at the final step). Cause verified: from an isolated home, `KHAN_HOME=<tmp> KHAN_PORT=7999 KHAN_TTS=silent ./bin/khan wait nolesson --timeout 1` → `{"event":"error","code":"SERVER_DOWN",...}` exit 2; the same command without `KHAN_PORT` → `{"event":"error","code":"HTTP_404","message":"unknown lesson"}` exit 1. They will pass as soon as nothing listens on 7777.

## Flakes (failed in one run, passed in another)

| Test | Failing assertion | Runs |
|---|---|---|
| `e2e/engine-clock.spec.js:152` criterion 7 pause/resume | `:177` `a3.currentTime − a1.currentTime < 0.5`, got 1.159 | fail 1/2 (under unit load), pass idle |
| `e2e/engine-question.spec.js:93` criterion 11 nested questions | `:129` `abs(r3.live.audio − top3.t) ≤ 0.25`, got 1.835 | fail 1/2 (under unit load), pass idle |
| `test/cli/production.test.js:187` `khan play fx-full-tour` | `:207` `r.json.ingested === true`, got false | fail 1/3 (under e2e load), pass 2/2 idle |

The `lifecycle.test.js:33` flake from QA 02 did not reappear in 3 runs (its fix landed in 1ac1cd7). The `< 150 ms` prepare-time assertions did not flake.

## Not tested (needs the human)

`khan audition` with a real key (voice choice); a real lesson through `/khan` in a live Claude Code session with the new narration/color rules; the look on the human's own display (the screenshots here are headless Chromium at 1280×800). Those are the "human gate" in the verdict.

## Verdict

`passed (automated); human gate pending (audition + first real lesson)`
