import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.js';

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
    assert.equal((await srv.get('/api/lesson/fx-no-such-lesson/events')).status, 404);
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
