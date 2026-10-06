// QA finding 4: `khan scene` must not summarize a control/inbox.json that predates this write's
// verdict, and its playlist poll must survive a slow server. Pure helpers plus a scripted HTTP stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inboxReflects, inboxFromPlaylist, pollPlaylist, waitForInbox, summarizeInbox } from '../../cli/lesson.js';
import { parseArgv, helpText } from '../../cli/args.js';

const T1 = '2026-10-06T10:00:00.000Z';
const T2 = '2026-10-06T10:00:01.000Z';
const inbox = (over) => ({ schema: 'khan-inbox/1', lessonId: 'l', updatedAt: T2, pending: [], notices: [], producerLastWriteAt: T2, ...over });

test('inboxReflects: stamp must match this write; a rejected verdict needs its pending reject; a degrade needs its notice', () => {
  const rejected = { sceneId: 's002', status: 'rejected', degraded: false };
  assert.equal(inboxReflects(null, rejected, T2), false, 'missing file');
  assert.equal(inboxReflects(inbox({ producerLastWriteAt: T1, pending: [{ kind: 'reject', sceneId: 's002' }] }), rejected, T2), false, 'stale stamp from before this write');
  assert.equal(inboxReflects(inbox(), rejected, T2), false, 'post-write inbox built while still validating (reject not yet pending)');
  assert.equal(inboxReflects(inbox({ pending: [{ kind: 'reject', sceneId: 's002', attempt: 1 }] }), rejected, T2), true);

  const accepted = { sceneId: 's002', status: 'voicing', degraded: false };
  assert.equal(inboxReflects(inbox(), accepted, T2), true, 'an accepted scene: no pending reject for it');
  assert.equal(inboxReflects(inbox({ pending: [{ kind: 'reject', sceneId: 's002' }] }), accepted, T2), false, 'a leftover reject for an accepted scene is stale');
  assert.equal(inboxReflects(inbox({ pending: [{ kind: 'reject', sceneId: 's001' }, { kind: 'question', qId: 'q001' }] }), accepted, T2), true, 'other scenes\' rejects and questions are fine');

  const degraded = { sceneId: 's002', status: 'voicing', degraded: true };
  assert.equal(inboxReflects(inbox(), degraded, T2), false, 'degrade notice not yet written');
  assert.equal(inboxReflects(inbox({ notices: [{ kind: 'degraded', sceneId: 's002', droppedElementIds: ['bad'] }] }), degraded, T2), true);

  assert.equal(inboxReflects(inbox({ producerLastWriteAt: T1 }), null, null), true, 'no entry and no stamp to compare: any readable inbox');
  assert.equal(inboxReflects(inbox({ producerLastWriteAt: T1 }), null, T2), false, 'no entry but a stamp: still must be this write');
});

test('inboxFromPlaylist mirrors the server rule: rejected entries and unanswered questions are pending', () => {
  const playlist = {
    entries: [{ sceneId: 's001', status: 'ready' }, { sceneId: 's002', status: 'rejected' }, { sceneId: 's003', status: 'degraded' }, { sceneId: 'q001-a01', status: 'ready' }],
    questions: [{ qId: 'q001', answeredBy: ['q001-a01'] }, { qId: 'q002', answeredBy: [] }],
  };
  assert.deepEqual(inboxFromPlaylist(playlist), { pending: 2, questions: 1, rejects: 1 });
  assert.deepEqual(inboxFromPlaylist(null), { pending: 0, questions: 0, rejects: 0 });
  assert.deepEqual(summarizeInbox(null), { pending: 0, questions: 0, rejects: 0, notices: [], readyAhead: null });
});

test('waitForInbox re-reads until the predicate holds, bounded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khan-inbox-'));
  try {
    mkdirSync(join(dir, 'control'));
    const path = join(dir, 'control', 'inbox.json');
    writeFileSync(path, JSON.stringify(inbox({ producerLastWriteAt: T1 })));
    setTimeout(() => writeFileSync(path, JSON.stringify(inbox({ pending: [{ kind: 'reject', sceneId: 's002' }] }))), 120);
    const t0 = Date.now();
    const r = await waitForInbox(dir, (ib) => inboxReflects(ib, { sceneId: 's002', status: 'rejected' }, T2), { timeoutMs: 2000, everyMs: 10 });
    assert.equal(r.consistent, true);
    assert.equal(r.inbox.pending.length, 1);
    assert.ok(Date.now() - t0 < 1500, 'returned soon after the file landed');
    const miss = await waitForInbox(dir, () => false, { timeoutMs: 100, everyMs: 10 });
    assert.equal(miss.consistent, false);
    assert.ok(miss.inbox, 'the last read is still returned');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A stub server that answers GET /api/lesson/<id>/playlist from a script of responses (last one repeats). */
function stubServer(script) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    const step = script[Math.min(n, script.length - 1)];
    n++;
    if (step === 'drop') { req.socket.destroy(); return; }
    if (typeof step === 'number') { setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ entries: [] })); }, step); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(step));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)), hits: () => n })));
}

const pl = (status) => ({ lessonId: 'l', producer: { lastWriteAt: T2 }, entries: [{ sceneId: 's001', status }], buffer: { readyAhead: 0 } });

test('pollPlaylist keeps polling past timeoutMs while extendWhile says the server has no verdict yet', async () => {
  const s = await stubServer([pl('pending'), pl('pending'), pl('validating'), pl('validating'), pl('validating'), pl('validating'), pl('ready')]);
  try {
    const settled = (p) => p.entries[0].status === 'ready';
    const undecided = (p) => ['pending', 'validating'].includes(p.entries[0].status);
    const r = await pollPlaylist(s.url, 'l', settled, { timeoutMs: 100, maxWaitMs: 3000, everyMs: 50, extendWhile: undecided });
    assert.equal(r.done, true, 'reached the verdict although timeoutMs (100 ms) had passed');
    assert.equal(r.playlist.entries[0].status, 'ready');
    assert.ok(r.waitedMs >= 250 && r.waitedMs < 3000, `waited ${r.waitedMs} ms`);
  } finally { await s.close(); }
});

test('pollPlaylist stops at timeoutMs when the status is decided but not settled (voicing), and at maxWaitMs when never decided', async () => {
  const s = await stubServer([pl('voicing')]);
  try {
    const r = await pollPlaylist(s.url, 'l', (p) => p.entries[0].status === 'ready', { timeoutMs: 150, maxWaitMs: 3000, everyMs: 30, extendWhile: (p) => p.entries[0].status === 'validating' });
    assert.equal(r.done, false);
    assert.equal(r.playlist.entries[0].status, 'voicing');
    assert.ok(r.waitedMs >= 150 && r.waitedMs < 1000, `waited ${r.waitedMs} ms`);
  } finally { await s.close(); }
  const s2 = await stubServer([pl('validating')]);
  try {
    const r = await pollPlaylist(s2.url, 'l', () => false, { timeoutMs: 50, maxWaitMs: 300, everyMs: 20, extendWhile: () => true });
    assert.equal(r.done, false);
    assert.ok(r.waitedMs >= 300 && r.waitedMs < 1500, `hard cap honoured: ${r.waitedMs} ms`);
  } finally { await s2.close(); }
});

test('pollPlaylist retries transient connection failures instead of reporting SERVER_DOWN; a server that never answers still throws', async () => {
  const s = await stubServer(['drop', 'drop', pl('ready')]);
  try {
    const r = await pollPlaylist(s.url, 'l', (p) => p.entries[0].status === 'ready', { timeoutMs: 2000, everyMs: 20 });
    assert.equal(r.done, true);
    assert.ok(s.hits() >= 3);
  } finally { await s.close(); }
  const dead = await stubServer(['drop']);
  try {
    await assert.rejects(() => pollPlaylist(dead.url, 'l', () => true, { timeoutMs: 150, everyMs: 20 }), (e) => e.code === 'SERVER_DOWN');
  } finally { await dead.close(); }
});

test('khan scene accepts --max-wait-ms and documents it', () => {
  assert.equal(parseArgv(['scene', 'my-lesson-01', 's001', '--max-wait-ms', '12000']).flags['max-wait-ms'], 12000);
  assert.match(helpText('scene'), /--max-wait-ms/);
  assert.match(helpText('scene'), /--timeout-ms/);
});
