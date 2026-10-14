# Backlog — khan

| # | Item | Source | Lane | Size | Status |
|---|------|--------|------|------|--------|
| 1 | First real `/khan` lesson with an OpenAI key: measure first-audio latency (≤ 8 s target) and inter-scene gaps (> 5 s typical ⇒ build option-2 producer) | qa/02-verification-report.md needs-human, 2026-10-06 | | S | done 2026-10-13: lesson 20261013-155609 played end to end in real Chrome; scene 1 voiced ~6 s after its file landed; inter-scene handoffs ~30 ms, no stalls; producer wrote each scene faster than the previous one played (buffer grew to 4). Option-2 producer not needed. |
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
| 25 | TTS per-attempt timeout (20 s) is too short for gpt-4o-mini-tts on 80–90-word narrations: every attempt aborts ("This operation was aborted"), scene plays silent | real lessons 20261013-002431 and 20261013-115749 | fix | S | done (v0.2.2) |
| 26 | Re-validation of a track started a second voicing of the same scene; both renamed the same `audio/<scene>.mp3.tmp` (ENOENT). Real cause was per-scene, not the cache; cache hardened anyway | lesson 20261013-002431 playlist after restart; fixer diagnosis | fix | S | done (v0.2.2) |
| 27 | SKILL.md: `itemAt` values must fall inside each item's own time window (validator BAD_AT "lies outside the element window"); cheat-sheet only says 0..0.9 non-decreasing | real lesson 20261013-115749 reject | fix | S | open |
| 28 | SKILL.md: narration cap of 90 words is overshot easily (91, 92 words twice in one lesson); advise aiming for ≤ 80 or count before sending | real lesson 20261013-115749 rejects | fix | S | open |
| 29 | Silent scenes (TTS_FAILED) are never retried; add a server-side re-voice on demand or on next replay | real lessons 2026-10-13 | change | S | open |
| 30 | Streamed speech response (`stream_format`) would allow a tight "nothing arrived" timeout instead of 90 s | TTS fixer report 2026-10-13 | change | S | open |
| 31 | With no key (`tts.ready=false`) the server marks every scene TTS_FAILED, including scenes whose audio is already in the cache; cache hits should be served regardless of key presence | restart without key 2026-10-13, lesson 20261013-115749 | fix | S | open |
| 32 | End-of-lesson summary card overlays the board and hides part of the last scene (table cells, plot); place it in the bottom panel or make it dismissable on click | real lesson 20261013-155609 screenshot | fix | S | open |
| 33 | Server idle-exits 10 min after a lesson ends even while a player tab is still connected; the next reload shows a raw "connection refused". Keep the server alive while any SSE client is connected, and have the player show "server stopped: run khan play <id>" instead of the browser error | human screenshot 2026-10-13 after lesson 20261013-155609 | fix | S | open |
| 34 | Make the video feel more like Sal Khan's: study his videos (what he writes vs draws, handwriting, timing of writing vs speech, colors, layout, movement, math look) and implement the findings | human request 2026-10-13 | change | M | in progress (change-khan-feel) |
| 35 | Redesign the player chrome for viewers: video-platform idiom (bottom control bar, chapters, captions), modern and intuitive, developer details hidden | human request 2026-10-13 | change | M | in progress (change-player-ui) |
| 36 | Scroll-board mode: fill the board top-left to bottom-right and scroll down when full instead of wiping, as Sal does (study §4 item 14) | design/02-khan-video-study.md | change | L | open |
| 37 | `\color{accentN}` inside math so factors within one equation can be colour-coded (study §4 item 13, chain rule 6:25) | design/02-khan-video-study.md | change | M | open |
| 38 | Pacing: with the 550 px/s pen, 102/142 non-last elements compress (36 by >3×) and 27/87 last elements overrun the yield cap and pop in; need length-weighted windows, a compression cap on the last element, and a producer pacing budget in SKILL.md | qa/04 finding 1 | fix | S | done (merge f267efe) |
| 39 | Plot: end-of-axis tick number crowds the arrowhead | qa/04 finding 4 | fix | S | done (merge f267efe) |
| 40 | `khan scene` output carries a stale `degraded` notice for a scene after a valid rewrite replaced the rejected version (playlist shows ready, not degraded); clear notices on re-ingest | RLAIF lesson 20261014-000122 s003 | fix | S | open |
