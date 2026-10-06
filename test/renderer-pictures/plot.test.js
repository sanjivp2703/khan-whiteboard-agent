// Slice 03 — `plot` drawable (brief 03 criterion 7 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparePlot } from '../../player/renderer/pictures/index.js';
import { formatNum, autoYRange, splitRuns } from '../../player/renderer/pictures/plot.js';
import { seriesToken } from '../../player/renderer/pictures/common.js';
import { slotRect } from '../../shared/layout-core/grid.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { ensureFont, ctxFor, insideSlot, rectInside, REPO_ROOT } from './helpers.js';

before(ensureFont);

const el = (overrides) => ({ id: 'pl', type: 'plot', slot: 'A1:C3', ...overrides });
const prep = (e) => preparePlot(e, ctxFor([e]));
const fixtureScene = (lesson, scene) => JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', 'lessons', lesson, 'scenes', `${scene}.json`), 'utf8'));

test('axes are the first part; tick labels are hand-written and inside the slot; the label sits top-right inside the slot', () => {
  const e = el({ fn: 'x^2', xRange: [-3, 3], yRange: [0, 10], label: 'y = x squared', color: 'accent1' });
  const d = prep(e);
  assert.equal(d.picture.partKinds[0], 'axes');
  assert.equal(d.parts, 2);
  const slot = slotRect(e.slot);
  assert.equal(d.picture.tickLabels.length, 4);
  for (const box of d.picture.tickLabels) assert.ok(rectInside(slot, box, 0.5), `tick label ${JSON.stringify(box)} inside slot`);
  const lb = d.picture.labelBox;
  assert.ok(lb && rectInside(slot, lb, 0.5));
  assert.ok(lb.x + lb.w > slot.x + slot.w * 0.6, 'label is on the right');
  assert.ok(lb.y < slot.y + slot.h * 0.2, 'label is at the top');
  // axes part contains fill (glyph) strokes and line strokes
  const axesStrokes = d.revealAt(1 / d.parts - 1e-9).complete;
  assert.ok(axesStrokes >= 6 + 4, 'two axes, four ticks and at least four glyphs');
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

test('fn + two series = three series = four parts (fixture fx-type-plot s002); fifty-point series draws fifty points', () => {
  const e = fixtureScene('fx-type-plot', 's002').elements[0];
  const d = prep(e);
  assert.equal(d.parts, 4);
  assert.deepEqual(d.picture.partKinds, ['axes', 'series', 'series', 'series']);
  assert.equal(d.picture.series[1].pointCount, 50);
  assert.deepEqual(d.picture.series[1].runs.map((r) => r.length), [50]);
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

test('a series with one point draws a dot; default ranges are [-10, 10] and data-driven y', () => {
  const d = prep(el({ series: [[[1, 2]]], xRange: [0, 2] }));
  assert.equal(d.parts, 2);
  assert.deepEqual(d.picture.series[0].runs.map((r) => r.length), [1]);
  assert.ok(d.revealAt(1).complete > d.revealAt(1 / 2 - 1e-9).complete, 'the dot is a stroke of its own');
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
