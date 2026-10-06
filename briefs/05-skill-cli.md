# Brief 05 — The `khan` skill and CLI (producer side)

Size: M. Depends on: **foundation only** (brief 00 `done`). Runs in parallel with 01–04. You do not need the player engine or renderers: all your tests drive the foundation server directly (HTTP + files) and simulate the player with `POST /position` calls.

Project: khan. Spec: `/Users/sanjivp27/Documents/projects/agent_pipeline/khan/spec.md` (approved 2026-10-05). Relevant parts: §1 items 1–3 and 6, §3 (Producer row), §4.1–4.3 (what the producer writes), §7 "Question-return mechanism (decided): blocking `khan wait`", §8 entire (SKILL.md rules, tier order, color consistency, CLI commands), §10 (no key → skill reports), §11 rows "Scene gaps / stalls", "Partial file reads", "Content correctness", "Chatty narration", "Session occupied", "Context cost". Foundation contracts: repo `README.md` and `briefs/00-foundation.md` §C1–C3 (scene contract, lesson folder/inbox, HTTP + `wait` semantics).

## Tech stack (from the spec)
Node >= 20 ES modules, no build step, no new npm dependencies (argument parsing by hand or `node:util.parseArgs`). The CLI is `bin/khan` (`#!/usr/bin/env node`, executable) registered in `package.json` `"bin": {"khan": "bin/khan"}` — this is the **only** `package.json` edit any slice makes; touch nothing else in it. Skill at `.claude/skills/khan/SKILL.md` (Claude Code skill format: YAML frontmatter `name`, `description`; body = instructions). Tests: `node --test`; no Playwright needed (optional one smoke spec if you want the browser-open suppression verified end to end). Git: commit to the working copy of https://github.com/sanjivp2703/khan-whiteboard-agent.

## The specific feature
The producer: how Claude, inside a Claude Code session, turns its last response into scene files and reacts to the server. Two deliverables.

### A. `khan` CLI (`bin/khan`, implementation in `cli/**`)
Commands (spec §8, plus one addition flagged to the human: `outline`, since the spec lists no command for writing `outline.json`):
- `khan serve [--port N] [--lessons-dir D] [--foreground]` — if a server is already healthy (`.khan/server.json` `{port, pid, startedAt}` + `GET /api/health` ok) print its info and exit 0; otherwise spawn `node server/index.js` **detached** (stdio to `.khan/server.log`), wait up to 5 s for health, write `.khan/server.json`, print one JSON line `{"ok":true,"port":7777,"tts":{...}}`. `--foreground` runs it inline (for humans/tests).
- `khan outline <lessonId|-> ` — reads outline JSON from stdin; `-` means generate a `lessonId` as `YYYYMMDD-HHMMSS-<slug>` from the title (regex-safe, ≤ 64 chars) and inject it; creates the lesson folder, atomic write (`.tmp` + rename) of `outline.json`; prints `{"ok":true,"lessonId":"...","url":"http://127.0.0.1:7777/lesson/<id>"}`. Validates `schema`, 3–12 scenes, `sceneId` sequence `s001..` before writing (shape only — the server remains the validator of scenes; the outline check here is a convenience so Claude gets fast feedback).
- `khan scene <lessonId> <sceneId>` — reads scene JSON from stdin; checks `lessonId`/`sceneId` regexes and that `scene.lessonId`/`scene.sceneId` match the args (fill them in if absent); atomic write to `scenes/<sceneId>.json`; waits up to 3 s for the server to validate (poll `/api/lesson/<id>/playlist` for a non-`pending` status) and prints **one line**: `{"ok":true,"sceneId":"s003","status":"ready|voicing|rejected|degraded","errors":[...],"inbox":{"pending":n,"questions":n,"rejects":n},"readyAhead":n}`. Exit code 0 even on `rejected` (the skill reads the JSON); non-zero only on CLI/IO/server-unreachable errors.
- `khan wait <lessonId> [--timeout S]` (default 540) — calls `GET /api/lesson/<id>/wait?timeout=S`, prints exactly the server's one JSON object (event `question|reject|continue|finished|player-closed|timeout`) and exits 0; server unreachable → `{"event":"error","code":"SERVER_DOWN","message":"..."}` exit 2.
- `khan status <lessonId>` — prints `/api/lesson/<id>/status` as one JSON line (includes `tts.ready`).
- `khan play <lessonId>` — ensures the server is running (as `serve`), verifies the lesson folder exists, prints the URL and opens the browser (via the server's opener or `open`/`xdg-open`; honor `KHAN_NO_OPEN=1`). Replay needs no model: the server re-ingests and the audio cache serves (foundation).
- `khan --help` and `khan <cmd> --help`.
All output is one JSON line per command (the skill summarizes it; keeps context cost low, §11). Human-readable only with `--pretty`.

### B. The skill: `.claude/skills/khan/SKILL.md`
Frontmatter `description` must make it trigger on `/khan`, "khan, explain this", "whiteboard this", "turn this into a video" and similar. Body instructs Claude, in order (spec §1, §8):
1. Parse the argument: none → explain the previous assistant response in full; free text → scope/focus plus optional audience/length hints. State the interpreted focus in one short line before starting.
2. `khan serve` (Bash). If the output's `tts.ready` is false → tell the user an OpenAI key is required (`OPENAI_API_KEY` in env) and **stop** without producing scenes.
3. Plan 3–12 scenes grounded only in the response; pick one accent token per concept (color map stays fixed for the whole lesson); write `outline.json` via `khan outline -` (stdin heredoc); tell the user the URL (the browser opens automatically).
4. Produce scene 1 **immediately and small** (target: first audio within 8 s), then the rest one at a time: `cat <<'EOF' | khan scene <id> s00N` … then `khan wait <id>`. Loop on the wait result: `continue` → next scene; `reject` → rewrite the same `sceneId` once following the error codes (the scene's narration may stay; fix the elements); `question` → write 1–4 answer scenes `qNNN-a01..` (first `wipe`, all with `questionId` and `insertAfter` from the event, last `final: true`), grounded in the response and the lesson so far, then continue the loop; `finished` / `player-closed` → print a one-line summary (scenes, degradations, questions answered — from `khan status`) and end the turn; `timeout` → call `khan wait` again; `error` → report and stop.
5. Authoring rules (must be in the file, verbatim in spirit): one idea per scene; narration 15–90 words, plain prose, second person, direct, no filler ("great question", "let's dive in"), never read the board aloud verbatim, spell or paraphrase identifiers TTS would mangle, code only in `code` elements; `region` scenes to build a board, `wipe` on topic change; drawing-type tier order `sketch → diagram → plot → svg`; arrays as a one-row `table` with an index header; equations as `math`, never `text`; never introduce concepts absent from the response; respect every cap in spec §4.4 (include a compact cap cheat-sheet in the skill so Claude rarely gets rejected); ids unique since last wipe; `at` optional.
6. A compact copy of the scene-file schema and one worked example scene per element type (short) so the skill is self-sufficient without reading the spec.
7. Esc/termination note: the turn stays open during the lesson; the user interacts through the player, not the terminal.

### Boundary
- Server behavior (`wait` semantics, inbox contents, validation, degradation, browser opening on new outline) → foundation. You call it; you don't reimplement it. If `wait`/`status` payloads differ from README, report — don't patch `server/`.
- TTS → slice 01 (you only surface `tts.ready`).
- Player → slice 04.
- No option-2 producer (spec §2); no hook trigger; no subagent.

Files you own: `bin/khan`, `cli/**`, `.claude/skills/khan/**`, `test/cli/**`, fixtures `fixtures/lessons/fx-cli-*` (if needed), the `bin` entry in `package.json`, and a "CLI and skill" section appended to README (your one README edit).

## End goal
In a Claude Code session in this repo, after any explanatory answer, the user types `/khan` (or "whiteboard this"): the server comes up, the browser opens to the lesson, scene 1 is voiced within seconds, scenes keep arriving while earlier ones play, a typed question in the player comes back through `khan wait` and is answered with inserted scenes, and when the lesson finishes Claude prints a one-line summary and ends its turn. Later, `khan play <lessonId>` replays the lesson with no model and no network beyond the TTS cache (none at all if cached).

## Acceptance criteria
1. `khan --help` lists all six commands; `node --check bin/khan` and every file in `cli/` pass.
2. `khan serve` with no server: spawns, becomes healthy ≤ 5 s, writes `.khan/server.json`, returns while the server keeps running (process survives the CLI exiting); second `khan serve` detects it and does not spawn; stale pidfile (dead pid) → respawns. `KHAN_NO_OPEN=1` and `--lessons-dir` are passed through.
3. `khan outline -` generates a valid `lessonId` (matches `^[a-z0-9-]{8,64}$`, starts with the timestamp, slug from title with non-alphanumerics collapsed to `-`), writes atomically (a watcher-side test sees no `.tmp` ingest and exactly one outline event), rejects outlines with 2 or 13 scenes or a non-sequential `sceneId` with a JSON error line and exit 1.
4. `khan scene` writes via `.tmp` + rename (test: a `fs.watch` observer records the create of `.tmp` then a rename, never a partial read — reuse the foundation watcher test approach), fills `lessonId`/`sceneId` if missing, refuses mismatched ones, prints exactly one JSON line with the fields listed, status `ready` for a valid fixture scene under the silent provider, `rejected` with the server's error codes for an invalid one.
5. `khan wait`: with < 3 ready scenes ahead and no final scene → `continue` immediately (< 500 ms); when the test POSTs `/question` while `wait` blocks → `question` event with `qId`, `text`, `atSceneId`, `atTime` within 1 s; writing an invalid scene then `wait` → `reject` with errors; `--timeout 2` with nothing happening (buffer ≥ 3 or final written) → `timeout` after ~2 s; after the test posts `end` for the last entry of a final lesson → `finished` with summary counts; server down → `{"event":"error","code":"SERVER_DOWN"}` exit 2.
6. Full scripted production (integration test acting as Claude): `serve` → `outline -` → `scene` ×4 (last `final`) interleaved with `wait` → test posts positions as a fake player → `wait` returns `finished`; then the test asks a question mid-way in a second run: `wait` → `question` → `scene q001-a01` (wipe) + `scene q001-a02` (final) → `wait` → `continue`/`finished` as appropriate; playlist order matches §4.1.
7. Degrade visibility: a scene rejected twice becomes `degraded`; the next `khan scene`/`wait` output includes the `degraded` notice; `khan status` counts it.
8. `khan status` with no key and `KHAN_TTS` unset → `tts.ready:false` with reason; SKILL.md step 2 instructs stopping on that.
9. `khan play fx-full-tour --lessons-dir fixtures/lessons` (with `KHAN_NO_OPEN=1`) prints the URL and the server reports all scenes `ready` within 10 s under the silent provider.
10. SKILL.md: frontmatter parses; `description` contains the trigger phrases; body contains each of: the tier-order string "sketch → diagram → plot → svg" (or equivalent wording with all four in order), the no-key stop rule, "15 to 90 words"/"15–90", the filler ban, "one idea per scene", the `khan wait` loop with all six event names, the answer-scene rules (`wipe` first, `questionId`, `insertAfter`, `final`), the color-consistency rule, the first-scene-fast rule, and one example per element type whose JSON validates (test extracts fenced JSON blocks from SKILL.md and runs them through `shared/schema/validate.js` in a fresh occupancy — every block must be `ok`).
11. The skill never tells Claude to read the lesson directory or any file other than `control/inbox.json`/CLI output (grep SKILL.md for `ls .khan`, `scenes/` reads — none).
12. README section documents commands, JSON outputs, the pidfile, and how `khan play` replays.

## Required tests (`test/cli/`)
Risks here are partial writes, the wait loop misbehaving (Claude stuck or spinning), and the skill text rotting out of sync with the schema — so:
- Unit: arg parsing for every command and flag; `lessonId` generation (slug edge cases: empty title, unicode, 80-char title → truncated to fit 64); atomic writer (criterion 4); output formatting (`--pretty` vs one-line); exit codes.
- Integration against the real foundation server (`startServer` in-process on port 0, or `khan serve --foreground` as a child, temp lessons dir, `KHAN_TTS=silent`, `KHAN_NO_OPEN=1`): criteria 2–9. Use a fake-player helper that posts `start`/`end` positions.
- Skill lint (criteria 10–11): parse frontmatter, assert required phrases, validate every fenced JSON example.
- Manual (document in README; cannot be automated here): run `/khan` on a real response once slices 01 and 04 are done; record first-audio latency and inter-scene gap (spec §11: gaps > 5 s typical is the trigger for option 2) — this is QA's job later, but your README tells them how.

## Depends on
Foundation only.

## Design-asset dependencies
None.

## Rules reminder
3-attempt stop rule; never weaken a test. Update your `pipeline-status.md` row. Commit and push. The `outline` command is an addition not in the spec's command list (§8); it is flagged to the human in the orchestrator's report — implement it as specified here unless told otherwise.
