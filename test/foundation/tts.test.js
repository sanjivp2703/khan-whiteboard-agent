import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSilentProvider, estimateDurationMs, silentWav, wavDurationMs } from '../../server/tts/silent.js';
import { createTtsCache, cacheKey } from '../../server/tts/cache.js';
import { selectProvider, ttsStatus, resolveVoice } from '../../server/tts/index.js';
import { startTestServer } from './helpers/server.js';

test('silent provider writes a playable WAV whose duration equals the 150-wpm estimate ±50 ms (criterion 15)', async () => {
  const p = createSilentProvider();
  assert.equal(p.name, 'silent');
  assert.deepEqual(p.ready(), { ok: true, reason: null });
  const text = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' '); // 45 words → 18 s
  const out = await p.synthesize({ text });
  assert.equal(out.mime, 'audio/wav');
  assert.equal(out.ext, 'wav');
  assert.equal(out.durationMs, 18000);
  assert.equal(estimateDurationMs(text), 18000);
  const parsed = wavDurationMs(out.bytes);
  assert.ok(Math.abs(parsed - 18000) <= 50, `parsed ${parsed}`);
  assert.equal(String.fromCharCode(...out.bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...out.bytes.slice(8, 12)), 'WAVE');
  // minimum 1.5 s
  assert.equal(estimateDurationMs('one two'), 1500);
  assert.ok(Math.abs(wavDurationMs(silentWav(1500)) - 1500) <= 50);
  assert.throws(() => wavDurationMs(new Uint8Array(100)), /not a WAV/);
});

test('cache: a hit never calls synthesize; key is sha256(provider|voice|text); voice changes the key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khan-cache-'));
  try {
    const cache = createTtsCache({ dir });
    let calls = 0;
    const counting = { name: 'silent', voice: null, ready: () => ({ ok: true }), synthesize: async (a) => { calls++; return createSilentProvider().synthesize(a); } };
    const a = await cache.getOrSynthesize(counting, 'hello there friend');
    assert.equal(calls, 1);
    assert.equal(a.cached, false);
    assert.ok(existsSync(a.path));
    assert.ok(existsSync(join(dir, `${a.key}.json`)));
    const b = await cache.getOrSynthesize(counting, 'hello there friend');
    assert.equal(calls, 1, 'second call must hit the cache');
    assert.equal(b.cached, true);
    assert.equal(b.durationMs, a.durationMs);
    assert.equal(b.path, a.path);
    // concurrent identical requests share one synthesize call
    const [c, d] = await Promise.all([cache.getOrSynthesize(counting, 'another text here'), cache.getOrSynthesize(counting, 'another text here')]);
    assert.equal(calls, 2);
    assert.equal(c.key, d.key);
    // voice is part of the key
    assert.notEqual(cacheKey('openai', 'alloy', 'x'), cacheKey('openai', 'nova', 'x'));
    assert.notEqual(cacheKey('openai', 'alloy', 'x'), cacheKey('silent', 'alloy', 'x'));
    assert.equal(cacheKey('silent', null, 'x'), cacheKey('silent', undefined, 'x'));
    assert.match(cacheKey('silent', null, 'x'), /^[0-9a-f]{64}$/);
    const voiced = { ...counting, name: 'openai', voice: 'alloy' };
    await cache.getOrSynthesize(voiced, 'hello there friend');
    assert.equal(calls, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selectProvider: KHAN_TTS=silent → silent; otherwise openai, not ready without a key', async () => {
  const s = await selectProvider({ KHAN_TTS: 'silent' }, {});
  assert.equal(s.name, 'silent');
  assert.deepEqual(ttsStatus(s), { provider: 'silent', voice: null, ready: true, reason: null });
  const o = await selectProvider({}, {});
  assert.equal(o.name, 'openai');
  const st = ttsStatus(o);
  assert.equal(st.ready, false);
  assert.ok(st.reason && st.reason.length > 0);
  if (!st.reason.includes('not installed')) assert.equal(st.reason, 'OPENAI_API_KEY not set');
  await assert.rejects(() => o.synthesize({ text: 'x' }));
  assert.equal(resolveVoice({ KHAN_TTS_VOICE: 'nova' }, { tts: { voice: 'alloy' } }), 'nova');
  assert.equal(resolveVoice({}, { tts: { voice: 'alloy' } }), 'alloy');
  assert.equal(resolveVoice({}, {}), null);
  assert.equal((await selectProvider({ KHAN_TTS_VOICE: 'shimmer' }, {})).voice, 'shimmer');
});

test('through the server: second ingest of the same narration hits the cache; the API key is never written', async () => {
  const SENTINEL = 'sk-SENTINEL-NEVER-WRITTEN-0123456789';
  const srv = await startTestServer({ OPENAI_API_KEY: SENTINEL });
  try {
    let calls = 0;
    const real = srv.info.provider;
    const origSynth = real.synthesize.bind(real);
    real.synthesize = async (a) => { calls++; return origSynth(a); };
    srv.copyFixture('fx-type-text');
    await srv.waitForStatuses('fx-type-text', { s001: 'ready', s002: 'ready', s003: 'ready' });
    assert.equal(calls, 3);
    // second lesson folder with identical narration → zero new synthesize calls
    srv.copyFixture('fx-type-text', { as: 'fx-type-text-copy' });
    // outline/scenes carry lessonId fx-type-text → BAD_LESSON_ID → rejected; so instead re-ingest by rewriting the same files
    srv.writeScene('fx-type-text', JSON.parse(readFileSync(join(srv.lessonsDir, 'fx-type-text', 'scenes', 's001.json'), 'utf8')));
    await srv.waitFor(async () => { const p = await srv.playlist('fx-type-text'); const e = p.entries.find((x) => x.sceneId === 's001'); return e && e.status === 'ready' && srv.info.store.get('fx-type-text').scenes.get('s001').attempts === 2; }, { what: 're-ingest' });
    assert.equal(calls, 3, 'rewrite with the same narration must not synthesize again');
    // the sentinel key never appears in the lesson dir, cache dir or playlist JSON
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
    walk(srv.root);
    assert.ok(files.length > 5);
    for (const f of files) assert.ok(!readFileSync(f).includes(SENTINEL), `sentinel key found in ${f}`);
    const snap = JSON.stringify(await srv.playlist('fx-type-text'));
    assert.ok(!snap.includes(SENTINEL));
    const health = await srv.get('/api/health');
    assert.ok(!JSON.stringify(health.body).includes(SENTINEL));
  } finally {
    await srv.close();
  }
});

test('no key (criterion 14): KHAN_TTS unset and OPENAI_API_KEY unset → server starts, tts.ready=false with reason, scenes ready with audioUrl:null + TTS_FAILED', async () => {
  const srv = await startTestServer({ KHAN_TTS: '', OPENAI_API_KEY: '' });
  try {
    const health = await srv.get('/api/health');
    assert.equal(health.body.ok, true);
    assert.equal(health.body.tts.ready, false);
    assert.equal(health.body.tts.provider, 'openai');
    assert.ok(health.body.tts.reason);
    srv.copyFixture('fx-type-box');
    const p = await srv.waitForStatuses('fx-type-box', { s001: 'ready', s002: 'ready', s003: 'ready' });
    assert.equal(p.tts.ready, false);
    for (const e of p.entries) {
      assert.equal(e.audioUrl, null);
      assert.ok(e.durationMs >= 1500, 'duration falls back to the 150-wpm estimate');
      assert.ok(e.errors.some((x) => x.code === 'TTS_FAILED'), JSON.stringify(e.errors));
      assert.equal(e.degraded, false);
    }
    assert.equal((await srv.get('/api/lesson/fx-type-box/audio/s001')).status, 404);
    assert.equal((await srv.get('/api/lesson/fx-type-box/scene/s001')).status, 200, 'scenes still validate');
    const inbox = JSON.parse((await import('node:fs')).readFileSync(`${srv.lessonsDir}/fx-type-box/control/inbox.json`, 'utf8'));
    assert.equal(inbox.tts.ready, false);
  } finally {
    await srv.close();
  }
});
