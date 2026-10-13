// The audio-clock scheduler (player/engine/scheduler.js). change-khan-feel items 1–2 and 5: an
// element is drawn at handwriting speed (naturalMs from the drawable + word/line micro-pauses)
// and then the pen parks for the rest of its window; the draw is compressed to the window only
// when it would overrun the next element (never for the last one — the yield rule owns the scene
// end); omitted `at` values start talk-first at 0.08.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimeline, progressAt, timelineEnd, effectiveTime, isSceneComplete, needsYield, activeIndex, startedIds,
  compressedItems, pauseProfile, contentCounts, DEFAULT_YIELD_CAP_MS, PEN_TRAVEL_MS,
} from '../../player/engine/scheduler.js';
import { PEN_WORD_GAP_MS, PEN_LINE_GAP_MS, TIMING } from '../../shared/layout-core/constants.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const scene = (elements) => ({ sceneId: 's001', board: { mode: 'wipe' }, elements });
const nat = (pairs) => new Map(Object.entries(pairs).map(([id, v]) => [id, typeof v === 'number' ? { naturalMs: v } : v]));

test('scheduler: default at spacing (talk-first 0.08 + 0.77·i/n) and last window end 0.95', () => {
  assert.equal(TIMING.firstAt, 0.08);
  const tl = buildTimeline(scene([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), 10000);
  assert.deepEqual(tl.map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(tl.map((x) => x.start), [800, 2725, 4650, 6575]);
  assert.deepEqual(tl.map((x) => x.windowEnd), [2725, 4650, 6575, 9500]);
  // no drawables (unknown natural duration): drawEnd = windowEnd, nothing compressed
  assert.deepEqual(tl.map((x) => x.drawEnd), [2725, 4650, 6575, 9500]);
  assert.deepEqual(tl.map((x) => x.compressed), [false, false, false, false]);
  assert.deepEqual(tl.map((x) => x.last), [false, false, false, true]);
  const single = buildTimeline(scene([{ id: 'only' }]), 6000);
  assert.deepEqual(single, [{ id: 'only', index: 0, start: 480, windowEnd: 5700, drawEnd: 5700, naturalMs: 0, pauseMs: 0, compressed: false, ratio: 1, last: true, segs: null }]);
  // explicit at 0 is still honoured (no talk-first offset imposed)
  assert.equal(buildTimeline(scene([{ id: 'now', at: 0 }]), 6000)[0].start, 0);
});

test('scheduler: natural-speed writing then park — drawEnd = start + naturalMs when it fits; the last element is never compressed', () => {
  const tl = buildTimeline(scene([{ id: 'client', at: 0.1 }, { id: 'serve', at: 0.6 }]), 12800, nat({ client: 500, serve: 9000 }));
  // client: window 6400 ≥ natural 500 → written in 500 ms, then the pen parks until 7680
  close(tl[0].start, 1280); close(tl[0].windowEnd, 7680); close(tl[0].drawEnd, 1780);
  assert.equal(tl[0].compressed, false);
  // serve: natural 9000 > window 4480 but it is the LAST element → natural (the yield rule holds silence, capped)
  close(tl[1].start, 7680); close(tl[1].windowEnd, 12160); close(tl[1].drawEnd, 16680);
  assert.equal(tl[1].compressed, false);
  assert.equal(tl[1].last, true);
  assert.equal(progressAt(tl[0], 0), 0);
  assert.equal(progressAt(tl[0], 1279.9), 0);
  close(progressAt(tl[0], 1280 + 250), 0.5);
  assert.equal(progressAt(tl[0], 1780), 1, 'complete at start + naturalMs');
  assert.equal(progressAt(tl[0], 5000), 1, 'parked (complete) for the rest of the window');
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
  // drawables may be a plain object; unknown or non-finite naturalMs counts as 0 (unknown → the window)
  assert.equal(buildTimeline(scene([{ id: 'a' }]), 1000, { a: { naturalMs: NaN } })[0].naturalMs, 0);
  assert.equal(buildTimeline(scene([{ id: 'a' }]), 0)[0].drawEnd, 0);
});

test('scheduler: compression is the last resort — only when natural time overruns the window of a non-last element; logged items carry the ratio', () => {
  const tl = buildTimeline(scene([{ id: 'a', at: 0 }, { id: 'b', at: 0.5 }, { id: 'c', at: 0.6 }]), 10000, nat({ a: 8000, b: 500, c: 9000 }));
  // a: natural 8000 > window 5000 and b follows → compressed to the window
  assert.equal(tl[0].compressed, true);
  close(tl[0].ratio, 1.6);
  close(tl[0].drawEnd, 5000);
  close(progressAt(tl[0], 2500), 0.5);
  assert.equal(progressAt(tl[0], 5000), 1);
  // b fits → natural; c is last → natural even though it overruns
  assert.equal(tl[1].compressed, false); close(tl[1].drawEnd, 5500);
  assert.equal(tl[2].compressed, false); close(tl[2].drawEnd, 15000);
  assert.deepEqual(compressedItems(tl).map((x) => x.id), ['a']);
  // compression keeps the order clean: no element is still drawing when the next one starts
  for (let i = 0; i + 1 < tl.length; i++) assert.ok(tl[i].drawEnd <= tl[i + 1].start + 1e-9, `${tl[i].id} ends before ${tl[i + 1].id} starts`);
  // a zero-length window with a natural duration: compressed to an instant (the author put both at the same `at`)
  const zero = buildTimeline(scene([{ id: 'a', at: 0.5 }, { id: 'b', at: 0.5 }]), 1000, nat({ a: 1000, b: 10 }));
  assert.equal(zero[0].compressed, true);
  assert.equal(zero[0].ratio, Infinity);
  assert.equal(zero[0].drawEnd, 500);
  assert.equal(progressAt(zero[0], 500), 1);
  // nothing compressed when everything fits
  assert.deepEqual(compressedItems(buildTimeline(scene([{ id: 'a' }, { id: 'b' }]), 10000, nat({ a: 100, b: 100 }))), []);
});

test('scheduler: micro-pauses — word and line gaps from the script, holds only on part boundaries', () => {
  assert.equal(PEN_WORD_GAP_MS, 120);
  assert.equal(PEN_LINE_GAP_MS, 250);
  // text: words − lines word gaps; one wrapped line unless the drawable says otherwise
  assert.deepEqual(pauseProfile({ type: 'text', text: 'one two three' }, null), { wordGaps: 2, lineGaps: 0, holds: 0, pauseMs: 240 });
  assert.deepEqual(pauseProfile({ type: 'text', text: 'one two three' }, { partStarts: [0], meta: { lines: ['one two', 'three'] } }), { wordGaps: 1, lineGaps: 1, holds: 0, pauseMs: 370 });
  // list items are lines AND parts: line gaps become holds
  assert.deepEqual(pauseProfile({ type: 'list', items: ['a b', 'c d', 'e f'] }, { partStarts: [0, 1 / 3, 2 / 3] }), { wordGaps: 3, lineGaps: 2, holds: 2, pauseMs: 3 * 120 + 2 * 250 });
  // code and math: lines from the script; code is one part (no holds), math one part per line
  assert.deepEqual(pauseProfile({ type: 'code', lines: ['a', 'b', 'c'] }, { partStarts: [0] }), { wordGaps: 0, lineGaps: 2, holds: 0, pauseMs: 500 });
  assert.deepEqual(pauseProfile({ type: 'math', lines: ['x', 'y'] }, { partStarts: [0, 0.5] }), { wordGaps: 0, lineGaps: 1, holds: 1, pauseMs: 250 });
  // table: cell words, rows as lines
  assert.deepEqual(contentCounts({ type: 'table', rows: [['a b', 'c'], ['d', 'e']] }, { partStarts: [0, 0.5] }), { words: 5, lines: 2, parts: 2 });
  // labels count as words; unknown types and missing content give no pauses
  assert.equal(pauseProfile({ type: 'box', label: 'two words' }, null).pauseMs, 120);
  assert.equal(pauseProfile({ type: 'arrow' }, null).pauseMs, 0);
  assert.equal(pauseProfile({ type: 'highlight' }, { partStarts: [0] }).pauseMs, 0);
  assert.equal(pauseProfile(null, null).pauseMs, 0);
});

test('scheduler: a multi-part element holds between parts (u plateaus at the part boundary) and still ends at drawEnd', () => {
  const list = { id: 'l', type: 'list', items: ['a b', 'c d', 'e f'] };
  const d = nat({ t: 1000, l: { naturalMs: 3000, partStarts: [0, 1 / 3, 2 / 3] } });
  const tl = buildTimeline(scene([{ id: 't', type: 'text', text: 'one two three' }, list]), 10000, d);
  // t: natural 1000 + 2 word gaps 240 → 1240 (fits the 3850 window); no parts → linear, no segs
  close(tl[0].start, 800); close(tl[0].drawEnd, 2040); assert.equal(tl[0].pauseMs, 240); assert.equal(tl[0].segs, null);
  // l: natural 3000 + 3 word gaps + 2 line gaps = 3860 (fits 4850); two holds of 250 on the part boundaries
  close(tl[1].start, 4650); close(tl[1].drawEnd, 8510); assert.equal(tl[1].pauseMs, 860);
  assert.equal(tl[1].segs.length, 3);
  const s = tl[1].segs;
  close(s[0].t0, 0); close(s[0].t1, 1120); close(s[1].t0, 1370); close(s[1].t1, 2490); close(s[2].t0, 2740); close(s[2].t1, 3860);
  close(s[0].u0, 0); close(s[0].u1, 1 / 3); close(s[2].u1, 1);
  const st = tl[1].start;
  close(progressAt(tl[1], st + 560), 1 / 6);
  close(progressAt(tl[1], st + 1120), 1 / 3);
  close(progressAt(tl[1], st + 1200), 1 / 3, 1e-6); // holding at the end of item 1
  close(progressAt(tl[1], st + 1369), 1 / 3);
  close(progressAt(tl[1], st + 1370 + 560), 0.5);
  close(progressAt(tl[1], st + 2600), 2 / 3); // second hold
  assert.equal(progressAt(tl[1], st + 3860), 1);
  assert.equal(progressAt(tl[1], st + 3859.9) < 1, true);
  // monotonic, non-decreasing, inside [0, 1]
  let prev = 0;
  for (let t = st - 10; t <= tl[1].drawEnd + 10; t += 1) { const u = progressAt(tl[1], t); assert.ok(u >= prev - 1e-12 && u >= 0 && u <= 1, `u(${t}) = ${u} after ${prev}`); prev = u; }
  // compressed multi-part: holds shrink with the ratio and never take more than half the span; last segment ends at the window
  const c = buildTimeline(scene([{ id: 'l', type: 'list', items: ['x', 'y', 'z'], at: 0 }, { id: 'n', at: 0.5 }]), 10000, nat({ l: { naturalMs: 8000, partStarts: [0, 1 / 3, 2 / 3] } }));
  assert.equal(c[0].compressed, true);
  close(c[0].ratio, 8500 / 5000);
  close(c[0].segs[2].t1, 5000);
  const holdTotal = (c[0].segs[1].t0 - c[0].segs[0].t1) + (c[0].segs[2].t0 - c[0].segs[1].t1);
  close(holdTotal, 2 * 250 * (5000 / 8500));
  assert.equal(progressAt(c[0], 5000), 1);
  // naturalMsScale stretches pauses too
  const sc = buildTimeline(scene([list]), 100000, nat({ l: { naturalMs: 3000, partStarts: [0, 1 / 3, 2 / 3] } }), { naturalMsScale: 2 });
  close(sc[0].drawEnd - sc[0].start, 2 * 3860);
});

test('scheduler: yield rule — hold until the last stroke, capped, then snap', () => {
  const D = 6000;
  const tl = buildTimeline(scene([{ id: 'para' }, { id: 'grid' }]), D, nat({ para: 1600, grid: 6000 }));
  // para: start 480, window 2310 ≥ 1600 → done at 2080; grid: start 2790, natural 6000 (last) → drawEnd 8790 > D → yield engages
  close(tl[0].drawEnd, 2080);
  close(tl[1].drawEnd, 8790);
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
  close(tl2[1].drawEnd, 6790);
  e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 789 });
  assert.equal(isSceneComplete(tl2, { audioEnded: true, ...e }), false);
  e = effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 791 });
  assert.equal(isSceneComplete(tl2, { audioEnded: true, ...e }), true);
  // custom cap
  assert.equal(effectiveTime({ audioMs: D, audioEnded: true, durationMs: D, holdMs: 300, yieldCapMs: 250 }).snap, true);
  // no strokes outrunning the audio: complete the moment the audio ends
  const tl3 = buildTimeline(scene([{ id: 'a' }]), D, nat({ a: 1000 }));
  close(tl3[0].drawEnd, 1480);
  assert.equal(isSceneComplete(tl3, { audioEnded: false, t: D, snap: false }), false, 'never complete before the audio ends');
  assert.equal(isSceneComplete(tl3, { audioEnded: true, t: D, snap: false }), true);
  // empty timeline (narration-only degraded scene) completes with the audio
  assert.equal(isSceneComplete([], { audioEnded: true, t: 0, snap: false }), true);
});

test('scheduler: active element and started ids follow at order; leadMs anticipates the next element for the pen travel', () => {
  const tl = buildTimeline(scene([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 3000, nat({ a: 100, b: 100, c: 100 }));
  // starts 240, 1010, 1780; each written in 100 ms then parked
  assert.deepEqual(tl.map((x) => Math.round(x.start)), [240, 1010, 1780]);
  assert.deepEqual(tl.map((x) => Math.round(x.drawEnd)), [340, 1110, 1880]);
  assert.equal(activeIndex(tl, -1), -1);
  assert.equal(activeIndex(tl, 100), -1, 'talk-first: nothing active before the first start');
  assert.equal(activeIndex(tl, 250), 0);
  assert.equal(activeIndex(tl, 900), 0, 'pen parks on a until b starts');
  assert.equal(activeIndex(tl, 1050), 1);
  assert.equal(activeIndex(tl, 2000), 2);
  assert.equal(activeIndex(tl, 5000), 2, 'pen parks on the last element once all are done');
  // with a lead the pen waits at the first element, and moves to the next one leadMs before its start once the current one is written
  assert.ok(PEN_TRAVEL_MS >= 250 && PEN_TRAVEL_MS <= 400, `travel ${PEN_TRAVEL_MS} ms`);
  const lead = { leadMs: 320 };
  assert.equal(activeIndex(tl, 100, lead), 0);
  assert.equal(activeIndex(tl, 500, lead), 0, '690 > 500: not yet');
  assert.equal(activeIndex(tl, 700, lead), 1, 'b starts at 1010: travel from 690');
  assert.equal(activeIndex(tl, 1050, lead), 1);
  assert.equal(activeIndex(tl, 1150, lead), 1, 'c starts at 1780: travel only from 1460');
  assert.equal(activeIndex(tl, 1500, lead), 2);
  assert.equal(activeIndex(tl, 5000, lead), 2);
  // a lead never leaves an element that is still being written
  const slow = buildTimeline(scene([{ id: 'a', at: 0 }, { id: 'b', at: 0.5 }]), 2000, nat({ a: 5000, b: 100 }));
  assert.equal(slow[0].compressed, true);
  assert.equal(activeIndex(slow, 900, lead), 0, 'a draws until 1000');
  assert.equal(activeIndex(slow, 1000, lead), 1);
  assert.equal(activeIndex([], 100, lead), -1);
  assert.deepEqual(startedIds(tl, 0), []);
  assert.deepEqual(startedIds(tl, 241), ['a']);
  assert.deepEqual(startedIds(tl, 1011), ['a', 'b']);
  assert.deepEqual(startedIds(tl, 1780.5), ['a', 'b', 'c']);
  assert.deepEqual(startedIds(tl, 0, { forced: new Set(['c']) }), ['c']);
  let prev = [];
  for (let t = 0; t <= 3000; t += 10) {
    const now = startedIds(tl, t);
    assert.ok(now.length >= prev.length, 'drawn set only grows');
    for (let i = 0; i < prev.length; i++) assert.equal(now[i], prev[i]);
    prev = now;
  }
});
