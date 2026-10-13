// Backlog #26 / fix lane (2026-10-13): the TTS cache under concurrent writers of the same key, and
// the synthesis concurrency limit that bounds startup re-voicing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTtsCache, cacheKeyFor, DEFAULT_CONCURRENCY } from '../../server/tts/cache.js';
import { createOpenAIProvider } from '../../server/tts/openai.js';
import { createSilentProvider } from '../../server/tts/silent.js';
import { createMockFetch, audioResponse, fixtureBytes } from './helpers/mock-fetch.js';

const KEY = 'sk-test-SENTINEL-123';
const TEXT = 'Two scenes can carry exactly the same narration, and then they share one cache key.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tmp() { return mkdtempSync(join(tmpdir(), 'khan-cache-race-')); }
const tmpFiles = (dir) => readdirSync(dir).filter((f) => f.includes('.tmp'));

test('backlog #26: two concurrent synthesize calls for the same text → exactly one network call, both resolve with the same file, no ENOENT, no leftover .tmp', async () => {
  const dir = tmp();
  try {
    const cache = createTtsCache({ dir });
    // the response arrives a little later so both callers are in flight together
    const mock = createMockFetch([() => new Promise((resolve) => setTimeout(() => resolve(audioResponse()), 30))]);
    const provider = createOpenAIProvider({ env: { OPENAI_API_KEY: KEY }, fetch: mock.fetch, backoffMs: [0, 0], timeoutMs: 5000, sleep: async () => {} });
    const [a, b] = await Promise.all([cache.getOrSynthesize(provider, TEXT), cache.getOrSynthesize(provider, TEXT)]);
    assert.equal(mock.calls.length, 1, 'identical text is voiced once per process');
    assert.equal(a.key, cacheKeyFor(provider, TEXT));
    assert.equal(a.path, b.path);
    assert.equal(a.durationMs, b.durationMs);
    assert.ok(existsSync(a.path));
    assert.deepEqual(readFileSync(a.path), Buffer.from(fixtureBytes()));
    assert.deepEqual(tmpFiles(dir), []);
    // a third call after both finished is a pure hit
    const c = await cache.getOrSynthesize(provider, TEXT);
    assert.equal(c.cached, true);
    assert.equal(mock.calls.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backlog #26: independent writers (two processes over one cache dir) storing the same key at once never hit ENOENT on rename; the final file is intact and no .tmp is left behind', async () => {
  const dir = tmp();
  try {
    const silent = createSilentProvider();
    const out = await silent.synthesize({ text: TEXT });
    const key = cacheKeyFor(silent, TEXT);
    const payload = { ...out, provider: silent.name, voice: silent.voice, model: null, instructions: null };
    // repeat the race a few times: a single interleaving could pass by luck
    for (let round = 0; round < 8; round++) {
      const writers = [createTtsCache({ dir }), createTtsCache({ dir }), createTtsCache({ dir })];
      const results = await Promise.all(writers.map((w) => w.store(key, payload)));
      for (const r of results) {
        assert.equal(r.key, key);
        assert.equal(r.path, join(dir, `${key}.${out.ext}`));
      }
      assert.ok(existsSync(join(dir, `${key}.${out.ext}`)));
      assert.ok(existsSync(join(dir, `${key}.json`)));
      assert.equal(readFileSync(join(dir, `${key}.${out.ext}`)).length, out.bytes.length, 'final file is a complete copy');
      assert.equal(JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8')).durationMs, out.durationMs);
      assert.deepEqual(tmpFiles(dir), [], `round ${round}: leftover temp files`);
    }
    // and the same race through getOrSynthesize on two instances (each has its own in-flight map)
    let calls = 0;
    const counting = { ...silent, synthesize: async (a) => { calls++; await sleep(20); return silent.synthesize(a); } };
    const [x, y] = await Promise.all([createTtsCache({ dir }).getOrSynthesize(counting, 'a different line'), createTtsCache({ dir }).getOrSynthesize(counting, 'a different line')]);
    assert.equal(calls, 2, 'two processes cannot share an in-flight map; both synthesize');
    assert.equal(x.path, y.path);
    assert.ok(existsSync(x.path));
    assert.deepEqual(tmpFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('synthesis concurrency: at most `concurrency` provider calls run at once (default 3); hits and in-flight shares do not take a slot', async () => {
  const dir = tmp();
  try {
    const silent = createSilentProvider();
    let inflight = 0, max = 0, calls = 0;
    const counting = {
      ...silent,
      synthesize: async (a) => {
        calls++; inflight++; max = Math.max(max, inflight);
        try { await sleep(25); return silent.synthesize(a); } finally { inflight--; }
      },
    };
    assert.equal(DEFAULT_CONCURRENCY, 3);
    const cache = createTtsCache({ dir });
    const texts = Array.from({ length: 9 }, (_, i) => `distinct narration number ${i}`);
    const all = await Promise.all(texts.map((t) => cache.getOrSynthesize(counting, t)));
    assert.equal(calls, 9);
    assert.equal(max, 3, `max in-flight was ${max}`);
    assert.equal(new Set(all.map((r) => r.path)).size, 9);
    for (const r of all) assert.ok(existsSync(r.path));
    // hits do not queue behind synthesis: a hit resolves while all slots are busy
    max = 0; inflight = 0;
    const busy = Promise.all(['x1', 'x2', 'x3', 'x4'].map((t) => cache.getOrSynthesize(counting, t)));
    const t0 = Date.now();
    const hit = await cache.getOrSynthesize(counting, texts[0]);
    assert.equal(hit.cached, true);
    assert.ok(Date.now() - t0 < 20, 'a hit did not wait for a free slot');
    await busy;
    assert.equal(max, 3);
    // the knob
    max = 0; inflight = 0;
    const one = createTtsCache({ dir, concurrency: 1 });
    await Promise.all(['y1', 'y2', 'y3'].map((t) => one.getOrSynthesize(counting, t)));
    assert.equal(max, 1);
    assert.deepEqual(tmpFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
