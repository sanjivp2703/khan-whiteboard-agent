// player/renderer/pictures/plot.js — `plot` drawable, Sal-style (design/02-khan-video-study.md §2.7,
// §4 item 8). Parts in Sal's order, each a separate gesture so tipAt follows his pen:
//   axis (x line + arrowheads) → axis (y) → one `tick` part per tick (mark + hand-written number,
//   2–5 integer ticks per axis) → `names` (axis names at the ends, plot label) → one `series` part
//   per fn/series (a curve in one sweep left to right; data points as filled dots with optional
//   letter labels) → `hole` (an open circle on the curve, for limits-style graphs).
//
// Colours: series 0 uses the element colour; series k > 0 rotate through the accents starting
// after the element's accent (common.seriesToken). Axes, ticks, numbers and axis names are chalk;
// the optional `label` is written top-right and the hole is drawn in the element colour.
import { CAPS } from '../../../shared/layout-core/constants.js';
import { parse as parseExpr, sample } from '../../../shared/expr.js';
import {
  pictureRects, roughFor, tokenColor, seriesToken, roughStrokes, stroke, writeAt, buildDrawable,
  ellipsePath, polyPath, rectContains, rectsIntersect, labelMeasure as measure,
} from './common.js';

const DEFAULT_X_RANGE = [-10, 10];
const DEFAULT_AXIS_NAMES = Object.freeze({ x: 'x', y: 'y' });
const TICK = 8;                 // tick mark length (centred on the axis)
const LABEL_GAP = 6;
const ARROW_LEN = 12;           // arrowhead wing length along the axis
const ARROW_HALF_W = 6;         // arrowhead half width across the axis
/** A jump between adjacent samples that changes sign and exceeds this fraction of the y span is an asymptote. */
const ASYMPTOTE_FRACTION = 0.25;
const DOT_DIAMETER = 8;         // filled data point
const HOLE_DIAMETER = 12;       // open circle
const POINT_LABEL_GAP = 3;
export const TICKS_MIN = 2;
export const TICKS_MAX = 5;

/** Compact number formatting for tick labels (3 significant digits, no trailing zeros). */
export function formatNum(v) {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  const s = parseFloat(v.toPrecision(3)).toString();
  return s === '-0' ? '0' : s;
}

/** Sample an expression at CAPS.plotSamples evenly spaced x over xRange (shared/expr.sample). */
export function sampleFn(src, xRange, n = CAPS.plotSamples) {
  return sample(parseExpr(src), xRange, n).map((p) => [p.x, p.y]);
}

/** Auto y range from finite data with 10 % padding (flat data gets ±1 or ±10 %). */
export function autoYRange(ys) {
  const finite = ys.filter((y) => Number.isFinite(y));
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite), hi = Math.max(...finite);
  if (hi - lo < 1e-9) { const pad = Math.max(1, Math.abs(lo) * 0.1); return [lo - pad, hi + pad]; }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/**
 * Sal's ticks: 2–5 values per axis at a "nice" step (1, 2, 5 × 10^k), integers whenever the range
 * holds at least two of them, never 0 (the origin is where the axes cross and is left unlabelled).
 * Ranges too narrow for two integers fall back to the largest fractional nice step (0.5, 0.2, 0.1, …)
 * that yields at least two ticks. Deterministic and pixel-free: it depends on the range only.
 */
export function chooseTicks(lo, hi, { min = TICKS_MIN, max = TICKS_MAX } = {}) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const eps = span * 1e-9;
  const multiples = (step) => {
    const out = [];
    for (let k = Math.ceil((lo - eps) / step); k <= Math.floor((hi + eps) / step); k++) {
      if (k === 0) continue;
      out.push(parseFloat((k * step).toPrecision(12)));
    }
    return out;
  };
  // integer nice steps, ascending: the smallest step that keeps the count within the cap wins;
  // if even that step gives too few ticks the range is narrower than two integers → fractions
  integers: for (let e = 0; e < 15; e++) {
    for (const m of [1, 2, 5]) {
      const t = multiples(m * 10 ** e);
      if (t.length > max) continue;
      if (t.length >= min) return t;
      break integers;
    }
  }
  let best = [];
  for (let e = 1; e < 9; e++) {
    for (const m of [5, 2, 1]) {
      const t = multiples(m / 10 ** e);
      if (t.length > max) return best;
      best = t;
      if (t.length >= min) return t;
    }
  }
  return best;
}

/**
 * Split points into drawable runs: non-finite or out-of-range points break the line (and are not
 * drawn); so does a sign-changing jump larger than ASYMPTOTE_FRACTION of the y span.
 */
export function splitRuns(points, xRange, yRange) {
  const [x0, x1] = xRange, [y0, y1] = yRange;
  const span = y1 - y0;
  const eps = 1e-9;
  const inside = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= x0 - eps && p[0] <= x1 + eps && p[1] >= y0 - eps && p[1] <= y1 + eps;
  const runs = [];
  let cur = [];
  let dropped = 0;
  for (const p of points) {
    if (!inside(p)) { dropped++; if (cur.length) runs.push(cur); cur = []; continue; }
    if (cur.length) {
      const q = cur[cur.length - 1];
      if (q[1] * p[1] < 0 && Math.abs(p[1] - q[1]) > ASYMPTOTE_FRACTION * span) { runs.push(cur); cur = []; }
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return { runs, dropped };
}

/** Break pixel runs around a hole so the open circle sits in a gap of the curve. */
export function cutHole(pxRuns, hole, radius) {
  if (!hole) return pxRuns;
  const out = [];
  for (const run of pxRuns) {
    let cur = [];
    for (const p of run) {
      if (Math.hypot(p[0] - hole[0], p[1] - hole[1]) <= radius) { if (cur.length) out.push(cur); cur = []; continue; }
      cur.push(p);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** Arrowhead at `tip` pointing along the unit direction (dx, dy): one open "V" stroke. */
function arrowhead(r, tip, dx, dy, color) {
  const [tx, ty] = tip;
  const bx = tx - dx * ARROW_LEN, by = ty - dy * ARROW_LEN;   // base point on the axis
  const px = -dy * ARROW_HALF_W, py = dx * ARROW_HALF_W;      // perpendicular half width
  return roughStrokes(r.linearPath([[bx + px, by + py], [tx, ty], [bx - px, by - py]]), color);
}

/**
 * Normalise `labels` per def: a flat array labels the first point series; an array of arrays is
 * aligned with `series[]` (the `fn` field is not a `series[]` entry, so it never takes labels).
 */
function pointLabelsFor(labels, defs, hasFn) {
  const out = defs.map(() => []);
  if (!Array.isArray(labels) || !labels.length) return out;
  if (labels.every((l) => typeof l === 'string')) {
    const k = defs.findIndex((d) => d.kind === 'series');
    if (k >= 0) out[k] = labels.slice();
    return out;
  }
  const offset = hasFn ? 1 : 0;
  labels.forEach((l, k) => { if (Array.isArray(l) && offset + k < defs.length) out[offset + k] = l.filter((s) => typeof s === 'string'); });
  return out;
}

/** prepare(element, ctx) for `plot`. */
export function preparePlot(element, ctx) {
  const { inner, safe, outer } = pictureRects(element.slot);
  const r = roughFor(ctx, element);
  const chalk = tokenColor('chalk');
  const elColor = tokenColor(element.color);
  const xRange = Array.isArray(element.xRange) ? element.xRange : DEFAULT_X_RANGE;
  const hole = Array.isArray(element.hole) && element.hole.length === 2 && element.hole.every(Number.isFinite) ? [element.hole[0], element.hole[1]] : null;
  const names = {
    x: typeof element.xLabel === 'string' && element.xLabel.trim() ? element.xLabel.trim() : DEFAULT_AXIS_NAMES.x,
    y: typeof element.yLabel === 'string' && element.yLabel.trim() ? element.yLabel.trim() : DEFAULT_AXIS_NAMES.y,
  };

  // series definitions in draw order: fn first, then series[] as given
  const defs = [];
  if (typeof element.fn === 'string') defs.push({ kind: 'fn', src: element.fn });
  if (Array.isArray(element.series)) {
    for (const s of element.series) {
      if (typeof s === 'string') defs.push({ kind: 'fn', src: s });
      else if (Array.isArray(s)) defs.push({ kind: 'series', points: s.map((p) => [Number(p[0]), Number(p[1])]) });
    }
  }
  const pointLabels = pointLabelsFor(element.labels, defs, typeof element.fn === 'string');
  const sampled = defs.map((d) => (d.kind === 'fn' ? sampleFn(d.src, xRange) : d.points));
  const yRange = Array.isArray(element.yRange)
    ? element.yRange
    : autoYRange(sampled.flat().filter((p) => p[0] >= xRange[0] && p[0] <= xRange[1]).map((p) => p[1]).concat(hole ? [hole[1]] : []));

  // ---- layout: ticks and names decide the reserves around the plot area ----
  const label = typeof element.label === 'string' && element.label.trim() ? element.label.trim() : null;
  const xTicks = chooseTicks(xRange[0], xRange[1]);
  const yTicks = chooseTicks(yRange[0], yRange[1]);
  const noteM = measure('Hg', 'note');
  const noteH = noteM.ascent + noteM.descent;
  const yMid = (noteM.ascent - noteM.descent) / 2;
  const widest = (vals) => Math.max(0, ...vals.map((v) => measure(formatNum(v), 'note').width));
  const yLabelW = widest(yTicks);
  const xLabelW = widest(xTicks);
  const xNameW = measure(names.x, 'note').width;
  const yNameW = measure(names.y, 'note').width;
  const yAxisAtLeft = xRange[0] >= 0;
  const yAxisAtRight = xRange[1] <= 0;
  const leftReserve = Math.max(yAxisAtLeft ? yLabelW + TICK / 2 + LABEL_GAP + 2 : 0, yAxisAtRight ? 0 : xLabelW / 2 + 2);
  const rightReserve = Math.max(xNameW + LABEL_GAP + 2, xLabelW / 2 + 2, yAxisAtRight ? 0 : yNameW + TICK + 2);
  const topReserve = (label ? noteH + LABEL_GAP : 0) + noteH / 2 + 4;
  const bottomReserve = TICK / 2 + LABEL_GAP + noteH + 2;
  const area = { x: safe.x + leftReserve, y: safe.y + topReserve, w: 0, h: 0 };
  area.w = Math.max(20, safe.x + safe.w - rightReserve - area.x);
  area.h = Math.max(20, safe.y + safe.h - bottomReserve - area.y);

  const xToPx = (x) => area.x + ((x - xRange[0]) / (xRange[1] - xRange[0])) * area.w;
  const yToPx = (y) => area.y + area.h - ((y - yRange[0]) / (yRange[1] - yRange[0])) * area.h;
  const xAxisY = yRange[0] <= 0 && yRange[1] >= 0 ? yToPx(0) : yRange[1] < 0 ? area.y : area.y + area.h;
  const yAxisX = xRange[0] <= 0 && xRange[1] >= 0 ? xToPx(0) : xRange[1] < 0 ? area.x + area.w : area.x;

  // ---- axes: two separate strokes, each with its own arrowhead(s) ----
  const xAxis = roughStrokes(r.line(area.x, xAxisY, area.x + area.w, xAxisY), chalk);
  const xArrows = ['+x'];
  xAxis.push(...arrowhead(r, [area.x + area.w, xAxisY], 1, 0, chalk));
  if (xRange[0] < 0 && xRange[1] > 0) { xAxis.push(...arrowhead(r, [area.x, xAxisY], -1, 0, chalk)); xArrows.push('-x'); }
  const yAxis = roughStrokes(r.line(yAxisX, area.y + area.h, yAxisX, area.y), chalk);
  const yArrows = ['+y'];
  yAxis.push(...arrowhead(r, [yAxisX, area.y], 0, -1, chalk));
  if (yRange[0] < 0 && yRange[1] > 0) { yAxis.push(...arrowhead(r, [yAxisX, area.y + area.h], 0, 1, chalk)); yArrows.push('-y'); }
  const parts = [
    { kind: 'axis', strokes: xAxis, meta: { axis: 'x', y: xAxisY, from: area.x, to: area.x + area.w, arrowheads: xArrows } },
    { kind: 'axis', strokes: yAxis, meta: { axis: 'y', x: yAxisX, from: area.y + area.h, to: area.y, arrowheads: yArrows } },
  ];

  // ---- ticks: one part each (mark, then the number) ----
  const tickLabels = [];
  const ticks = { x: [], y: [] };
  for (const v of xTicks) {
    const tx = xToPx(v);
    const strokes = roughStrokes(r.line(tx, xAxisY - TICK / 2, tx, xAxisY + TICK / 2), chalk);
    const w = writeAt(formatNum(v), 'note', tx, xAxisY + TICK / 2 + LABEL_GAP + noteM.ascent, chalk, { anchor: 'middle' });
    strokes.push(...w.strokes);
    tickLabels.push(w.box);
    ticks.x.push({ value: v, px: tx, box: w.box });
    parts.push({ kind: 'tick', strokes, meta: { axis: 'x', value: v, px: tx, box: w.box } });
  }
  for (const v of yTicks) {
    const ty = yToPx(v);
    const strokes = roughStrokes(r.line(yAxisX - TICK / 2, ty, yAxisX + TICK / 2, ty), chalk);
    const w = writeAt(formatNum(v), 'note', yAxisX - TICK / 2 - LABEL_GAP, ty + yMid, chalk, { anchor: 'end' });
    strokes.push(...w.strokes);
    tickLabels.push(w.box);
    ticks.y.push({ value: v, px: ty, box: w.box });
    parts.push({ kind: 'tick', strokes, meta: { axis: 'y', value: v, px: ty, box: w.box } });
  }

  // ---- names: axis names at the positive ends, then the plot label top-right ----
  const nameStrokes = [];
  const wx = writeAt(names.x, 'note', area.x + area.w + LABEL_GAP, xAxisY + yMid, chalk, { anchor: 'start' });
  const wy = yAxisAtRight
    ? writeAt(names.y, 'note', yAxisX - TICK, area.y + yMid, chalk, { anchor: 'end' })
    : writeAt(names.y, 'note', yAxisX + TICK, area.y + yMid, chalk, { anchor: 'start' });
  nameStrokes.push(...wx.strokes, ...wy.strokes);
  let labelBox = null;
  if (label) {
    const wl = writeAt(label, 'note', safe.x + safe.w, safe.y + noteM.ascent, elColor, { anchor: 'end' });
    // keep it inside the safe rect even for a very long label
    if (wl.box.x < safe.x) {
      const wl2 = writeAt(label, 'note', safe.x, safe.y + noteM.ascent, elColor, { anchor: 'start' });
      nameStrokes.push(...wl2.strokes); labelBox = wl2.box;
    } else { nameStrokes.push(...wl.strokes); labelBox = wl.box; }
  }
  const namesMeta = { x: names.x, y: names.y, xBox: wx.box, yBox: wy.box, labelBox };
  parts.push({ kind: 'names', strokes: nameStrokes, meta: namesMeta });

  // ---- series: curves in one sweep, points as dots with labels beside ----
  const holePx = hole && hole[0] >= xRange[0] && hole[0] <= xRange[1] && hole[1] >= yRange[0] && hole[1] <= yRange[1]
    ? [xToPx(hole[0]), yToPx(hole[1])] : null;
  const seriesMeta = [];
  const dotRect = (p) => ({ x: p[0] - DOT_DIAMETER / 2, y: p[1] - DOT_DIAMETER / 2, w: DOT_DIAMETER, h: DOT_DIAMETER });
  defs.forEach((def, k) => {
    const token = seriesToken(element.color, k);
    const color = tokenColor(token);
    const { runs, dropped } = splitRuns(sampled[k], xRange, yRange);
    const strokes = [];
    let pxRuns = runs.map((run) => run.map(([x, y]) => [xToPx(x), yToPx(y)]));
    const dots = [];
    if (def.kind === 'fn') {
      pxRuns = cutHole(pxRuns, holePx, HOLE_DIAMETER / 2 + 1);
      for (const px of pxRuns) {
        if (px.length >= 2) strokes.push(...roughStrokes(r.linearPath(px), color));
        else strokes.push(stroke(ellipsePath(px[0][0], px[0][1], DOT_DIAMETER / 2, DOT_DIAMETER / 2), color, { mode: 'fill' }));
      }
    } else {
      const pts = pxRuns.flat();
      const labels = pointLabels[k];
      const obstacles = pts.map(dotRect);
      pts.forEach((p, i) => {
        strokes.push(stroke(ellipsePath(p[0], p[1], DOT_DIAMETER / 2, DOT_DIAMETER / 2), color, { mode: 'fill' }));
        const dot = { x: p[0], y: p[1], label: null, labelBox: null };
        const text = typeof labels[i] === 'string' && labels[i].trim() ? labels[i].trim() : null;
        if (text) {
          const rr = DOT_DIAMETER / 2 + POINT_LABEL_GAP;
          const candidates = [
            { ax: p[0] + rr, base: p[1] - rr, anchor: 'start' },                 // above right
            { ax: p[0] - rr, base: p[1] - rr, anchor: 'end' },                   // above left
            { ax: p[0] + rr, base: p[1] + rr + noteM.ascent, anchor: 'start' },  // below right
            { ax: p[0] - rr, base: p[1] + rr + noteM.ascent, anchor: 'end' },    // below left
          ];
          let chosen = null;
          for (const c of candidates) {
            const w = writeAt(text, 'note', c.ax, c.base, color, { anchor: c.anchor });
            const clear = rectContains(safe, w.box) && !obstacles.some((o) => rectsIntersect(o, w.box));
            if (clear) { chosen = w; break; }
            if (!chosen) chosen = w;
          }
          strokes.push(...chosen.strokes);
          dot.label = text; dot.labelBox = chosen.box;
          obstacles.push(chosen.box);
        }
        dots.push(dot);
      });
    }
    const meta = { kind: def.kind, src: def.src || null, token, runs: pxRuns, dataRuns: runs, pointCount: sampled[k].length, dropped, dots };
    seriesMeta.push(meta);
    parts.push({ kind: 'series', strokes, meta });
  });

  // ---- hole: an open circle, last ----
  let holeMeta = null;
  if (holePx) {
    const strokes = roughStrokes(r.circle(holePx[0], holePx[1], HOLE_DIAMETER), elColor);
    holeMeta = { x: hole[0], y: hole[1], px: holePx[0], py: holePx[1], box: { x: holePx[0] - HOLE_DIAMETER / 2, y: holePx[1] - HOLE_DIAMETER / 2, w: HOLE_DIAMETER, h: HOLE_DIAMETER } };
    parts.push({ kind: 'hole', strokes, meta: holeMeta });
  }

  return buildDrawable({
    id: element.id,
    type: 'plot',
    parts,
    fallbackRect: inner,
    picture: {
      kind: 'plot', area, xRange, yRange: [yRange[0], yRange[1]], autoY: !Array.isArray(element.yRange),
      axes: { xAxisY, yAxisX, arrowheads: { x: xArrows, y: yArrows } }, ticks, tickLabels, names: namesMeta, labelBox,
      series: seriesMeta, hole: holeMeta, slotRect: outer, safeRect: safe,
    },
  });
}
