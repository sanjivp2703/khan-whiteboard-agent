// player/renderer/core/drawable.js — shared machinery for the core drawables (slice 02).
// Pure and DOM-free except Drawable.paint. A drawable is a list of "strokes" (SVG path
// strings with a style) grouped into parts; `u` maps to parts through partStarts and,
// inside a part, strokes are revealed in order proportionally to their length.
//
// Stroke kinds: 'glyph' (handwriting outline: filled when complete, outlined while in
// progress), 'rough' (rough.js stroke), 'faint' (rough.js stroke, lighter and thinner).
import { flatten, rough, parsePath } from '../../../shared/strokes.js';
import { glyphPaths, textWidth, measure, lineHeight, fontSize, getFont } from '../../../shared/handwriting.js';
import { colorOf, tokens } from '../../../shared/layout-core/tokens.js';
import { PEN_PX_PER_S, ROUGH_OPTIONS, CANVAS_W, CANVAS_H, CODE_CHAR_ADVANCE } from '../../../shared/layout-core/constants.js';
import { rectContainsRect, rectUnion } from '../../../shared/layout-core/grid.js';

/** Wobble envelope (px) a rough stroke is confined to around its ideal geometry. */
export const ROUGH_ENVELOPE = 4;
/** Lines longer than this get their bowing scaled down so the sag stays inside the envelope. */
const BOW_REF_PX = 250;
const FIT_ATTEMPTS = 6;
const EPS = 1e-6;

export const PEN = Object.freeze({
  glyphEdge: 1.0,        // outline width added around a completed, filled glyph
  glyphProgress: 2.2,    // outline width of the glyph currently being written
  rough: ROUGH_OPTIONS.strokeWidth,
  faint: 1.5,
  faintAlpha: 0.55,
});

const BOARD = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

// ---------- geometry helpers ----------

export function expandRect(r, m) {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

export function clampRectInto(r, outer) {
  const x = Math.min(Math.max(r.x, outer.x), outer.x + outer.w - r.w);
  const y = Math.min(Math.max(r.y, outer.y), outer.y + outer.h - r.h);
  return { x, y, w: r.w, h: r.h };
}

export function rectsIntersect(a, b) {
  return !(b.x >= a.x + a.w || b.x + b.w <= a.x || b.y >= a.y + a.h || b.y + b.h <= a.y);
}

/** Bounds of the flattened polyline of a path (what paint actually draws); null if empty. */
export function flatBounds(flat) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of flat) for (const [x, y] of sp.points) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function boundsOfPaths(paths) {
  let b = null;
  for (const d of paths) {
    if (!d) continue;
    const fb = flatBounds(flatten(d));
    if (fb) b = b ? rectUnion(b, fb) : fb;
  }
  return b;
}

const fmt = (v) => Math.round(v * 100) / 100;

/** Serialize absolute segments (from strokes.parsePath) back to a path string. */
export function segmentsToPath(segs) {
  let out = '';
  for (const s of segs) {
    if (s.type === 'Z') { out += 'Z'; continue; }
    const p = s.pts.map(fmt);
    if (s.type === 'M') out += `M${p[0]} ${p[1]}`;
    else if (s.type === 'L') out += `L${p[0]} ${p[1]}`;
    else if (s.type === 'Q') out += `Q${p[0]} ${p[1]} ${p[2]} ${p[3]}`;
    else if (s.type === 'C') out += `C${p[0]} ${p[1]} ${p[2]} ${p[3]} ${p[4]} ${p[5]}`;
  }
  return out;
}

/** Deterministic last resort: clamp every coordinate of a path into a rectangle. */
export function clampPathInto(d, r) {
  const segs = parsePath(d).map((s) => ({
    type: s.type,
    pts: s.pts.map((v, i) => (i % 2 === 0 ? Math.min(Math.max(v, r.x), r.x + r.w) : Math.min(Math.max(v, r.y), r.y + r.h))),
  }));
  return segmentsToPath(segs);
}

// ---------- rough.js helpers (seeded, envelope-confined) ----------

/** Extra rough options for a stroke of length `len`: fixed vertices, sag capped by length. */
export function roughOpts(len) {
  return { preserveVertices: true, bowing: Math.min(1, BOW_REF_PX / Math.max(len, 1)) };
}

export function roughLine(r, x1, y1, x2, y2) {
  return r.line(x1, y1, x2, y2, roughOpts(Math.hypot(x2 - x1, y2 - y1)));
}

export function roughRect(r, x, y, w, h) {
  return r.rectangle(x, y, w, h, roughOpts(Math.max(w, h)));
}

/** Hand-drawn ellipse as a rough curve through sampled points (bounded wobble, unlike rough.ellipse). */
export function roughEllipse(r, cx, cy, w, h) {
  const rx = Math.max(1, w / 2), ry = Math.max(1, h / 2);
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(12, Math.min(48, Math.round(perimeter / 25)));
  const pts = [];
  const start = -Math.PI * 0.6; // begin top-left, like a hand ring
  for (let i = 0; i <= n; i++) {
    const a = start + (2 * Math.PI * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  pts.push([cx + rx * Math.cos(start + 0.35), cy + ry * Math.sin(start + 0.35)]); // small overlap
  return r.curve(pts, { bowing: 0 });
}

/**
 * Generate rough paths that stay inside `envelope`. `make(r)` returns path strings for a
 * seeded rough instance; seeds are retried deterministically and, failing that, coordinates
 * are clamped. Returns the paths.
 */
export function roughFit(seedBase, envelope, make) {
  let first = null;
  for (let k = 0; k < FIT_ATTEMPTS; k++) {
    const r = rough(((seedBase + k * 7919) % 2147483646) + 1);
    const paths = make(r).filter((d) => typeof d === 'string' && d.length > 0);
    const b = boundsOfPaths(paths);
    if (!b || rectContainsRect(envelope, b)) return paths;
    if (!first) first = paths;
  }
  return (first || []).map((d) => clampPathInto(d, envelope));
}

/** Build a 'rough' stroke list (one stroke per path) from paths. */
export function roughStrokes(paths, color, extra = {}) {
  return paths.map((d) => ({ d, kind: extra.kind || 'rough', color, ...extra }));
}

// ---------- handwriting helpers ----------

const descentCache = new Map();
export function styleDescent(style) {
  if (!descentCache.has(style)) descentCache.set(style, measure('x', style).descent);
  return descentCache.get(style);
}

/** Baseline y of a line whose box starts at `top` for a style (descender sits inside the box). */
export function baselineFor(style, top) {
  return top + lineHeight(style) - styleDescent(style);
}

function isMissingGlyph(ch) {
  const f = getFont();
  if (!f) return false;
  const g = f.charToGlyph(ch);
  return !g || g.index === 0;
}

/**
 * Glyph outline for `ch` at (x, baseline) serialized from opentype's command list.
 * handwriting.glyphPaths returns `glyph.getPath().toPathData(2)`, and the vendored
 * opentype.js `roundDecimal` turns some tiny decimal parts (e.g. 1e-13) into NaN through string
 * concatenation, so its `d` can contain "NaN" at larger x (reported as a foundation/vendor gap).
 * Same geometry, same placement (x from glyphPaths, incl. the code-style centring), safe numbers.
 */
export function glyphOutline(ch, style, x, baseline) {
  const f = getFont();
  if (!f) return '';
  const glyph = f.charToGlyph(ch);
  const size = fontSize(style);
  let gx = x;
  if (style === 'code') {
    const natural = (glyph.advanceWidth || 0) * (size / f.unitsPerEm);
    gx = x + Math.max(0, (CODE_CHAR_ADVANCE - natural) / 2);
  }
  const path = glyph.getPath(gx, baseline, size);
  let d = '';
  for (const c of path.commands) {
    switch (c.type) {
      case 'M': d += `M${fmt(c.x)} ${fmt(c.y)}`; break;
      case 'L': d += `L${fmt(c.x)} ${fmt(c.y)}`; break;
      case 'Q': d += `Q${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x)} ${fmt(c.y)}`; break;
      case 'C': d += `C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`; break;
      case 'Z': d += 'Z'; break;
      default: break;
    }
  }
  return d;
}

/**
 * Strokes for one line of handwriting with its baseline at (x, y). Characters the font lacks
 * become a small rough square (never a throw). Returns {strokes, width}.
 */
export function lineStrokes(text, style, x, y, color, seed, extraMeta = {}) {
  const strokes = [];
  const glyphs = glyphPaths(text, style, x, y);
  let n = 0;
  for (const g of glyphs) {
    if (g.d) {
      const d = glyphOutline(g.char, style, g.x, y) || g.d;
      strokes.push({ d, kind: 'glyph', color, char: g.char, ...extraMeta });
    } else if (g.char.trim() !== '' && isMissingGlyph(g.char)) {
      const size = fontSize(style);
      const side = Math.max(4, Math.min(g.advance * 0.8, size * 0.4));
      const sx = g.x + Math.max(0, (g.advance - side) / 2);
      const sy = y - side - 2;
      const envelope = expandRect({ x: sx, y: sy, w: side, h: side }, ROUGH_ENVELOPE);
      const paths = roughFit(seed + 101 * (n + 1), envelope, (r) => roughRect(r, sx, sy, side, side));
      for (const d of paths) strokes.push({ d, kind: 'glyph', color, char: g.char, fallback: true, ...extraMeta });
    }
    n++;
  }
  return { strokes, width: textWidth(text, style) };
}

/**
 * Strokes for a block of pre-wrapped lines starting at `top`.
 * @returns {{strokes:object[], lineRects:Array<{x,y,w,h,baseline}>}}
 */
export function blockStrokes(lines, style, x, top, color, seed, { align = 'left', width = 0, meta = {} } = {}) {
  const lh = lineHeight(style);
  const strokes = [];
  const lineRects = [];
  lines.forEach((line, i) => {
    const lw = textWidth(line, style);
    const lineX = align === 'center' ? x + Math.max(0, (width - lw) / 2) : x;
    const lineTop = top + i * lh;
    const baseline = baselineFor(style, lineTop);
    const { strokes: s } = lineStrokes(line, style, lineX, baseline, color, seed + 31 * i, { ...meta, line: i });
    strokes.push(...s);
    lineRects.push({ x: lineX, y: lineTop, w: lw, h: lh, baseline });
  });
  return { strokes, lineRects };
}

// ---------- the Drawable ----------

/** Point at `fraction` of a flattened path (same semantics as strokes.pointAt). */
export function pointOnFlat(flat, total, fraction) {
  if (!flat.length) return null;
  if (total === 0) { const p = flat[0].points[0]; return { x: p[0], y: p[1] }; }
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (const sp of flat) {
    if (target > sp.length + 1e-9) { target -= sp.length; continue; }
    const pts = sp.points, lens = sp.lengths;
    for (let i = 1; i < pts.length; i++) {
      if (lens[i] >= target - 1e-9) {
        const segLen = lens[i] - lens[i - 1];
        const t = segLen === 0 ? 0 : (target - lens[i - 1]) / segLen;
        return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t };
      }
    }
    const last = pts[pts.length - 1];
    return { x: last[0], y: last[1] };
  }
  const sp = flat[flat.length - 1];
  const last = sp.points[sp.points.length - 1];
  return { x: last[0], y: last[1] };
}

/** moveTo/lineTo the first `budget` px of a flattened path onto a 2D context (no beginPath/stroke). */
function traceFlat(ctx2d, flat, budget) {
  for (const sp of flat) {
    if (budget <= 0) break;
    const pts = sp.points, lens = sp.lengths;
    ctx2d.moveTo(pts[0][0], pts[0][1]);
    let cut = false;
    for (let i = 1; i < pts.length; i++) {
      if (lens[i] <= budget + 1e-9) { ctx2d.lineTo(pts[i][0], pts[i][1]); continue; }
      const segLen = lens[i] - lens[i - 1];
      const t = segLen === 0 ? 0 : (budget - lens[i - 1]) / segLen;
      ctx2d.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
      cut = true;
      break;
    }
    if (cut) { budget = 0; break; }
    budget -= sp.length;
  }
}

/**
 * Assemble a Drawable.
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.type
 * @param {Array<Array<object>>} spec.parts   strokes per part, in draw order: {d, kind, color, lineWidth?, alpha?, ...meta}
 * @param {number[]} spec.partStarts         normalized part starts in [0,1), same length as parts
 * @param {object} [spec.bounds]             override; default = union of stroke bounds and `extraBounds`
 * @param {object[]} [spec.extraBounds]      rects to union into bounds (rough envelopes)
 * @param {object} [spec.meta]               test/inspection data
 * @param {Function} [spec.tipOverride]      tipAt(u) replacement (pointer highlights)
 */
export function buildDrawable(spec) {
  const { id, type } = spec;
  const partCount = Math.max(1, spec.parts.length);
  const partStarts = spec.partStarts && spec.partStarts.length === spec.parts.length ? spec.partStarts.slice() : evenStarts(partCount);
  const strokes = [];
  const partLengths = [];
  spec.parts.forEach((part, pi) => {
    let total = 0;
    for (const s of part) {
      if (!s || typeof s.d !== 'string' || s.d.length === 0) continue;
      const flat = flatten(s.d);
      const length = flat.reduce((acc, sp) => acc + sp.length, 0);
      const fb = flatBounds(flat);
      strokes.push({ ...s, part: pi, flat, length, bounds: fb });
      total += length;
    }
    partLengths.push(total);
  });
  const paths = strokes.map((s) => s.d);
  const totalLength = strokes.reduce((a, s) => a + s.length, 0);
  const naturalMs = (totalLength / PEN_PX_PER_S) * 1000;
  let bounds = spec.bounds || null;
  if (!bounds) {
    const rects = [];
    for (const s of strokes) if (s.bounds) rects.push(s.bounds);
    for (const r of spec.extraBounds || []) if (r) rects.push(r);
    bounds = rects.length ? rectUnion(...rects) : (spec.fallbackBounds || { ...BOARD });
  }
  const partEnd = (k) => (k + 1 < partStarts.length ? Math.max(partStarts[k + 1], partStarts[k]) : 1);

  /**
   * Reveal state at progress u: {part, completeCount, current: index|-1, fraction}.
   * `completeCount` strokes are fully drawn, stroke `current` is drawn to `fraction`.
   */
  function progress(u) {
    if (!(u > 0)) return { part: -1, completeCount: 0, current: -1, fraction: 0 };
    if (u >= 1) return { part: partCount - 1, completeCount: strokes.length, current: -1, fraction: 1 };
    let k = -1;
    for (let i = 0; i < partStarts.length; i++) if (partStarts[i] <= u + EPS) k = i;
    if (k < 0) return { part: -1, completeCount: 0, current: -1, fraction: 0 };
    // strokes of parts < k are complete
    let completeCount = 0;
    while (completeCount < strokes.length && strokes[completeCount].part < k) completeCount++;
    const start = partStarts[k], end = partEnd(k);
    const v = end > start ? Math.min(1, (u - start) / (end - start)) : 1;
    let budget = v * partLengths[k];
    let current = -1, fraction = 0;
    while (completeCount < strokes.length && strokes[completeCount].part === k) {
      const s = strokes[completeCount];
      if (s.length <= budget + 1e-9) { budget -= s.length; completeCount++; continue; }
      current = completeCount;
      fraction = s.length > 0 ? budget / s.length : 1;
      break;
    }
    return { part: k, completeCount, current, fraction };
  }

  function setStyle(ctx2d, s, inProgress) {
    const color = s.color || tokens.chalk;
    ctx2d.strokeStyle = color;
    ctx2d.fillStyle = color;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.globalAlpha = s.alpha !== undefined ? s.alpha : (s.kind === 'faint' ? PEN.faintAlpha : 1);
    if (s.kind === 'glyph') ctx2d.lineWidth = s.lineWidth !== undefined ? s.lineWidth : (inProgress ? PEN.glyphProgress : PEN.glyphEdge);
    else if (s.kind === 'faint') ctx2d.lineWidth = s.lineWidth !== undefined ? s.lineWidth : PEN.faint;
    else ctx2d.lineWidth = s.lineWidth !== undefined ? s.lineWidth : PEN.rough;
  }

  function paint(ctx2d, u) {
    const p = progress(u);
    if (p.completeCount === 0 && p.current < 0) return;
    ctx2d.save();
    for (let i = 0; i < p.completeCount; i++) {
      const s = strokes[i];
      setStyle(ctx2d, s, false);
      ctx2d.beginPath();
      traceFlat(ctx2d, s.flat, Infinity);
      if (s.kind === 'glyph') ctx2d.fill();
      ctx2d.stroke();
    }
    if (p.current >= 0 && p.fraction > 0) {
      const s = strokes[p.current];
      setStyle(ctx2d, s, true);
      ctx2d.beginPath();
      traceFlat(ctx2d, s.flat, p.fraction * s.length);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function tipAt(u) {
    if (spec.tipOverride) return spec.tipOverride(u);
    if (!strokes.length) return null;
    const p = progress(u);
    if (p.current >= 0) return pointOnFlat(strokes[p.current].flat, strokes[p.current].length, p.fraction);
    if (p.completeCount === 0) { const s = strokes[0]; return pointOnFlat(s.flat, s.length, 0); }
    const s = strokes[p.completeCount - 1];
    return pointOnFlat(s.flat, s.length, 1);
  }

  return {
    id,
    type,
    bounds,
    parts: partCount,
    partStarts,
    naturalMs,
    paths,
    paint,
    tipAt,
    progress,
    strokes,
    meta: spec.meta || {},
    pending: spec.pending === true,
  };
}

export function evenStarts(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i / n);
  return out;
}

/** Resolve an element's color token to a CSS color (unknown/missing → chalk). */
export function elementColor(el) {
  return colorOf(el && el.color);
}

export function requireField(el, name, type) {
  const v = el ? el[name] : undefined;
  if (v === undefined || v === null || (type && typeof v !== type)) {
    throw new Error(`renderer-core: ${el && el.type ? el.type : 'element'} "${el && el.id}" is missing required field "${name}"${type ? ` (${type})` : ''}`);
  }
  return v;
}

export { BOARD as BOARD_BOUNDS };
