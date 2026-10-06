# Pipeline status — khan

Idea: a Claude Code skill that turns the last response's explanation into a Khan Academy style narrated whiteboard video.

Repo: https://github.com/sanjivp2703/khan-whiteboard-agent (this folder is its working copy). Stack: Node >= 20, plain ESM, vanilla JS + rough.js player, no build step. Playwright pinned to 1.54.x (>= 1.62 has no Chromium for macOS 13; see lessons.md).

| Slice | Brief | Status | Notes |
|-------|-------|--------|-------|
| research | research/01-problems.md | done | research-agent, 2026-09-26; external signals only, no internal data source |
| spec | spec.md | done | approved 2026-10-05; sliced 2026-10-06 |
| foundation | briefs/00-foundation.md | done | **blocking; built first, alone.** Done 2026-10-06, commits 8fc5d54 → 8e95bc9 (stages 1–5). `npm test` 98/98, `npm run test:e2e` 5/5 (Chromium), `npm run check` clean. Playwright pinned **1.54.2** (>= 1.62 has no Chromium for macOS 13 — do not upgrade). No spec cap value tuned; foundation-chosen constants (SLOT_PAD 12, CODE_CHAR_ADVANCE 10, line heights, PEN_PX_PER_S 1500) documented in README. Contracts C1–C5 in README. Slice 01 import point: `server/tts/openai.js` exporting `createOpenAIProvider({apiKey, voice, env})`. |
| design-tokens | briefs/00-foundation.md (tokens section) | not started | token NAMES frozen by foundation with placeholder values (contract-first rule); final values await a design pass — no design agent planned yet; no slice test is gated on this |
| openai-tts | briefs/01-openai-tts.md | in progress | foundation only; size S; `server/tts/openai.js` + mp3 duration; voice is `tts.voice` config, chosen later by the human |
| renderer-core | briefs/02-renderer-core.md | done | Done 2026-10-06 on branch `worktree-agent-a90cd8cae18394916` (commits ab5ff59 → c112e24 + status). `player/renderer/core/**` registers text, list, code, table, math, box, arrow, highlight; hooks under `window.__khan.rendererCore` (`warm(scene)`, `ready`, `prepares`). `npm test` 145/145 (47 new in `test/renderer-core/`), `npm run check` clean, `npm run test:e2e` 19/20: the one failure is the foundation's `e2e/foundation-harness.spec.js` first test, which asserts fx-full-tour draws with the *fallback* (bounds = slot rect, 1 path) — true only while no renderer is registered; foundation-owned, not edited, needs rewriting once renderers are merged (slice 03 will hit it too). Fixtures added: `fx-core-dense`, `fx-core-arrows`. Screenshots: `test-results/renderer-core/` after `npm run test:e2e`. Shared gap (not patched): vendored opentype.js `roundDecimal` emits `NaN` in `toPathData` for some glyph x positions, so `handwriting.glyphPaths().d` can be unparsable; the renderer serializes outlines from `glyph.getPath().commands` itself. Notes for slice 04: `prepare` is sync; math needs MathJax initialised (`rendererCore.ready`) or `warm(scene)` first, else a `pending` drawable (empty) is returned; list `itemAt` windows use `ctx.window = {at,end}` when the engine supplies it. |
| renderer-pictures | briefs/03-renderer-pictures.md | in progress | foundation only; size L; sketch library, diagram layout, plot, svg drawables |
| player-engine | briefs/04-player-engine.md | in progress | foundation only; size L; state machine, clock, pen, stall, rewind/skip, questions + resume stack, sidebar, transcript, summary |
| skill-cli | briefs/05-skill-cli.md | in progress | foundation only; size M; `bin/khan` (serve, outline, scene, wait, status, play) + `.claude/skills/khan/SKILL.md`; only slice allowed to edit package.json (adds `bin`) |

Parallel group after foundation: openai-tts, renderer-core, renderer-pictures, player-engine, skill-cli (no dependencies between them).

QA: not run
Deploy: not deployed (local tool; "deploy" = tagged release in the public repo)
