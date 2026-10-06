// Criteria 6–9: a scripted production acting as Claude (with and without a mid-lesson question),
// degrade visibility, status without a key, and `khan play` of a fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cpSync } from 'node:fs';
import { makeHome, runKhan, startKhan, startHomeServer, outlineOf, sceneOf, badSceneOf, killPid, FIXTURES, sleep } from './helpers.js';

test('production run 1 (criterion 6): serve → outline → 4 scenes interleaved with wait → fake player → finished', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h);
  try {
    const o = await runKhan(['outline', '-'], { env: h.env, stdin: outlineOf('Production one', 4) });
    assert.equal(o.code, 0, o.stdout);
    const L = o.json.lessonId;
    // serve reports the running server rather than spawning
    const s = await runKhan(['serve'], { env: h.env });
    assert.equal(s.json.spawned, false);
    assert.equal(s.json.port, srv.info.port);

    const events = [];
    for (let i = 1; i <= 4; i++) {
      const id = `s00${i}`;
      const r = await runKhan(['scene', L, id], { env: h.env, stdin: sceneOf(id, { final: i === 4 }) });
      assert.equal(r.json.status, 'ready', r.stdout);
      // the fake player keeps up: it starts the scene just written, ending the previous one
      if (i > 1) await srv.post(`/api/lesson/${L}/position`, { sceneId: `s00${i - 1}`, event: 'end' });
      await srv.post(`/api/lesson/${L}/position`, { sceneId: id, event: 'start', t: 0 });
      if (i < 4) {
        const w = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
        events.push(w.json.event);
        assert.equal(w.json.event, 'continue', w.stdout);
        assert.equal(w.json.readyAhead, 0);
      }
    }
    // final scene written → wait blocks until the player ends it → finished
    const pending = startKhan(['wait', L, '--timeout', '10'], { env: h.env });
    await sleep(500);
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 's004', event: 'end' });
    const fin = await pending.done;
    assert.equal(fin.json.event, 'finished', fin.stdout);
    assert.deepEqual(events, ['continue', 'continue', 'continue']);
    assert.equal(fin.json.summary.scenes, 4);
    assert.equal(fin.json.summary.planned, 4);
    assert.equal(fin.json.summary.questions, 0);
    const st = await runKhan(['status', L], { env: h.env });
    assert.equal(st.json.ended, true);
    assert.equal(st.json.counts.ready, 4);
    assert.deepEqual((await srv.playlist(L)).entries.map((e) => e.sceneId), ['s001', 's002', 's003', 's004']);
  } finally {
    await srv.close();
    h.cleanup();
  }
});

test('production run 2 (criterion 6): a question mid-way → answer scenes → continue → finished; playlist order per §4.1', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h);
  const L = 'production-two';
  try {
    assert.equal((await runKhan(['outline', L], { env: h.env, stdin: outlineOf('Production two', 4) })).code, 0);
    assert.equal((await runKhan(['scene', L, 's001'], { env: h.env, stdin: sceneOf('s001') })).json.status, 'ready');
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 's001', event: 'start', t: 0 });
    assert.equal((await runKhan(['wait', L, '--timeout', '5'], { env: h.env })).json.event, 'continue');
    assert.equal((await runKhan(['scene', L, 's002'], { env: h.env, stdin: sceneOf('s002') })).json.status, 'ready');
    assert.equal((await runKhan(['wait', L, '--timeout', '5'], { env: h.env })).json.event, 'continue');
    assert.equal((await runKhan(['scene', L, 's003'], { env: h.env, stdin: sceneOf('s003') })).json.status, 'ready');
    // s001 is playing with s002, s003 ready ahead (2 < 3) → still continue; the producer is ahead of the player
    const c0 = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(c0.json.event, 'continue');
    assert.equal(c0.json.readyAhead, 2);
    // the producer's scene 4 is not written yet; it waits with a full-enough buffer: simulate by writing s004 as non-final
    assert.equal((await runKhan(['scene', L, 's004'], { env: h.env, stdin: sceneOf('s004') })).json.status, 'ready');
    // the user asks while s001 plays (the now-blocked wait receives it)
    const pending = startKhan(['wait', L, '--timeout', '10'], { env: h.env });
    await sleep(500);
    const q = await srv.post(`/api/lesson/${L}/question`, { text: 'what is a key?', atSceneId: 's001', atTime: 2.5 });
    const qe = await pending.done;
    assert.equal(qe.json.event, 'question');
    assert.equal(qe.json.qId, q.body.qId);
    assert.equal(qe.json.atSceneId, 's001');
    const a1 = await runKhan(['scene', L, 'q001-a01'], { env: h.env, stdin: sceneOf('q001-a01', { questionId: 'q001', insertAfter: 's001' }) });
    assert.equal(a1.json.status, 'ready', a1.stdout);
    assert.equal(a1.json.inbox.questions, 0, 'the first answer scene clears the pending question');
    const a2 = await runKhan(['scene', L, 'q001-a02'], { env: h.env, stdin: sceneOf('q001-a02', { questionId: 'q001', insertAfter: 's001', final: true }) });
    assert.equal(a2.json.status, 'ready');
    // a01 must be a wipe: a region a01 is rejected by the server
    const badA = await runKhan(['scene', L, 'q002-a01'], { env: h.env, stdin: sceneOf('q002-a01', { questionId: 'q002', insertAfter: 's002', board: { mode: 'region', slots: 'A1:B1' }, final: true }) });
    assert.equal(badA.json.status, 'rejected');
    assert.ok(badA.json.errors.some((e) => e.code === 'BAD_BOARD'));
    assert.equal((await runKhan(['scene', L, 'q002-a01'], { env: h.env, stdin: sceneOf('q002-a01', { questionId: 'q002', insertAfter: 's002', final: true }) })).json.status, 'ready');
    // the player plays the answers and moves on; after q002-a01 starts only s003, s004 are ahead → continue
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 's001', event: 'end' });
    for (const id of ['q001-a01', 'q001-a02', 's002']) await srv.play(L, id);
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 'q002-a01', event: 'start', t: 0 });
    const c = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(c.json.event, 'continue', c.stdout);
    assert.equal(c.json.readyAhead, 2);
    // the producer rewrites s004 as the final scene (allowed: same sceneId, re-validated)
    const fin4 = await runKhan(['scene', L, 's004'], { env: h.env, stdin: sceneOf('s004', { final: true }) });
    assert.equal(fin4.json.status, 'ready', fin4.stdout);
    const order = (await srv.playlist(L)).entries.map((e) => e.sceneId);
    assert.deepEqual(order, ['s001', 'q001-a01', 'q001-a02', 's002', 'q002-a01', 's003', 's004']);
    assert.equal((await srv.playlist(L)).entries.find((e) => e.sceneId === 's004').final, true);
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 'q002-a01', event: 'end' });
    await srv.play(L, 's003');
    await srv.play(L, 's004');
    const fin = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(fin.json.event, 'finished', fin.stdout);
    assert.equal(fin.json.summary.answerScenes, 3);
    assert.equal(fin.json.summary.scenes, 4);
    assert.equal(fin.json.summary.questions, 1, 'q002 was written by the producer, only q001 was asked');
  } finally {
    await srv.close();
    h.cleanup();
  }
});

test('degrade visibility (criterion 7): rejected twice → degraded; scene/wait output carry the notice; status counts it', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h, { extraEnv: { KHAN_REJECT_GRACE_MS: '60000' } });
  const L = 'degrade-visible';
  try {
    assert.equal((await runKhan(['outline', L], { env: h.env, stdin: outlineOf('Degrade', 3) })).code, 0);
    assert.equal((await runKhan(['scene', L, 's001'], { env: h.env, stdin: sceneOf('s001') })).json.status, 'ready');
    const bad = badSceneOf('s002', { elements: [{ id: 'good', type: 'text', slot: 'A1:B1', text: 'fine' }, { id: 'bad', type: 'text', slot: 'C1', style: 'title', text: 'Nine words in a title is too many here' }] });
    const first = await runKhan(['scene', L, 's002'], { env: h.env, stdin: bad });
    assert.equal(first.json.status, 'rejected');
    assert.equal(first.json.inbox.rejects, 1);
    const rj = await runKhan(['wait', L, '--timeout', '5'], { env: h.env });
    assert.equal(rj.json.event, 'reject');
    // still invalid on the rewrite → degraded, played without the bad element
    bad.elements[1].text = 'Still far too many words for a title element';
    const second = await runKhan(['scene', L, 's002'], { env: h.env, stdin: bad });
    assert.equal(second.code, 0);
    assert.equal(second.json.status, 'degraded', second.stdout);
    assert.equal(second.json.degraded, true);
    assert.deepEqual(second.json.droppedElementIds, ['bad']);
    assert.ok(second.json.notices.some((n) => n.kind === 'degraded' && n.sceneId === 's002' && n.droppedElementIds.includes('bad')), second.stdout);
    assert.equal(second.json.inbox.rejects, 0, 'degrading clears the pending reject');
    await srv.waitForStatuses(L, { s002: 'ready' });
    assert.equal((await srv.playlist(L)).entries.find((e) => e.sceneId === 's002').degraded, true);
    const w = await runKhan(['wait', L, '--timeout', '2'], { env: h.env });
    assert.ok(['continue', 'timeout'].includes(w.json.event), w.stdout);
    assert.ok(w.json.notices.some((n) => n.kind === 'degraded' && n.sceneId === 's002'), 'wait carries the degraded notice once');
    const again = await runKhan(['wait', L, '--timeout', '1'], { env: h.env });
    assert.deepEqual(again.json.notices, [], 'notices are cleared after delivery');
    const st = await runKhan(['status', L], { env: h.env });
    assert.equal(st.code, 0);
    assert.equal(st.json.counts.degraded, 1);
    assert.equal(st.json.counts.rejected, 0);
    assert.equal(st.json.tts.ready, true);
    assert.equal(st.lines.length, 1);
    // unknown lesson → UNKNOWN_LESSON exit 1
    const unknown = await runKhan(['status', 'never-heard-of-it'], { env: h.env });
    assert.equal(unknown.code, 1);
    assert.equal(unknown.json.code, 'UNKNOWN_LESSON');
  } finally {
    await srv.close();
    h.cleanup();
  }
});

test('status without a key and KHAN_TTS unset (criterion 8): tts.ready false with a reason; the server still runs', async () => {
  const h = makeHome({ KHAN_TTS: undefined });
  assert.equal(h.env.KHAN_TTS, undefined);
  assert.equal(h.env.OPENAI_API_KEY, undefined);
  const srv = await startHomeServer(h);
  const L = 'no-key-lesson';
  try {
    const o = await runKhan(['outline', L], { env: h.env, stdin: outlineOf('No key', 3) });
    assert.equal(o.code, 0, o.stdout);
    const st = await runKhan(['status', L], { env: h.env });
    assert.equal(st.code, 0, st.stdout);
    assert.equal(st.json.tts.ready, false);
    assert.equal(typeof st.json.tts.reason, 'string');
    assert.ok(st.json.tts.reason.length > 0);
    assert.equal(st.json.tts.provider, 'openai');
    const s = await runKhan(['serve'], { env: h.env });
    assert.equal(s.json.tts.ready, false, 'serve surfaces tts.ready for the skill to stop on');
  } finally {
    await srv.close();
    h.cleanup();
  }
});

test('khan play fx-full-tour --lessons-dir <copy of fixtures/lessons> (criterion 9): spawns, prints the URL, all 10 scenes ready ≤ 10 s; missing lesson → NO_LESSON', async () => {
  const h = makeHome();
  // the server writes audio/, control/ and state/ into every lesson folder it serves, so replay a
  // temp copy of the fixtures rather than the tracked ones (same approach as playwright.config.js)
  const lessons = join(h.home, 'fixture-lessons');
  cpSync(join(FIXTURES, 'lessons'), lessons, { recursive: true });
  let pid = null;
  try {
    const missing = await runKhan(['play', 'no-such-lesson-here', '--lessons-dir', lessons], { env: h.env });
    assert.equal(missing.code, 1);
    assert.equal(missing.json.code, 'NO_LESSON');
    assert.equal(h.readServerJson(), null, 'nothing spawned for a missing lesson');

    const t0 = Date.now();
    const r = await runKhan(['play', 'fx-full-tour', '--lessons-dir', lessons, '--port', '0'], { env: h.env });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.lines.length, 1);
    pid = h.readServerJson().pid;
    assert.equal(r.json.ok, true);
    assert.equal(r.json.spawned, true);
    assert.equal(r.json.ingested, true);
    assert.equal(r.json.opened, false, 'KHAN_NO_OPEN=1 honoured');
    assert.equal(r.json.url, `http://127.0.0.1:${r.json.port}/lesson/fx-full-tour`);
    assert.equal(r.json.lessonsDir, lessons);
    // all scenes ready within 10 s of the trigger
    for (;;) {
      const p = await (await fetch(`${r.json.url.replace('/lesson/fx-full-tour', '')}/api/lesson/fx-full-tour/playlist`)).json();
      if (p.entries.length === 10 && p.entries.every((e) => e.status === 'ready')) break;
      assert.ok(Date.now() - t0 < 10000, `not all ready after 10 s: ${JSON.stringify(p.entries.map((e) => [e.sceneId, e.status]))}`);
      await sleep(100);
    }
    const st = await runKhan(['status', 'fx-full-tour'], { env: h.env });
    assert.equal(st.json.counts.ready, 10);
    assert.equal(st.json.counts.svgElements, 1);
    // play again: reuses the server, no second spawn
    const again = await runKhan(['play', 'fx-full-tour', '--lessons-dir', lessons], { env: h.env });
    assert.equal(again.json.spawned, false);
    assert.equal(h.readServerJson().pid, pid);
    // --no-open flag also suppresses opening
    const noOpen = await runKhan(['play', 'fx-type-text', '--no-open'], { env: { ...h.env, KHAN_NO_OPEN: '' } });
    assert.equal(noOpen.code, 0, noOpen.stdout);
    assert.equal(noOpen.json.opened, false);
  } finally {
    await killPid(pid);
    h.cleanup();
  }
});
