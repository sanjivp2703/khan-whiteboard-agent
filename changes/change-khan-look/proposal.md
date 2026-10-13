# change-khan-look

**Lane:** change
**Requested:** 2026-10-12, by the human (in conversation)
**Status:** approved 2026-10-12 (tokens and voice plan approved by the human via two explicit questions; recorded in decisions.md "Approved 2026-10-12" and checkpoints.md Checkpoint 2)

Note: this change was started before CLAUDE.md rule 5 and iteration-guide.md existed; the folder was created retroactively on the same day, after approval and while the two builders were already running. Research is in design/01-khan-look-research.md.

## Why
"Make the whiteboard look exactly like Khan Academy: fully black background, match the cursor type, match the colors he commonly uses (he uses certain colors for certain purposes often), use his voice or one that's similar that you can find." The v0.1.0 board used placeholder token values (dark slate, generic pastels, a chalk-stick cursor) and OpenAI's older speech model with its default voice.

## What changes
The board is pure black. Strokes use Khan Academy's official on-black palette (white, yellow, light blue, coral, teal, pink, grey). The cursor is a white arrow pointer with a dark outline, slightly enlarged, as in the videos. Strokes are slightly thicker. Narration uses OpenAI's instructable speech model with a warm, thinking-aloud delivery description and `ash` as the interim voice; a new `khan audition` command plays a sample in each candidate voice so the human can pick. The skill tells Claude to give body text its concept's color (white reserved for neutral connecting text) and to narrate conversationally, thinking out loud. No real person's voice is cloned.

## Spec deltas

### ADDED
- Under "4.4 Board grid, rendering, and elements": "Token values (approved 2026-10-12, design/01-khan-look-research.md): `boardBg` #000000, `chalk` #FFFFFF, `accent1` #FFE066 (yellow), `accent2` #65D0FA (light blue), `accent3` #FF8D71 (coral), `accent4` #59F3CE (teal), `accent5` #FB73BE (pink), `muted` #717378. Source: Khan Academy's published on-black palette. Never true red on black."
- Under "6. Live playback model": "**Pen cursor.** A white arrow pointer with a dark outline, about 1.3× the OS default, hotspot at the tip; it follows the active stroke, parks on `pointer` highlights, and wobbles while idle. Pen strokes are slightly thicker than v0.1.0 with light pressure variation where the stroke pipeline allows."
- Under "8. Producer (skill) behavior": "Color defaults: body text, lists, tables, math and code labels take their concept's accent; chalk (white) is reserved for neutral connecting text. Recommended palette use (defaults, not hard rules; the map is fixed for the lesson): yellow for curves, graphs and the main thread; light blue for definitions and steps; coral for cautions and contrasts; teal and pink for what is currently being worked on. Narration style: conversational and warm, thinking out loud, unhurried, one idea at a time, introduce a term plainly then use it, address the viewer directly, never emotionless or salesy, no filler praise, concrete numbers; place a `highlight`/`pointer` when narration refers to something on the board."
- Under "8. Producer (skill) behavior", the CLI command list gains: "`audition [--text] [--voices] [--out] [--no-play]` (synthesizes one paragraph per candidate voice, writes `<out>/<voice>.mp3`, plays each with `afplay` on macOS, prints the env var to adopt a voice)."

### MODIFIED
- Under "10. Non-functional constraints": replace "TTS: OpenAI (tts-1 class) is the only user-facing provider. The voice is a config setting (`tts.voice`), chosen during QA by listening; the audio cache is keyed by hash of (provider, voice, text) so rewinds and replays never re-synthesize and a voice change re-voices cleanly." with "TTS: OpenAI is the only user-facing provider; default model `gpt-4o-mini-tts`, default voice `ash`. A free-text delivery instruction is sent for models that accept it (not tts-1/tts-1-hd); precedence `KHAN_TTS_INSTRUCTIONS` > `tts.instructions` > built-in default describing a warm, unhurried, thinking-aloud tutor (no real person named). Voice precedence `KHAN_TTS_VOICE` > `tts.voice` > default; model `KHAN_TTS_MODEL` > `tts.model` > default. The voice is chosen by the human with `khan audition`. The audio cache is keyed by hash of (provider, voice, model, instructions, text) so any change re-voices cleanly and old entries go unused."
- Under "9. Data model basics": replace "**Config** (server, `.khan/config.json` or env): `tts.voice`, `port`; secrets only from env." with "**Config** (server, `.khan/config.json` or env): `tts.voice`, `tts.model`, `tts.instructions`, `port`; secrets only from env."
- Under "10. Non-functional constraints": replace "Cost: TTS only; ≈ $0.05–0.15 per lesson on tts-1 class pricing." with "Cost: TTS only; ≈ $0.05–0.15 per lesson at gpt-4o-mini-tts pricing (re-check on the vendor page)."

### REMOVED
- none

## Unchanged behavior
- Token NAMES are unchanged; `color` still accepts exactly accent1…accent5 and muted; the validator's element caps and error codes are unchanged.
- Every drawable's bounds stay inside its slot for every fixture lesson (validator ↔ renderer agreement).
- Pen module API (createPen, modes hidden/draw/park/idle, setTip, setIdlePaths, frame) unchanged; the engine needs no change.
- Yield-to-pen rule, stall captions, resume stack to depth 3, rewind/skip, and the fixed answer-replay behavior unchanged.
- `ready()` without a key still returns `{ok:false, reason:"OPENAI_API_KEY not set"}`; `TTS_FAILED` handling and key redaction unchanged; the `silent` provider still drives all tests.
- All 13 JSON examples in SKILL.md still validate; the error-code and banned-macro lint still covers everything.
- `khan serve/outline/scene/wait/status/play` behave as before; `wait --timeout 100` loop unchanged.
- Muted scaffolding (axes, grid lines, faint code frames) remains visible on black; hachure fills remain visible.

## Risk
low. No money, auth or shared data. Visual regressions (something invisible on black) and voice quality are the exposures; the first is covered by screenshot inspection and a token-pin test, the second by the human audition.

## Design assets
none (token values approved from published sources; pipeline-status row `design-tokens` moves to done when this change is archived).
