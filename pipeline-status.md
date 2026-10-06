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
| renderer-core | briefs/02-renderer-core.md | in progress | foundation only; size L; text, list, code, table, math, box, arrow, highlight drawables |
| renderer-pictures | briefs/03-renderer-pictures.md | done | Done 2026-10-06 on branch `worktree-agent-a308cb7dd9acf21f2`. `sketch` (10-shape authored library in `player/renderer/pictures/sketch-library.js`), `diagram` (in-house deterministic layered layout, **no dagre vendored**), `plot`, `svg` registered via `player/renderer/pictures/index.js`; hooks under `window.__khan.rendererPictures`. Fixtures `fx-pic-dense`, `fx-pic-shapes` (validator-clean). Tests: `test/renderer-pictures/*` 45 unit, `e2e/renderer-pictures-harness.spec.js` 9 e2e (screenshots in `test-results/renderer-pictures/`); full run 143/143 unit, 14/14 e2e, check clean. Shared-module gap reported (not patched): vendored opentype `toPathData` emits `NaN` coordinates for some glyph offsets (its `roundDecimal` string-concatenates `"e+2"`); `shared/handwriting.glyphPaths` passes it through — pictures repairs affected glyphs locally (`common.glyphOutlines`); slice 02 will hit the same bug. Deviation: a diagram whose labels cannot fit even at note size scales uniformly (text included), recorded as `picture.textScale < 1`; fixtures assert the near-cap 2×2 case needs no scaling. |
| player-engine | briefs/04-player-engine.md | in progress | foundation only; size L; state machine, clock, pen, stall, rewind/skip, questions + resume stack, sidebar, transcript, summary |
| skill-cli | briefs/05-skill-cli.md | in progress | foundation only; size M; `bin/khan` (serve, outline, scene, wait, status, play) + `.claude/skills/khan/SKILL.md`; only slice allowed to edit package.json (adds `bin`) |

Parallel group after foundation: openai-tts, renderer-core, renderer-pictures, player-engine, skill-cli (no dependencies between them).

QA: not run
Deploy: not deployed (local tool; "deploy" = tagged release in the public repo)
