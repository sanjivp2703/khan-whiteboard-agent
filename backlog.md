# Backlog — khan

| # | Item | Source | Lane | Size | Status |
|---|------|--------|------|------|--------|
| 1 | First real `/khan` lesson with an OpenAI key: measure first-audio latency (≤ 8 s target) and inter-scene gaps (> 5 s typical ⇒ build option-2 producer) | qa/02-verification-report.md needs-human, 2026-10-06 | | S | open (human) |
| 2 | Choose the voice by listening (`khan audition`) | spec §10; decisions.md 2026-10-05 | | S | open (human) |
| 3 | Safari/Firefox: MP3 seek on resume (server has no Range support) | qa/01-integration-report.md known issue 5 | fix | S | open |
| 4 | Confirm the silent re-wait loop (`khan wait --timeout 100`) in a real Claude Code session | qa/02-verification-report.md | | S | open (human) |
| 5 | Add KA blue #4984F2 and purple #A87DFF as accent6/accent7 (validator, skill, tokens) | design/01-khan-look-research.md; human declined for now 2026-10-12 | change | S | open |
| 6 | Renderer "prepare < 150 ms" assertions flake under heavy concurrent load | qa/02-verification-report.md flake candidates | fix | S | open |
| 7 | e2e/engine-jump criterion 8 failed once under triple load | fix-pass CLI fixer report 2026-10-06 | fix | S | open |
| 8 | CLI tests adopt a user's real server on default port 7777 (two tests fail with exit 1 instead of 2 when a server is running) | voice builder report 2026-10-12; reproduced on main | fix | S | open |
| 9 | Option-2 producer (local program streams the script from the Claude API) if scene gaps are long | spec §11 trigger | change | M | open (blocked on #1) |
| 10 | mp4 export | spec §2 "later slice" | change | M | open |
| 11 | `scripts/bootstrap.sh` + `.worktreeinclude` + fast/full tier commands in briefs (iteration-guide.md requirement) | iteration-guide.md 2026-10-12 | fix | S | open |
| 12 | Early open before ingest: `/outline` and `/playlist` still 404 until ingested (events fixed) | foundation fixer observation 2026-10-06 | fix | S | open |
| 13 | After `→` to the next lesson scene, `←` lands on the just-heard answer scene (asymmetry, spec-conformant) | qa/02-verification-report.md nuance | change | S | open |
| 14 | Ten retro proposals awaiting human apply/reject | lessons.md khan entry 2026-10-06 | | | open (human, at /triage) |
| 15 | Promote v0.2.0 from pre-release to release after #1 and #2 | iteration-guide release gate | | S | open (human) |
