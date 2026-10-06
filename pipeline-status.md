# Pipeline status — khan

Idea: a Claude Code skill that turns the last response's explanation into a Khan Academy style narrated whiteboard video.

Repo: https://github.com/sanjivp2703/khan-whiteboard-agent (this folder is its working copy). Stack: Node >= 20, plain ESM, vanilla JS + rough.js player, no build step. Playwright pinned to 1.54.x (>= 1.62 has no Chromium for macOS 13; see lessons.md).

| Slice | Brief | Status | Notes |
|-------|-------|--------|-------|
| research | research/01-problems.md | done | research-agent, 2026-09-26; external signals only, no internal data source |
| spec | spec.md | done | approved 2026-10-05; sliced 2026-10-06 |
| foundation | briefs/00-foundation.md | in progress | **blocking; built first, alone.** Size L. Shared modules (layout-core, handwriting, math, mermaid-subset, expr, svg-subset, strokes), full validator, fixtures, server (watch/validate/degrade/playlist/SSE/REST/wait/lifecycle) with silent TTS + cache, player shell, registry + fallback drawable, harness page, Playwright config |
| design-tokens | briefs/00-foundation.md (tokens section) | not started | token NAMES frozen by foundation with placeholder values (contract-first rule); final values await a design pass — no design agent planned yet; no slice test is gated on this |
| openai-tts | briefs/01-openai-tts.md | not started | foundation only; size S; `server/tts/openai.js` + mp3 duration; voice is `tts.voice` config, chosen later by the human |
| renderer-core | briefs/02-renderer-core.md | not started | foundation only; size L; text, list, code, table, math, box, arrow, highlight drawables |
| renderer-pictures | briefs/03-renderer-pictures.md | not started | foundation only; size L; sketch library, diagram layout, plot, svg drawables |
| player-engine | briefs/04-player-engine.md | not started | foundation only; size L; state machine, clock, pen, stall, rewind/skip, questions + resume stack, sidebar, transcript, summary |
| skill-cli | briefs/05-skill-cli.md | not started | foundation only; size M; `bin/khan` (serve, outline, scene, wait, status, play) + `.claude/skills/khan/SKILL.md`; only slice allowed to edit package.json (adds `bin`) |

Parallel group after foundation: openai-tts, renderer-core, renderer-pictures, player-engine, skill-cli (no dependencies between them).

QA: not run
Deploy: not deployed (local tool; "deploy" = tagged release in the public repo)
