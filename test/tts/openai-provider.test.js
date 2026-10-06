// Slice 01 — unit tests for the OpenAI provider with a recording fetch mock (criteria 1, 2, 5, key hygiene).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIProvider, OPENAI_SPEECH_URL, DEFAULT_VOICE, DEFAULT_MODEL, resolveVoice, resolveModel, redactKey, NO_KEY_REASON, BACKOFF_MS, TIMEOUT_MS, MAX_ATTEMPTS } from '../../server/tts/openai.js';
import { selectProvider, ttsStatus } from '../../server/tts/index.js';
import { cacheKey } from '../../server/tts/cache.js';
import { createMockFetch, audioResponse, errorResponse, hangingResponse, networkError, fixtureBytes, FIXTURE_MP3_META } from './helpers/mock-fetch.js';

const KEY = 'sk-test-SENTINEL-123';
const TEXT = 'A cache lookup takes the request key, hashes it, and checks whether the store already holds a response for that hash before doing any work.';

function make(script, extra = {}) {
  const mock = createMockFetch(script);
  const logs = [];
  const sleeps = [];
  const provider = createOpenAIProvider({
    env: { OPENAI_API_KEY: KEY, ...(extra.env || {}) },
    config: extra.config || {},
    voice: extra.voice ?? null,
    fetch: mock.fetch,
    backoffMs: extra.backoffMs || [0, 0],
    timeoutMs: extra.timeoutMs ?? 5000,
    log: (line) => logs.push(line),
    sleep: async (ms) => { sleeps.push(ms); },
    ...(extra.opts || {}),
  });
  return { mock, logs, sleeps, provider };
}

test('ready(): {ok:false, reason:"OPENAI_API_KEY not set"} without a key; {ok:true} with one; never throws (criterion 1)', () => {
  for (const env of [{}, { OPENAI_API_KEY: '' }, { OPENAI_API_KEY: '   ' }, undefined, null]) {
    const p = createOpenAIProvider({ env });
    assert.deepEqual(p.ready(), { ok: false, reason: NO_KEY_REASON }, `env ${JSON.stringify(env)}`);
  }
  assert.deepEqual(createOpenAIProvider({ env: { OPENAI_API_KEY: KEY } }).ready(), { ok: true, reason: null });
  // the foundation passes apiKey explicitly as well; either source counts
  assert.deepEqual(createOpenAIProvider({ apiKey: KEY, env: {} }).ready(), { ok: true, reason: null });
  assert.equal(NO_KEY_REASON, 'OPENAI_API_KEY not set');
  // the key is read at call time: setting it later flips ready()
  const env = {};
  const late = createOpenAIProvider({ env });
  assert.equal(late.ready().ok, false);
  env.OPENAI_API_KEY = KEY;
  assert.equal(late.ready().ok, true);
  // through the foundation's ttsStatus
  assert.deepEqual(ttsStatus(createOpenAIProvider({ env: {} })), { provider: 'openai', voice: DEFAULT_VOICE, ready: false, reason: NO_KEY_REASON });
});

test('selectProvider resolves this module: KHAN_TTS=silent never instantiates it; otherwise name openai with the real voice (criterion 1, foundation behaviour)', async () => {
  const s = await selectProvider({ KHAN_TTS: 'silent', OPENAI_API_KEY: KEY }, {});
  assert.equal(s.name, 'silent');
  assert.equal(s.model, undefined, 'silent provider has no model → openai module was not used');
  const o = await selectProvider({ OPENAI_API_KEY: KEY }, {});
  assert.equal(o.name, 'openai');
  assert.equal(o.model, DEFAULT_MODEL);
  assert.equal(o.voice, DEFAULT_VOICE);
  assert.deepEqual(o.ready(), { ok: true, reason: null });
  const noKey = await selectProvider({}, {});
  assert.equal(noKey.name, 'openai');
  assert.deepEqual(noKey.ready(), { ok: false, reason: NO_KEY_REASON });
  assert.equal(noKey.model, DEFAULT_MODEL, 'the real module (not the foundation stub) is in use');
  await assert.rejects(() => noKey.synthesize({ text: TEXT }), (e) => e.code === 'TTS_FAILED' && e.message === NO_KEY_REASON);
  // voice flows through the foundation's resolution
  assert.equal((await selectProvider({ KHAN_TTS_VOICE: 'nova' }, { tts: { voice: 'echo' } })).voice, 'nova');
  assert.equal((await selectProvider({}, { tts: { voice: 'echo' } })).voice, 'echo');
});

test('synthesize sends exactly one request with the right URL, method, headers and JSON body; response_format mp3 (criterion 2)', async () => {
  const { mock, provider, logs } = make([audioResponse()]);
  const out = await provider.synthesize({ text: TEXT });
  assert.equal(mock.calls.length, 1);
  const c = mock.calls[0];
  assert.equal(c.url, OPENAI_SPEECH_URL);
  assert.equal(c.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.headers.authorization, `Bearer ${KEY}`);
  assert.equal(c.headers['content-type'], 'application/json');
  assert.deepEqual(c.body, { model: DEFAULT_MODEL, voice: DEFAULT_VOICE, input: TEXT, response_format: 'mp3' });
  assert.equal(c.body.response_format, 'mp3');
  assert.ok(c.signal instanceof AbortSignal, 'an AbortSignal is attached');
  assert.equal(c.signal.aborted, false);
  // result shape (foundation C3)
  assert.ok(out.bytes instanceof Uint8Array);
  assert.equal(out.bytes.length, fixtureBytes().length);
  assert.equal(out.mime, 'audio/mpeg');
  assert.equal(out.ext, 'mp3');
  assert.ok(Math.abs(out.durationMs - FIXTURE_MP3_META.durationMs) <= 50, `durationMs ${out.durationMs}`);
  // logging: provider, voice, text length, duration, attempt count — and never the key
  assert.equal(logs.length, 1);
  assert.match(logs[0], /provider=openai/);
  assert.match(logs[0], new RegExp(`voice=${DEFAULT_VOICE}`));
  assert.match(logs[0], new RegExp(`chars=${TEXT.length}`));
  assert.match(logs[0], /durationMs=2011/);
  assert.match(logs[0], /attempts=1/);
  assert.ok(!logs.join('\n').includes(KEY));
  assert.ok(!/authorization|bearer/i.test(logs.join('\n')));
});

test('key hygiene: JSON.stringify(provider) and its own properties never expose the key; errors never contain it', async () => {
  const { provider, mock } = make([errorResponse(401, `Incorrect API key provided: ${KEY}`)]);
  const json = JSON.stringify(provider);
  assert.ok(!json.includes(KEY), json);
  assert.ok(!json.includes('sk-'), json);
  for (const v of Object.values(provider)) if (typeof v === 'string') assert.ok(!v.includes(KEY));
  assert.deepEqual(Object.keys(provider).sort(), ['model', 'name', 'ready', 'synthesize', 'voice']);
  // The provider must have used the key for the request …
  await assert.rejects(() => provider.synthesize({ text: TEXT }), (e) => {
    assert.equal(e.code, 'TTS_AUTH');
    // … but a server echo of the key in the error body is redacted before it can reach the playlist
    assert.ok(!String(e.message).includes(KEY), e.message);
    assert.ok(!String(e.stack).includes(KEY));
    assert.match(e.message, /Incorrect API key provided: \[redacted\]/);
    return true;
  });
  assert.equal(mock.calls[0].headers.authorization, `Bearer ${KEY}`);
  // anything that looks like a key is redacted too, even one we do not hold
  assert.equal(redactKey('key sk-proj-ABCDEFGHIJKLMNOP leaked and sk-xyz', null), 'key [redacted] leaked and sk-xyz');
  assert.equal(redactKey(`a ${KEY} b`, KEY), 'a [redacted] b');
  const { provider: p2, logs } = make([errorResponse(401, 'Incorrect API key provided')]);
  await assert.rejects(() => p2.synthesize({ text: TEXT }), (e) => e.code === 'TTS_AUTH' && !String(e.message).includes(KEY) && !String(e.stack).includes(KEY));
  assert.ok(!logs.join('\n').includes(KEY));
});

test('voice/model resolution: explicit voice > KHAN_TTS_VOICE > config.tts.voice > default; KHAN_TTS_MODEL > config.tts.model > tts-1', async () => {
  assert.equal(DEFAULT_VOICE, 'alloy');
  assert.equal(DEFAULT_MODEL, 'tts-1');
  assert.equal(resolveVoice({}, {}), 'alloy');
  assert.equal(resolveVoice({}, { tts: { voice: 'echo' } }), 'echo');
  assert.equal(resolveVoice({ KHAN_TTS_VOICE: 'nova' }, { tts: { voice: 'echo' } }), 'nova');
  assert.equal(resolveVoice({ KHAN_TTS_VOICE: '  ' }, { tts: { voice: 'echo' } }), 'echo');
  assert.equal(resolveModel({}, {}), 'tts-1');
  assert.equal(resolveModel({}, { tts: { model: 'tts-1-hd' } }), 'tts-1-hd');
  assert.equal(resolveModel({ KHAN_TTS_MODEL: 'gpt-4o-mini-tts' }, { tts: { model: 'tts-1-hd' } }), 'gpt-4o-mini-tts');
  // and what actually goes over the wire
  const a = make([audioResponse()], { env: { KHAN_TTS_VOICE: 'nova', KHAN_TTS_MODEL: 'tts-1-hd' }, config: { tts: { voice: 'echo', model: 'x' } } });
  assert.equal(a.provider.voice, 'nova');
  assert.equal(a.provider.model, 'tts-1-hd');
  await a.provider.synthesize({ text: TEXT });
  assert.equal(a.mock.calls[0].body.voice, 'nova');
  assert.equal(a.mock.calls[0].body.model, 'tts-1-hd');
  const b = make([audioResponse()], { config: { tts: { voice: 'echo' } } });
  assert.equal(b.provider.voice, 'echo');
  await b.provider.synthesize({ text: TEXT });
  assert.equal(b.mock.calls[0].body.voice, 'echo');
  // explicit voice (as the foundation passes it) wins over everything
  const c = make([audioResponse()], { voice: 'shimmer', env: { KHAN_TTS_VOICE: 'nova' }, config: { tts: { voice: 'echo' } } });
  assert.equal(c.provider.voice, 'shimmer');
  await c.provider.synthesize({ text: TEXT });
  assert.equal(c.mock.calls[0].body.voice, 'shimmer');
  // the cache key the foundation derives changes with the voice and comes back when the voice does
  const k1 = cacheKey('openai', a.provider.voice, TEXT), k2 = cacheKey('openai', b.provider.voice, TEXT), k3 = cacheKey('openai', 'nova', TEXT);
  assert.notEqual(k1, k2);
  assert.equal(k1, k3);
});

test('retry matrix (criterion 5): 429 then 200 → success in 2 attempts with the 1 s backoff', async () => {
  const { mock, provider, logs, sleeps } = make([errorResponse(429, 'Rate limit reached'), audioResponse()], { backoffMs: undefined, opts: { backoffMs: BACKOFF_MS } });
  const out = await provider.synthesize({ text: TEXT });
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(sleeps, [1000], 'first backoff is 1 s');
  assert.equal(out.ext, 'mp3');
  assert.match(logs.at(-1), /attempts=2/);
  assert.match(logs[0], /attempt=1\/3 retryable failure: attempt 1: HTTP 429/);
});

test('retry matrix: 500 ×3 → rejects with TTS_FAILED after exactly 3 attempts, backoff 1 s then 3 s, cause carries the last status', async () => {
  const { mock, provider, sleeps } = make([errorResponse(500, 'The server had an error'), errorResponse(502, ''), errorResponse(503, 'down')], { backoffMs: undefined, opts: { backoffMs: BACKOFF_MS } });
  await assert.rejects(() => provider.synthesize({ text: TEXT }), (e) => {
    assert.equal(e.code, 'TTS_FAILED');
    assert.equal(e.attempts, 3);
    assert.ok(e.cause, 'cause attached');
    assert.equal(e.cause.status, 503);
    assert.match(e.message, /after 3 attempts/);
    assert.match(e.message, /HTTP 503/);
    return true;
  });
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(sleeps, [1000, 3000]);
  assert.deepEqual(BACKOFF_MS, [1000, 3000]);
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(TIMEOUT_MS, 20000);
});

test('retry matrix: 408 and network errors are retried; 401 → TTS_AUTH after 1 attempt; 403 → TTS_AUTH; 400/404/422 → TTS_BAD_REQUEST immediately', async () => {
  const r408 = make([errorResponse(408), networkError(), audioResponse()]);
  await r408.provider.synthesize({ text: TEXT });
  assert.equal(r408.mock.calls.length, 3);
  assert.deepEqual(r408.sleeps, [0, 0]);

  const r401 = make([errorResponse(401, 'Incorrect API key provided'), audioResponse()]);
  await assert.rejects(() => r401.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_AUTH' && e.status === 401 && e.attempts === 1 && /401/.test(e.message));
  assert.equal(r401.mock.calls.length, 1, 'no retry on 401');
  assert.deepEqual(r401.sleeps, []);

  const r403 = make([errorResponse(403, 'forbidden'), audioResponse()]);
  await assert.rejects(() => r403.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_AUTH' && e.status === 403);
  assert.equal(r403.mock.calls.length, 1);

  for (const status of [400, 404, 422]) {
    const r = make([errorResponse(status, `bad ${status}: voice not supported`), audioResponse()]);
    await assert.rejects(() => r.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_BAD_REQUEST' && e.status === status && e.attempts === 1 && e.message.includes(`HTTP ${status}`) && e.message.includes('voice not supported'));
    assert.equal(r.mock.calls.length, 1, `no retry on ${status}`);
  }
  // all-network failure → TTS_FAILED with the network error as cause
  const net = make([networkError('ECONNREFUSED'), networkError('ECONNREFUSED'), networkError('ECONNREFUSED')]);
  await assert.rejects(() => net.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_FAILED' && e.attempts === 3 && e.cause && e.cause.code === 'TTS_NETWORK' && /ECONNREFUSED/.test(e.message));
  assert.equal(net.mock.calls.length, 3);
});

test('a hanging request is aborted at the timeout (per attempt), then retried; three hangs → TTS_FAILED with a timeout cause', async () => {
  const t0 = Date.now();
  const hang = make([(_u, init) => hangingResponse(init), audioResponse()], { timeoutMs: 60 });
  const out = await hang.provider.synthesize({ text: TEXT });
  assert.equal(hang.mock.calls.length, 2);
  assert.equal(hang.mock.calls[0].signal.aborted, true, 'first request was aborted');
  assert.equal(hang.mock.calls[1].signal.aborted, false, 'second request completed normally');
  assert.ok(Date.now() - t0 < 2000, 'did not wait for a real 20 s timeout');
  assert.equal(out.ext, 'mp3');
  assert.match(hang.logs[0], /timed out after 60 ms/);

  const all = make([(_u, init) => hangingResponse(init)], { timeoutMs: 30 });
  await assert.rejects(() => all.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_FAILED' && e.attempts === 3 && e.cause && e.cause.code === 'TTS_TIMEOUT' && /timed out after 30 ms/.test(e.message));
  assert.equal(all.mock.calls.length, 3);
  for (const c of all.mock.calls) assert.equal(c.signal.aborted, true);
  // env knobs reach the provider when constructed by the foundation (no injection possible there)
  const viaEnv = createOpenAIProvider({ env: { OPENAI_API_KEY: KEY, KHAN_TTS_TIMEOUT_MS: '25', KHAN_TTS_BACKOFF_MS: '0,0' }, fetch: (_u, init) => hangingResponse(init) });
  const t1 = Date.now();
  await assert.rejects(() => viaEnv.synthesize({ text: TEXT }), (e) => e.code === 'TTS_FAILED');
  assert.ok(Date.now() - t1 < 1500, 'env timeout/backoff honoured');
});

test('bad responses: non-audio content type → TTS_FAILED-class failure; empty body → failure; undecodable bytes → failure; no retries for any of them', async () => {
  const html = make([new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }), audioResponse()]);
  await assert.rejects(() => html.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_BAD_RESPONSE' && /content-type "text\/html"/.test(e.message));
  assert.equal(html.mock.calls.length, 1);

  const json = make([new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })]);
  await assert.rejects(() => json.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_BAD_RESPONSE');

  const empty = make([audioResponse(new Uint8Array(0)), audioResponse()]);
  await assert.rejects(() => empty.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_BAD_RESPONSE' && /empty audio body/.test(e.message));
  assert.equal(empty.mock.calls.length, 1);

  const garbage = make([audioResponse(new TextEncoder().encode('this is not an mp3 at all, just text pretending')), audioResponse()]);
  await assert.rejects(() => garbage.provider.synthesize({ text: TEXT }), (e) => e.code === 'TTS_BAD_RESPONSE' && e.cause && e.cause.code === 'BAD_MP3' && /not a decodable MP3/.test(e.message));
  assert.equal(garbage.mock.calls.length, 1);

  // a missing content-type is tolerated when the bytes decode; audio/mp3 and octet-stream are accepted
  for (const ct of [null, 'audio/mp3', 'audio/mpeg; charset=binary', 'application/octet-stream']) {
    const ok = make([audioResponse(fixtureBytes(), { contentType: ct })]);
    const out = await ok.provider.synthesize({ text: TEXT });
    assert.equal(out.ext, 'mp3', `content-type ${ct}`);
  }
  // invalid text input fails before any request
  const none = make([audioResponse()]);
  await assert.rejects(() => none.provider.synthesize({ text: '' }), (e) => e.code === 'TTS_BAD_REQUEST');
  await assert.rejects(() => none.provider.synthesize({}), (e) => e.code === 'TTS_BAD_REQUEST');
  assert.equal(none.mock.calls.length, 0);
});

test('default fetch is looked up per call on globalThis (so a swapped global takes effect after construction)', async () => {
  const mock = createMockFetch([audioResponse()]);
  const provider = createOpenAIProvider({ env: { OPENAI_API_KEY: KEY }, backoffMs: [0, 0] });
  mock.install();
  try {
    const out = await provider.synthesize({ text: TEXT });
    assert.equal(out.ext, 'mp3');
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.uninstall();
  }
});
