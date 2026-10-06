import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startTestServer, openSse, sleep } from './helpers/server.js';

test('route guards (criterion 13): bad ids → 400, foreign Origin → 403, own origin / no origin → ok', async () => {
  const srv = await startTestServer();
  try {
    srv.copyFixture('fx-type-text');
    await srv.waitForStatuses('fx-type-text', { s001: 'ready' });
    for (const bad of ['..%2F..%2Fetc', 'UPPER-CASE', 'short', 'has space', 'a'.repeat(65)]) {
      const r = await srv.get(`/api/lesson/${bad}/playlist`);
      assert.equal(r.status, 400, `lessonId ${bad}`);
      assert.equal((await srv.get(`/lesson/${bad}`)).status, 400);
      assert.equal((await srv.get(`/harness/${bad}`)).status, 400);
    }
    // a literal "../" is normalised away by the HTTP client before the server sees it; the server
    // then has no such route (404) — either way it never reaches the filesystem
    assert.ok([400, 404].includes((await srv.get('/api/lesson/../etc/playlist')).status));
    assert.ok([400, 404].includes((await srv.get('/lesson/../../package.json')).status));
    for (const bad of ['s1', 'S001', 'q1-a1', '..%2Fs001', 's001.json', 'q001-a1']) {
      assert.equal((await srv.get(`/api/lesson/fx-type-text/scene/${bad}`)).status, 400, `sceneId ${bad}`);
      assert.equal((await srv.get(`/api/lesson/fx-type-text/audio/${bad}`)).status, 400, `audio ${bad}`);
    }
    const body = { text: 'why?', atSceneId: 's001', atTime: 1 };
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', body, { origin: 'http://evil.local' })).status, 403);
    assert.equal((await srv.get('/api/lesson/fx-type-text/playlist', { origin: 'http://evil.local:7777' })).status, 403);
    assert.equal((await srv.get('/api/health', { origin: `http://127.0.0.1:${srv.info.port + 1}` })).status, 403);
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', body, { origin: `http://127.0.0.1:${srv.info.port}` })).status, 200);
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', body, { origin: `http://localhost:${srv.info.port}` })).status, 200);
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', body)).status, 200);
    // question body validation
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', { text: '' })).status, 400);
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', { text: 'x'.repeat(501) })).status, 400);
    assert.equal((await srv.post('/api/lesson/fx-type-text/question', { text: 'ok', atSceneId: 'bad' })).status, 400);
    assert.equal((await srv.post('/api/lesson/fx-type-text/position', { sceneId: 's001', event: 'pause' })).status, 400);
    assert.equal((await srv.post('/api/lesson/fx-type-text/position', { sceneId: 's001', event: 'start' })).status, 204);
    assert.equal((await srv.get('/api/lesson/fx-type-text/position')).status, 405);
    const raw = await fetch(srv.url('/api/lesson/fx-type-text/question'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(raw.status, 400);
  } finally {
    await srv.close();
  }
});

test('404s, static serving, pages, audio Content-Type, health', async () => {
  const srv = await startTestServer();
  try {
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/playlist')).status, 404);
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/outline')).status, 404);
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/status')).status, 404);
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/scene/s001')).status, 404);
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/audio/s001')).status, 404);
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/wait?timeout=1')).status, 404);
    // (events on an unknown but well-formed id is a 200 `waiting` stream — see the SSE-before-ingest test)
    assert.equal((await srv.get('/api/nope')).status, 404);
    assert.equal((await srv.get('/player/does-not-exist.js')).status, 404);
    assert.equal((await srv.get('/player/../package.json')).status, 404);
    assert.equal((await srv.get('/player/..%2F..%2Fpackage.json')).status, 404);
    const health = await srv.get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.port, srv.info.port);
    assert.equal(health.body.lessonsDir, srv.lessonsDir);
    assert.deepEqual(health.body.tts, { provider: 'silent', voice: null, ready: true, reason: null });

    srv.copyFixture('fx-type-code');
    await srv.waitForStatuses('fx-type-code', { s001: 'ready', s002: 'ready', s003: 'ready' });
    const outline = await srv.get('/api/lesson/fx-type-code/outline');
    assert.equal(outline.status, 200);
    assert.equal(outline.body.schema, 'khan-outline/1');
    const scene = await srv.get('/api/lesson/fx-type-code/scene/s002');
    assert.equal(scene.status, 200);
    assert.equal(scene.body.elements[0].type, 'code');
    assert.equal((await srv.get('/api/lesson/fx-type-code/scene/s009')).status, 404, 'unknown scene');
    const audio = await fetch(srv.url('/api/lesson/fx-type-code/audio/s001'));
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'audio/wav');
    const bytes = new Uint8Array(await audio.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
    assert.equal(Number(audio.headers.get('content-length')), bytes.length);
    const playlist = await srv.get('/api/lesson/fx-type-code/playlist');
    assert.equal(playlist.body.entries[0].audioUrl, '/api/lesson/fx-type-code/audio/s001');
    assert.equal(playlist.body.entries[0].kind, 'lesson');
    assert.equal(playlist.body.entries[0].position, 0);
    assert.equal(playlist.body.title, 'Code elements');
    assert.equal(typeof playlist.body.producer.lastWriteAgeMs, 'number');
    // pages and static
    for (const [path, type, needle] of [
      ['/lesson/fx-type-code', 'text/html', '<canvas id="board"'],
      ['/harness/fx-type-code', 'text/html', 'harness'],
      ['/player/app.js', 'text/javascript', 'window.__khan'],
      ['/shared/layout-core/constants.js', 'text/javascript', 'CANVAS_W'],
      ['/vendor/rough/rough.esm.js', 'text/javascript', 'export'],
      ['/player/tokens.css', 'text/css', '--khan-'],
    ]) {
      const r = await fetch(srv.url(path));
      assert.equal(r.status, 200, path);
      assert.ok(r.headers.get('content-type').startsWith(type), `${path}: ${r.headers.get('content-type')}`);
      assert.ok((await r.text()).includes(needle), `${path} should contain ${needle}`);
    }
    const font = await fetch(srv.url('/vendor/fonts/PatrickHand-Regular.ttf'));
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/ttf');
    assert.equal((await srv.get('/favicon.ico')).status, 204);
    const status = await srv.get('/api/lesson/fx-type-code/status');
    assert.equal(status.body.counts.ready, 3);
    assert.equal(status.body.counts.planned, 3);
    assert.equal(status.body.ended, false);
  } finally {
    await srv.close();
  }
});

test('SSE before ingest (QA finding 7): a well-formed unknown lessonId gets a 200 stream with `waiting`, then `playlist` once the lesson appears; malformed ids stay rejected', async () => {
  const srv = await startTestServer();
  const L = 'fx-type-text'; // the folder does not exist yet; it is copied in below
  try {
    assert.equal((await srv.get(`/api/lesson/${L}/playlist`)).status, 404, 'the lesson does not exist yet');
    const sse = await openSse(srv.url(`/api/lesson/${L}/events`), { until: 'waiting' });
    assert.equal(sse.status, 200);
    assert.ok(sse.headers.get('content-type').startsWith('text/event-stream'));
    assert.equal(sse.events[0].event, 'waiting');
    assert.equal(sse.events[0].data.lessonId, L);
    assert.equal(srv.info.store.get(L), null, 'no phantom lesson is created by the pending stream');
    await sleep(300);
    assert.ok(sse.events.every((e) => e.event === 'waiting'), 'nothing but waiting until the lesson exists');
    // the outline lands → the same connection switches to playlist snapshots
    const playlistEv = sse.next('playlist');
    srv.copyFixture(L);
    const first = await playlistEv;
    assert.equal(first.data.lessonId, L);
    assert.equal(first.data.outline.lessonId, L);
    await srv.waitForStatuses(L, { s001: 'ready', s002: 'ready', s003: 'ready' });
    await sleep(100);
    const last = sse.events[sse.events.length - 1];
    assert.equal(last.event, 'playlist');
    assert.equal(last.data.entries.every((e) => e.status === 'ready'), true);
    assert.equal((await srv.playlist(L)).player.connected, true, 'the attached stream counts as the player');
    sse.close();
    await srv.waitFor(async () => (await srv.playlist(L)).player.connected === false, { what: 'disconnect' });
    // malformed ids are still rejected before anything else
    assert.equal((await srv.get('/api/lesson/UPPER-CASE/events')).status, 400);
    assert.equal((await srv.get('/api/lesson/short/events')).status, 400);
    // an abandoned pending stream is dropped cleanly
    const abandoned = await openSse(srv.url('/api/lesson/fx-never-arrives/events'), { until: 'waiting' });
    assert.equal(srv.info.store.get('fx-never-arrives'), null);
    abandoned.close();
    await sleep(100);
  } finally {
    await srv.close();
  }
});

test('body cap (QA finding 11): a POST body over 64 KB → 413 JSON, declared or chunked; the server stays healthy', async () => {
  const srv = await startTestServer();
  try {
    srv.copyFixture('fx-type-text');
    await srv.waitForStatuses('fx-type-text', { s001: 'ready' });
    const big = JSON.stringify({ sceneId: 's001', event: 'start', pad: 'x'.repeat(70 * 1024) });
    // declared Content-Length over the cap
    const r1 = await fetch(srv.url('/api/lesson/fx-type-text/position'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
    assert.equal(r1.status, 413);
    assert.match((await r1.json()).error, /too large/);
    // chunked transfer (no Content-Length): the cap is hit while streaming
    const r2 = await new Promise((resolve, reject) => {
      const u = new URL(srv.url('/api/lesson/fx-type-text/question'));
      const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => {
        let text = '';
        res.on('data', (d) => { text += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: text }));
      });
      req.on('error', reject);
      const piece = 'y'.repeat(8 * 1024);
      req.write('{"text":"');
      let sent = 0;
      const pump = () => { if (req.destroyed) return; if (sent >= 10) { req.end('"}'); return; } sent++; req.write(piece, pump); };
      pump();
    });
    assert.equal(r2.status, 413);
    assert.match(JSON.parse(r2.body).error, /too large/);
    // still serving, and an in-range body still works
    assert.equal((await srv.get('/api/health')).status, 200);
    assert.equal((await srv.post('/api/lesson/fx-type-text/position', { sceneId: 's001', event: 'start' })).status, 204);
    const ok = await fetch(srv.url('/api/lesson/fx-type-text/question'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'z'.repeat(500), atSceneId: 's001', atTime: 1, pad: 'p'.repeat(60 * 1024) }) });
    assert.equal(ok.status, 200);
  } finally {
    await srv.close();
  }
});

test('wait on an unknown lesson → 404 and no phantom lesson (QA finding 13); wait on a known lesson still works', async () => {
  const srv = await startTestServer();
  try {
    const r = await srv.get('/api/lesson/zzzz-not-here-either/wait?timeout=1');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'unknown lesson');
    assert.equal(srv.info.store.get('zzzz-not-here-either'), null);
    assert.equal((await srv.get('/api/lesson/zzzz-not-here-either/playlist')).status, 404, 'still unknown afterwards');
    assert.equal((await srv.get('/api/lesson/zzzz-not-here-either/status')).status, 404);
    srv.copyFixture('fx-type-text', { onlyScenes: ['s001'] });
    await srv.waitForStatuses('fx-type-text', { s001: 'ready' });
    const w = await srv.get('/api/lesson/fx-type-text/wait?timeout=1');
    assert.equal(w.status, 200);
    assert.equal(w.body.event, 'continue');
    assert.equal(w.body.readyAhead, 1);
  } finally {
    await srv.close();
  }
});
