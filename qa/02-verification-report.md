# QA — verification report 02 (khan, main @ 95c6b88, fix pass 1)

Date: 2026-10-06. Tester: qa-tester (read-only on code). Same environment as report 01: macOS 13, Node v22.5.1, Playwright 1.54.2 (Chromium), `KHAN_TTS=silent`; no OpenAI key, no live Claude Code session. Every finding below was re-tested with the original repro from `qa/01-integration-report.md` (scratch CLI server on port 7911 over a fresh `KHAN_HOME`, Playwright driving `window.__khan.engine`, in-process `startServer` with an opener spy, curl for HTTP).

**Overall verdict: passed.** All 13 findings are fixed; no blocker or major remains open. Two minor observations are new (N1, N2 below), neither blocks.

## Gate numbers

| Run | `npm test` | `npm run test:e2e` | `npm run check` |
|---|---|---|---|
| 1 (idle) | 273 tests: 272 pass, 0 fail, 1 skipped (live TTS) | 51 passed, 0 failed (2.1 min) | clean |
| 2 (idle) | 272 / 0 / 1 | 51 / 0 | — |
| 3 (unit suite twice while E2E ran) | first: **271 pass, 1 fail** (`test/foundation/lifecycle.test.js:33`, see N1); second: 272 / 0 | 51 / 0 under load | — |

Flaky tests observed across all runs: exactly one, `lifecycle.test.js:33` "in-process: a new outline opens the browser unless KHAN_NO_OPEN=1" (1 of 2 loaded runs). The ones the fixers expected (`< 150 ms` renderer prepare-time assertions in `test/renderer-core/sweep.test.js:137` / `test/renderer-pictures/sweep.test.js:102`, and `e2e/engine-jump.spec.js` criterion 8) did **not** flake in 4 unit runs and 3 E2E runs (2 of each under load); they stay on the candidate list from report 01. `test/cli/production.test.js:129` (finding 4) passed in all 4 unit runs including both loaded ones.

## Per-finding verification

| # | Finding (report 01) | Fixer's claim | Verified by | Result |
|---|---|---|---|---|
| 1 | Answer scenes replay after the resumed scene ends | per-pass played set; E2E 10b + 11 | Original fx-eng-short repro: scene starts now `s001, q001-a01, s001(resume), s002, s003`; position posts have one `start/end q001-a01`; summary scenes 4, questions 1. Depth-3 tour scenario: all three resumes exact, no cascade replay, playlist order unchanged, 0 console errors. Question asked while `stalled`: resume lands on s001 at t = D, completes, returns to `stalled` (no replay). | **fixed** |
| 2 | `foundation-harness` criterion 17 asserted fallback shapes | rewritten to containment + fallback-for-unregistered-type | Read the new test: asserts every drawable of all 10 tour scenes is inside its slot (or the board for arrow/highlight), has strokes, parts/partStarts consistent, not equal to the slot; a second test unregisters `text` in-page and asserts the fallback's exact shape. Not weakened — strictly more coverage than before. Passes 3/3. | **fixed** |
| 3 | `engine-clock` criterion 4 second half assumed fallback stroke lengths | rewritten to assert the spec yield rule | Read the new test: both halves assert complete ≥ audio end, complete − ended ≤ cap + 200, `holdMs` ≤ cap + 200, every element at u = 1 at completion; stretched half still requires the cap to decide (`snap === true`); unstretched half requires `snap === (holdMs ≥ cap)`. Passes 3/3. | **fixed** |
| 4 | `khan scene` read `control/inbox.json` before the server wrote it (flaky under load) | `inboxReflects`/`waitForInbox`, `inboxStale` flag, new `test/cli/inbox-sync.test.js` | Code read: inbox accepted only when its `producerLastWriteAt` equals the playlist stamp and its pending/notices agree with the entry's verdict; otherwise counts come from the HTTP snapshot and `inboxStale: true` is set. CLI flow: valid scenes and a reject both reported consistent (`inboxStale` absent, `inbox.rejects` 1 right after the reject). `production.test.js` degrade-visibility passed 4/4 incl. 2 under load (was 2/3 failing). | **fixed** |
| 5 | Server opened a tab for every lesson folder at startup (22) | opener only for outlines appearing after startup (`meta.initial`) | Opener spy over a copy of `fixtures/lessons`: **0** calls after startup ingest of 22 folders; a new outline written afterwards → exactly 1 call with the right URL; rewriting that outline → still 1. | **fixed** (see N1 for a race in the "after startup" boundary) |
| 6 | Valid scene rewritten invalid was degraded with no reject round | `invalidAttempts` per revision | `s003` ready → rewritten as `REGION_OCCUPIED` → `rejected`, `khan wait` → `reject` attempt 1 → second invalid write → `degraded` with notice. | **fixed** |
| 7 | `/events` 404 before ingest → 2 console errors | SSE accepts a well-formed not-yet-ingested id with a `waiting` event; malformed → 400 | `curl` on an unknown well-formed id: 200 `text/event-stream`, `event: waiting`, heartbeats; when the outline landed the same stream received `event: playlist` snapshots (pending stream attached). Malformed id → 400. Browser early-open probe: **0** console errors (was 2), sidebar fills from the outline, Space arms, s001 auto-plays. The 400-for-malformed choice is right: it is the same regex guard every route applies; only well-formed ids are plausible lesson ids worth waiting for. No disagreement. | **fixed** |
| 8 | `shared/handwriting.glyphPaths` emitted `NaN` (2.1 %) | own serializer from path commands | Same scan as report 01 (231 584 glyphs, 4 styles × 4 x-offsets): **0 NaN** (was 4 903). Renderer sweep unchanged (0 NaN, 0 containment violations). | **fixed** |
| 9 | Engine never awaited `rendererCore.ready` / `warm()` | awaits bounded 15 s; warms on scene fetch | Engine events now carry `renderer-ready {hook:true, outcome:"ready", waitedMs:0}`; `warmScene` runs on every scene fetch. Math lessons (`fx-type-math`, `fx-core-dense`, `fx-full-tour`), including with MathJax fetches delayed 4 s: every math drawable has real paths, 0 pending, 0 console errors. | **fixed** |
| 10 | 18 px horizontal overflow at 320 px wide | CSS fix | 320×640: `scrollWidth` 320 (was 338); 400×300 and 3000×400 unchanged and correct; Start/Pause/Ask visible and inside the viewport. | **fixed** |
| 11 | > 64 KB body destroyed the socket | 413 | Declared `Content-Length` 70 KB → `413 {"error":"body too large (max 65536 bytes)"}`; chunked 70 KB → 413 too. | **fixed** |
| 12 | SKILL.md error table / macro list incomplete | all 30 codes, 38 macros, lint test | Scripted check: every code in `ERROR_CODES` (30) appears as a backticked code in SKILL.md; all 38 `BANNED_MACROS` appear; `khan wait <lessonId> --timeout 100` with the "re-wait silently on `timeout`" rule; `test/cli/skill.test.js` passes (all fenced JSON still validates). | **fixed** |
| 13 | `GET /wait` on an unknown lesson created a phantom lesson | 404 | `curl` → `404 {"error":"unknown lesson"}`; `khan wait zzzz-unknown-lesson` → `{"event":"error","code":"HTTP_404"}` exit 1; `/playlist` for that id stays 404 (nothing materialised). | **fixed** |

## Regression spot-checks at the seams passed in report 01

| Seam | Result |
|---|---|
| Resume after questions to depth 3 with real renderers (fx-full-tour copy) | pass — r1/r2/r3 exact `t` and planned drawn sets, Ask disabled at depth 3, summary 15 scenes / 3 questions, 0 problems, 0 console errors |
| Rewind sweep (fx-full-tour, fx-core-dense, fx-core-arrows, fx-pic-dense, fx-pic-shapes, fx-build-region) | pass — 0 drawn-set mismatches over 42 jumps; only the benign `play-rejected` log from my immediate pause after each jump |
| CLI flow with a question (serve → outline → scenes → `wait` continue → final → blocked `wait` + `POST /question` → `question` → answer scene → fake player → `finished` with summary) | pass |
| Degrade path in the player (element drop + narration-only `region C1`) → summary degraded 2, `khan status` degraded 2, sidebar/transcript markers | pass |
| Security (foreign Origin 403, `..%2F` 400, static traversal variants 404) | pass |
| No-key server (real `openai` provider): note, Start disabled, "no audio" badges, `TTS_FAILED` entries | pass |
| Tiny viewports, keyboard-only arm, outline-only lesson | pass |

## The engine fix's behaviour nuance (coordinator question 4)

Observed: after the resume, the lesson continues with the next lesson scene (s002); pressing `→` right after the resume also goes to s002, not to the just-heard answer; a manual rewind to s001 starts a new pass and the sequence is `s001, q001-a01, s002, s003` — the answer replays in position.

Judgement against spec §7: this matches. §7 step 5 says the player "resumes exactly where it stopped"; continuing with the next lesson scene is the only reading in which the user does not re-watch the answer they just saw. §7 "Rewind / skip" says "Answer scenes already in the playlist are replayed in position", which is exactly what the new pass does after a manual jump. `→` skipping the already-played answer is a sensible extension of step 5 (skip means "move on"). One asymmetry to be aware of, from code reading (`skipBack` uses the previous playlist entry): after `→` to s002, `←` lands on q001-a01 rather than s001, and since any jump starts a new pass it then plays q001-a01 → s002. That is spec-conformant (rewind replays answers in position) and I do not count it as a defect; a human may still prefer `←` to step over answers symmetrically — a product choice, not a bug.

## New observations (not blocking)

- **N1 (minor, foundation; also the one flaky test).** The "after startup" boundary in the fix for #5 is "after the watcher's first scan completed" (`initialScan` flag). A lesson folder that appears between `listen()` (when `/api/health` starts answering) and the end of the first scan is tagged `initial: true` and never opens the browser. That is what `lifecycle.test.js:33` hit once under load: it copies the fixture immediately after `startTestServer` resolves. Product impact is nil via the CLI (the CLI opens the tab itself and passes `KHAN_NO_OPEN=1`), and small for `npm run serve` + a hand-written lesson in the first ~100 ms. Suggested test-side fix: wait for the first scan (e.g. `watcher.seen` populated or a short settle) before copying; a product-side option is to treat only files whose mtime predates server start as initial.
- **N2 (informational, skill).** `khan wait --timeout 100` means a long buffered lesson produces a `timeout` event roughly every 100 s, each one a Bash call Claude must repeat silently. SKILL.md documents this; context cost is one short JSON line per 100 s. Fine, but worth watching in the first real run (needs human, as in report 01).

## Not re-tested (unchanged from report 01)
Anything with a real key or a live Claude Code session; Firefox/Safari; the real 10-minute idle exit; the 30 s reject grace. The "needs human" list in `qa/01-integration-report.md` still applies, with one update: the Bash-timeout item is now addressed by SKILL.md (`--timeout 100`), so the human check becomes "confirm the silent re-wait loop behaves in a real session".
