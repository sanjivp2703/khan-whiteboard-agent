import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, openSse, sleep } from './helpers/server.js';
import * as fsMod from 'node:fs';
const await_fs = () => fsMod;

const outline = (lessonId, n) => ({ schema: 'khan-outline/1', lessonId, title: 'Wait test', scenes: Array.from({ length: n }, (_, i) => ({ sceneId: `s${String(i + 1).padStart(3, '0')}`, title: `S${i + 1}`, goal: 'g' })), producer: { kind: 'test', version: '1' } });
const scene = (lessonId, sceneId, over = {}) => ({
  schema: 'khan-scene/1', lessonId, sceneId, title: sceneId,
  narration: 'A perfectly ordinary narration that is long enough to clear the fifteen word minimum for a valid scene file.',
  board: { mode: 'wipe' }, elements: [{ id: 't', type: 'text', slot: 'A1:B1', style: 'body', text: `scene ${sceneId}` }], final: false, ...over,
});

test('wait: continue immediately while buffer < 3 and no final scene; blocks otherwise (criterion 11)', async () => {
  const srv = await startTestServer({ KHAN_PLAYER_CLOSED_MS: '400' });
  const L = 'fx-wait-lesson';
  try {
    srv.writeOutline(L, outline(L, 4));
    srv.writeScene(L, scene(L, 's001'));
    await srv.waitForStatuses(L, { s001: 'ready' });
    let t0 = Date.now();
    let r = await srv.get(`/api/lesson/${L}/wait?timeout=5`);
    assert.equal(r.body.event, 'continue');
    assert.equal(r.body.readyAhead, 1);
    assert.deepEqual(r.body.notices, []);
    assert.ok(Date.now() - t0 < 1000, 'continue must be immediate');

    // fill the buffer to 3 ready → wait blocks → timeout after the given seconds
    srv.writeScene(L, scene(L, 's002'));
    srv.writeScene(L, scene(L, 's003'));
    await srv.waitForStatuses(L, { s002: 'ready', s003: 'ready' });
    t0 = Date.now();
    r = await srv.get(`/api/lesson/${L}/wait?timeout=1`);
    assert.equal(r.body.event, 'timeout');
    assert.ok(Date.now() - t0 >= 900 && Date.now() - t0 < 3000, `timeout took ${Date.now() - t0} ms`);

    // a question arrives while blocked → returned within 1 s
    const pending = srv.get(`/api/lesson/${L}/wait?timeout=10`);
    await sleep(150);
    t0 = Date.now();
    const q = await srv.post(`/api/lesson/${L}/question`, { text: 'why is it cached?', atSceneId: 's002', atTime: 4.5 });
    assert.equal(q.status, 200);
    assert.equal(q.body.qId, 'q001');
    r = await pending;
    assert.ok(Date.now() - t0 < 1000, `question delivered in ${Date.now() - t0} ms`);
    assert.equal(r.body.event, 'question');
    assert.equal(r.body.qId, 'q001');
    assert.equal(r.body.text, 'why is it cached?');
    assert.equal(r.body.atSceneId, 's002');
    assert.equal(r.body.atTime, 4.5);
    // the question is delivered once; the inbox still lists it until an answer scene arrives
    const readInbox = () => JSON.parse((await_fs()).readFileSync(`${srv.lessonsDir}/${L}/control/inbox.json`, 'utf8'));
    await srv.waitFor(() => readInbox().pending.filter((p) => p.kind === 'question').length === 1, { what: 'question in inbox' });
    const questionFile = JSON.parse((await import('node:fs')).readFileSync(`${srv.lessonsDir}/${L}/control/question-q001.json`, 'utf8'));
    assert.equal(questionFile.text, 'why is it cached?');

    // the answer clears the pending question; a reject is returned by wait
    srv.writeScene(L, scene(L, 'q001-a01', { questionId: 'q001', insertAfter: 's002', final: true }));
    await srv.waitForStatuses(L, { 'q001-a01': 'ready' });
    await srv.waitFor(() => readInbox().pending.length === 0, { what: 'inbox cleared after the answer' });
    srv.writeScene(L, scene(L, 's004', { elements: [{ id: 't', type: 'text', slot: 'A1', style: 'title', text: 'Nine words in a title is too many here' }], final: true }));
    await srv.waitForStatuses(L, { s004: 'rejected' });
    r = await srv.get(`/api/lesson/${L}/wait?timeout=2`);
    assert.equal(r.body.event, 'reject');
    assert.equal(r.body.sceneId, 's004');
    assert.equal(r.body.attempt, 1);
    assert.ok(r.body.errors.some((e) => e.code === 'CAP_WORDS' || e.code === 'SLOT_TOO_SMALL'));

    // rewrite valid → ready; the lesson now has a final scene so no `continue`
    srv.writeScene(L, scene(L, 's004', { final: true }));
    await srv.waitForStatuses(L, { s004: 'ready' });

    // player plays through: posting `end` on the last playlist entry → finished
    const order = (await srv.playlist(L)).entries.map((e) => e.sceneId);
    assert.deepEqual(order, ['s001', 's002', 'q001-a01', 's003', 's004']);
    for (const id of order) {
      await srv.post(`/api/lesson/${L}/position`, { sceneId: id, event: 'start' });
      await srv.post(`/api/lesson/${L}/position`, { sceneId: id, event: 'end' });
    }
    r = await srv.get(`/api/lesson/${L}/wait?timeout=2`);
    assert.equal(r.body.event, 'finished');
    assert.equal(r.body.summary.scenes, 4);
    assert.equal(r.body.summary.answerScenes, 1);
    assert.equal(r.body.summary.questions, 1);
    assert.equal((await srv.get(`/api/lesson/${L}/status`)).body.ended, true);
  } finally {
    await srv.close();
  }
});

test('wait: player-closed after the only SSE client disconnects for longer than the threshold', async () => {
  const srv = await startTestServer({ KHAN_PLAYER_CLOSED_MS: '300' });
  const L = 'fx-wait-closed';
  try {
    srv.writeOutline(L, outline(L, 3));
    for (const id of ['s001', 's002', 's003']) srv.writeScene(L, scene(L, id, { final: id === 's003' }));
    await srv.waitForStatuses(L, { s003: 'ready' });
    // never connected → no player-closed, so a blocked wait times out
    let r = await srv.get(`/api/lesson/${L}/wait?timeout=1`);
    assert.equal(r.body.event, 'timeout');
    const sse = await openSse(srv.url(`/api/lesson/${L}/events`));
    assert.equal(sse.events[0].event, 'playlist');
    assert.equal((await srv.playlist(L)).player.connected, true);
    sse.close();
    await srv.waitFor(async () => (await srv.playlist(L)).player.connected === false, { what: 'disconnect' });
    const t0 = Date.now();
    r = await srv.get(`/api/lesson/${L}/wait?timeout=5`);
    assert.equal(r.body.event, 'player-closed');
    assert.ok(Date.now() - t0 < 2500, `took ${Date.now() - t0}`);
  } finally {
    await srv.close();
  }
});

test('wait: notices (degradations) ride along once and are then cleared', async () => {
  const srv = await startTestServer({ KHAN_REJECT_GRACE_MS: '200' });
  const L = 'fx-degrade-flow';
  try {
    srv.copyFixture(L, { from: 'degrade' });
    await srv.waitForStatuses(L, { s002: 'rejected' });
    // no rewrite within the grace period → degraded automatically
    const p = await srv.waitForStatuses(L, { s002: 'ready' }, 5000);
    assert.equal(p.entries.find((e) => e.sceneId === 's002').degraded, true);
    const r = await srv.get(`/api/lesson/${L}/wait?timeout=1`);
    // the auto-degrade cleared the pending reject; the lesson has a final scene and a full buffer, so
    // wait blocks → timeout — and even a timeout carries the degraded notice
    assert.equal(r.body.event, 'timeout');
    assert.ok(r.body.notices.some((n) => n.kind === 'degraded' && n.sceneId === 's002' && n.droppedElementIds.includes('bad')), JSON.stringify(r.body));
    const again = await srv.get(`/api/lesson/${L}/wait?timeout=1`);
    assert.deepEqual(again.body.notices, []);
  } finally {
    await srv.close();
  }
});
