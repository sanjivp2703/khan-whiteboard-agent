import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderEntries, deriveEnded, readyAhead, kindOf, lastLessonEntry } from '../../server/playlist.js';
import { startTestServer } from './helpers/server.js';

const e = (sceneId, over = {}) => ({ sceneId, status: 'ready', final: false, insertAfter: null, ...over });

test('ordering (criterion 12): answers after insertAfter, grouped by qId, nested depth 2', () => {
  const entries = [e('s004', { final: true }), e('s002'), e('q001-a02', { insertAfter: 's002' }), e('s001'), e('q002-a01', { insertAfter: 'q001-a01' }), e('s003'), e('q001-a01', { insertAfter: 's002' })];
  assert.deepEqual(orderEntries(entries).map((x) => x.sceneId), ['s001', 's002', 'q001-a01', 'q002-a01', 'q001-a02', 's003', 's004']);
  // two questions on the same insertAfter: earlier question first
  const two = [e('s001'), e('s002'), e('q002-a01', { insertAfter: 's001' }), e('q001-a01', { insertAfter: 's001' })];
  assert.deepEqual(orderEntries(two).map((x) => x.sceneId), ['s001', 'q001-a01', 'q002-a01', 's002']);
  // orphan answers (insertAfter not present yet) go last
  const orphan = [e('s001'), e('q001-a01', { insertAfter: 's009' })];
  assert.deepEqual(orderEntries(orphan).map((x) => x.sceneId), ['s001', 'q001-a01']);
  // lesson scenes sort numerically, s010 after s002
  assert.deepEqual(orderEntries([e('s010'), e('s002'), e('s001')]).map((x) => x.sceneId), ['s001', 's002', 's010']);
  assert.equal(kindOf('q001-a01'), 'answer');
  assert.equal(kindOf('s001'), 'lesson');
  assert.equal(lastLessonEntry(orderEntries(entries)).sceneId, 's004');
});

test('ended derivation and re-opening on a new question', () => {
  const ordered = orderEntries([e('s001'), e('s002', { final: true })]);
  assert.equal(deriveEnded({ ordered, lastEndSceneId: null, questions: [] }), false);
  assert.equal(deriveEnded({ ordered, lastEndSceneId: 's001', questions: [] }), false);
  assert.equal(deriveEnded({ ordered, lastEndSceneId: 's002', questions: [] }), true);
  // no final lesson scene → never ended
  assert.equal(deriveEnded({ ordered: orderEntries([e('s001'), e('s002')]), lastEndSceneId: 's002', questions: [] }), false);
  // an open question re-opens the lesson
  assert.equal(deriveEnded({ ordered, lastEndSceneId: 's002', questions: [{ complete: false }] }), false);
  assert.equal(deriveEnded({ ordered, lastEndSceneId: 's002', questions: [{ complete: true }] }), true);
  // answer appended after the end: the last entry is now the answer scene
  const withAnswer = orderEntries([e('s001'), e('s002', { final: true }), e('q001-a01', { insertAfter: 's002', final: true })]);
  assert.equal(deriveEnded({ ordered: withAnswer, lastEndSceneId: 's002', questions: [{ complete: true }] }), false);
  assert.equal(deriveEnded({ ordered: withAnswer, lastEndSceneId: 'q001-a01', questions: [{ complete: true }] }), true);
});

test('readyAhead counts ready entries after the last start position', () => {
  const ordered = orderEntries([e('s001'), e('s002'), e('s003', { status: 'voicing' }), e('s004')]);
  assert.equal(readyAhead(ordered, null), 3);
  assert.equal(readyAhead(ordered, 's001'), 2);
  assert.equal(readyAhead(ordered, 's002'), 1);
  assert.equal(readyAhead(ordered, 's004'), 0);
});

test('status transitions through the server: pending → validating → voicing → ready, keep degraded:true once ready', async () => {
  const srv = await startTestServer();
  try {
    const seen = new Map();
    srv.copyFixture('fx-type-list');
    const lesson = await srv.waitFor(() => srv.info.store.get('fx-type-list'), { what: 'lesson' });
    const poll = setInterval(() => {
      for (const en of lesson.scenes.values()) { if (!seen.has(en.sceneId)) seen.set(en.sceneId, []); const arr = seen.get(en.sceneId); if (arr[arr.length - 1] !== en.status) arr.push(en.status); }
    }, 2);
    await srv.waitForStatuses('fx-type-list', { s001: 'ready', s002: 'ready', s003: 'ready' });
    clearInterval(poll);
    for (const [id, path] of seen) {
      assert.equal(path[path.length - 1], 'ready', id);
      const allowed = ['pending', 'validating', 'voicing', 'ready'];
      for (const st of path) assert.ok(allowed.includes(st), `${id}: ${path}`);
      // order preserved
      const idx = path.map((s) => allowed.indexOf(s));
      for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `${id}: ${path}`);
    }
    const p = await srv.playlist('fx-type-list');
    assert.equal(p.entries.every((x) => x.degraded === false && x.audioUrl && x.durationMs >= 1500), true);
    // the degrade fixture: degraded stays true once ready
    srv.copyFixture('fx-degrade-flow', { from: 'degrade' });
    await srv.waitForStatuses('fx-degrade-flow', { s002: 'rejected' });
    const s2 = JSON.parse((await import('node:fs')).readFileSync(`${srv.lessonsDir}/fx-degrade-flow/scenes/s002.json`, 'utf8'));
    s2.elements[1].text = 'Still nine words of title in one cell'; // another invalid rewrite → degrade
    srv.writeScene('fx-degrade-flow', s2);
    const after = await srv.waitForStatuses('fx-degrade-flow', { s002: 'ready' });
    const entry = after.entries.find((x) => x.sceneId === 's002');
    assert.equal(entry.degraded, true);
    assert.deepEqual(entry.droppedElementIds, ['bad']);
  } finally {
    await srv.close();
  }
});
