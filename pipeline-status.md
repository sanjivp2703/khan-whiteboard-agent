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
| renderer-pictures | briefs/03-renderer-pictures.md | in progress | foundation only; size L; sketch library, diagram layout, plot, svg drawables |
| player-engine | briefs/04-player-engine.md | done | Done 2026-10-06 on branch `worktree-agent-a9fe84e0f05e2c10a`. `player/engine/**` (reducer, scheduler, board-plan, resume-stack, index, ui, pen, engine.css), `test/engine/` 19 node tests, `e2e/engine-*.spec.js` 19 Playwright tests (criteria 1–18, nested questions to depth 3), fixtures `fx-eng-short`, `fx-eng-skip`. Gate: `npm test` 117/117, `npm run test:e2e` 25/25, `npm run check` clean. Deviations: UI chrome is overlays on the board (the shell's #engine-root is an overlay and criterion 18 needs the full letterbox); Ask disabled in `armed` as well as `waiting` (no position yet); a manual jump clears the resume stack; `e2e/foundation-shell.spec.js` now asserts `engine.stub === false`. TTS-failed / no-key paths are E2E-tested by serving a mutated playlist snapshot on the SSE route (silent provider never fails). |
| skill-cli | briefs/05-skill-cli.md | in progress | foundation only; size M; `bin/khan` (serve, outline, scene, wait, status, play) + `.claude/skills/khan/SKILL.md`; only slice allowed to edit package.json (adds `bin`) |

Parallel group after foundation: openai-tts, renderer-core, renderer-pictures, player-engine, skill-cli (no dependencies between them).

QA: not run
Deploy: not deployed (local tool; "deploy" = tagged release in the public repo)
