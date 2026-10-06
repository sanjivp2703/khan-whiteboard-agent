// khan wait (criterion 5): continue / question / reject / timeout / finished / SERVER_DOWN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHome, runKhan, startKhan, startHomeServer, outlineOf, sceneOf, badSceneOf, sleep } from './helpers.js';

test('wait: continue immediately, question within 1 s while blocked, reject, timeout ~2 s, finished with summary', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h);
  const L = 'wait-cmd-lesson';
  try {
    assert.equal((await runKhan(['outline', L], { env: h.env, stdin: outlineOf('Wait', 4) })).code, 0);
    assert.equal((await runKhan(['scene', L, 's001'], { env: h.env, stdin: sceneOf('s001') })).json.status, 'ready');

    // (a) < 3 ready ahead, no final → continue, fast
    const c = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(c.code, 0);
    assert.equal(c.json.event, 'continue');
    assert.equal(c.json.readyAhead, 1);
    assert.deepEqual(c.json.notices, []);
    assert.ok(c.ms < 1500, `continue took ${c.ms} ms including node startup`);
    assert.equal(c.lines.length, 1);

    // fill the buffer so wait blocks
    assert.equal((await runKhan(['scene', L, 's002'], { env: h.env, stdin: sceneOf('s002') })).json.status, 'ready');
    assert.equal((await runKhan(['scene', L, 's003'], { env: h.env, stdin: sceneOf('s003') })).json.status, 'ready');

    // (b) a question arrives while blocked → question event within 1 s of the POST
    const pending = startKhan(['wait', L, '--timeout', '10'], { env: h.env });
    await sleep(600); // child start + request in flight
    const tq = Date.now();
    const q = await srv.post(`/api/lesson/${L}/question`, { text: 'why is it cached?', atSceneId: 's002', atTime: 4.5 });
    assert.equal(q.body.qId, 'q001');
    const qr = await pending.done;
    assert.ok(Date.now() - tq < 1000, `question delivered ${Date.now() - tq} ms after the POST`);
    assert.equal(qr.code, 0);
    assert.equal(qr.json.event, 'question');
    assert.equal(qr.json.qId, 'q001');
    assert.equal(qr.json.text, 'why is it cached?');
    assert.equal(qr.json.atSceneId, 's002');
    assert.equal(qr.json.atTime, 4.5);
    assert.ok(Array.isArray(qr.json.notices));

    // answer it so the inbox clears
    const a = await runKhan(['scene', L, 'q001-a01'], { env: h.env, stdin: sceneOf('q001-a01', { questionId: 'q001', insertAfter: 's002', final: true }) });
    assert.equal(a.json.status, 'ready');
    assert.equal(a.json.inbox.questions, 0);

    // (c) an invalid final scene → reject with errors
    const bad = await runKhan(['scene', L, 's004'], { env: h.env, stdin: badSceneOf('s004', { final: true }) });
    assert.equal(bad.json.status, 'rejected');
    const rj = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(rj.json.event, 'reject');
    assert.equal(rj.json.sceneId, 's004');
    assert.equal(rj.json.attempt, 1);
    assert.ok(rj.json.errors.some((e) => e.code === 'CAP_WORDS' || e.code === 'SLOT_TOO_SMALL'));

    // rewrite valid; lesson now has a final scene → wait blocks → timeout after ~2 s
    assert.equal((await runKhan(['scene', L, 's004'], { env: h.env, stdin: sceneOf('s004', { final: true }) })).json.status, 'ready');
    const to = await runKhan(['wait', L, '--timeout', '2'], { env: h.env });
    assert.equal(to.json.event, 'timeout');
    assert.ok(to.ms >= 1900 && to.ms < 4500, `timeout took ${to.ms} ms`);
    assert.deepEqual(to.json.notices, []);

    // (d) fake player plays everything in playlist order → finished with counts
    const order = (await srv.playlist(L)).entries.map((e) => e.sceneId);
    assert.deepEqual(order, ['s001', 's002', 'q001-a01', 's003', 's004']);
    for (const id of order) await srv.play(L, id);
    const fin = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(fin.json.event, 'finished');
    assert.equal(fin.json.summary.scenes, 4);
    assert.equal(fin.json.summary.answerScenes, 1);
    assert.equal(fin.json.summary.questions, 1);
    assert.equal(fin.json.summary.degraded, 0);
    assert.equal(fin.json.summary.ready, 5);
    // default timeout is 540 and anything above 600 is clamped (no CLI error)
    assert.equal((await runKhan(['wait', L, '--timeout', '9999'], { env: h.env })).json.event, 'finished');
  } finally {
    await srv.close();
    h.cleanup();
  }
  // (e) server down → error event, exit 2
  const down = await runKhan(['wait', L, '--timeout', '1'], { env: h.env });
  assert.equal(down.code, 2);
  assert.equal(down.json.event, 'error');
  assert.equal(down.json.code, 'SERVER_DOWN');
  assert.ok(down.json.message);
});
