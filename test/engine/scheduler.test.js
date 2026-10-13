// The audio-clock scheduler (player/engine/scheduler.js). change-khan-feel items 1–2 and 5: an
// element is drawn at handwriting speed (naturalMs from the drawable + word/line micro-pauses)
// and then the pen parks for the rest of its window; the draw is compressed to the window only
// when it would overrun the next element; omitted `at` values start talk-first at 0.08.
// qa/04 finding 1 (fix): omitted-`at` elements share their span by need (weightWindows), and the
// last element is compressed to D + yieldCapMs when its need runs past the cap instead of popping
// in at scene end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimeline, progressAt, timelineEnd, effectiveTime, isSceneComplete, needsYield, activeIndex, startedIds,
  compressedItems, pauseProfile, contentCounts, weightWindows, DEFAULT_YIELD_CAP_MS, PEN_TRAVEL_MS,
} from '../../player/engine/scheduler.js';
import { PEN_WORD_GAP_MS, PEN_LINE_GAP_MS, TIMING } from '../../shared/layout-core/constants.js';
import { resolveTiming } from '../../shared/layout-core/timing.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const scene = (elements) => ({ sceneId: 's001', board: { mode: 'wipe' }, elements });
const nat = (pairs) => new Map(Object.entries(pairs).map(([id, v]) => [id, typeof v === 'number' ? { naturalMs: v } : v]));

// MODIFIED (qa/04 finding 1a): omitted-`at` elements no longer take the validator's even 0.08 + 0.77·i/n
// starts at play time; their span [0.08 × D, 0.95 × D] is shared by need, and with nothing known
// about the content (no drawables) every element gets the same window.
test('scheduler: default at spacing — talk-first 0.08, equal windows up to 0.95 when nothing is known about the content', () => {
  assert.equal(TIMING.firstAt, 0.08);
  const tl = buildTimeline(scene([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), 10000);
  assert.deepEqual(tl.map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(tl.map((x) => x.start), [800, 2975, 5150, 7325]);
  assert.deepEqual(tl.map((x) => x.windowEnd), [2975, 5150, 7325, 9500]);
  // no drawables (unknown natural duration): drawEnd = windowEnd, nothing compressed
  assert.deepEqual(tl.map((x) => x.drawEnd), [2975, 5150, 7325, 9500]);
  assert.deepEqual(tl.map((x) => x.compressed), [false, false, false, false]);
  assert.deepEqual(tl.map((x) => x.last), [false, false, false, true]);
  const single = buildTimeline(scene([{ id: 'only' }]), 6000);
  assert.deepEqual(single, [{ id: 'only', index: 0, start: 480, windowEnd: 5700, drawEnd: 5700, naturalMs: 0, pauseMs: 0, compressed: false, ratio: 1, last: true, segs: null }]);
  // explicit at 0 is still honoured (no talk-first offset imposed)
  assert.equal(buildTimeline(scene([{ id: 'now', at: 0 }]), 6000)[0].start, 0);
});

// MODIFIED (qa/04 finding 1b): the last element used to keep its natural time however far past the
// audio it ran (and snapped in at the cap); it now runs into the hold only up to D + yieldCapMs.
test('scheduler: natural-speed writing then park — drawEnd = start + naturalMs when it fits; the last element may run into the yield hold up to the cap', () => {
  const tl = buildTimeline(scene([{ id: 'client', at: 0.1 }, { id: 'serve', at: 0.6 }]), 12800, nat({ client: 500, serve: 9000 }));
  // client: window 6400 ≥ natural 500 → written in 500 ms, then the pen parks until 7680
  close(tl[0].start, 1280); close(tl[0].windowEnd, 7680); close(tl[0].drawEnd, 1780);
  assert.equal(tl[0].compressed, false);
  // serve: natural 9000 > window 4480 and past D + cap (14300) even as the LAST element → compressed to D + cap
  close(tl[1].start, 7680); close(tl[1].windowEnd, 12160); close(tl[1].drawEnd, 12800 + DEFAULT_YIELD_CAP_MS);
  assert.equal(tl[1].compressed, true);
  close(tl[1].ratio, 9000 / 6620);
  assert.equal(tl[1].last, true);
  // a last element that finishes inside the hold is natural (the yield rule holds silence for it)
  const held = buildTimeline(scene([{ id: 'client', at: 0.1 }, { id: 'serve', at: 0.6 }]), 12800, nat({ client: 500, serve: 6000 }));
  close(held[1].drawEnd, 13680);
  assert.equal(held[1].compressed, false);
  // the cap is a knob (the engine passes config.yieldCapMs)
  close(buildTimeline(scene([{ id: 'serve', at: 0.6 }]), 12800, nat({ serve: 9000 }), { yieldCapMs: 3000 })[0].drawEnd, 15800);
  close(buildTimeline(scene([{ id: 'serve', at: 0.6 }]), 12800, nat({ serve: 9000 }), { yieldCapMs: 0 })[0].drawEnd, 12800);
  assert.equal(progressAt(tl[0], 0), 0);
  assert.equal(progressAt(tl[0], 1279.9), 0);
  close(progressAt(tl[0], 1280 + 250), 0.5);
  assert.equal(progressAt(tl[0], 1780), 1, 'complete at start + naturalMs');
  assert.equal(progressAt(tl[0], 5000), 1, 'parked (complete) for the rest of the window');
  assert.equal(progressAt(tl[0], 99999), 1);
  close(progressAt(tl[1], 7680 + 3310), 0.5);
  assert.equal(progressAt(tl[1], Infinity), 1);
  assert.equal(progressAt(tl[1], -Infinity), 0);
  close(timelineEnd(tl), 14300);
  assert.equal(needsYield(tl, 12800), true);
  assert.equal(needsYield(buildTimeline(scene([{ id: 'x' }]), 5000), 5000), false);
  // naturalMsScale (test knob) multiplies natural durations only (the only element is last: its 20 s of ink are capped at D + cap)
  const scaled = buildTimeline(scene([{ id: 'client', at: 0.1 }]), 10000, nat({ client: 1000 }), { naturalMsScale: 20 });
  close(scaled[0].naturalMs, 20000);
  close(scaled[0].drawEnd, 10000 + DEFAULT_YIELD_CAP_MS);
  close(buildTimeline(scene([{ id: 'client', at: 0.1 }, { id: 'z', at: 0.9 }]), 10000, nat({ client: 1000 }), { naturalMsScale: 5 })[0].drawEnd, 1000 + 5000);
  // a zero-length window with no natural duration is complete as soon as it starts
  const zero = buildTimeline(scene([{ id: 'a', at: 0.5 }, { id: 'b', at: 0.5 }]), 1000);
  assert.equal(zero[0].drawEnd, 500);
  assert.equal(progressAt(zero[0], 500), 1);
  assert.equal(progressAt(zero[0], 499), 0);
  // drawables may be a plain object; unknown or non-finite naturalMs counts as 0 (unknown → the window)
  assert.equal(buildTimeline(scene([{ id: 'a' }]), 1000, { a: { naturalMs: NaN } })[0].naturalMs, 0);
  assert.equal(buildTimeline(scene([{ id: 'a' }]), 0)[0].drawEnd, 0);
});

// MODIFIED (qa/04 finding 1b): the last element is compressed too when it would run past D + cap.
test('scheduler: compression is the last resort — only when natural time overruns the window (or, for the last element, D + cap); logged items carry the ratio', () => {
  const tl = buildTimeline(scene([{ id: 'a', at: 0 }, { id: 'b', at: 0.5 }, { id: 'c', at: 0.6 }]), 10000, nat({ a: 8000, b: 500, c: 9000 }));
  // a: natural 8000 > window 5000 and b follows → compressed to the window
  assert.equal(tl[0].compressed, true);
  close(tl[0].ratio, 1.6);
  close(tl[0].drawEnd, 5000);
  close(progressAt(tl[0], 2500), 0.5);
  assert.equal(progressAt(tl[0], 5000), 1);
  // b fits → natural; c is last and would run to 15000, past D + cap = 11500 → compressed to the cap
  assert.equal(tl[1].compressed, false); close(tl[1].drawEnd, 5500);
  assert.equal(tl[2].compressed, true); close(tl[2].drawEnd, 11500); close(tl[2].ratio, 9000 / 5500);
  assert.deepEqual(compressedItems(tl).map((x) => x.id), ['a', 'c']);
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
  // (qa/04 finding 1a: the list is anchored at 0.465 so the windows stay where this test's numbers expect them)
  const tl = buildTimeline(scene([{ id: 't', type: 'text', text: 'one two three' }, { ...list, at: 0.465 }]), 10000, d);
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
  // (qa/04 finding 1a: both anchored so the windows stay where this test's numbers expect them)
  const tl = buildTimeline(scene([{ id: 'para', at: 0.08 }, { id: 'grid', at: 0.465 }]), D, nat({ para: 1600, grid: 6000 }));
  // para: start 480, window 2310 ≥ 1600 → done at 2080; grid: start 2790, natural 6000 (last) would end at 8790,
  // past D + cap = 7500 → compressed to the cap (finding 1b): it finishes exactly as the hold ends, no snap-in
  close(tl[0].drawEnd, 2080);
  close(tl[1].drawEnd, 7500);
  assert.equal(tl[1].compressed, true);
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
  const tl2 = buildTimeline(scene([{ id: 'para', at: 0.08 }, { id: 'grid', at: 0.465 }]), D, nat({ para: 0, grid: 4000 }));
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
  // (qa/04 finding 1a: equal needs → equal windows over [240, 2850]) starts 240, 1110, 1980; each written in 100 ms then parked
  const tl = buildTimeline(scene([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 3000, nat({ a: 100, b: 100, c: 100 }));
  assert.deepEqual(tl.map((x) => Math.round(x.start)), [240, 1110, 1980]);
  assert.deepEqual(tl.map((x) => Math.round(x.drawEnd)), [340, 1210, 2080]);
  assert.equal(activeIndex(tl, -1), -1);
  assert.equal(activeIndex(tl, 100), -1, 'talk-first: nothing active before the first start');
  assert.equal(activeIndex(tl, 250), 0);
  assert.equal(activeIndex(tl, 1000), 0, 'pen parks on a until b starts');
  assert.equal(activeIndex(tl, 1150), 1);
  assert.equal(activeIndex(tl, 2000), 2);
  assert.equal(activeIndex(tl, 5000), 2, 'pen parks on the last element once all are done');
  // with a lead the pen waits at the first element, and moves to the next one leadMs before its start once the current one is written
  assert.ok(PEN_TRAVEL_MS >= 250 && PEN_TRAVEL_MS <= 400, `travel ${PEN_TRAVEL_MS} ms`);
  const lead = { leadMs: 320 };
  assert.equal(activeIndex(tl, 100, lead), 0);
  assert.equal(activeIndex(tl, 500, lead), 0, '790 > 500: not yet');
  assert.equal(activeIndex(tl, 800, lead), 1, 'b starts at 1110: travel from 790');
  assert.equal(activeIndex(tl, 1150, lead), 1);
  assert.equal(activeIndex(tl, 1250, lead), 1, 'c starts at 1980: travel only from 1660');
  assert.equal(activeIndex(tl, 1700, lead), 2);
  assert.equal(activeIndex(tl, 5000, lead), 2);
  // a lead never leaves an element that is still being written
  const slow = buildTimeline(scene([{ id: 'a', at: 0 }, { id: 'b', at: 0.5 }]), 2000, nat({ a: 5000, b: 100 }));
  assert.equal(slow[0].compressed, true);
  assert.equal(activeIndex(slow, 900, lead), 0, 'a draws until 1000');
  assert.equal(activeIndex(slow, 1000, lead), 1);
  assert.equal(activeIndex([], 100, lead), -1);
  assert.deepEqual(startedIds(tl, 0), []);
  assert.deepEqual(startedIds(tl, 241), ['a']);
  assert.deepEqual(startedIds(tl, 1111), ['a', 'b']);
  assert.deepEqual(startedIds(tl, 1980.5), ['a', 'b', 'c']);
  assert.deepEqual(startedIds(tl, 0, { forced: new Set(['c']) }), ['c']);
  let prev = [];
  for (let t = 0; t <= 3000; t += 10) {
    const now = startedIds(tl, t);
    assert.ok(now.length >= prev.length, 'drawn set only grows');
    for (let i = 0; i < prev.length; i++) assert.equal(now[i], prev[i]);
    prev = now;
  }
});

// ---------- qa/04 finding 1a: length-weighted windows ----------

test('weighting: omitted-at elements share their span by need — when the needs fit, each gets its need plus a share of the slack and nothing is compressed', () => {
  const D = 10000;
  const els = [{ id: 'title', type: 'text', text: 'Caching' }, { id: 'para', type: 'text', text: 'a long paragraph of body text here' }, { id: 'arrow', type: 'arrow' }];
  const tl = buildTimeline(scene(els), D, nat({ title: 1000, para: 5000, arrow: 300 }));
  // span [800, 9500] = 8700; base = 8700 / 6 = 1450; owed = max(need, base) = 1450 + 5720 (6 word gaps) + 1450 = 8620 fits; slack 80 shared by owed
  close(tl[0].start, 800, 1e-6);
  close(tl[2].windowEnd, 9500, 1e-6);
  const need = tl.map((it) => it.naturalMs + it.pauseMs);
  assert.deepEqual(need, [1000, 5000 + 6 * PEN_WORD_GAP_MS, 300]);
  const owed = need.map((v) => Math.max(v, 8700 / 6));
  const total = owed.reduce((a, b) => a + b, 0);
  tl.forEach((it, i) => {
    close(it.windowEnd - it.start, owed[i] + ((8700 - total) * owed[i]) / total, 1e-6);
    assert.equal(it.compressed, false, it.id);
    close(it.drawEnd, it.start + need[i], 1e-6);
    if (i > 0) close(it.start, tl[i - 1].windowEnd, 1e-6);
  });
  // the big element got the big window; the tiny arrow still has a dwell of at least half an even share
  assert.ok(tl[1].windowEnd - tl[1].start > 3 * (tl[0].windowEnd - tl[0].start));
  assert.ok(tl[2].windowEnd - tl[2].start >= 1450);
  assert.ok(tl[0].windowEnd - tl[0].start >= 1450);
  // deterministic: the same inputs give the same timeline
  assert.deepEqual(buildTimeline(scene(els), D, nat({ title: 1000, para: 5000, arrow: 300 })), tl);
  // compared with the validator's even defaults: the first start and the last window end are where they were
  const w = resolveTiming(scene(els));
  close(tl[0].start, w[0].at * D, 1e-6);
  close(tl[2].windowEnd, w[2].end * D, 1e-6);
});

test('weighting: when the needs do not fit, the span is shared by weight so every element is compressed by about the same ratio instead of the big ones by a lot', () => {
  const D = 10000;
  const els = [{ id: 'code', type: 'code', lines: ['a'] }, { id: 'list', type: 'list', items: ['x', 'y'] }, { id: 'note', type: 'text', text: 'note' }, { id: 'hl', type: 'highlight' }];
  const tl = buildTimeline(scene(els), D, nat({ code: 20000, list: { naturalMs: 10000, partStarts: [0, 0.5] }, note: 2000, hl: 0 }));
  // span 8700 ≪ needs 20000 + 10250 + 2000 (+ 0): every element gets the base 8700 / 8 = 1087.5, the other half of the
  // span is shared by the need beyond the base
  const need = tl.map((it) => it.naturalMs + it.pauseMs);
  assert.deepEqual(need, [20000, 10000 + PEN_LINE_GAP_MS, 2000, 0]);
  const base = 8700 / 8;
  const excess = need.map((v) => Math.max(0, v - base));
  const excessTotal = excess.reduce((a, b) => a + b, 0);
  tl.forEach((it, i) => close(it.windowEnd - it.start, base + (4350 * excess[i]) / excessTotal, 1e-6));
  close(tl.reduce((a, it) => a + (it.windowEnd - it.start), 0), 8700, 1e-6);
  assert.deepEqual(tl.map((it) => it.compressed), [true, true, true, false]);
  // the compression is carried by the big elements, in proportion: code ≈ ×5.1, list ≈ ×4.2, note ≈ ×1.6
  assert.ok(tl[0].ratio > tl[1].ratio && tl[1].ratio > tl[2].ratio);
  assert.ok(tl[0].ratio < 5.2 && tl[0].ratio > 5.0, `code ${tl[0].ratio}`);
  assert.ok(tl[2].ratio < 1.7, `note ${tl[2].ratio}`);
  // under the old even windows (2175 each) the code block alone would have been compressed ×9.2
  assert.ok(tl[0].ratio < 20000 / 2175 / 1.5);
  // the pointer highlight (no ink) keeps the base as a window to park on, and the order is still clean
  close(tl[3].windowEnd - tl[3].start, base, 1e-6);
  for (let i = 0; i + 1 < tl.length; i++) assert.ok(tl[i].drawEnd <= tl[i + 1].start + 1e-9);
  close(tl[3].windowEnd, 9500, 1e-6);
});

test('weighting: explicit at anchors stay fixed; only the omitted elements between anchors are redistributed; a run of one is left as resolved', () => {
  const D = 10000;
  // [anchor 0.1] [free] [free] [anchor 0.7] [free]: group 1 = a + b + c over [1000, 7000); group 2 = d + e over [7000, 9500)
  const els = [{ id: 'a', at: 0.1 }, { id: 'b' }, { id: 'c' }, { id: 'd', at: 0.7 }, { id: 'e' }];
  const tl = buildTimeline(scene(els), D, nat({ a: 500, b: 3000, c: 500, d: 1500, e: 200 }));
  close(tl[0].start, 1000); close(tl[3].start, 7000); close(tl[4].windowEnd, 9500);
  close(tl[2].windowEnd, 7000);
  assert.ok(tl[1].windowEnd - tl[1].start > tl[0].windowEnd - tl[0].start, 'b (3000) gets more than a (500)');
  assert.ok(tl[1].windowEnd - tl[1].start > tl[2].windowEnd - tl[2].start, 'b (3000) gets more than c (500)');
  for (const it of tl) assert.equal(it.compressed, false);
  // group 2: d needs 1500, e 200 → both fit (base 625 each), d gets the bigger window
  assert.ok(tl[3].windowEnd - tl[3].start > tl[4].windowEnd - tl[4].start);
  // all explicit: untouched
  const fixed = buildTimeline(scene([{ id: 'a', at: 0.1 }, { id: 'b', at: 0.5 }]), D, nat({ a: 100, b: 9000 }));
  close(fixed[0].start, 1000); close(fixed[0].windowEnd, 5000); close(fixed[1].start, 5000); close(fixed[1].windowEnd, 9500);
  // weightWindows directly: a run of one element is left as resolved; zero spans and zero needs are safe
  assert.deepEqual(weightWindows([{ at: 0.9, end: 0.95, explicit: true }], 1000, [5000]), [{ start: 900, windowEnd: 950 }]);
  assert.deepEqual(weightWindows([{ at: 0.5, end: 0.5, explicit: true }, { at: 0.5, end: 0.95, explicit: false }], 1000, [0, 0]), [{ start: 500, windowEnd: 725 }, { start: 725, windowEnd: 950 }]);
  assert.deepEqual(weightWindows([{ at: 0.5, end: 0.5, explicit: true }, { at: 0.5, end: 0.5, explicit: false }], 1000, [100, 100]), [{ start: 500, windowEnd: 500 }, { start: 500, windowEnd: 500 }]);
  assert.deepEqual(weightWindows([], 1000, []), []);
  // D = 0 (no audio yet): everything at 0
  for (const it of buildTimeline(scene(els), 0, nat({ a: 500, b: 3000 }))) { assert.equal(it.start, 0); assert.equal(it.windowEnd, 0); }
});
