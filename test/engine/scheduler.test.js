import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, progressAt, timelineEnd, effectiveTime, isSceneComplete, needsYield, activeIndex, startedIds, DEFAULT_YIELD_CAP_MS } from '../../player/engine/scheduler.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const scene = (elements) => ({ sceneId: 's001', board: { mode: 'wipe' }, elements });
const nat = (pairs) => new Map(Object.entries(pairs).map(([id, naturalMs]) => [id, { naturalMs }]));

test('scheduler: default at spacing (0.85·i/n) and last window end 0.95', () => {
  const tl = buildTimeline(scene([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), 10000);
  assert.deepEqual(tl.map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(tl.map((x) => x.start), [0, 2125, 4250, 6375]);
  assert.deepEqual(tl.map((x) => x.windowEnd), [2125, 4250, 6375, 9500]);
  // no drawables: drawEnd = windowEnd
  assert.deepEqual(tl.map((x) => x.drawEnd), [2125, 4250, 6375, 9500]);
  const single = buildTimeline(scene([{ id: 'only' }]), 6000);
  assert.deepEqual(single, [{ id: 'only', index: 0, start: 0, windowEnd: 5700, drawEnd: 5700, naturalMs: 0 }]);
});

test('scheduler: explicit at values, u math, natural-duration override', () => {
  const tl = buildTimeline(scene([{ id: 'client', at: 0.1 }, { id: 'serve', at: 0.6 }]), 12800, nat({ client: 500, serve: 9000 }));
  close(tl[0].start, 1280); close(tl[0].windowEnd, 7680); close(tl[0].drawEnd, 7680); // window (6400) > natural (500)
  close(tl[1].start, 7680); close(tl[1].windowEnd, 12160); close(tl[1].drawEnd, 16680); // natural 9000 > window 4480
  assert.equal(progressAt(tl[0], 0), 0);
  assert.equal(progressAt(tl[0], 1279.9), 0);
  close(progressAt(tl[0], 1280 + 3200), 0.5);
  assert.equal(progressAt(tl[0], 7680), 1);
  assert.equal(progressAt(tl[0], 99999), 1);
  close(progressAt(tl[1], 7680 + 4500), 0.5);
  assert.equal(progressAt(tl[1], Infinity), 1);
  assert.equal(progressAt(tl[1], -Infinity), 0);
  close(timelineEnd(tl), 16680);
  assert.equal(needsYield(tl, 12800), true);
  assert.equal(needsYield(buildTimeline(scene([{ id: 'x' }]), 5000), 5000), false);
  // naturalMsScale (test knob) multiplies natural durations only
  const scaled = buildTimeline(scene([{ id: 'client', at: 0.1 }]), 10000, nat({ client: 1000 }), { naturalMsScale: 20 });
  close(scaled[0].drawEnd, 1000 + 20000);
  // a zero-length window with no natural duration is complete as soon as it starts
  const zero = buildTimeline(scene([{ id: 'a', at: 0.5 }, { id: 'b', at: 0.5 }]), 1000);
  assert.equal(zero[0].drawEnd, 500);
  assert.equal(progressAt(zero[0], 500), 1);
  assert.equal(progressAt(zero[0], 499), 0);
  // drawables may be a plain object; unknown or non-finite naturalMs counts as 0
  assert.equal(buildTimeline(scene([{ id: 'a' }]), 1000, { a: { naturalMs: NaN } })[0].naturalMs, 0);
  assert.equal(buildTimeline(scene([{ id: 'a' }]), 0)[0].drawEnd, 0);
});

test('scheduler: yield rule — hold until the last stroke, capped, then snap', () => {
  const D = 6000;
  const tl = buildTimeline(scene([{ id: 'para' }, { id: 'grid' }]), D, nat({ para: 1600, grid: 6000 }));
  // grid: start 2550, window end 5700, natural 6000 → drawEnd 8550 > D → yield engages
  close(tl[1].drawEnd, 8550);
  assert.equal(needsYield(tl, D), true);
  // while audio plays, the audio is the clock
  assert.deepEqual(effectiveTime({ audioMs: 1234, audioEnded: false, durationMs: D }), { t: 1234, snap: false, holding: false });
  // audio ended, strokes not done → holding on silence, clock = D + hold
  let e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 0 });
  assert.deepEqual(e, { t: D, snap: false, holding: true });
  assert.equal(isSceneComplete(tl, { audioEnded: true, t: e.t, snap: e.snap }), false);
  e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 1000 });
  assert.equal(e.t, 7000);
  assert.equal(isSceneComplete(tl, { audioEnded: true, ...e }), false);
  // at the cap (1500 ms default) the remaining strokes snap to complete
  e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: DEFAULT_YIELD_CAP_MS });
  assert.deepEqual(e, { t: Infinity, snap: true, holding: false });
  assert.equal(isSceneComplete(tl, { audioEnded: true, ...e }), true);
  assert.equal(progressAt(tl[1], e.t), 1);
  // a shorter natural duration completes before the cap: done at hold = drawEnd − D
  const tl2 = buildTimeline(scene([{ id: 'para' }, { id: 'grid' }]), D, nat({ para: 0, grid: 4000 }));
  close(tl2[1].drawEnd, 6550);
  e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 549 });
  assert.equal(isSceneComplete(tl2, { audioEnded: true, ...e }), false);
  e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 551 });
  assert.equal(isSceneComplete(tl2, { audioEnded: true, ...e }), true);
  // custom cap
  assert.equal(effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 300, yieldCapMs: 250 }).snap, true);
  // no strokes outrunning the audio: complete the moment the audio ends
  const tl3 = buildTimeline(scene([{ id: 'a' }]), D, nat({ a: 1000 }));
  assert.equal(isSceneComplete(tl3, { audioEnded: false, t: D, snap: false }), false, 'never complete before the audio ends');
  assert.equal(isSceneComplete(tl3, { audioEnded: true, t: D, snap: false }), true);
  // empty timeline (narration-only degraded scene) completes with the audio
  assert.equal(isSceneComplete([], { audioEnded: true, t: 0, snap: false }), true);
});

test('scheduler: active element and started ids follow at order', () => {
  const tl = buildTimeline(scene([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 3000, nat({ a: 100, b: 100, c: 100 }));
  // starts 0, 850, 1700; windows 850, 850, 1150
  assert.equal(activeIndex(tl, -1), -1);
  assert.equal(activeIndex(tl, 100), 0);
  assert.equal(activeIndex(tl, 900), 1);
  assert.equal(activeIndex(tl, 2000), 2);
  assert.equal(activeIndex(tl, 5000), 2, 'pen parks on the last element once all are done');
  assert.deepEqual(startedIds(tl, 0), []);
  assert.deepEqual(startedIds(tl, 1), ['a']);
  assert.deepEqual(startedIds(tl, 851), ['a', 'b']);
  assert.deepEqual(startedIds(tl, 1700.5), ['a', 'b', 'c']);
  assert.deepEqual(startedIds(tl, 0, { forced: new Set(['c']) }), ['c']);
  let prev = [];
  for (let t = 0; t <= 3000; t += 10) {
    const now = startedIds(tl, t);
    assert.ok(now.length >= prev.length, 'drawn set only grows');
    for (let i = 0; i < prev.length; i++) assert.equal(now[i], prev[i]);
    prev = now;
  }
});
