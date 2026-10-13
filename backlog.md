# Backlog — khan

| # | Item | Source | Lane | Size | Status |
|---|------|--------|------|------|--------|
| 1 | First real `/khan` lesson with an OpenAI key: measure first-audio latency (≤ 8 s target) and inter-scene gaps (> 5 s typical ⇒ build option-2 producer) | qa/02-verification-report.md needs-human, 2026-10-06 | | S | open (human) |
| 2 | Choose the voice by listening (`khan audition`) | spec §10; decisions.md 2026-10-05 | | S | open (human) |
| 3 | Safari/Firefox: MP3 seek on resume (server has no Range support) | qa/01-integration-report.md known issue 5 | fix | S | open |
| 4 | Confirm the silent re-wait loop (`khan wait --timeout 100`) in a real Claude Code session | qa/02-verification-report.md | | S | open (human) |
| 5 | Add KA blue #4984F2 and purple #A87DFF as accent6/accent7 (validator, skill, tokens) | design/01-khan-look-research.md; human declined for now 2026-10-12 | change | S | open |
| 6 | Timing tolerances flake under concurrent-suite load: renderer prepare < 150 ms; engine-clock.spec.js:177; engine-question.spec.js:129; production.test.js:207 waitForOutline 5 s | qa/02 and qa/03 flake lists | fix | S | open |
| 7 | e2e/engine-jump criterion 8 failed once under triple load | fix-pass CLI fixer report 2026-10-06 | fix | S | open |
| 8 | CLI tests adopt a user's real server on default port 7777 (two tests fail with exit 1 instead of 2 when a server is running) | voice builder report 2026-10-12; reproduced on main | fix | S | open |
| 9 | Option-2 producer (local program streams the script from the Claude API) if scene gaps are long | spec §11 trigger | change | M | open (blocked on #1) |
| 10 | mp4 export | spec §2 "later slice" | change | M | open |
| 11 | `scripts/bootstrap.sh` + `.worktreeinclude` + fast/full tier commands in briefs (iteration-guide.md requirement) | iteration-guide.md 2026-10-12 | fix | S | open |
| 12 | Early open before ingest: `/outline` and `/playlist` still 404 until ingested (events fixed) | foundation fixer observation 2026-10-06 | fix | S | open |
| 13 | After `→` to the next lesson scene, `←` lands on the just-heard answer scene (asymmetry, spec-conformant) | qa/02-verification-report.md nuance | change | S | open |
| 14 | Ten retro proposals awaiting human apply/reject | lessons.md khan entry 2026-10-06 | | | open (human, at /triage) |
| 15 | Promote v0.2.0 (tagged pre-release 2026-10-13) to a full release after #1 and #2 | iteration-guide release gate | | S | open (human) |
| 16 | First server restart after v0.2.0 re-voices every lesson folder in `.khan/lessons` under the new cache key (≈ $0.05–0.15 each); move old lessons out to avoid it | qa/03-change-khan-look.md finding 2 | | S | open (human, release note) |
| 17 | Stroke pressure variation along a stroke (thick mid, thin ends) was deferred: needs per-segment stroking in both renderers | look builder report 2026-10-12 | change | S | open |
| 18 | Box ink margin to slot edge is now 0.4 px; any stroke width > 4 px would cross the slot | qa/03 finding 3 | | S | open (note) |
| 19 | Player chrome covers board content: the scene rail expands over the left of the board whenever not playing, and the transcript bar overlays the bottom; spec §10 says the transcript is under the board | human screenshot 2026-10-13 (lesson 20261013-002431) | fix | S | done (merge 41f1bd1) |
| 20 | "scene skipped: audio unavailable" notes duplicate on each pass over the same scenes | human screenshot 2026-10-13 | fix | S | done (merge 41f1bd1) |
| 21 | Diagram edge labels overlap arrows and neighbouring labels (e.g. "interrupt or wait" across the Orchestrator→Assessor edge) | human screenshot 2026-10-13 | fix | S | done (merge 71a57f6) |
| 22 | Server shows `ready` with `TTS_FAILED` 401 on every scene when the key is wrong; the player should surface "OpenAI rejected the API key" once, loudly, instead of per-scene "no audio" badges | lesson 20261013-002431 playlist | change | S | open |
| 23 | SKILL.md hint: a diagram with 5+ ranks in a 2-row slot scales text to ~0.68; prefer LR in wide slots or give TD diagrams 3 rows | diagram fixer report 2026-10-13 | fix | S | open |
| 24 | Rail hover shrinks the board (re-letterbox) rather than covering it; judge the feel; consider a wider collapsed strip or no-hover mode | chrome fixer report 2026-10-13 | | S | open (human) |
| 25 | TTS per-attempt timeout (20 s) is too short for gpt-4o-mini-tts on 80–90-word narrations: every attempt aborts ("This operation was aborted"), scene plays silent | real lessons 20261013-002431 and 20261013-115749 | fix | S | in progress (fix: tts timeout) |
| 26 | Startup re-voicing of several lessons races on the TTS cache: `ENOENT rename` on identical-text cache keys written concurrently | lesson 20261013-002431 playlist after restart | fix | S | in progress (fix: tts timeout) |
| 27 | SKILL.md: `itemAt` values must fall inside each item's own time window (validator BAD_AT "lies outside the element window"); cheat-sheet only says 0..0.9 non-decreasing | real lesson 20261013-115749 reject | fix | S | open |
| 28 | SKILL.md: narration cap of 90 words is overshot easily (91, 92 words twice in one lesson); advise aiming for ≤ 80 or count before sending | real lesson 20261013-115749 rejects | fix | S | open |
| 29 | Silent scenes (TTS_FAILED) are never retried; add a server-side re-voice on demand or on next replay | real lessons 2026-10-13 | change | S | open |
