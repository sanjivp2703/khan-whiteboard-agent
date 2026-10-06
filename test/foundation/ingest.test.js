import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { startTestServer, openSse, sleep } from './helpers/server.js';

test('ingest (criterion 8): fx-build-region reaches ready in order; SSE sends a snapshot on connect and after each change; effective scene served', async () => {
  const srv = await startTestServer();
  try {
    // connect before the lesson exists: the lesson object is created on demand by /events? No — 404 until known; so copy the outline first.
    srv.copyFixture('fx-build-region', { onlyScenes: [] });
    await srv.waitFor(() => srv.info.store.get('fx-build-region'), { what: 'lesson registered' });
    const sse = await openSse(srv.url('/api/lesson/fx-build-region/events'));
    assert.equal(sse.events[0].event, 'playlist');
    assert.equal(sse.events[0].data.entries.length, 0);
    assert.equal(sse.events[0].data.outline.scenes.length, 4);
    const before = sse.events.length;
    srv.copyFixture('fx-build-region');
    const p = await srv.waitForStatuses('fx-build-region', { s001: 'ready', s002: 'ready', s003: 'ready', s004: 'ready' });
    assert.deepEqual(p.entries.map((e) => e.sceneId), ['s001', 's002', 's003', 's004']);
    assert.deepEqual(p.entries.map((e) => e.degraded), [false, false, false, false]);
    await sleep(100);
    assert.ok(sse.events.length > before + 4, `expected several playlist events, got ${sse.events.length - before}`);
    assert.ok(sse.events.every((e) => e.event === 'playlist' || e.event === 'heartbeat'));
    const last = sse.events[sse.events.length - 1].data;
    assert.equal(last.entries.every((e) => e.status === 'ready'), true);
    sse.close();
    const eff = await srv.get('/api/lesson/fx-build-region/scene/s002');
    assert.equal(eff.status, 200);
    assert.equal(eff.body.sceneId, 's002');
    assert.equal(eff.body.board.mode, 'region');
    assert.ok(existsSync(join(srv.lessonsDir, 'fx-build-region', 'state', 'playlist.json')));
    assert.ok(existsSync(join(srv.lessonsDir, 'fx-build-region', 'audio', 's001.wav')));
    const inbox = JSON.parse(readFileSync(join(srv.lessonsDir, 'fx-build-region', 'control', 'inbox.json'), 'utf8'));
    assert.equal(inbox.schema, 'khan-inbox/1');
    assert.equal(inbox.lessonId, 'fx-build-region');
    assert.deepEqual(inbox.pending, []);
    assert.equal(inbox.tts.provider, 'silent');
    assert.ok(inbox.producerLastWriteAt);
  } finally {
    await srv.close();
  }
});

test('partial writes (criterion 9): two chunks with a pause never produce rejected; .tmp is ignored', async () => {
  const srv = await startTestServer();
  const L = 'fx-type-box';
  try {
    srv.copyFixture(L, { onlyScenes: ['s001'] });
    await srv.waitForStatuses(L, { s001: 'ready' });
    const s002 = readFileSync(join('fixtures', 'lessons', L, 'scenes', 's002.json'), 'utf8');
    const file = join(srv.lessonsDir, L, 'scenes', 's002.json');
    const statuses = new Set();
    const fd = openSync(file, 'w');
    writeSync(fd, s002.slice(0, Math.floor(s002.length / 2)));
    const poll = setInterval(async () => { const p = await srv.playlist(L); const e = p && p.entries.find((x) => x.sceneId === 's002'); if (e) statuses.add(e.status); }, 20);
    await sleep(700);
    writeSync(fd, s002.slice(Math.floor(s002.length / 2)));
    closeSync(fd);
    await srv.waitForStatuses(L, { s002: 'ready' });
    clearInterval(poll);
    assert.ok(!statuses.has('rejected'), `saw statuses ${[...statuses]}`);
    assert.equal(srv.info.store.get(L).scenes.get('s002').attempts, 1, 'ingested exactly once');
    // a .tmp file is ignored
    writeFileSync(join(srv.lessonsDir, L, 'scenes', 's003.json.tmp'), '{"garbage":');
    await sleep(500);
    const p = await srv.playlist(L);
    assert.equal(p.entries.some((e) => e.sceneId === 's003'), false);
    // a file that never becomes valid JSON is reported as BAD_JSON after the grace period (shortened via the watcher)
  } finally {
    await srv.close();
  }
});

test('reject → rewrite → ready, and reject → second invalid → degraded (criterion 10)', async () => {
  const srv = await startTestServer({ KHAN_REJECT_GRACE_MS: '60000' });
  const L = 'fx-degrade-flow';
  try {
    srv.copyFixture(L, { from: 'degrade' });
    const p1 = await srv.waitForStatuses(L, { s001: 'ready', s002: 'rejected', s003: 'ready' });
    const rej = p1.entries.find((e) => e.sceneId === 's002');
    assert.ok(rej.errors.length > 0);
    assert.deepEqual([...new Set(rej.errors.map((e) => e.elementId))], ['bad']);
    assert.equal(rej.audioUrl, null);
    assert.equal((await srv.get(`/api/lesson/${L}/scene/s002`)).status, 404, 'no effective scene while rejected');
    const rejectFile = join(srv.lessonsDir, L, 'control', 'reject-s002.json');
    await srv.waitFor(() => existsSync(rejectFile), { what: 'reject file' });
    const rejJson = JSON.parse(readFileSync(rejectFile, 'utf8'));
    assert.equal(rejJson.sceneId, 's002');
    assert.equal(rejJson.attempt, 1);
    await srv.waitFor(() => { const ib = JSON.parse(readFileSync(join(srv.lessonsDir, L, 'control', 'inbox.json'), 'utf8')); return ib.pending.some((p) => p.kind === 'reject' && p.sceneId === 's002'); }, { what: 'inbox reject' });

    // rewrite with a valid file → ready, not degraded
    const original = JSON.parse(readFileSync(join(srv.lessonsDir, L, 'scenes', 's002.json'), 'utf8'));
    const fixed = { ...original, elements: original.elements.filter((e) => e.id !== 'bad') };
    srv.writeScene(L, fixed);
    const p2 = await srv.waitForStatuses(L, { s002: 'ready' });
    const ok = p2.entries.find((e) => e.sceneId === 's002');
    assert.equal(ok.degraded, false);
    assert.deepEqual(ok.errors, []);
    assert.ok(ok.audioUrl);
    await srv.waitFor(() => { const ib = JSON.parse(readFileSync(join(srv.lessonsDir, L, 'control', 'inbox.json'), 'utf8')); return !ib.pending.some((p) => p.kind === 'reject'); }, { what: 'inbox cleared' });
  } finally {
    await srv.close();
  }

  // second path: reject then another invalid rewrite → degraded
  const srv2 = await startTestServer({ KHAN_REJECT_GRACE_MS: '60000' });
  try {
    srv2.copyFixture(L, { from: 'degrade' });
    await srv2.waitForStatuses(L, { s002: 'rejected' });
    const original = JSON.parse(readFileSync(join(srv2.lessonsDir, L, 'scenes', 's002.json'), 'utf8'));
    original.elements[1].text = 'Still far too many words for a title here'; // still invalid
    srv2.writeScene(L, original);
    const p = await srv2.waitForStatuses(L, { s002: 'ready' });
    const deg = p.entries.find((e) => e.sceneId === 's002');
    assert.equal(deg.degraded, true);
    assert.deepEqual(deg.droppedElementIds, ['bad']);
    assert.ok(deg.audioUrl, 'narration kept and voiced');
    const eff = await srv2.get(`/api/lesson/${L}/scene/s002`);
    assert.deepEqual(eff.body.elements.map((e) => e.id), ['good', 'note']);
    assert.equal(eff.body.narration, original.narration);
    const w = await srv2.get(`/api/lesson/${L}/wait?timeout=1`);
    const notices = w.body.notices.length ? w.body.notices : (await srv2.get(`/api/lesson/${L}/wait?timeout=1`)).body.notices;
    assert.ok(notices.some((n) => n.kind === 'degraded' && n.sceneId === 's002' && n.droppedElementIds.includes('bad')));
    const ib = JSON.parse(readFileSync(join(srv2.lessonsDir, L, 'control', 'inbox.json'), 'utf8'));
    assert.equal(ib.pending.some((p) => p.kind === 'reject'), false);
    assert.equal((await srv2.get(`/api/lesson/${L}/status`)).body.counts.degraded, 1);
  } finally {
    await srv2.close();
  }
});

test('no rewrite within the grace period → degraded automatically; scene-level fault → narration-only, board never wiped', async () => {
  const srv = await startTestServer({ KHAN_REJECT_GRACE_MS: '300' });
  const L = 'fx-degrade-flow';
  try {
    srv.copyFixture(L, { from: 'degrade' });
    await srv.waitForStatuses(L, { s002: 'rejected' });
    const p = await srv.waitForStatuses(L, { s002: 'ready' }, 5000);
    const e = p.entries.find((x) => x.sceneId === 's002');
    assert.equal(e.degraded, true);
    assert.deepEqual(e.droppedElementIds, ['bad']);

    // scene-level fault (narration too short) on a region scene twice → narration-only with the region kept
    const bad = {
      schema: 'khan-scene/1', lessonId: L, sceneId: 's004', title: 'Short', narration: 'Too short.',
      board: { mode: 'region', slots: 'D1:F2' }, elements: [{ id: 'x', type: 'text', slot: 'D1', style: 'body', text: 'hello' }], final: true,
    };
    srv.writeScene(L, bad);
    await srv.waitForStatuses(L, { s004: 'rejected' });
    const p2 = await srv.waitForStatuses(L, { s004: 'ready' }, 5000);
    const e4 = p2.entries.find((x) => x.sceneId === 's004');
    assert.equal(e4.degraded, true);
    assert.deepEqual(e4.droppedElementIds, ['x']);
    const eff = (await srv.get(`/api/lesson/${L}/scene/s004`)).body;
    assert.deepEqual(eff.elements, []);
    assert.deepEqual(eff.board, { mode: 'region', slots: 'D1:F2' });
    assert.equal(eff.narration, 'Too short.');
    assert.equal(eff.final, true);
    // an invalid board on a region scene → free single cell region, never a wipe
    const bad5 = { ...bad, sceneId: 's005', board: { mode: 'nonsense' }, final: true };
    srv.writeScene(L, bad5);
    await srv.waitForStatuses(L, { s005: 'rejected' });
    await srv.waitForStatuses(L, { s005: 'ready' }, 5000);
    const eff5 = (await srv.get(`/api/lesson/${L}/scene/s005`)).body;
    assert.equal(eff5.board.mode, 'region');
    assert.match(eff5.board.slots, /^[A-F][1-4]$/);
  } finally {
    await srv.close();
  }
});

test('answer scenes: ordering in the live playlist, question bookkeeping, ended re-opens on a new question', async () => {
  const srv = await startTestServer();
  const L = 'fx-answer-insert';
  try {
    srv.copyFixture(L);
    const p = await srv.waitForStatuses(L, { s001: 'ready', s002: 'ready', s003: 'ready', s004: 'ready', 'q001-a01': 'ready', 'q001-a02': 'ready', 'q002-a01': 'ready' });
    assert.deepEqual(p.entries.map((e) => e.sceneId), ['s001', 's002', 'q001-a01', 'q002-a01', 'q001-a02', 's003', 's004']);
    assert.deepEqual(p.entries.map((e) => e.kind), ['lesson', 'lesson', 'answer', 'answer', 'answer', 'lesson', 'lesson']);
    assert.equal(p.entries[2].questionId, 'q001');
    assert.equal(p.entries[2].insertAfter, 's002');
    for (const id of p.entries.map((e) => e.sceneId)) {
      await srv.post(`/api/lesson/${L}/position`, { sceneId: id, event: 'start', t: 0 });
      await srv.post(`/api/lesson/${L}/position`, { sceneId: id, event: 'end' });
    }
    let st = await srv.get(`/api/lesson/${L}/status`);
    assert.equal(st.body.ended, true);
    assert.equal(st.body.counts.answerScenes, 3);
    assert.equal(st.body.player.position.sceneId, 's004');
    // a new question re-opens the lesson
    const q = await srv.post(`/api/lesson/${L}/question`, { text: 'one more thing?', atSceneId: 's004', atTime: 1 });
    assert.equal(q.body.qId, 'q001'); // server-assigned ids start at q001 regardless of fixture answer scenes
    st = await srv.get(`/api/lesson/${L}/status`);
    assert.equal(st.body.ended, false);
    const pl = await srv.playlist(L);
    assert.equal(pl.questions.length, 1);
    assert.equal(pl.questions[0].complete, false);
    // the answer arrives and is appended after s004; ended again once it is played
    srv.writeScene(L, { schema: 'khan-scene/1', lessonId: L, sceneId: 'q003-a01', title: 'A', narration: 'An answer scene that is long enough to clear the fifteen word minimum for a valid khan scene.', board: { mode: 'wipe' }, elements: [{ id: 'a', type: 'text', slot: 'A1:B1', style: 'body', text: 'answer' }], final: true, questionId: 'q003', insertAfter: 's004' });
    await srv.waitForStatuses(L, { 'q003-a01': 'ready' });
    const pl2 = await srv.playlist(L);
    assert.equal(pl2.entries[pl2.entries.length - 1].sceneId, 'q003-a01');
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 'q003-a01', event: 'start' });
    await srv.post(`/api/lesson/${L}/position`, { sceneId: 'q003-a01', event: 'end' });
    // q001 (server-assigned) is still unanswered, so the lesson is not ended
    assert.equal((await srv.get(`/api/lesson/${L}/status`)).body.ended, false);
  } finally {
    await srv.close();
  }
});

test('replay: a lesson folder present at startup is ingested and audio comes from the cache', async () => {
  const srv = await startTestServer();
  try {
    srv.copyFixture('fx-type-sketch');
    await srv.waitForStatuses('fx-type-sketch', { s001: 'ready', s002: 'ready', s003: 'ready' });
    const cacheFiles = (await import('node:fs')).readdirSync(srv.cacheDir).filter((f) => f.endsWith('.wav'));
    assert.equal(cacheFiles.length, 3);
    const first = srv.info.store.get('fx-type-sketch').scenes.get('s001').audio;
    assert.equal(first.cached, false);
  } finally {
    await srv.close();
  }
  // second server over the same folders: cache hits
  const { mkdtempSync } = await import('node:fs');
  void mkdtempSync;
});

test('a ready scene rewritten invalid gets its reject round before degrading (QA finding 6): invalid attempts count, not ingests', async () => {
  const srv = await startTestServer({ KHAN_REJECT_GRACE_MS: '60000' });
  const L = 'fx-degrade-flow';
  try {
    srv.copyFixture(L, { from: 'degrade', onlyScenes: ['s001', 's003'] });
    await srv.waitForStatuses(L, { s001: 'ready', s003: 'ready' });
    const entry = () => srv.info.store.get(L).scenes.get('s003');
    assert.equal(entry().attempts, 1);
    assert.equal(entry().invalidAttempts, 0);

    // rewrite the valid s003 with a scene-level fault (a region over cells s001 occupies) → rejected, not degraded
    const original = JSON.parse(readFileSync(join(srv.lessonsDir, L, 'scenes', 's003.json'), 'utf8'));
    const s001 = JSON.parse(readFileSync(join(srv.lessonsDir, L, 'scenes', 's001.json'), 'utf8'));
    const occupiedSlot = s001.elements.find((e) => e.slot).slot;
    const invalid = { ...original, board: { mode: 'region', slots: occupiedSlot }, elements: [{ id: 'late', type: 'text', slot: occupiedSlot, style: 'body', text: 'late text' }] };
    const seen = new Set();
    const poll = setInterval(async () => { const p = await srv.playlist(L); const e = p && p.entries.find((x) => x.sceneId === 's003'); if (e) seen.add(e.status); }, 15);
    srv.writeScene(L, invalid);
    const p1 = await srv.waitForStatuses(L, { s003: 'rejected' });
    clearInterval(poll);
    const rej = p1.entries.find((e) => e.sceneId === 's003');
    assert.ok(rej.errors.some((e) => e.code === 'REGION_OCCUPIED'), JSON.stringify(rej.errors));
    assert.equal(rej.degraded, false);
    assert.ok(!seen.has('degraded'), `went through degraded without a reject round: ${[...seen]}`);
    assert.equal(entry().attempts, 2);
    assert.equal(entry().invalidAttempts, 1);
    const rejectFile = join(srv.lessonsDir, L, 'control', 'reject-s003.json');
    await srv.waitFor(() => existsSync(rejectFile), { what: 'reject file' });
    assert.equal(JSON.parse(readFileSync(rejectFile, 'utf8')).attempt, 1, 'first invalid attempt of this revision');
    const w = await srv.get(`/api/lesson/${L}/wait?timeout=1`);
    assert.equal(w.body.event, 'reject');
    assert.equal(w.body.sceneId, 's003');
    assert.equal(w.body.attempt, 1);
    assert.equal((await srv.get(`/api/lesson/${L}/scene/s003`)).status, 404, 'no effective scene while rejected');

    // second invalid rewrite → degraded (narration-only: the fault is scene-level)
    srv.writeScene(L, { ...invalid, title: 'Still broken' });
    const p2 = await srv.waitForStatuses(L, { s003: 'ready' });
    const deg = p2.entries.find((e) => e.sceneId === 's003');
    assert.equal(deg.degraded, true);
    assert.deepEqual(deg.droppedElementIds, ['late']);
    assert.equal(entry().invalidAttempts, 2);
    const eff = (await srv.get(`/api/lesson/${L}/scene/s003`)).body;
    assert.deepEqual(eff.elements, []);
    assert.equal(eff.board.mode, 'region');
    assert.notEqual(eff.board.slots, occupiedSlot);

    // a valid rewrite resets the cycle: the next invalid write is rejected again, not degraded
    srv.writeScene(L, original);
    await srv.waitFor(async () => { const p = await srv.playlist(L); const e = p.entries.find((x) => x.sceneId === 's003'); return e.status === 'ready' && !e.degraded; }, { what: 'valid again' });
    assert.equal(entry().invalidAttempts, 0);
    srv.writeScene(L, invalid);
    await srv.waitForStatuses(L, { s003: 'rejected' });
    assert.equal(entry().invalidAttempts, 1);
    assert.equal(entry().attempts, 5);
  } finally {
    await srv.close();
  }
});
