// player/renderer/pictures/common.js — shared helpers for the picture drawables (slice 03):
// stroke records, the Drawable builder (parts → paint/tipAt/bounds), handwriting labels as glyph
// strokes, path transforms and rectangle fitting. Pure and DOM-free except Drawable.paint.
//
// Reveal semantics (brief 02 §reveal, brief 03 "Common"): u ∈ [0,1] maps to parts via
// partStarts = i / parts; inside a part the strokes are drawn in order, proportionally to path
// length. paint(ctx2d, 1) is the complete deterministic image.
import { slotRect, slotInnerRect, rectInset } from '../../../shared/layout-core/grid.js';
import { colorOf, tokens, COLOR_TOKENS } from '../../../shared/layout-core/tokens.js';
import { ROUGH_OPTIONS, FONT_SIZES } from '../../../shared/layout-core/constants.js';
import { pathBounds, pathLength, pointAt, drawPartial, naturalMs, rough, parsePath } from '../../../shared/strokes.js';
import { glyphPaths, measure, wrap, lineHeight, getFont } from '../../../shared/handwriting.js';

/** Rough strokes wobble a few px beyond their nominal geometry; keep geometry this far inside the inner rect. */
export const ROUGH_MARGIN = 8;
/** Line width of a plain rough stroke (from the shared ROUGH_OPTIONS). */
export const STROKE_WIDTH = ROUGH_OPTIONS.strokeWidth;
/** Hachure (fill) strokes are thinner and lighter than outlines. */
export const HACHURE_WIDTH = 1.2;
export const HACHURE_ALPHA = 0.55;
/** Width used when a glyph outline is traced while it is still in progress. */
export const GLYPH_TRACE_WIDTH = 1.4;

const ACCENTS = COLOR_TOKENS.filter((t) => t.startsWith('accent'));

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const round2 = (v) => Math.round(v * 100) / 100;

/** Resolve a token name to a CSS color (unknown → chalk). `chalk` is accepted as well as the element tokens. */
export function tokenColor(name) {
  if (name === 'chalk') return tokens.chalk;
  return colorOf(name);
}

/** True when `name` is an element color token or `chalk`. */
export function isColorToken(name) {
  return name === 'chalk' || COLOR_TOKENS.includes(name);
}

/**
 * Series colour rule (brief 03 `plot`): series 0 is the element colour; series k > 0 takes the accent
 * k steps after the element's accent (wrapping over accent1..accent5). A non-accent element colour
 * (`muted`, or none → chalk) counts as position 0, so its extra series are accent2, accent3.
 */
export function seriesToken(elementColor, k) {
  if (k === 0) return elementColor && COLOR_TOKENS.includes(elementColor) ? elementColor : 'chalk';
  const base = Math.max(0, ACCENTS.indexOf(elementColor));
  return ACCENTS[(base + k) % ACCENTS.length];
}

/** The three rectangles a slotted picture works with. */
export function pictureRects(slot) {
  const outer = slotRect(slot);
  const inner = slotInnerRect(slot);
  const safe = rectInset(inner, ROUGH_MARGIN);
  return { outer, inner, safe };
}

/** Seeded rough wrapper for an element (ctx.seed is the foundation's seedFor). */
export function roughFor(ctx, element) {
  return rough(ctx && typeof ctx.seed === 'function' ? ctx.seed(element.id) : element.id);
}

// ---------- strokes ----------

/**
 * @typedef {object} Stroke
 * @property {string} d        SVG path data (board px)
 * @property {string} color    CSS colour
 * @property {number} width    line width (stroke / hachure modes)
 * @property {'stroke'|'fill'|'hachure'} mode
 * @property {number[]|null} dash  canvas dash pattern or null
 * @property {number} len      flattened length (px)
 */

/** Make a stroke record; returns null for an empty path. */
export function stroke(d, color, { width = STROKE_WIDTH, mode = 'stroke', dash = null } = {}) {
  if (!d || typeof d !== 'string' || !d.trim()) return null;
  let len;
  try { len = pathLength(d); } catch (e) { throw new Error(`pictures: bad path data (${e.message}): "${d.slice(0, 120)}"`); }
  return { d, color, width, mode, dash, len };
}

/** Strokes from a list of rough path strings (first = outline, rest = hachure when `fill` is set). */
export function roughStrokes(paths, color, { width = STROKE_WIDTH, dash = null, fillColor = null, fillCount = 0 } = {}) {
  const out = [];
  paths.forEach((d, i) => {
    const isFill = fillColor !== null && i >= paths.length - fillCount;
    const s = isFill
      ? stroke(d, fillColor, { width: HACHURE_WIDTH, mode: 'hachure' })
      : stroke(d, color, { width, mode: 'stroke', dash });
    if (s) out.push(s);
  });
  return out;
}

/** Hachure-only strokes for a closed rough primitive: call `fn` with `{fill, stroke:'none'}`. */
export function hachureStrokes(paths, fillColor) {
  return paths.map((d) => stroke(d, fillColor, { width: HACHURE_WIDTH, mode: 'hachure' })).filter(Boolean);
}

// ---------- paths ----------

/** Serialize absolute segments (from strokes.parsePath) back to path data. */
export function serializeSegments(segs) {
  let out = '';
  for (const s of segs) {
    if (s.type === 'Z') { out += 'Z'; continue; }
    const pts = s.pts.map(round2);
    out += `${s.type}${pts.join(' ')} `;
  }
  return out.trim();
}

/** Apply a point mapping ([x,y] → [x,y]) to every point of a path (arcs become cubics). */
export function transformPath(d, map) {
  const segs = parsePath(d).map((s) => {
    if (s.type === 'Z') return s;
    const pts = [];
    for (let i = 0; i < s.pts.length; i += 2) { const [x, y] = map([s.pts[i], s.pts[i + 1]]); pts.push(x, y); }
    return { type: s.type, pts };
  });
  return serializeSegments(segs);
}

/** Point mapping for a uniform scale about the origin followed by a translation. */
export function scaleTranslate(scale, tx, ty) {
  return ([x, y]) => [x * scale + tx, y * scale + ty];
}

/** Path data of an axis-aligned ellipse as four cubic arcs. */
export function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498;
  const ox = rx * k, oy = ry * k;
  return `M${cx + rx} ${cy} C${cx + rx} ${cy + oy} ${cx + ox} ${cy + ry} ${cx} ${cy + ry} ` +
    `C${cx - ox} ${cy + ry} ${cx - rx} ${cy + oy} ${cx - rx} ${cy} ` +
    `C${cx - rx} ${cy - oy} ${cx - ox} ${cy - ry} ${cx} ${cy - ry} ` +
    `C${cx + ox} ${cy - ry} ${cx + rx} ${cy - oy} ${cx + rx} ${cy} Z`;
}

export function polyPath(points, closed) {
  if (!points.length) return '';
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) d += ` L${points[i][0]} ${points[i][1]}`;
  return closed ? `${d} Z` : d;
}

// ---------- rectangles ----------

export function unionRects(rects) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of list) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Largest rectangle with aspect ratio w:h centred in `rect`. */
export function fitAspect(aspect, rect) {
  let w = rect.w, h = w / aspect;
  if (h > rect.h) { h = rect.h; w = h * aspect; }
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

export function rectContains(outer, inner, eps = 0.001) {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}

export function rectsIntersect(a, b) {
  return !(b.x >= a.x + a.w || b.x + b.w <= a.x || b.y >= a.y + a.h || b.y + b.h <= a.y);
}

// ---------- handwriting ----------

/** Serialize opentype path commands ({type, x, y, x1, y1, x2, y2}) to path data. */
export function commandsToPath(commands) {
  let out = '';
  for (const c of commands) {
    switch (c.type) {
      case 'M': out += `M${round2(c.x)} ${round2(c.y)}`; break;
      case 'L': out += `L${round2(c.x)} ${round2(c.y)}`; break;
      case 'C': out += `C${round2(c.x1)} ${round2(c.y1)} ${round2(c.x2)} ${round2(c.y2)} ${round2(c.x)} ${round2(c.y)}`; break;
      case 'Q': out += `Q${round2(c.x1)} ${round2(c.y1)} ${round2(c.x)} ${round2(c.y)}`; break;
      case 'Z': out += 'Z'; break;
      default: break;
    }
  }
  return out;
}

/**
 * Glyph outlines for a line of text — shared/handwriting.glyphPaths plus a repair step: the vendored
 * opentype `toPathData` can emit a literal `NaN` for coordinates whose fractional part prints in
 * exponent notation (its roundDecimal concatenates the decimal part with the string "e+2"). Such
 * glyphs are rebuilt from the glyph's own path commands (same geometry, our serializer).
 * Reported as a shared-module gap.
 */
export function glyphOutlines(text, style, x, y) {
  const glyphs = glyphPaths(text, style, x, y);
  const f = getFont();
  const size = FONT_SIZES[style];
  return glyphs.map((g) => {
    if (!g.d || !g.d.includes('NaN')) return g;
    const p = f.charToGlyph(g.char).getPath(g.x, y, size);
    return { ...g, d: commandsToPath(p.commands) };
  });
}

/**
 * Pick the largest style whose wrapped lines fit `maxWidth` in at most `maxLines` lines.
 * Falls back to the smallest style wrapped (hard-split by handwriting.wrap, so every line fits the width).
 * @returns {{style:string, lines:string[], width:number, height:number}}
 */
export function fitText(text, maxWidth, { styles = ['body', 'note'], maxLines = 2 } = {}) {
  const str = String(text ?? '').trim();
  let chosen = null;
  for (const style of styles) {
    const lines = wrap(str, style, Math.max(1, maxWidth));
    const widest = Math.max(0, ...lines.map((l) => measure(l, style).width));
    chosen = { style, lines, width: widest, height: lines.length * lineHeight(style) };
    if (lines.length <= maxLines && widest <= maxWidth) break;
  }
  return chosen;
}

/** Metric height of one line of text (ascent + descent at that style). */
export function textBlockHeight(style, lineCount = 1) {
  return lineCount * lineHeight(style);
}

/**
 * Glyph strokes for lines of text inside a box: the block is `lines.length × lineHeight` tall,
 * aligned horizontally per `align` within [x, x + w] and starting at `y`.
 * @returns {{strokes: Stroke[], box: {x,y,w,h}}} box = nominal text block (metrics, not glyph bounds)
 */
export function writeLines(lines, style, x, y, w, color, { align = 'center', scale = 1 } = {}) {
  const lh = lineHeight(style) * scale;
  const m0 = measure('Hg', style);
  const ascent = m0.ascent * scale;
  const descent = m0.descent * scale;
  const strokes = [];
  let widest = 0;
  lines.forEach((line, i) => {
    const width = measure(line, style).width * scale;
    widest = Math.max(widest, width);
    const lx = align === 'left' ? x : align === 'right' ? x + w - width : x + (w - width) / 2;
    // baseline so that ascent+descent is centred in the line box
    const baseline = y + i * lh + (lh - (ascent + descent)) / 2 + ascent;
    if (scale === 1) {
      for (const g of glyphOutlines(line, style, lx, baseline)) {
        const s = stroke(g.d, color, { mode: 'fill', width: GLYPH_TRACE_WIDTH });
        if (s) strokes.push(s);
      }
    } else {
      // glyph d from glyphOutlines(..., 0, 0) is already offset by the glyph's x advance
      for (const g of glyphOutlines(line, style, 0, 0)) {
        if (!g.d) continue;
        const d = transformPath(g.d, ([px, py]) => [lx + px * scale, baseline + py * scale]);
        const s = stroke(d, color, { mode: 'fill', width: GLYPH_TRACE_WIDTH });
        if (s) strokes.push(s);
      }
    }
  });
  const blockX = align === 'left' ? x : align === 'right' ? x + w - widest : x + (w - widest) / 2;
  return { strokes, box: { x: blockX, y, w: widest, h: lines.length * lh } };
}

/** One line of text with its left/centre/right anchor at (ax, baselineY), optionally scaled from `style`. */
export function writeAt(text, style, ax, baselineY, color, { anchor = 'start', scale = 1 } = {}) {
  const width = measure(text, style).width * scale;
  const startX = anchor === 'middle' ? ax - width / 2 : anchor === 'end' ? ax - width : ax;
  const strokes = [];
  for (const g of glyphOutlines(String(text), style, 0, 0)) {
    if (!g.d) continue;
    const d = scale === 1 ? transformPath(g.d, ([px, py]) => [startX + px, baselineY + py]) : transformPath(g.d, ([px, py]) => [startX + px * scale, baselineY + py * scale]);
    const s = stroke(d, color, { mode: 'fill', width: GLYPH_TRACE_WIDTH });
    if (s) strokes.push(s);
  }
  const m = measure('Hg', style);
  return { strokes, box: { x: startX, y: baselineY - m.ascent * scale, w: width, h: (m.ascent + m.descent) * scale }, width };
}

export const fontPx = (style) => FONT_SIZES[style];

// ---------- Drawable ----------

/**
 * @typedef {object} Part
 * @property {string} kind      e.g. 'shape', 'label', 'node', 'edge', 'axes', 'series', 'svg:rect'
 * @property {Stroke[]} strokes
 * @property {object} [meta]
 */

/** Reveal state at u: how many strokes are complete and which one is in progress. */
function revealState(parts, u) {
  const n = parts.length;
  const p = clamp01(u);
  let complete = 0;
  let partial = null;
  let tip = null;
  for (let i = 0; i < n; i++) {
    const s = i / n, e = (i + 1) / n;
    const f = p >= e ? 1 : p <= s ? 0 : (p - s) / (e - s);
    const strokes = parts[i].strokes;
    if (f === 0) { if (i === 0 && strokes.length) tip = { stroke: strokes[0], fraction: 0 }; break; }
    const total = strokes.reduce((a, st) => a + st.len, 0);
    let budget = f * total;
    for (let k = 0; k < strokes.length; k++) {
      const st = strokes[k];
      if (f === 1 || budget >= st.len - 1e-9) { complete++; budget -= st.len; tip = { stroke: st, fraction: 1 }; continue; }
      const frac = st.len === 0 ? 1 : budget / st.len;
      partial = { stroke: st, fraction: frac, index: complete };
      tip = partial;
      break;
    }
    if (partial) break;
  }
  return { complete, partial, tip };
}

function applyStyle(ctx2d, st) {
  ctx2d.strokeStyle = st.color;
  ctx2d.fillStyle = st.color;
  ctx2d.lineWidth = st.mode === 'fill' ? GLYPH_TRACE_WIDTH : st.width;
  ctx2d.lineCap = 'round';
  ctx2d.lineJoin = 'round';
  ctx2d.globalAlpha = st.mode === 'hachure' ? HACHURE_ALPHA : 1;
  if (typeof ctx2d.setLineDash === 'function') ctx2d.setLineDash(st.dash || []);
}

function drawFull(ctx2d, st) {
  applyStyle(ctx2d, st);
  const hasPath2D = typeof Path2D !== 'undefined';
  if (st.mode === 'fill') {
    if (hasPath2D) { st.p2d = st.p2d || new Path2D(st.d); ctx2d.fill(st.p2d); }
    else drawPartial(ctx2d, st.d, 1);
    return;
  }
  if (hasPath2D) { st.p2d = st.p2d || new Path2D(st.d); ctx2d.stroke(st.p2d); }
  else drawPartial(ctx2d, st.d, 1);
}

/**
 * Build a Drawable from ordered parts.
 * @param {{id:string, type:string, parts:Part[], fallbackRect:{x,y,w,h}, picture?:object}} spec
 */
export function buildDrawable({ id, type, parts, fallbackRect, picture = {} }) {
  const list = parts.length ? parts : [{ kind: 'empty', strokes: [] }];
  const all = list.flatMap((p) => p.strokes);
  const paths = all.map((s) => s.d);
  const bounds = unionRects(all.map((s) => pathBounds(s.d))) || { x: fallbackRect.x + fallbackRect.w / 2, y: fallbackRect.y + fallbackRect.h / 2, w: 0, h: 0 };
  const n = list.length;
  const partStarts = list.map((_, i) => i / n);
  return {
    id,
    type,
    bounds,
    parts: n,
    partStarts,
    naturalMs: naturalMs(paths),
    paths,
    /** Per-path style, aligned with `paths` (test hook): {mode, width, dash, color}. */
    strokeInfo: all.map((s) => ({ mode: s.mode, width: s.width, dash: s.dash, color: s.color })),
    picture: { ...picture, partKinds: list.map((p) => p.kind), partMeta: list.map((p) => p.meta || null), strokeCount: all.length },
    paint(ctx2d, u) {
      const { complete, partial } = revealState(list, u);
      ctx2d.save();
      let k = 0;
      for (const st of all) {
        if (k >= complete) break;
        drawFull(ctx2d, st);
        k++;
      }
      if (partial && partial.fraction > 0) {
        applyStyle(ctx2d, partial.stroke);
        drawPartial(ctx2d, partial.stroke.d, partial.fraction);
      }
      ctx2d.restore();
    },
    tipAt(u) {
      const { tip } = revealState(list, u);
      if (!tip) return null;
      return pointAt(tip.stroke.d, tip.fraction);
    },
    /** Test hook: {complete, partialIndex, partialFraction} at u. */
    revealAt(u) {
      const r = revealState(list, u);
      return { complete: r.complete, partialIndex: r.partial ? r.partial.index : null, partialFraction: r.partial ? r.partial.fraction : null };
    },
  };
}
