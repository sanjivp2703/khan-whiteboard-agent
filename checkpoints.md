# Checkpoints — khan

## Checkpoint 1 — 2026-10-05 (spec review)

**Brought:** research/01-problems.md (21 external signals); spec draft from spec-writer; cost estimate (~$0.10–0.25 per video incl. voice).

**Decided:**
- Trigger `/khan` + natural language; generation inside the Claude Code session (option 1), direct-API producer as fallback if gaps > 5 s.
- Live browser player (not mp4); pause, rewind, mid-lesson questions with resume; nested to depth 3; blocking `khan wait`.
- Twelve element types incl. sketch/diagram/plot/svg; "audio yields to the pen" rule (no draw-time validation); OpenAI TTS required (no `say` fallback); Node + vanilla JS + rough.js.

**Still open — carried to checkpoint 2:**
- [ ] Voice choice by listening
- [ ] First real run with a key

## Checkpoint 2 — 2026-10-12 (design cycle 1: the Khan Academy look)

**Brought:** v0.1.0 released 2026-10-06 (272 unit / 51 e2e green, QA passed after 13 fixes); design/01-khan-look-research.md with KA's official on-black palette and creator guidance.

**Decided:**
- Token values: boardBg #000000, chalk #FFFFFF, accents yellow #FFE066 / light blue #65D0FA / coral #FF8D71 / teal #59F3CE / pink #FB73BE, muted #717378. KA blue/purple not added now (backlog #5).
- Cursor: white arrow pointer with dark outline, slightly enlarged. Strokes slightly thicker.
- Voice: gpt-4o-mini-tts with a thinking-aloud delivery instruction, interim default `ash`, `khan audition` to choose; no cloning of a real person's voice.

**Still open — carried to checkpoint 3:**
- [ ] Voice choice by listening (backlog #2)
- [ ] First real run with a key: latency, gaps, look and voice judgment (backlog #1) — decides promotion of v0.2.0 (backlog #15)

## Checkpoint 3 — 2026-10-13 (first real lessons, v0.2.0–v0.2.2)

**Brought:** v0.2.0 (Khan look, voice, audition), v0.2.1 (chrome outside the board, duplicate notes, diagram labels), v0.2.2 (TTS timeout and voicing race) — all pre-releases. First three real lessons: one silent (rejected key), one partly silent (20 s TTS timeout), then lesson 20261013-155609 "What a limit is" played end to end in real Chrome with audio: 5 scenes (14.5, 20.1, 41.0, 23.6, 28.8 s), handoffs ~30 ms, no stall, no snap, 0 degraded, 0 rejected on the server (4 producer-side rewrites). Voice `ash` chosen by measured pitch and pacing (orchestrator), pending the human's ear.

**Decided:**
- Voice `ash` is the default in `.khan/config.json`; the human can override after listening (backlog #2 stays open until they say so).
- Inter-scene gaps are far under 5 s, so the option-2 (direct-API) producer is not needed (backlog #9 → wontfix unless gaps appear with longer lessons).

**Still open — carried to checkpoint 4:**
- [ ] Human hears a full lesson and confirms the voice (backlog #2) → promote v0.2.2 to a full release (backlog #15)
- [ ] Rail hover feel (backlog #24); end-summary card placement (backlog #32)
