// Slice 03 — `plot` drawable (brief 03 criterion 7 + edge cases), extended by change-khan-feel
// (Sal-style plots: separate axes with arrowheads, 2–5 integer ticks written one at a time, axis
// names at the ends, dots with letter labels, an open-circle `hole`).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePlot } from '../../player/renderer/pictures/index.js';
import { formatNum, autoYRange, splitRuns, chooseTicks, cutHole, axisOvershoot, TICKS_MIN, TICKS_MAX, LABEL_GAP, ARROW_LEN, ARROW_HALF_W } from '../../player/renderer/pictures/plot.js';
import { seriesToken, rectsIntersect } from '../../player/renderer/pictures/common.js';
import { slotRect } from '../../shared/layout-core/grid.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { validateScene, prepareValidator } from '../../shared/schema/validate.js';
import { createOccupancy } from '../../shared/layout-core/occupancy.js';
import { ensureFont, ctxFor, insideSlot, rectInside, rectsDistance, REPO_ROOT } from './helpers.js';

before(ensureFont);

const el = (overrides) => ({ id: 'pl', type: 'plot', slot: 'A1:C3', ...overrides });
const prep = (e) => preparePlot(e, ctxFor([e]));
const fixtureScene = (lesson, scene) => JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', 'lessons', lesson, 'scenes', `${scene}.json`), 'utf8'));
const kinds = (d) => d.picture.partKinds;
/** Strokes completed at the end of part i (u exactly on the boundary: the part is whole, the next one untouched). */
const completeAfterPart = (d, i) => d.revealAt((i + 1) / d.parts).complete;

// MODIFIED (change-khan-feel): axes are now two `axis` parts followed by one part per tick and a
// `names` part, so the part count and the tick-label count changed; the containment and placement
// assertions are unchanged.
test('two axis parts come first; every tick number is hand-written and inside the slot; the label sits top-right inside the slot', () => {
  const e = el({ fn: 'x^2', xRange: [-3, 3], yRange: [0, 10], label: 'y = x squared', color: 'accent1' });
  const d = prep(e);
  assert.deepEqual(kinds(d).slice(0, 2), ['axis', 'axis']);
  assert.deepEqual(kinds(d), ['axis', 'axis', ...Array(7).fill('tick'), 'names', 'series']);
  const slot = slotRect(e.slot);
  assert.equal(d.picture.tickLabels.length, 7, 'x: -2, 2; y: 2, 4, 6, 8, 10');
  for (const box of d.picture.tickLabels) assert.ok(rectInside(slot, box, 0.5), `tick label ${JSON.stringify(box)} inside slot`);
  const lb = d.picture.labelBox;
  assert.ok(lb && rectInside(slot, lb, 0.5));
  assert.ok(lb.x + lb.w > slot.x + slot.w * 0.6, 'label is on the right');
  assert.ok(lb.y < slot.y + slot.h * 0.2, 'label is at the top');
  assert.ok(insideSlot(d, e.slot));
  // the plot area lies inside the slot and the x axis sits at y = 0 → bottom of the area (y range starts at 0)
  assert.ok(Math.abs(d.picture.axes.xAxisY - (d.picture.area.y + d.picture.area.h)) < 1e-6);
});

test('1/x over [-2, 2] without yRange: the line breaks at the asymptote — no run straddles x = 0 and no segment spans the slot height', () => {
  const e = el({ fn: '1/x', xRange: [-2, 2], slot: 'A1:B2' });
  const d = prep(e);
  const s = d.picture.series[0];
  assert.ok(s.runs.length >= 2, 'broken into at least two runs');
  for (const run of s.dataRuns) {
    const signs = new Set(run.map((p) => Math.sign(p[0])));
    assert.equal(signs.size, 1, `run does not straddle x=0: ${JSON.stringify(run.slice(0, 3))}`);
  }
  const slotH = slotRect(e.slot).h;
  for (const run of s.runs) for (let i = 1; i < run.length; i++) assert.ok(Math.abs(run[i][1] - run[i - 1][1]) < slotH, 'no segment spans the slot height');
  assert.ok(insideSlot(d, e.slot));
});

test('non-finite points are skipped (ln(x) over [-10, 10] drops the 25 negative samples) and the line simply starts later', () => {
  const d = prep(el({ fn: 'ln(x)', xRange: [-10, 10] }));
  const s = d.picture.series[0];
  assert.equal(s.pointCount, 50);
  assert.equal(s.dropped, 25);
  assert.deepEqual(s.runs.map((r) => r.length), [25]);
  assert.ok(s.dataRuns[0].every((p) => p[0] > 0));
});

// MODIFIED (change-khan-feel): parts = 2 axes + 6 ticks + names + 3 series; point series are dots.
test('fn + two series = three series parts, last (fixture fx-type-plot s002); fifty-point series draws fifty dots', () => {
  const e = fixtureScene('fx-type-plot', 's002').elements[0];
  const d = prep(e);
  assert.deepEqual(kinds(d).slice(-3), ['series', 'series', 'series']);
  assert.deepEqual(kinds(d), ['axis', 'axis', ...Array(6).fill('tick'), 'names', 'series', 'series', 'series']);
  assert.equal(d.picture.series[1].pointCount, 50);
  assert.deepEqual(d.picture.series[1].runs.map((r) => r.length), [50]);
  assert.equal(d.picture.series[1].dots.length, 50, 'a point series is drawn as dots');
  assert.equal(d.picture.series[0].dots.length, 0, 'a fn is a curve, not dots');
  assert.ok(insideSlot(d, e.slot));
});

test('points outside yRange are clipped (not drawn) and the line breaks there', () => {
  const d = prep(el({ fn: 'x^2', xRange: [-3, 3], yRange: [0, 4] }));
  const s = d.picture.series[0];
  assert.ok(s.dropped > 0);
  for (const run of s.dataRuns) for (const p of run) assert.ok(p[1] >= 0 && p[1] <= 4, `y ${p[1]} within range`);
  const area = d.picture.area;
  for (const run of s.runs) for (const [, y] of run) assert.ok(y >= area.y - 1e-6 && y <= area.y + area.h + 1e-6, 'drawn points inside the plot area');
  // a sine that oscillates beyond the range gets several runs
  const w = prep(el({ fn: 'sin(x) * 2', xRange: [-10, 10], yRange: [-1, 1] }));
  assert.ok(w.picture.series[0].runs.length >= 3);
});

test('auto yRange pads the data by 10 %; a constant fn still gets a visible range; exp(x) on [0, 10] fits the slot', () => {
  assert.deepEqual(autoYRange([0, 10]), [-1, 11]);
  assert.deepEqual(autoYRange([3, 3, 3]), [2, 4]);
  assert.deepEqual(autoYRange([NaN, Infinity]), [0, 1]);
  const c = prep(el({ fn: '3', xRange: [0, 1] }));
  assert.deepEqual(c.picture.yRange, [2, 4]);
  assert.deepEqual(c.picture.series[0].runs.map((r) => r.length), [50]);
  const steep = prep(el({ fn: 'exp(x)', xRange: [0, 10], slot: 'A1:C2' }));
  assert.ok(steep.picture.yRange[1] > 20000);
  assert.ok(insideSlot(steep, 'A1:C2'));
  assert.deepEqual(steep.picture.series[0].runs.map((r) => r.length), [50], 'a steep but continuous function is one run');
});

// MODIFIED (change-khan-feel): the series is the last part (after axes, ticks and names) instead of part 2 of 2.
test('a series with one point draws a dot as the last part; default ranges are [-10, 10] and data-driven y', () => {
  const d = prep(el({ series: [[[1, 2]]], xRange: [0, 2] }));
  assert.equal(kinds(d)[d.parts - 1], 'series');
  assert.deepEqual(d.picture.series[0].runs.map((r) => r.length), [1]);
  assert.ok(d.revealAt(1).complete > completeAfterPart(d, d.parts - 2), 'the dot is a stroke of its own');
  const dflt = prep(el({ fn: 'x' }));
  assert.deepEqual(dflt.picture.xRange, [-10, 10]);
  assert.deepEqual(dflt.picture.yRange, [-12, 12]);
  assert.equal(dflt.picture.autoY, true);
});

test('series colours: the element colour first, then accents rotated after it (documented rule)', () => {
  assert.deepEqual([0, 1, 2].map((k) => seriesToken('accent2', k)), ['accent2', 'accent3', 'accent4']);
  assert.deepEqual([0, 1, 2].map((k) => seriesToken('accent5', k)), ['accent5', 'accent1', 'accent2']);
  assert.deepEqual([0, 1, 2].map((k) => seriesToken('muted', k)), ['muted', 'accent2', 'accent3']);
  assert.deepEqual([0, 1, 2].map((k) => seriesToken(undefined, k)), ['chalk', 'accent2', 'accent3']);
  const d = prep(el({ fn: 'x', series: [[[0, 0], [1, 1]], 'x^2'], xRange: [0, 1], color: 'accent4' }));
  assert.deepEqual(d.picture.series.map((s) => s.token), ['accent4', 'accent5', 'accent1']);
  // the strokes of the second series carry accent5
  const colors = new Set(d.strokeInfo.map((s) => s.color));
  assert.ok(colors.has(tokens.accent4) && colors.has(tokens.accent5) && colors.has(tokens.accent1) && colors.has(tokens.chalk));
});

test('splitRuns and formatNum helpers', () => {
  // NaN breaks; 50 → -50 is a sign-changing jump of 100 > 25 % of the 120 span → break; -50 → -1 keeps its sign → same run
  const { runs, dropped } = splitRuns([[0, 1], [1, NaN], [2, 1], [3, 50], [4, -50], [5, -1]], [0, 5], [-60, 60]);
  assert.equal(dropped, 1);
  assert.deepEqual(runs.map((r) => r.length), [1, 2, 2]);
  // a small sign change (e.g. a sine through zero) does not break
  assert.deepEqual(splitRuns([[0, -1], [1, 1], [2, -1]], [0, 2], [-10, 10]).runs.map((r) => r.length), [3]);
  // out-of-range points are dropped and break the run
  assert.deepEqual(splitRuns([[0, 1], [1, 99], [2, 1]], [0, 2], [0, 10]).runs.map((r) => r.length), [1, 1]);
  assert.equal(formatNum(10), '10');
  assert.equal(formatNum(-1.5), '-1.5');
  assert.equal(formatNum(3.14159), '3.14');
  assert.equal(formatNum(22026.4658), '22000');
  assert.equal(formatNum(-0.0001), '-0.0001');
});

test('axes cross at the origin when zero is inside both ranges, otherwise hug the edges', () => {
  const mid = prep(el({ fn: 'x', xRange: [-1, 1], yRange: [-1, 1] }));
  const a = mid.picture.area;
  assert.ok(Math.abs(mid.picture.axes.yAxisX - (a.x + a.w / 2)) < 1e-6);
  assert.ok(Math.abs(mid.picture.axes.xAxisY - (a.y + a.h / 2)) < 1e-6);
  const pos = prep(el({ fn: 'x', xRange: [1, 2], yRange: [1, 2] }));
  assert.ok(Math.abs(pos.picture.axes.yAxisX - pos.picture.area.x) < 1e-6);
  assert.ok(Math.abs(pos.picture.axes.xAxisY - (pos.picture.area.y + pos.picture.area.h)) < 1e-6);
  const neg = prep(el({ fn: 'x', xRange: [-2, -1], yRange: [-2, -1] }));
  assert.ok(Math.abs(neg.picture.axes.yAxisX - (neg.picture.area.x + neg.picture.area.w)) < 1e-6);
  assert.ok(Math.abs(neg.picture.axes.xAxisY - neg.picture.area.y) < 1e-6);
  for (const d of [mid, pos, neg]) assert.ok(insideSlot(d, 'A1:C3'));
});

// ---------- change-khan-feel: Sal-style plots ----------

test("parts follow Sal's order — axis, axis, ticks, names, curve, hole — and tipAt walks them in that order (fixture s004)", () => {
  const e = fixtureScene('fx-type-plot', 's004').elements[0];
  const d = prep(e);
  const k = kinds(d);
  assert.deepEqual(k.slice(0, 2), ['axis', 'axis']);
  const tickCount = k.filter((x) => x === 'tick').length;
  assert.ok(tickCount >= 2 * TICKS_MIN && tickCount <= 2 * TICKS_MAX, `${tickCount} ticks`);
  assert.deepEqual(k.slice(2, 2 + tickCount), Array(tickCount).fill('tick'));
  assert.deepEqual(k.slice(2 + tickCount), ['names', 'series', 'hole']);
  const { xAxisY, yAxisX } = d.picture.axes;
  const n = d.parts;
  const mid = (i) => (i + 0.5) / n;
  // the pen is on the x axis during part 0, on the y axis during part 1 (rough wobble ≤ 8 px)
  const t0 = d.tipAt(mid(0)); assert.ok(Math.abs(t0.y - xAxisY) < 10, `tip on the x axis: ${JSON.stringify(t0)} vs ${xAxisY}`);
  const t1 = d.tipAt(mid(1)); assert.ok(Math.abs(t1.x - yAxisX) < 10, `tip on the y axis: ${JSON.stringify(t1)} vs ${yAxisX}`);
  // each tick part writes its mark then its number: the tip at the end of a tick part is inside the number's box
  for (let i = 2; i < 2 + tickCount; i++) {
    const meta = d.picture.partMeta[i];
    const tip = d.tipAt((i + 1) / n - 1e-9);
    assert.ok(rectInside(meta.box, { x: tip.x, y: tip.y, w: 0, h: 0 }, 2), `tick ${meta.axis}=${meta.value}: tip ${JSON.stringify(tip)} ends in its number ${JSON.stringify(meta.box)}`);
  }
  // the hole is drawn last, around its point
  const h = d.picture.hole;
  const tEnd = d.tipAt(1);
  assert.ok(Math.hypot(tEnd.x - h.px, tEnd.y - h.py) <= 12, 'the last stroke is the hole circle');
  assert.ok(insideSlot(d, e.slot));
});

test('ticks: 2–5 per axis at a nice step, integers whenever two fit, never zero, from the range (chooseTicks + prepared plots)', () => {
  assert.deepEqual(chooseTicks(-10, 10), [-10, -5, 5, 10]);
  assert.deepEqual(chooseTicks(-3, 3), [-2, 2]);
  assert.deepEqual(chooseTicks(0, 10), [2, 4, 6, 8, 10]);
  assert.deepEqual(chooseTicks(2, 4), [2, 3, 4]);
  assert.deepEqual(chooseTicks(-2, 2), [-2, -1, 1, 2]);
  assert.deepEqual(chooseTicks(0, 22000), [5000, 10000, 15000, 20000]);
  assert.deepEqual(chooseTicks(-1.5, 1.5), [-1, 1]);
  // narrower than two integers → the largest fractional nice step with at least two ticks
  assert.deepEqual(chooseTicks(0, 1), [0.5, 1]);
  assert.deepEqual(chooseTicks(0, 0.3), [0.1, 0.2, 0.3]);
  assert.deepEqual(chooseTicks(0.95, 1.05), [0.95, 1, 1.05]);
  assert.deepEqual(chooseTicks(1, 1), []);
  // a sweep of ranges: always 2–5 ticks, inside the range, no zero, integers when the span holds two
  for (const [lo, hi] of [[-10, 10], [-7, 7], [-6, 6], [0, 1], [1, 2], [-2, -1], [0, 100], [-0.5, 0.5], [3, 17], [-12, 12], [0, 4], [-1, 4]]) {
    const t = chooseTicks(lo, hi);
    assert.ok(t.length >= TICKS_MIN && t.length <= TICKS_MAX, `[${lo}, ${hi}] → ${t.length} ticks`);
    assert.ok(t.every((v) => v >= lo && v <= hi && v !== 0), `[${lo}, ${hi}] → ${t}`);
    if (Math.floor(hi) - Math.ceil(lo) >= 2) assert.ok(t.every(Number.isInteger), `[${lo}, ${hi}] → integers, got ${t}`);
    assert.ok(t.every((v, i) => i === 0 || v > t[i - 1]), 'ascending');
  }
  // prepared: tick parts carry the values and each number sits beside its mark on the right axis
  const d = prep(el({ fn: 'x', xRange: [-10, 10], yRange: [0, 10] }));
  assert.deepEqual(d.picture.ticks.x.map((t) => t.value), [-10, -5, 5, 10]);
  assert.deepEqual(d.picture.ticks.y.map((t) => t.value), [2, 4, 6, 8, 10]);
  const { xAxisY, yAxisX } = d.picture.axes;
  for (const t of d.picture.ticks.x) { assert.ok(t.box.y > xAxisY, 'x numbers below the x axis'); assert.ok(Math.abs(t.box.x + t.box.w / 2 - t.px) < 1, 'centred on the tick'); }
  for (const t of d.picture.ticks.y) { assert.ok(t.box.x + t.box.w < yAxisX, 'y numbers left of the y axis'); assert.ok(t.box.y < t.px && t.box.y + t.box.h > t.px, 'vertically on the tick'); }
  assert.ok(insideSlot(d, 'A1:C3'));
});

// MODIFIED (qa/04 finding 4): the positive-end arrow tip is `axes.xEnd` / `axes.yEnd` — the axis end nudged past
// the last tick number — rather than the data area's edge.
test('arrowheads: each axis is its own stroke with an arrowhead at its positive end, and at both ends when the range crosses zero', () => {
  const one = prep(el({ fn: 'x', xRange: [0, 4], yRange: [0, 4] }));
  assert.deepEqual(one.picture.axes.arrowheads, { x: ['+x'], y: ['+y'] });
  const both = prep(el({ fn: 'x', xRange: [-2, 2], yRange: [-2, 2] }));
  assert.deepEqual(both.picture.axes.arrowheads, { x: ['+x', '-x'], y: ['+y', '-y'] });
  for (const d of [one, both]) {
    const n = d.parts;
    const a = d.picture.area;
    const { xAxisY, yAxisX } = d.picture.axes;
    // part 0 = x axis line + its arrowheads (more strokes than the bare line); the pen ends at the last arrowhead's wing
    const xStrokes = completeAfterPart(d, 0);
    const yStrokes = completeAfterPart(d, 1) - xStrokes;
    assert.ok(xStrokes >= 1 + d.picture.axes.arrowheads.x.length, `x axis has ${xStrokes} strokes`);
    assert.ok(yStrokes >= 1 + d.picture.axes.arrowheads.y.length, `y axis has ${yStrokes} strokes`);
    const lastX = d.picture.axes.arrowheads.x.at(-1) === '+x' ? d.picture.axes.xEnd : a.x;
    const tx = d.tipAt(1 / n - 1e-9);
    assert.ok(Math.hypot(tx.x - lastX, tx.y - xAxisY) <= 22, `x arrowhead ends near the axis end: ${JSON.stringify(tx)}`);
    const lastY = d.picture.axes.arrowheads.y.at(-1) === '+y' ? d.picture.axes.yEnd : a.y + a.h;
    const ty = d.tipAt(2 / n - 1e-9);
    assert.ok(Math.hypot(ty.x - yAxisX, ty.y - lastY) <= 22, `y arrowhead ends near the axis end: ${JSON.stringify(ty)}`);
    // the first stroke of part 0 is the x axis line itself: the pen starts at its left end
    const start = d.tipAt(1e-9);
    assert.ok(Math.abs(start.y - xAxisY) < 10 && Math.abs(start.x - a.x) < 10, `x axis starts at the left: ${JSON.stringify(start)}`);
  }
});

test('hole: an open circle at the mapped point, drawn last in the element colour, with the curve broken around it', () => {
  const e = fixtureScene('fx-type-plot', 's004').elements[0];
  const d = prep(e);
  const a = d.picture.area;
  const [x0, x1] = d.picture.xRange, [y0, y1] = d.picture.yRange;
  const px = a.x + ((1 - x0) / (x1 - x0)) * a.w, py = a.y + a.h - ((2 - y0) / (y1 - y0)) * a.h;
  const h = d.picture.hole;
  assert.ok(Math.abs(h.px - px) < 1e-6 && Math.abs(h.py - py) < 1e-6, 'the circle is centred on (1, 2)');
  assert.equal(kinds(d).at(-1), 'hole');
  assert.equal(d.strokeInfo.at(-1).color, tokens.accent1);
  assert.equal(d.strokeInfo.at(-1).mode, 'stroke', 'an open circle, not a filled dot');
  // the curve leaves a gap for the circle: no drawn point inside it, and the run is split there
  const runs = d.picture.series[0].runs;
  assert.ok(runs.length >= 2, 'the sweep is broken at the hole');
  for (const run of runs) for (const p of run) assert.ok(Math.hypot(p[0] - h.px, p[1] - h.py) > 6, 'no curve point inside the hole');
  assert.ok(rectInside(slotRect(e.slot), h.box));
  // a hole outside the ranges draws nothing (the validator rejects it anyway); auto-y makes room for one
  assert.equal(prep(el({ fn: 'x', xRange: [0, 4], yRange: [0, 4], hole: [9, 9] })).picture.hole, null);
  assert.equal(prep(el({ fn: 'x', xRange: [0, 4], yRange: [0, 4] })).picture.hole, null);
  const auto = prep(el({ fn: 'x', xRange: [0, 4], hole: [2, 20] }));
  assert.ok(auto.picture.yRange[1] >= 20 && auto.picture.hole, 'auto yRange includes the hole');
  assert.equal(cutHole([[[0, 0], [10, 0], [20, 0], [30, 0]]], [10, 0], 7).length, 2);
  assert.deepEqual(cutHole([[[0, 0], [10, 0]]], null, 7), [[[0, 0], [10, 0]]]);
});

test('point labels: written beside each dot in the series colour, clear of every dot, inside the slot; flat → first point series, arrays → per series', () => {
  const e = fixtureScene('fx-type-plot', 's005').elements[0];
  const d = prep(e);
  const s = d.picture.series[0];
  assert.deepEqual(s.dots.map((p) => p.label), ['A', 'B', 'C', 'D']);
  const dotRects = s.dots.map((p) => ({ x: p.x - 4, y: p.y - 4, w: 8, h: 8 }));
  const slot = slotRect(e.slot);
  for (const [i, p] of s.dots.entries()) {
    assert.ok(rectInside(slot, p.labelBox, 0.5), `label ${p.label} inside the slot`);
    for (const [j, r] of dotRects.entries()) assert.ok(!rectsIntersect(r, p.labelBox), `label ${p.label} clear of dot ${j}`);
    for (const [j, q] of s.dots.entries()) if (j !== i) assert.ok(!rectsIntersect(q.labelBox, p.labelBox), `labels ${p.label} and ${q.label} do not overlap`);
    assert.ok(Math.hypot(p.labelBox.x + p.labelBox.w / 2 - p.x, p.labelBox.y + p.labelBox.h / 2 - p.y) < 40, `label ${p.label} is beside its dot`);
  }
  // every label stroke (glyph fill) in the series part is in the series colour
  assert.ok(d.strokeInfo.filter((st) => st.mode === 'fill' && st.color === tokens.accent2).length >= 4 + 4, 'four dots and four glyph labels in accent2');
  assert.ok(insideSlot(d, e.slot));
  // the dots are drawn before their labels: tip at the end of the series part is in the last label box
  const tip = d.tipAt(1);
  assert.ok(rectInside(s.dots[3].labelBox, { x: tip.x, y: tip.y, w: 0, h: 0 }, 2));
  // per-series arrays are aligned with series[] (the fn field is not a series entry and takes no labels)
  const two = prep(el({ fn: 'x', series: [[[1, 1], [2, 2]]], labels: [['P', 'Q']], xRange: [0, 3], yRange: [0, 3] }));
  assert.deepEqual(two.picture.series[1].dots.map((p) => p.label), ['P', 'Q']);
  assert.deepEqual(two.picture.series[0].dots, []);
  const three = prep(el({ series: [[[1, 1]], 'x', [[2, 2], [3, 3]]], labels: [['P'], [], ['Q', 'R']], xRange: [0, 4], yRange: [0, 4] }));
  assert.deepEqual(three.picture.series.map((s) => s.dots.map((p) => p.label)), [['P'], [], ['Q', 'R']]);
  // fewer labels than points: the rest stay unlabelled; a flat list skips the fn and labels the first point series
  const flat = prep(el({ fn: 'x', series: [[[1, 1], [2, 2], [3, 1]]], labels: ['A'], xRange: [0, 4], yRange: [0, 4] }));
  assert.deepEqual(flat.picture.series[1].dots.map((p) => p.label), ['A', null, null]);
  // a label crowded against the slot edge still lands inside it
  const edge = prep(el({ series: [[[4, 4], [0, 0]]], labels: ['top right', 'origin'], xRange: [0, 4], yRange: [0, 4], slot: 'A1:B2' }));
  for (const p of edge.picture.series[0].dots) assert.ok(rectInside(slotRect('A1:B2'), p.labelBox, 0.5), `${p.label} inside`);
  assert.ok(insideSlot(edge, 'A1:B2'));
});

test('axis names: x / y by default, xLabel / yLabel when given, hand-written in chalk at the positive ends (after the ticks, before the curve)', () => {
  const dflt = prep(el({ fn: 'x', xRange: [0, 4], yRange: [0, 4] }));
  assert.equal(dflt.picture.names.x, 'x');
  assert.equal(dflt.picture.names.y, 'y');
  const e = fixtureScene('fx-type-plot', 's005').elements[0];
  const d = prep(e);
  const { x, y, xBox, yBox } = d.picture.names;
  assert.equal(x, 'time');
  assert.equal(y, 'price');
  const a = d.picture.area;
  assert.ok(xBox.x >= a.x + a.w, 'x name to the right of the x axis end');
  assert.ok(xBox.y < d.picture.axes.xAxisY && xBox.y + xBox.h > d.picture.axes.xAxisY, 'x name on the axis line');
  assert.ok(yBox.y < a.y + 4, 'y name at the top of the y axis');
  assert.ok(yBox.x >= d.picture.axes.yAxisX, 'y name to the right of the y axis');
  const k = kinds(d);
  assert.equal(k.indexOf('names'), k.lastIndexOf('tick') + 1);
  assert.equal(k[k.indexOf('names') + 1], 'series');
  for (const box of [xBox, yBox]) assert.ok(rectInside(slotRect(e.slot), box, 0.5));
  // names never collide with the tick numbers or the plot label
  const boxes = [...d.picture.tickLabels];
  for (const box of [xBox, yBox]) for (const t of boxes) assert.ok(!rectsIntersect(box, t), `${JSON.stringify(box)} vs tick ${JSON.stringify(t)}`);
  const titled = prep(el({ fn: 'x^2', xRange: [-3, 3], yRange: [0, 10], label: 'y = x squared', yLabel: 'f of x' }));
  assert.ok(!rectsIntersect(titled.picture.names.yBox, titled.picture.labelBox));
  // the y name moves to the left of the axis when the axis hugs the right edge (all-negative x)
  const neg = prep(el({ fn: 'x', xRange: [-4, -1], yRange: [0, 4] }));
  assert.ok(neg.picture.names.yBox.x + neg.picture.names.yBox.w <= neg.picture.axes.yAxisX);
  assert.ok(insideSlot(neg, 'A1:C3'));
});

test('validator: hole, labels, xLabel and yLabel are additive and checked (BAD_FIELD / CAP_WORDS); the new fixture scenes pass', async () => {
  await prepareValidator();
  const scene = (plot) => ({
    schema: 'khan-scene/1', lessonId: 'fx-type-plot', sceneId: 's001', narration: 'A plot with the new Sal style fields on it, checked by the validator for every rule.',
    board: { mode: 'wipe' }, elements: [{ id: 'p', type: 'plot', slot: 'A1:C3', xRange: [0, 4], yRange: [0, 4], ...plot }],
  });
  const run = async (plot) => validateScene(scene(plot), createOccupancy(), { lessonId: 'fx-type-plot' });
  const codes = (r) => r.errors.map((e) => e.code);
  assert.ok((await run({ fn: 'x', hole: [1, 1], xLabel: 'time', yLabel: 'price' })).ok);
  assert.ok((await run({ series: [[[1, 1], [2, 2]]], labels: ['A', 'B'] })).ok);
  assert.ok((await run({ fn: 'x', series: [[[1, 1], [2, 2]]], labels: [['A']] })).ok, 'per-series arrays align with series[]');
  assert.ok((await run({ series: ['x', [[1, 1], [2, 2]]], labels: [[], ['A', 'B']] })).ok, 'an expression entry takes an empty array');
  assert.ok(codes(await run({ series: ['x', [[1, 1]]], labels: [['A'], []] })).includes('BAD_FIELD'), 'labels on an expression entry');
  assert.ok((await run({ fn: 'x', hole: [1, 99] })).ok === false && codes(await run({ fn: 'x', hole: [1, 99] })).includes('BAD_FIELD'), 'hole y outside yRange');
  assert.ok(codes(await run({ fn: 'x', hole: [9, 1] })).includes('BAD_FIELD'), 'hole x outside xRange');
  assert.ok(codes(await run({ fn: 'x', hole: [1] })).includes('BAD_FIELD'), 'hole must be a pair');
  assert.ok(codes(await run({ fn: 'x', hole: ['1', '2'] })).includes('BAD_FIELD'), 'hole must be numbers');
  assert.ok(codes(await run({ fn: 'x', xLabel: 'time since the start' })).includes('CAP_WORDS'), 'xLabel ≤ 2 words');
  assert.ok(codes(await run({ fn: 'x', yLabel: 3 })).includes('BAD_FIELD'), 'yLabel must be a string');
  assert.ok(codes(await run({ series: [[[1, 1], [2, 2]]], labels: ['A', 'B', 'C'] })).includes('BAD_FIELD'), 'no more labels than points');
  assert.ok(codes(await run({ series: [[[1, 1], [2, 2]]], labels: ['the very first point', 'B'] })).includes('CAP_WORDS'), 'label ≤ 3 words');
  assert.ok(codes(await run({ fn: 'x', labels: ['A'] })).includes('BAD_FIELD'), 'labels need a point series');
  assert.ok(codes(await run({ fn: 'x', series: [[[1, 1]]], labels: [['A'], ['B']] })).includes('BAD_FIELD'), 'labels for an expression series');
  assert.ok(codes(await run({ series: [[[1, 1]]], labels: 'A' })).includes('BAD_FIELD'), 'labels must be an array');
  // a hole without an explicit yRange is checked against xRange only (the renderer makes room for y)
  const noY = scene({ fn: 'x', hole: [2, 50] }); delete noY.elements[0].yRange;
  assert.ok((await validateScene(noY, createOccupancy(), { lessonId: 'fx-type-plot' })).ok);
  for (const id of ['s004', 's005']) {
    const r = await validateScene(fixtureScene('fx-type-plot', id), createOccupancy(), { lessonId: 'fx-type-plot' });
    assert.ok(r.ok, `${id}: ${JSON.stringify(r.errors)}`);
  }
});

// ---------- qa/04 finding 4: the last tick number no longer crowds the arrowhead ----------

/** Bounding boxes of the arrowheads at the positive ends. */
const positiveArrowRects = (d) => {
  const { xAxisY, yAxisX, xEnd, yEnd } = d.picture.axes;
  return {
    x: { x: xEnd - ARROW_LEN, y: xAxisY - ARROW_HALF_W, w: ARROW_LEN, h: 2 * ARROW_HALF_W },
    y: { x: yAxisX - ARROW_HALF_W, y: yEnd, w: 2 * ARROW_HALF_W, h: ARROW_LEN },
  };
};

test('tick crowding: a tick number at the positive end of an axis is kept, and the axis runs on past it so the arrowhead clears the number by LABEL_GAP; a clear tick leaves the axis alone', () => {
  // the helper: no overshoot when the tick is far from the end; exactly enough when it sits on the end
  assert.equal(axisOvershoot(0.5, 400, 24), 0);
  assert.ok(Math.abs(axisOvershoot(0, 400, 24) - (12 + LABEL_GAP + ARROW_LEN)) < 1e-9);
  assert.equal(axisOvershoot(1, 400, 24), 0);
  assert.equal(axisOvershoot(NaN, 400, 24), 0);
  // ticks 1..4 on both axes end on the range end (fx-type-plot s004-like): both axes are nudged
  const d = prep(el({ fn: 'x', xRange: [0, 4], yRange: [0, 4] }));
  const a = d.picture.area;
  const { xEnd, yEnd, overshoot } = d.picture.axes;
  assert.deepEqual(d.picture.ticks.x.map((t) => t.value), [1, 2, 3, 4]);
  assert.deepEqual(d.picture.ticks.y.map((t) => t.value), [1, 2, 3, 4]);
  assert.ok(overshoot.x > 0 && overshoot.y > 0, `overshoot ${JSON.stringify(overshoot)}`);
  assert.ok(Math.abs(xEnd - (a.x + a.w + overshoot.x)) < 1e-9);
  assert.ok(Math.abs(yEnd - (a.y - overshoot.y)) < 1e-9);
  const lastX = d.picture.ticks.x.at(-1), lastY = d.picture.ticks.y.at(-1);
  assert.ok(lastX.box && lastY.box, 'the end ticks keep their numbers');
  assert.ok(xEnd - ARROW_LEN >= lastX.box.x + lastX.box.w + LABEL_GAP - 1e-6, 'x arrowhead base clears the last x number');
  assert.ok(yEnd + ARROW_LEN <= lastY.box.y - LABEL_GAP + 1e-6, 'y arrowhead base clears the last y number');
  // the axis names moved with the tips, and everything is still inside the slot
  assert.ok(d.picture.names.xBox.x >= xEnd + LABEL_GAP - 1e-6);
  assert.ok(d.picture.names.yBox.y < yEnd + 4);
  assert.ok(insideSlot(d, 'A1:C3'));
  // the parts' meta `to` is the tip; the pen ends the axis stroke there
  const [px, py] = d.picture.partKinds.map((k, i) => i).slice(0, 2);
  assert.equal(px, 0); assert.equal(py, 1);
  // x ticks −2 / 2 inside [−3, 3] are far from the ends: no x overshoot; y ticks end on 10: y nudged
  const clear = prep(el({ fn: 'x^2', xRange: [-3, 3], yRange: [0, 10] }));
  assert.equal(clear.picture.axes.overshoot.x, 0);
  assert.ok(Math.abs(clear.picture.axes.xEnd - (clear.picture.area.x + clear.picture.area.w)) < 1e-9);
  assert.ok(clear.picture.axes.overshoot.y > 0);
  // every tick number of the plot fixtures (s001 "10" vs the y arrow, s004 "4" / "5", s005 "4") is at least LABEL_GAP clear of the positive arrowheads
  for (const sceneId of ['s001', 's002', 's003', 's004', 's005']) {
    const e = fixtureScene('fx-type-plot', sceneId).elements[0];
    const dd = prep(e);
    const arrows = positiveArrowRects(dd);
    for (const box of dd.picture.tickLabels) {
      for (const k of ['x', 'y']) assert.ok(rectsDistance(box, arrows[k]) >= LABEL_GAP - 1e-6, `${sceneId}: tick ${JSON.stringify(box)} vs ${k} arrowhead ${JSON.stringify(arrows[k])}`);
    }
    for (const box of [dd.picture.names.xBox, dd.picture.names.yBox]) for (const t of dd.picture.tickLabels) assert.ok(!rectsIntersect(box, t));
    assert.ok(insideSlot(dd, e.slot));
  }
});
