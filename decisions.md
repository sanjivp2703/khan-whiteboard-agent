# Design decisions — khan

Recorded 2026-10-05 from a conversation with the human. Input to spec-writer. These are decided unless marked "open".

## What it is

A Claude Code skill. The user asks for the explanation in Claude's last response to be delivered as a Khan Academy style narrated whiteboard lesson: a voice explaining while strokes, text, boxes, arrows and code appear progressively on a canvas.

## Trigger

- Canonical trigger: slash command `/khan`, a skill at `.claude/skills/khan/SKILL.md`.
- Also triggers from natural language via the skill description ("khan, explain this", "turn this into a video", "whiteboard this").
- Argument contract: no argument = the last response; free text = scope or focus (e.g. "just the caching part"); optional hints for length or audience.
- A `UserPromptSubmit` hook as a deterministic word trigger is held in reserve, not in scope.
- Subagent (`@agent-khan`) rejected: fresh context would not see the response to explain.

## Generation approach

- Instructions, not pixels. The model never generates video frames. It writes a structured scene script (JSON): outline first, then scenes, each with narration text and ordered draw elements (text, box, arrow, code, highlight).
- A deterministic renderer draws the script progressively on an HTML canvas (hand-drawn look, e.g. rough.js; stroke-dashoffset style draw-in). Timing per scene is stretched to that scene's actual audio length.
- Narration via text-to-speech, one request per scene. Provider open (OpenAI tts-1 class, ElevenLabs, or local/`say` as a free fallback).
- Layout is constrained: fixed slot grid, small element vocabulary, fixed font sizes, hard caps on words per element. A validator checks each scene for overlap and overflow before it is played.
- Each scene owns its board region or wipes the board, so layout validation is scene-local and later scenes cannot collide with earlier ones.
- Rejected: recording an agent driving a real paint-style GUI (fragile automation); Manim (LLM layout failures, heavy deps); generative video models.

## Delivery: live, not a prepared file

- Primary output is a browser player served locally, not an mp4. mp4 export is a later slice, not in the first spec.
- Playback starts as soon as the first scene's audio is ready (target: within a few seconds, roughly 5 s buffer). Later scenes are generated and voiced while earlier ones play. The buffer should grow under normal conditions since generation is faster than speech.
- Stall handling: if the buffer runs dry, the pen idles or re-traces a highlight and narration pauses on a natural beat. It reads as thinking, not buffering.
- Script generation runs INSIDE the Claude Code session (option 1): the skill has Claude write scene files one at a time into a watched folder; a local server picks them up, voices them, and feeds the player. No extra API key.
- Option 2 (a local program calls the Claude API directly with true streaming, roughly $0.10–0.25 per video incl. voice) is the fallback if option 1 produces noticeable gaps between scenes. The spec should keep the scene-file contract such that swapping the producer does not change the player or server.

## Interactivity (in scope, added 2026-10-05)

- Pause and resume.
- Go back: rewind to an earlier scene and replay it.
- Ask a question mid-lesson: the user types or speaks a question; khan stops drawing, visibly "thinks", generates an answer as one or more inserted scenes, plays them, then resumes the original lesson where it left off.
- Goal: it should feel like talking to khan, not watching a video.
- Open: how the question reaches Claude in option 1 (the player must get the question back into the Claude Code session, e.g. the server writes a question file the skill loop polls for, or the skill instructs Claude to wait on the server). The spec should name the mechanism or flag it for the human.

## Research

See research/01-problems.md (2026-09-26). Key findings the spec should respond to: long responses vanish from the terminal; copying out is painful; AI-generated explainer videos fail on layout (overlap, cut-offs) and on correctness; narration that is chatty or robotic tires technical listeners; retention is lower when answers are read passively.
