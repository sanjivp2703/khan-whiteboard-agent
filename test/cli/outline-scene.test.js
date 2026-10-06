// khan outline (criterion 3) and khan scene (criterion 4) against the real foundation server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REGEX } from '../../shared/layout-core/constants.js';
import { makeHome, runKhan, startHomeServer, outlineOf, sceneOf, badSceneOf, readFixtureScene } from './helpers.js';

test('outline -: generated id, atomic write, ingested once; invalid outlines → JSON error, exit 1', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h);
  try {
    const r = await runKhan(['outline', '-'], { env: h.env, stdin: outlineOf('How the Response Cache Works!', 4, { audience: 'dev' }) });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.lines.length, 1);
    const { lessonId, url, ingested, server, scenes } = r.json;
    assert.match(lessonId, REGEX.lessonId);
    assert.match(lessonId, /^\d{8}-\d{6}-how-the-response-cache-works$/);
    assert.equal(url, `${srv.base}/lesson/${lessonId}`);
    assert.equal(server, true);
    assert.equal(ingested, true);
    assert.equal(scenes, 4);
    const dir = join(h.lessonsDir, lessonId);
    assert.ok(existsSync(join(dir, 'outline.json')));
    assert.ok(existsSync(join(dir, 'scenes')), 'scenes dir created');
    assert.deepEqual(readdirSync(dir).sort(), ['control', 'outline.json', 'scenes', 'state'].filter((n) => existsSync(join(dir, n))));
    assert.ok(!existsSync(join(dir, 'outline.json.tmp')));
    const written = JSON.parse(readFileSync(join(dir, 'outline.json'), 'utf8'));
    assert.equal(written.schema, 'khan-outline/1');
    assert.equal(written.lessonId, lessonId);
    assert.deepEqual(written.producer, { kind: 'claude-code-skill', version: '1' });
    const lesson = srv.info.store.get(lessonId);
    assert.equal(lesson.outline.title, 'How the Response Cache Works!');
    assert.deepEqual(lesson.outlineErrors, []);
    assert.equal((await srv.get(`/api/lesson/${lessonId}/outline`)).status, 200);
    // the server did not open a browser (CLI owns it; KHAN_NO_OPEN set) and no extra outline event fired
    assert.deepEqual(srv.opened, []);

    // explicit id
    const e = await runKhan(['outline', 'explicit-id-01'], { env: h.env, stdin: outlineOf('T', 3) });
    assert.equal(e.code, 0);
    assert.equal(e.json.lessonId, 'explicit-id-01');

    // rejections
    for (const [label, input] of [['2 scenes', outlineOf('T', 2)], ['13 scenes', outlineOf('T', 13)]]) {
      const bad = await runKhan(['outline', '-'], { env: h.env, stdin: input });
      assert.equal(bad.code, 1, label);
      assert.equal(bad.json.ok, false);
      assert.equal(bad.json.code, 'BAD_OUTLINE');
      assert.ok(bad.json.details.some((x) => x.code === 'CAP_COUNT'), label);
    }
    const gap = outlineOf('T', 3); gap.scenes[1].sceneId = 's005';
    const nonSeq = await runKhan(['outline', '-'], { env: h.env, stdin: gap });
    assert.equal(nonSeq.code, 1);
    assert.ok(nonSeq.json.details.some((x) => x.code === 'BAD_SCENE_ID'));
    const notJson = await runKhan(['outline', '-'], { env: h.env, stdin: '{ not json' });
    assert.equal(notJson.code, 1);
    assert.equal(notJson.json.code, 'BAD_JSON');
    const badArg = await runKhan(['outline', 'Bad_Id'], { env: h.env, stdin: outlineOf('T', 3) });
    assert.equal(badArg.code, 1);
    assert.equal(badArg.json.code, 'BAD_LESSON_ID');
    // nothing was written for the rejected ones
    assert.equal(readdirSync(h.lessonsDir).length, 2);
  } finally {
    await srv.close();
    h.cleanup();
  }
});

test('scene: one JSON line with status/errors/inbox/readyAhead; fills ids; refuses mismatches; ready for a fixture scene, rejected with codes for an invalid one', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h);
  const L = 'scene-cmd-lesson';
  try {
    assert.equal((await runKhan(['outline', L], { env: h.env, stdin: outlineOf('Scene cmd', 3) })).code, 0);
    // a fixture scene (lessonId differs → fill-in only when absent, so strip it)
    const fx = readFixtureScene('fx-type-text', 's001');
    delete fx.lessonId; delete fx.sceneId; delete fx.schema;
    const ok = await runKhan(['scene', L, 's001'], { env: h.env, stdin: fx });
    assert.equal(ok.code, 0, ok.stdout);
    assert.equal(ok.lines.length, 1, 'exactly one line');
    const j = ok.json;
    assert.equal(j.ok, true);
    assert.equal(j.lessonId, L);
    assert.equal(j.sceneId, 's001');
    assert.equal(j.status, 'ready');
    assert.deepEqual(j.errors, []);
    assert.equal(j.degraded, false);
    assert.deepEqual(j.inbox, { pending: 0, questions: 0, rejects: 0 });
    assert.equal(j.readyAhead, 1);
    assert.ok(Number.isInteger(j.durationMs) && j.durationMs > 0);
    assert.deepEqual(j.notices, []);
    const written = JSON.parse(readFileSync(join(h.lessonsDir, L, 'scenes', 's001.json'), 'utf8'));
    assert.equal(written.lessonId, L);
    assert.equal(written.sceneId, 's001');
    assert.equal(written.schema, 'khan-scene/1');

    // invalid → rejected, exit 0, the server's codes
    const bad = await runKhan(['scene', L, 's002'], { env: h.env, stdin: badSceneOf('s002') });
    assert.equal(bad.code, 0);
    assert.equal(bad.json.status, 'rejected');
    assert.ok(bad.json.errors.some((e) => e.code === 'CAP_WORDS' || e.code === 'SLOT_TOO_SMALL'), JSON.stringify(bad.json.errors));
    assert.equal(bad.json.inbox.rejects, 1);
    assert.equal(bad.json.inbox.pending, 1);

    // mismatched ids refused before anything is written
    const mm = await runKhan(['scene', L, 's003'], { env: h.env, stdin: sceneOf('s003', { lessonId: 'some-other-lesson' }) });
    assert.equal(mm.code, 1);
    assert.equal(mm.json.code, 'ID_MISMATCH');
    const mm2 = await runKhan(['scene', L, 's003'], { env: h.env, stdin: sceneOf('s001', { sceneId: 's001' }) });
    assert.equal(mm2.code, 1);
    assert.equal(mm2.json.code, 'ID_MISMATCH');
    assert.ok(!existsSync(join(h.lessonsDir, L, 'scenes', 's003.json')));
    // bad ids / bad json / unknown lesson
    assert.equal((await runKhan(['scene', L, 'scene-3'], { env: h.env, stdin: sceneOf('s003') })).json.code, 'BAD_SCENE_ID');
    assert.equal((await runKhan(['scene', L, 's003'], { env: h.env, stdin: 'nope' })).json.code, 'BAD_JSON');
    const noLesson = await runKhan(['scene', 'never-written-01', 's001'], { env: h.env, stdin: sceneOf('s001') });
    assert.equal(noLesson.code, 1);
    assert.equal(noLesson.json.code, 'NO_LESSON');
    // answer scene ids are accepted
    const ans = await runKhan(['scene', L, 'q001-a01'], { env: h.env, stdin: sceneOf('q001-a01', { questionId: 'q001', insertAfter: 's001', final: true }) });
    assert.equal(ans.code, 0, ans.stdout);
    assert.equal(ans.json.status, 'ready');
  } finally {
    await srv.close();
    h.cleanup();
  }
  // server down → exit 2
  const down = await runKhan(['scene', L, 's001'], { env: h.env, stdin: sceneOf('s001') });
  assert.equal(down.code, 2);
  assert.equal(down.json.code, 'SERVER_DOWN');
});
