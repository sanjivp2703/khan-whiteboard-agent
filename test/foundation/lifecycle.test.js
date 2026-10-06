import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLifecycle } from '../../server/lifecycle.js';
import { startTestServer, openSse, sleep } from './helpers/server.js';
import { FIXTURES, REPO_ROOT } from './helpers/fixtures.js';

test('lifecycle unit: KHAN_NO_OPEN suppresses the opener; idle exit fires after ended / all clients gone; activity cancels', async () => {
  const calls = [];
  const exits = [];
  const lc = createLifecycle({ env: { KHAN_NO_OPEN: '1', KHAN_IDLE_EXIT_MS: '60' }, opener: (u) => calls.push(u), onIdleExit: (why) => exits.push(why) });
  assert.equal(lc.openBrowser('http://x'), false);
  assert.deepEqual(calls, []);
  lc.noteEnded();
  assert.equal(lc.pendingReason(), 'ended');
  await sleep(120);
  assert.deepEqual(exits, ['ended']);
  lc.noteAllClientsGone();
  lc.noteActivity();
  await sleep(120);
  assert.deepEqual(exits, ['ended'], 'activity cancels a pending exit');
  const open = createLifecycle({ env: {}, opener: (u) => calls.push(u), idleExitMs: 1000 });
  assert.equal(open.openBrowser('http://y'), true);
  assert.deepEqual(calls, ['http://y']);
  assert.equal(open.idleMs, 1000);
  open.dispose();
  lc.dispose();
});

test('in-process: a new outline opens the browser unless KHAN_NO_OPEN=1 (opener spy never invoked)', async () => {
  const srv = await startTestServer();
  try {
    srv.copyFixture('fx-type-box');
    await srv.waitForStatuses('fx-type-box', { s001: 'ready' });
    assert.deepEqual(srv.opened, []);
    assert.deepEqual(srv.info.lifecycle.opened, []);
  } finally {
    await srv.close();
  }
  const srv2 = await startTestServer({ KHAN_NO_OPEN: '' });
  try {
    srv2.copyFixture('fx-type-box');
    await srv2.waitFor(() => srv2.opened.length > 0, { what: 'opener' });
    assert.equal(srv2.opened[0], `${srv2.base}/lesson/fx-type-box`);
    srv2.copyFixture('fx-type-box', { as: 'fx-type-box-2' }); // a second lesson with mismatched ids still opens once
    await sleep(400);
    assert.equal(srv2.opened.length, 2);
  } finally {
    await srv2.close();
  }
});

test('startup scan never opens the browser (QA finding 5): lesson folders present at start → 0 opener calls; an outline appearing afterwards → exactly 1', async () => {
  const present = ['fx-type-text', 'fx-type-box', 'fx-type-list'];
  const srv = await startTestServer({ KHAN_NO_OPEN: '' }, {
    populate: (lessonsDir) => { for (const id of present) cpSync(join(FIXTURES, 'lessons', id), join(lessonsDir, id), { recursive: true }); },
  });
  try {
    for (const id of present) await srv.waitForStatuses(id, { s001: 'ready' });
    await sleep(300);
    assert.deepEqual(srv.opened, [], 'no tab for lessons ingested by the startup scan');
    assert.deepEqual(srv.info.lifecycle.opened, []);
    // the lessons are fully served (this is the replay path)
    assert.equal((await srv.get('/api/lesson/fx-type-text/outline')).status, 200);
    // a startup lesson's outline rewritten later still does not open (it is not a new lesson)
    const outline = JSON.parse((await import('node:fs')).readFileSync(join(srv.lessonsDir, 'fx-type-text', 'outline.json'), 'utf8'));
    srv.writeOutline('fx-type-text', { ...outline, title: 'Renamed' });
    await srv.waitFor(async () => (await srv.get('/api/lesson/fx-type-text/outline')).body.title === 'Renamed', { what: 'outline rewrite ingested' });
    await sleep(200);
    assert.deepEqual(srv.opened, []);
    // a NEW outline after startup opens exactly once
    srv.copyFixture('fx-type-code');
    await srv.waitFor(() => srv.opened.length > 0, { what: 'opener for the new lesson' });
    await srv.waitForStatuses('fx-type-code', { s001: 'ready', s002: 'ready', s003: 'ready' });
    await sleep(300);
    assert.deepEqual(srv.opened, [`${srv.base}/lesson/fx-type-code`]);
  } finally {
    await srv.close();
  }
  // KHAN_NO_OPEN=1 still suppresses the opener for new lessons (the CLI relies on it)
  const srv2 = await startTestServer({ KHAN_NO_OPEN: '1' });
  try {
    srv2.copyFixture('fx-type-code');
    await srv2.waitForStatuses('fx-type-code', { s001: 'ready' });
    await sleep(200);
    assert.deepEqual(srv2.opened, []);
  } finally {
    await srv2.close();
  }
});

function spawnServer(lessonsDir, cacheDir, env) {
  const child = spawn(process.execPath, [join(REPO_ROOT, 'server', 'index.js'), '--port', '0', '--lessons-dir', lessonsDir, '--cache-dir', cacheDir], {
    env: { ...process.env, KHAN_TTS: 'silent', KHAN_NO_OPEN: '1', KHAN_WATCH_INTERVAL_MS: '80', KHAN_WATCH_STABLE_MS: '100', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const started = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start: ${err}`)), 15000);
    child.stdout.on('data', () => { const line = out.split('\n').find((l) => l.startsWith('{')); if (line) { clearTimeout(t); resolve(JSON.parse(line)); } });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`exited early with ${code}: ${err}`)); });
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, started, exited, stderr: () => err };
}

test('spawned process (criterion 16): exits ~2 s after ended and ~2 s after the only SSE client disconnects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'khan-lc-'));
  const lessonsDir = join(root, 'lessons');
  mkdirSync(lessonsDir);
  cpSync(join(FIXTURES, 'lessons', 'fx-type-text'), join(lessonsDir, 'fx-type-text'), { recursive: true });
  try {
    // (a) ended → exit
    let s = spawnServer(lessonsDir, join(root, 'cache'), { KHAN_IDLE_EXIT_MS: '2000' });
    let info = await s.started;
    const base = `http://127.0.0.1:${info.port}`;
    const poll = async (pred) => { for (let i = 0; i < 200; i++) { const r = await fetch(`${base}/api/lesson/fx-type-text/playlist`); if (r.status === 200 && pred(await r.json())) return; await sleep(50); } throw new Error('timeout'); };
    await poll((p) => p.entries.length === 3 && p.entries.every((e) => e.status === 'ready'));
    const t0 = Date.now();
    for (const id of ['s001', 's002', 's003']) {
      await fetch(`${base}/api/lesson/fx-type-text/position`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId: id, event: 'start' }) });
      await fetch(`${base}/api/lesson/fx-type-text/position`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId: id, event: 'end' }) });
    }
    const st = await (await fetch(`${base}/api/lesson/fx-type-text/status`)).json();
    assert.equal(st.ended, true);
    const code = await Promise.race([s.exited, sleep(8000).then(() => 'timeout')]);
    const took = Date.now() - t0;
    assert.equal(code, 0, `exit code ${code}; stderr: ${s.stderr()}`);
    assert.ok(took >= 1800 && took < 7000, `exited after ${took} ms`);

    // (b) only SSE client disconnects → exit
    s = spawnServer(lessonsDir, join(root, 'cache'), { KHAN_IDLE_EXIT_MS: '2000' });
    info = await s.started;
    const base2 = `http://127.0.0.1:${info.port}`;
    for (let i = 0; i < 200; i++) { const r = await fetch(`${base2}/api/lesson/fx-type-text/playlist`); if (r.status === 200) break; await sleep(50); }
    const sse = await openSse(`${base2}/api/lesson/fx-type-text/events`);
    await sleep(300);
    const t1 = Date.now();
    sse.close();
    const code2 = await Promise.race([s.exited, sleep(8000).then(() => 'timeout')]);
    const took2 = Date.now() - t1;
    assert.equal(code2, 0, `exit code ${code2}; stderr: ${s.stderr()}`);
    assert.ok(took2 >= 1800 && took2 < 7000, `exited after ${took2} ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
