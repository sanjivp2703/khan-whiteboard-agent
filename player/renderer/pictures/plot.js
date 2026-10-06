// player/renderer/pictures/plot.js — `plot` drawable: axes first (rough lines, end ticks,
// hand-written min/max labels), then each fn/series as a rough polyline drawn left to right.
//
// Colours: series 0 uses the element colour; series k > 0 rotate through the accents starting
// after the element's accent (common.seriesToken). Axes, ticks and tick labels are chalk; the
// optional `label` is written top-right in the element colour.
import { CAPS } from '../../../shared/layout-core/constants.js';
import { parse as parseExpr, evaluate } from '../../../shared/expr.js';
import { measure } from '../../../shared/handwriting.js';
import {
  pictureRects, roughFor, tokenColor, seriesToken, roughStrokes, writeAt, buildDrawable,
} from './common.js';

const DEFAULT_X_RANGE = [-10, 10];
const TICK = 8;
const LABEL_GAP = 6;
const TOP_RESERVE = 16;      // room for the top y label when no element label
const BOTTOM_RESERVE = 38;   // x labels below the plot area
const RIGHT_RESERVE = 8;
/** A jump between adjacent samples that changes sign and exceeds this fraction of the y span is an asymptote. */
const ASYMPTOTE_FRACTION = 0.25;
const DOT_DIAMETER = 6;

/** Compact number formatting for tick labels (3 significant digits, no trailing zeros). */
export function formatNum(v) {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  const s = parseFloat(v.toPrecision(3)).toString();
  return s === '-0' ? '0' : s;
}

/** Sample an expression at CAPS.plotSamples evenly spaced x over xRange. */
export function sampleFn(src, xRange, n = CAPS.plotSamples) {
  const ast = parseExpr(src);
  const [min, max] = xRange;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = min + ((max - min) * i) / (n - 1);
    pts.push([x, evaluate(ast, x)]);
  }
  return pts;
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

/** prepare(element, ctx) for `plot`. */
export function preparePlot(element, ctx) {
  const { inner, safe, outer } = pictureRects(element.slot);
  const r = roughFor(ctx, element);
  const chalk = tokenColor('chalk');
  const elColor = tokenColor(element.color);
  const xRange = Array.isArray(element.xRange) ? element.xRange : DEFAULT_X_RANGE;

  // series definitions in draw order: fn first, then series[] as given
  const defs = [];
  if (typeof element.fn === 'string') defs.push({ kind: 'fn', src: element.fn });
  if (Array.isArray(element.series)) {
    for (const s of element.series) {
      if (typeof s === 'string') defs.push({ kind: 'fn', src: s });
      else if (Array.isArray(s)) defs.push({ kind: 'series', points: s.map((p) => [Number(p[0]), Number(p[1])]) });
    }
  }
  const sampled = defs.map((d) => (d.kind === 'fn' ? sampleFn(d.src, xRange) : d.points));
  const yRange = Array.isArray(element.yRange)
    ? element.yRange
    : autoYRange(sampled.flat().filter((p) => p[0] >= xRange[0] && p[0] <= xRange[1]).map((p) => p[1]));

  // reserve space for labels
  const label = typeof element.label === 'string' && element.label.trim() ? element.label.trim() : null;
  const yLabels = [formatNum(yRange[0]), formatNum(yRange[1])];
  const xLabels = [formatNum(xRange[0]), formatNum(xRange[1])];
  const yLabelW = Math.max(...yLabels.map((t) => measure(t, 'note').width));
  const noteM = measure('Hg', 'note');
  const topReserve = label ? noteM.ascent + noteM.descent + LABEL_GAP + 4 : TOP_RESERVE;
  const area = {
    x: safe.x + yLabelW + TICK / 2 + LABEL_GAP + 4,
    y: safe.y + topReserve,
    w: 0, h: 0,
  };
  area.w = Math.max(20, safe.x + safe.w - RIGHT_RESERVE - area.x);
  area.h = Math.max(20, safe.y + safe.h - BOTTOM_RESERVE - area.y);

  const xToPx = (x) => area.x + ((x - xRange[0]) / (xRange[1] - xRange[0])) * area.w;
  const yToPx = (y) => area.y + area.h - ((y - yRange[0]) / (yRange[1] - yRange[0])) * area.h;
  const xAxisY = yRange[0] <= 0 && yRange[1] >= 0 ? yToPx(0) : yRange[1] < 0 ? area.y : area.y + area.h;
  const yAxisX = xRange[0] <= 0 && xRange[1] >= 0 ? xToPx(0) : xRange[1] < 0 ? area.x + area.w : area.x;

  // axes part
  const axes = [];
  axes.push(...roughStrokes(r.line(area.x, xAxisY, area.x + area.w, xAxisY), chalk));
  axes.push(...roughStrokes(r.line(yAxisX, area.y + area.h, yAxisX, area.y), chalk));
  for (const tx of [area.x, area.x + area.w]) axes.push(...roughStrokes(r.line(tx, xAxisY - TICK / 2, tx, xAxisY + TICK / 2), chalk));
  for (const ty of [area.y + area.h, area.y]) axes.push(...roughStrokes(r.line(yAxisX - TICK / 2, ty, yAxisX + TICK / 2, ty), chalk));
  const tickLabels = [];
  const xBase = xAxisY + TICK / 2 + LABEL_GAP + noteM.ascent;
  const wx0 = writeAt(xLabels[0], 'note', area.x, xBase, chalk, { anchor: 'start' });
  const wx1 = writeAt(xLabels[1], 'note', area.x + area.w, xBase, chalk, { anchor: 'end' });
  const yMid = (noteM.ascent - noteM.descent) / 2;
  const wy0 = writeAt(yLabels[0], 'note', yAxisX - TICK / 2 - LABEL_GAP, area.y + area.h + yMid, chalk, { anchor: 'end' });
  const wy1 = writeAt(yLabels[1], 'note', yAxisX - TICK / 2 - LABEL_GAP, area.y + yMid, chalk, { anchor: 'end' });
  for (const w of [wx0, wx1, wy0, wy1]) { axes.push(...w.strokes); tickLabels.push(w.box); }
  let labelBox = null;
  if (label) {
    const wl = writeAt(label, 'note', safe.x + safe.w, safe.y + noteM.ascent, elColor, { anchor: 'end' });
    // keep it inside the safe rect even for a very long label
    if (wl.box.x < safe.x) {
      const wl2 = writeAt(label, 'note', safe.x, safe.y + noteM.ascent, elColor, { anchor: 'start' });
      axes.push(...wl2.strokes); labelBox = wl2.box;
    } else { axes.push(...wl.strokes); labelBox = wl.box; }
  }
  const parts = [{ kind: 'axes', strokes: axes, meta: { xAxisY, yAxisX, tickLabels, labelBox } }];

  // series parts
  const seriesMeta = [];
  defs.forEach((def, k) => {
    const token = seriesToken(element.color, k);
    const color = tokenColor(token);
    const { runs, dropped } = splitRuns(sampled[k], xRange, yRange);
    const strokes = [];
    const pxRuns = [];
    for (const run of runs) {
      const px = run.map(([x, y]) => [xToPx(x), yToPx(y)]);
      pxRuns.push(px);
      if (px.length >= 2) strokes.push(...roughStrokes(r.linearPath(px), color));
      else strokes.push(...roughStrokes(r.circle(px[0][0], px[0][1], DOT_DIAMETER), color));
    }
    const meta = { kind: def.kind, src: def.src || null, token, runs: pxRuns, dataRuns: runs, pointCount: sampled[k].length, dropped };
    seriesMeta.push(meta);
    parts.push({ kind: 'series', strokes, meta });
  });

  return buildDrawable({
    id: element.id,
    type: 'plot',
    parts,
    fallbackRect: inner,
    picture: { kind: 'plot', area, xRange, yRange: [yRange[0], yRange[1]], autoY: !Array.isArray(element.yRange), axes: { xAxisY, yAxisX }, series: seriesMeta, tickLabels, labelBox, slotRect: outer, safeRect: safe },
  });
}
