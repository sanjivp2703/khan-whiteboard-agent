# Pipeline status — khan

Idea: a Claude Code skill that turns the last response's explanation into a Khan Academy style narrated whiteboard video.

Repo: https://github.com/sanjivp2703/khan-whiteboard-agent (this folder is its working copy). Stack: Node >= 20, plain ESM, vanilla JS + rough.js player, no build step. Playwright pinned to 1.54.x (>= 1.62 has no Chromium for macOS 13; see lessons.md).

| Slice | Brief | Status | Notes |
|-------|-------|--------|-------|
| research | research/01-problems.md | done | research-agent, 2026-09-26; external signals only, no internal data source |
| spec | spec.md | done | approved 2026-10-05; sliced 2026-10-06 |
| foundation | briefs/00-foundation.md | done | **blocking; built first, alone.** Done 2026-10-06, commits 8fc5d54 → 8e95bc9 (stages 1–5). `npm test` 98/98, `npm run test:e2e` 5/5 (Chromium), `npm run check` clean. Playwright pinned **1.54.2** (>= 1.62 has no Chromium for macOS 13 — do not upgrade). No spec cap value tuned; foundation-chosen constants (SLOT_PAD 12, CODE_CHAR_ADVANCE 10, line heights, PEN_PX_PER_S 1500) documented in README. Contracts C1–C5 in README. Slice 01 import point: `server/tts/openai.js` exporting `createOpenAIProvider({apiKey, voice, env})`. |
| design-tokens | briefs/00-foundation.md (tokens section) | not started | token NAMES frozen by foundation with placeholder values (contract-first rule); final values await a design pass — no design agent planned yet; no slice test is gated on this |
| openai-tts | briefs/01-openai-tts.md | done | Done 2026-10-06, commit ddd9a31 (branch `worktree-agent-a141238716cde090d`). `server/tts/openai.js` + `server/tts/mp3-duration.js`, `test/tts/` (24 tests: 23 pass, 1 live smoke skipped unless `KHAN_LIVE_TTS=1`), `fixtures/audio/`. `npm test` 121/121 (+1 skipped), e2e 5/5, check clean. Defaults `tts-1` / `alloy`; voice is `KHAN_TTS_VOICE` > `tts.voice` config, chosen later by the human by listening (cache keyed by voice). Deviation: no MP3 encoder on this machine, so the fixtures are synthesized spec-conformant frame streams (silence), cross-checked with `afinfo` — see `fixtures/audio/LICENSE.md`. Finding: OpenAI 401 bodies echo the key; provider redacts it before the message reaches the playlist. |
| renderer-core | briefs/02-renderer-core.md | in progress | foundation only; size L; text, list, code, table, math, box, arrow, highlight drawables |
| renderer-pictures | briefs/03-renderer-pictures.md | in progress | foundation only; size L; sketch library, diagram layout, plot, svg drawables |
| player-engine | briefs/04-player-engine.md | in progress | foundation only; size L; state machine, clock, pen, stall, rewind/skip, questions + resume stack, sidebar, transcript, summary |
| skill-cli | briefs/05-skill-cli.md | done | Done 2026-10-06 on branch `worktree-agent-ae8d83018a983aa68`. `bin/khan` + `cli/**` (serve, outline, scene, wait, status, play), `.claude/skills/khan/SKILL.md`, `package.json` `bin` entry, README "CLI and skill" section. `npm test` 122/122 (24 in `test/cli/`), `npm run test:e2e` 5/5, `npm run check` clean. Deviations: the CLI owns browser opening (server spawned with `KHAN_NO_OPEN=1`) because the foundation server opens a tab for **every** lesson folder present at startup (foundation finding, not patched); `outline` is the brief's addition to the spec's command list. Manual QA of `/khan` on a real response needs slices 01 + 04 (see README). |

Parallel group after foundation: openai-tts, renderer-core, renderer-pictures, player-engine, skill-cli (no dependencies between them).

QA: not run
Deploy: not deployed (local tool; "deploy" = tagged release in the public repo)
