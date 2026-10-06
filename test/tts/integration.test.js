// Slice 01 — integration against the in-process foundation server: KHAN_TTS unset, sentinel key,
// mocked fetch (criteria 3, 6, 7 and the no-key run). The server's own requests pass through the mock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from '../foundation/helpers/server.js';
import { cacheKey } from '../../server/tts/cache.js';
import { DEFAULT_VOICE, NO_KEY_REASON } from '../../server/tts/openai.js';
import { createMockFetch, audioResponse, errorResponse, captureConsole, FIXTURE_MP3_META } from './helpers/mock-fetch.js';

const SENTINEL = 'sk-test-SENTINEL-123';
// KHAN_TTS: '' overrides the helper's `silent` so the foundation selects the openai provider.
const BASE_ENV = Object.freeze({ KHAN_TTS: '', OPENAI_API_KEY: SENTINEL, KHAN_TTS_LOG: '1', KHAN_TTS_BACKOFF_MS: '0,0', KHAN_TTS_TIMEOUT_MS: '2000' });

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const narrationOf = (lessonsDir, lessonId, sceneId) => JSON.parse(readFileSync(join(lessonsDir, lessonId, 'scenes', `${sceneId}.json`), 'utf8')).narration;

test('through the server: real MP3s land in audio/, durationMs is measured, cache hits are instant, voice change re-voices and switching back hits the cache (criterion 3)', async () => {
  const sharedCache = mkdtempSync(join(tmpdir(), 'khan-tts-cache-'));
  const mock = createMockFetch([() => audioResponse()]).install();
  try {
    // --- run A: default voice, three scenes → three requests
    const a = await startTestServer({ ...BASE_ENV }, { cacheDir: sharedCache });
    try {
      assert.deepEqual(a.info.tts, { provider: 'openai', voice: DEFAULT_VOICE, ready: true, reason: null });
      a.copyFixture('fx-type-text');
      const p = await a.waitForStatuses('fx-type-text', { s001: 'ready', s002: 'ready', s003: 'ready' });
      assert.equal(mock.calls.length, 3, 'one request per distinct narration');
      for (const e of p.entries) {
        assert.equal(e.audioUrl, `/api/lesson/fx-type-text/audio/${e.sceneId}`);
        assert.equal(e.durationMs, Math.round(FIXTURE_MP3_META.durationMs), 'durationMs measured from the MP3 bytes, not estimated');
        assert.deepEqual(e.errors, []);
        const file = join(a.lessonsDir, 'fx-type-text', 'audio', `${e.sceneId}.mp3`);
        assert.ok(existsSync(file), `${file} exists`);
        assert.equal(statSync(file).size, FIXTURE_MP3_META.bytes);
        assert.equal(readFileSync(file)[0], 0xff, 'MP3 frame sync at byte 0');
      }
      const audio = await fetch(a.url('/api/lesson/fx-type-text/audio/s001'));
      assert.equal(audio.status, 200);
      assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
      assert.equal((await audio.arrayBuffer()).byteLength, FIXTURE_MP3_META.bytes);
      // every request carried the right shape
      for (const c of mock.calls) {
        assert.equal(c.init.method, 'POST');
        assert.equal(c.headers.authorization, `Bearer ${SENTINEL}`);
        assert.equal(c.body.voice, DEFAULT_VOICE);
        assert.equal(c.body.response_format, 'mp3');
      }
      // cache layout: sha256(provider|voice|text).mp3 + .json
      for (const id of ['s001', 's002', 's003']) {
        const key = cacheKey('openai', DEFAULT_VOICE, narrationOf(a.lessonsDir, 'fx-type-text', id));
        assert.ok(existsSync(join(sharedCache, `${key}.mp3`)), `cache entry for ${id}`);
        const meta = JSON.parse(readFileSync(join(sharedCache, `${key}.json`), 'utf8'));
        assert.equal(meta.voice, DEFAULT_VOICE);
        assert.equal(meta.provider, 'openai');
        assert.equal(meta.ext, 'mp3');
      }
      // rewind/replay within the same run: rewriting a scene with the same narration → zero new requests
      a.writeScene('fx-type-text', JSON.parse(readFileSync(join(a.lessonsDir, 'fx-type-text', 'scenes', 's001.json'), 'utf8')));
      await a.waitFor(async () => a.info.store.get('fx-type-text').scenes.get('s001').attempts === 2 && (await a.playlist('fx-type-text')).entries.find((e) => e.sceneId === 's001').status === 'ready', { what: 're-ingest' });
      assert.equal(mock.calls.length, 3);
    } finally {
      await a.close();
    }
    assert.equal(readdirSync(sharedCache).filter((f) => f.endsWith('.mp3')).length, 3);

    // --- run B: same voice, fresh server, same cache dir (replay) → zero requests
    mock.reset([() => audioResponse()]);
    const b = await startTestServer({ ...BASE_ENV }, { cacheDir: sharedCache });
    try {
      b.copyFixture('fx-type-text');
      const p = await b.waitForStatuses('fx-type-text', { s001: 'ready', s002: 'ready', s003: 'ready' });
      assert.equal(mock.calls.length, 0, 'replay must make zero requests');
      for (const e of p.entries) { assert.equal(e.audioUrl, `/api/lesson/fx-type-text/audio/${e.sceneId}`); assert.equal(e.durationMs, Math.round(FIXTURE_MP3_META.durationMs)); }
    } finally {
      await b.close();
    }

    // --- run C: voice changed via config.tts.voice → three new requests with the new voice, new cache keys
    mock.reset([() => audioResponse()]);
    const c = await startTestServer({ ...BASE_ENV }, { cacheDir: sharedCache, config: { tts: { voice: 'nova' } } });
    try {
      assert.equal(c.info.tts.voice, 'nova');
      c.copyFixture('fx-type-text');
      await c.waitForStatuses('fx-type-text', { s001: 'ready', s002: 'ready', s003: 'ready' });
      assert.equal(mock.calls.length, 3, 'a voice change re-voices every scene');
      for (const call of mock.calls) assert.equal(call.body.voice, 'nova');
      for (const id of ['s001', 's002', 's003']) {
        const text = narrationOf(c.lessonsDir, 'fx-type-text', id);
        assert.notEqual(cacheKey('openai', 'nova', text), cacheKey('openai', DEFAULT_VOICE, text));
        assert.ok(existsSync(join(sharedCache, `${cacheKey('openai', 'nova', text)}.mp3`)));
      }
      assert.equal(readdirSync(sharedCache).filter((f) => f.endsWith('.mp3')).length, 6, 'both voices cached side by side');
      const inbox = JSON.parse(readFileSync(join(c.lessonsDir, 'fx-type-text', 'control', 'inbox.json'), 'utf8'));
      assert.deepEqual(inbox.tts, { provider: 'openai', voice: 'nova', ready: true, reason: null });
    } finally {
      await c.close();
    }

    // --- run D: KHAN_TTS_VOICE env beats config; back to the default voice → zero requests
    mock.reset([() => audioResponse()]);
    const d = await startTestServer({ ...BASE_ENV, KHAN_TTS_VOICE: DEFAULT_VOICE }, { cacheDir: sharedCache, config: { tts: { voice: 'nova' } } });
    try {
      assert.equal(d.info.tts.voice, DEFAULT_VOICE, 'env override wins over config');
      d.copyFixture('fx-type-text');
      await d.waitForStatuses('fx-type-text', { s001: 'ready', s002: 'ready', s003: 'ready' });
      assert.equal(mock.calls.length, 0, 'switching back hits the cache');
    } finally {
      await d.close();
    }
  } finally {
    mock.uninstall();
    rmSync(sharedCache, { recursive: true, force: true });
  }
});

test('a scene whose synthesis ultimately fails still reaches ready with audioUrl:null and a TTS_FAILED error; other scenes unaffected (criterion 6)', async () => {
  // s002's narration fails with 500 ×3; the others succeed
  let failingText = null;
  const mock = createMockFetch([(_u, _i, call) => (call.body.input === failingText ? errorResponse(500, 'The server had an error while processing your request') : audioResponse())]).install();
  try {
    const srv = await startTestServer({ ...BASE_ENV });
    try {
      srv.copyFixture('fx-type-box');
      failingText = narrationOf(srv.lessonsDir, 'fx-type-box', 's002');
      // the fixture was copied before failingText was set; the watcher's stability window (100 ms) makes that safe,
      // but re-assert by waiting for the statuses the brief demands
      const p = await srv.waitForStatuses('fx-type-box', { s001: 'ready', s002: 'ready', s003: 'ready' });
      const byId = Object.fromEntries(p.entries.map((e) => [e.sceneId, e]));
      assert.equal(byId.s002.audioUrl, null);
      assert.equal(byId.s002.degraded, false, 'a TTS failure is not a degrade');
      const err = byId.s002.errors.find((e) => e.code === 'TTS_FAILED');
      assert.ok(err, JSON.stringify(byId.s002.errors));
      assert.match(err.message, /after 3 attempts/);
      assert.match(err.message, /HTTP 500/);
      assert.ok(byId.s002.durationMs >= 1500, 'falls back to the 150-wpm estimate');
      assert.equal((await srv.get('/api/lesson/fx-type-box/audio/s002')).status, 404);
      for (const id of ['s001', 's003']) {
        assert.equal(byId[id].audioUrl, `/api/lesson/fx-type-box/audio/${id}`);
        assert.deepEqual(byId[id].errors, []);
        assert.equal(byId[id].durationMs, Math.round(FIXTURE_MP3_META.durationMs));
      }
      const failing = mock.calls.filter((c) => c.body.input === failingText);
      assert.equal(failing.length, 3, 'exactly three attempts for the failing scene');
      assert.equal(mock.calls.length - failing.length, 2, 'one request each for the two good scenes');
      assert.equal(p.tts.ready, true, 'provider stays ready; the failure is per scene');
      const status = await srv.get('/api/lesson/fx-type-box/status');
      assert.equal(status.body.counts.ready, 3);
    } finally {
      await srv.close();
    }
  } finally {
    mock.uninstall();
  }
});

test('the key never appears in the lesson folder, cache, playlist/status/health JSON, inbox or captured logs (criterion 7)', async () => {
  const mock = createMockFetch([
    // mix of outcomes so both success and failure log paths run
    (_u, _i, call) => (call.body.input.length % 2 === 0 ? audioResponse() : errorResponse(401, `Incorrect API key provided: ${SENTINEL}. You can find your API key at https://platform.openai.com.`)),
  ]).install();
  try {
    const { result: snapshots, lines } = await captureConsole(async () => {
      const srv = await startTestServer({ ...BASE_ENV });
      try {
        srv.copyFixture('fx-type-list');
        const playlist = await srv.waitForStatuses('fx-type-list', { s001: 'ready', s002: 'ready', s003: 'ready' });
        assert.ok(mock.calls.length >= 3);
        assert.ok(mock.calls.every((c) => c.headers.authorization === `Bearer ${SENTINEL}`), 'the key was really sent (so the test is meaningful)');
        const status = await srv.get('/api/lesson/fx-type-list/status');
        const health = await srv.get('/api/health');
        const files = walk(srv.root);
        assert.ok(files.some((f) => f.endsWith('inbox.json')));
        assert.ok(files.some((f) => f.endsWith('playlist.json')));
        const fileHits = files.filter((f) => readFileSync(f).includes(SENTINEL));
        return { playlist, status: status.body, health: health.body, fileHits, fileCount: files.length, lessonDir: join(srv.lessonsDir, 'fx-type-list') };
      } finally {
        await srv.close();
      }
    });
    assert.ok(snapshots.fileCount > 5);
    assert.deepEqual(snapshots.fileHits, [], `sentinel found in files: ${snapshots.fileHits.join(', ')}`);
    for (const [name, obj] of Object.entries({ playlist: snapshots.playlist, status: snapshots.status, health: snapshots.health })) {
      assert.ok(!JSON.stringify(obj).includes(SENTINEL), `sentinel in ${name}`);
    }
    // the 401 message echoed the key; it must not have reached the playlist error either
    const failed = snapshots.playlist.entries.filter((e) => e.errors.some((x) => x.code === 'TTS_FAILED'));
    for (const e of failed) assert.ok(!JSON.stringify(e.errors).includes(SENTINEL), 'server echo of the key leaked into the playlist');
    // logs (KHAN_TTS_LOG=1 made the provider log every attempt through console.error)
    assert.ok(lines.some((l) => l.includes('[khan tts]')), 'provider logging was active');
    assert.ok(!lines.join('\n').includes(SENTINEL), 'sentinel in logs');
    assert.ok(!/authorization|bearer/i.test(lines.join('\n')), 'Authorization header in logs');
  } finally {
    mock.uninstall();
  }
});

test('no key: KHAN_TTS unset and OPENAI_API_KEY unset → tts.ready=false with reason, no requests, scenes ready with audioUrl:null (criterion 1 + playlist)', async () => {
  const mock = createMockFetch([() => audioResponse()]).install();
  try {
    const srv = await startTestServer({ KHAN_TTS: '', OPENAI_API_KEY: '' });
    try {
      assert.deepEqual(srv.info.tts, { provider: 'openai', voice: DEFAULT_VOICE, ready: false, reason: NO_KEY_REASON });
      const health = await srv.get('/api/health');
      assert.deepEqual(health.body.tts, { provider: 'openai', voice: DEFAULT_VOICE, ready: false, reason: 'OPENAI_API_KEY not set' });
      srv.copyFixture('fx-type-code');
      const p = await srv.waitForStatuses('fx-type-code', { s001: 'ready', s002: 'ready', s003: 'ready' });
      assert.equal(p.tts.ready, false);
      assert.equal(p.tts.reason, NO_KEY_REASON);
      for (const e of p.entries) {
        assert.equal(e.audioUrl, null);
        assert.ok(e.errors.some((x) => x.code === 'TTS_FAILED' && x.message === NO_KEY_REASON), JSON.stringify(e.errors));
      }
      assert.equal(mock.calls.length, 0, 'no network call without a key');
      const inbox = JSON.parse(readFileSync(join(srv.lessonsDir, 'fx-type-code', 'control', 'inbox.json'), 'utf8'));
      assert.equal(inbox.tts.ready, false);
      assert.equal(inbox.tts.reason, NO_KEY_REASON);
      const status = await srv.get('/api/lesson/fx-type-code/status');
      assert.equal(status.body.tts.ready, false);
    } finally {
      await srv.close();
    }
  } finally {
    mock.uninstall();
  }
});

test('KHAN_TTS=silent never instantiates the openai provider, even with a key present (criterion 1, foundation behaviour)', async () => {
  const mock = createMockFetch([() => audioResponse()]).install();
  try {
    const srv = await startTestServer({ OPENAI_API_KEY: SENTINEL }); // helper default: KHAN_TTS=silent
    try {
      assert.equal(srv.info.tts.provider, 'silent');
      assert.equal(srv.info.provider.model, undefined);
      srv.copyFixture('fx-type-text');
      await srv.waitForStatuses('fx-type-text', { s001: 'ready', s002: 'ready', s003: 'ready' });
      assert.equal(mock.calls.length, 0);
    } finally {
      await srv.close();
    }
  } finally {
    mock.uninstall();
  }
});
