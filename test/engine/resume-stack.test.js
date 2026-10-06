import { test } from 'node:test';
import assert from 'node:assert/strict';
import { push, pop, peek, withTopQId, isFull, MAX_DEPTH } from '../../player/engine/resume-stack.js';

test('resume stack: push/pop/peek are pure and ordered', () => {
  const s0 = [];
  const s1 = push(s0, { sceneId: 's002', t: 3.25 });
  assert.deepEqual(s0, [], 'input untouched');
  assert.deepEqual(s1, [{ sceneId: 's002', t: 3.25, from: 'playing', qId: null }]);
  const s2 = push(s1, { sceneId: 'q001-a01', t: 1, from: 'playing', qId: null });
  assert.equal(s2.length, 2);
  assert.deepEqual(peek(s2), { sceneId: 'q001-a01', t: 1, from: 'playing', qId: null });
  const [top, rest] = pop(s2);
  assert.equal(top.sceneId, 'q001-a01');
  assert.deepEqual(rest, s1);
  assert.deepEqual(pop([]), [null, []]);
  assert.equal(peek([]), null);
});

test('resume stack: depth capped at 3; push past the cap returns null', () => {
  assert.equal(MAX_DEPTH, 3);
  let s = [];
  for (let i = 0; i < 3; i++) { s = push(s, { sceneId: `s00${i + 1}`, t: i }); assert.ok(s); }
  assert.equal(s.length, 3);
  assert.equal(isFull(s), true);
  assert.equal(push(s, { sceneId: 's009', t: 0 }), null);
  const [, rest] = pop(s);
  assert.equal(isFull(rest), false);
  assert.ok(push(rest, { sceneId: 's009', t: 0 }));
  assert.equal(push([], { sceneId: 'x', t: 0 }, 0), null);
});

test('resume stack: entries are normalized (t ≥ 0, from, qId) and qId can be set on the top', () => {
  const s = push([], { sceneId: 's002', t: -1, from: 'ended' });
  assert.deepEqual(s[0], { sceneId: 's002', t: 0, from: 'ended', qId: null });
  assert.deepEqual(push([], { sceneId: 's002', t: NaN })[0].t, 0);
  const withQ = withTopQId(push(s, { sceneId: 'q001-a01', t: 2 }), 'q002');
  assert.equal(withQ[1].qId, 'q002');
  assert.equal(withQ[0].qId, null);
  assert.deepEqual(withTopQId([], 'q001'), []);
  assert.throws(() => push([], { t: 1 }), TypeError);
  assert.throws(() => push(null, { sceneId: 's001' }), TypeError);
});
