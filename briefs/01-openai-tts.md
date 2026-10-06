# Brief 01 — OpenAI TTS provider

Size: S. Depends on: **foundation only** (brief 00 must be `done` in `pipeline-status.md` before you start). Runs in parallel with 02–05.

Project: khan. Spec: `/Users/sanjivp27/Documents/projects/agent_pipeline/khan/spec.md` (approved 2026-10-05; §3 names this slice, §10 "TTS" and §11 rows "Chatty or mangled narration", "Cross-site POST" are the relevant parts). Foundation contracts: `README.md` in the repo and `briefs/00-foundation.md` §C2–C3 (provider interface, cache, `tts` status fields).

## Tech stack (from the spec)
Node >= 20, plain ES modules, no build step, **no new npm dependencies** — use the global `fetch` (Node >= 20) for the OpenAI API. Unit tests with `node --test`. Git: commit to the working copy of https://github.com/sanjivp2703/khan-whiteboard-agent. Never commit a key; `.env` and `.khan/` are gitignored.

## The specific feature
The one user-facing TTS provider: OpenAI speech synthesis (tts-1 class model) behind the foundation's provider interface, with duration measurement, retries, and clear "no key" behavior. The specific voice is a config setting (`tts.voice` in `.khan/config.json` or `KHAN_TTS_VOICE`) that the human will pick later by listening — you ship a sensible default and make switching trivial (cache is keyed by voice, so a change re-voices cleanly and a change back hits the cache).

Files you own: `server/tts/openai.js` (new), `test/tts/*.test.js`, a small real MP3 fixture `fixtures/audio/short.mp3` (1–3 s, license-free; record its provenance in `fixtures/audio/LICENSE.md`). You do **not** edit `server/tts/index.js`, `cache.js`, `silent.js`, or anything else in `server/` — the foundation's `selectProvider` already resolves the `openai` provider by importing `./openai.js`; if that import point does not exist exactly as README describes, stop and report rather than editing foundation files.

### Boundary
- Provider selection, cache storage, `tts.ready` plumbing into playlist/status/inbox, and the `TTS_FAILED → ready with audioUrl:null` path are foundation. You implement what the interface asks for and return the right results/errors.
- The player's "OpenAI key required" message is slice 04. The skill's "report missing key instead of producing" is slice 05. You make `ready()` accurate so both can rely on it.
- No `say`/local TTS, no other providers (spec §2).

## Provider contract to satisfy (from foundation C3)
```js
export function createOpenAIProvider({ env, config }) → {
  name: "openai",
  voice: string,                         // config.tts.voice || env.KHAN_TTS_VOICE || DEFAULT_VOICE
  ready(): {ok:boolean, reason:string|null},   // ok=false, reason "OPENAI_API_KEY not set" when missing; never throws
  synthesize({text}): Promise<{bytes:Uint8Array, mime:"audio/mpeg", ext:"mp3", durationMs:number}>
}
```
- Request: `POST https://api.openai.com/v1/audio/speech`, `Authorization: Bearer <key>`, JSON `{model, voice, input: text, response_format: "mp3"}`; model name is a constant (`tts-1` default; `KHAN_TTS_MODEL` override). Timeout 20 s per attempt (AbortController).
- Retries: on network error, 408/429/5xx → retry up to 3 attempts total with backoff 1 s, 3 s (jitter allowed but test with injected zero delays). 4xx other than 408/429 → fail immediately with a descriptive error (`code: "TTS_AUTH"` for 401/403, `"TTS_BAD_REQUEST"` otherwise). After the last failure, reject with an `Error` carrying `code: "TTS_FAILED"` and `cause` — the foundation then marks the entry per C3.
- Duration: measured from the returned MP3 bytes (parse frame headers: MPEG version, layer, bitrate, sample rate, samples per frame; handle Xing/Info header and ID3v2 tag; CBR and VBR). Implement in `server/tts/mp3-duration.js` (new, yours). Accuracy target ±50 ms on the fixture. Do not shell out to ffmpeg/afinfo.
- Logging: never log the key or the Authorization header; log provider, voice, text length, duration, attempt count.
- Key hygiene: the key is read from `env.OPENAI_API_KEY` at call time; it is not stored on the provider object in a way that `JSON.stringify(provider)` would expose (test asserts).

## End goal
With `OPENAI_API_KEY` in the environment and `KHAN_TTS` unset, starting the server and dropping a fixture lesson into the lessons dir yields real narrated MP3s in `audio/`, correct `durationMs` in the playlist, instant cache hits on replay/rewind, and a clean re-voice when `tts.voice` changes. Without a key, nothing crashes and `tts.ready` is false with a readable reason.

## Acceptance criteria
1. `ready()` → `{ok:false, reason:"OPENAI_API_KEY not set"}` without a key; `{ok:true}` with one. `KHAN_TTS=silent` never instantiates this provider (foundation behavior — verify, don't implement).
2. `synthesize` sends exactly one request for a new (voice, text) with the correct URL, method, headers and JSON body; `response_format` is `mp3`.
3. Through the foundation cache, a second ingest of the same text with the same voice makes **zero** requests; changing `tts.voice` makes a new request and produces a different cache key; switching back makes zero requests.
4. `durationMs` for `fixtures/audio/short.mp3` is within ±50 ms of its true duration (record the true value and how you measured it in `fixtures/audio/LICENSE.md`); a VBR sample (construct or obtain a second small fixture, or synthesize a minimal valid VBR frame sequence in the test) is also within tolerance; an ID3v2-prefixed copy of the fixture yields the same duration.
5. Retry behavior: 429 then 200 → success with 2 attempts; 500 ×3 → rejects with `code:"TTS_FAILED"` after exactly 3 attempts; 401 → rejects immediately with `code:"TTS_AUTH"` after 1 attempt; a hanging request is aborted at the timeout.
6. A scene whose synthesis ultimately fails still reaches `ready` with `audioUrl: null` and a `TTS_FAILED` error in the playlist (foundation path — your integration test proves your provider triggers it correctly).
7. The key never appears in: any file under the lesson folder, `state/playlist.json`, the playlist/status/health JSON, inbox.json, server logs captured by the test (use a sentinel key like `sk-test-SENTINEL-123`).
8. Default voice and model are documented in README (append a "TTS" section — this is the one README edit you may make) along with how to change the voice and what happens to the cache.
9. `node --check` passes for your files; `npm test` stays green offline (all your tests mock `fetch`; a live test exists but is skipped unless `KHAN_LIVE_TTS=1`).

## Required tests (`test/tts/`)
This slice touches the only secret in the system and an external input (network bytes), so test it more deeply than its size suggests:
- Unit, with `globalThis.fetch` replaced by a recording mock: request shape (criterion 2), header does not leak into logs, voice/model resolution precedence (config file < env override, document whichever precedence you pick in README), retry/backoff/timeout matrix (criterion 5) with injected zero delays, response with non-audio content type → `TTS_FAILED`, empty body → `TTS_FAILED`.
- `mp3-duration`: CBR fixture, ID3v2-prefixed fixture, truncated file (last frame partial) → still returns a finite duration, garbage bytes → throws a typed error (and `synthesize` maps it to `TTS_FAILED`), VBR with Xing header.
- Integration against the in-process foundation server (`startServer` on port 0, temp lessons dir, mocked `fetch`, `KHAN_TTS` unset, sentinel key in env): criteria 3, 6, 7; and the no-key run (criterion 1 + playlist `tts.ready=false`).
- Live smoke (skipped by default): with `KHAN_LIVE_TTS=1` and a real key, synthesize one 20-word sentence, assert mp3 magic bytes and duration between 2 and 15 s.

## Depends on
Foundation only.

## Design-asset dependencies
None.

## Rules reminder
3-attempt stop rule; never weaken a test to pass. Update your row in `pipeline-status.md` (`in progress` → `done`, with commit hash). Commit and push.
