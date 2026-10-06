// player/renderer/core/math.js — `math` drawable: each LaTeX line compiled by shared/math.js
// (via math-compile.js cache), its SVG glyphs converted to board-space strokes at
// MATH_LAYOUT.fontPx, lines aligned so their `=` share one x (left-aligned fallback when the
// aligned block would not fit), appearing in turn (one part per line).
import { measureMath } from '../../../shared/layout-core/measure.js';
import { MATH_LAYOUT } from '../../../shared/layout-core/constants.js';
import { rectInset } from '../../../shared/layout-core/grid.js';
import { SLOT_PAD } from '../../../shared/layout-core/constants.js';
import { buildDrawable, evenStarts, elementColor, requireField } from './drawable.js';
import { svgToStrokes } from './svg-strokes.js';
import { compiledFor, compileSync, compileErrorFor, ready, warmLines, isReady } from './math-compile.js';

/**
 * Layout of compiled lines inside a slot rect: per line {x, top, width, height, eqX|null}
 * (board px) plus `aligned` (true when `=` alignment was applied).
 */
export function mathLayout(compiled, rect) {
  const m = measureMath(compiled, rect);
  const px = MATH_LAYOUT.fontPx;
  const withEq = m.lines.filter((l) => l.eqX !== null);
  let offsets = m.lines.map(() => 0);
  let aligned = false;
  if (withEq.length >= 2) {
    const col = Math.max(...withEq.map((l) => l.eqX));
    const cand = m.lines.map((l) => (l.eqX === null ? 0 : col - l.eqX));
    const width = Math.max(...m.lines.map((l, i) => cand[i] + l.width));
    if (width <= m.inner.w + 1e-6) { offsets = cand; aligned = true; }
  }
  const lines = m.lines.map((l, i) => {
    const glyphH = compiled[i].height * px;
    return {
      x: m.inner.x + offsets[i],
      top: m.inner.y + l.y + Math.max(0, (l.height - glyphH) / 2),
      boxTop: m.inner.y + l.y,
      width: l.width,
      height: l.height,
      glyphHeight: glyphH,
      eqX: l.eqX === null ? null : m.inner.x + offsets[i] + l.eqX,
    };
  });
  return { inner: m.inner, lines, aligned, width: m.width, height: m.height, px };
}

function pendingDrawable(el, rect, reason) {
  const n = Array.isArray(el.lines) ? el.lines.length : 1;
  const inner = rectInset(rect, SLOT_PAD);
  return buildDrawable({
    id: el.id,
    type: 'math',
    parts: Array.from({ length: n }, () => []),
    partStarts: evenStarts(n),
    bounds: { x: inner.x, y: inner.y, w: 0, h: 0 },
    pending: true,
    meta: { pending: true, reason, inner },
  });
}

export function prepareMath(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const lines = requireField(el, 'lines');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error(`renderer-core: math "${el.id}" lines must be a non-empty array`);
  const rect = ctx.slotRect(slot);
  const failed = compileErrorFor(lines);
  if (failed) return pendingDrawable(el, rect, `compile failed: ${failed.message}`);
  let compiled = compiledFor(lines);
  if (!compiled) {
    if (isReady()) {
      try { compiled = compileSync(lines); } catch (e) { return pendingDrawable(el, rect, `compile failed: ${e.message}`); }
    } else {
      // MathJax not initialised yet: start it and compile in the background; the next prepare hits the cache.
      ready().then(() => warmLines(lines)).catch(() => null);
      return pendingDrawable(el, rect, 'mathjax not ready');
    }
  }
  const layout = mathLayout(compiled, rect);
  const color = elementColor(el);
  const px = layout.px / 1000;
  const parts = [];
  const lineMeta = [];
  compiled.forEach((c, i) => {
    const L = layout.lines[i];
    const vb = c.viewBox;
    const root = [px, 0, 0, px, L.x - vb.x * px, L.top - vb.y * px];
    const raw = svgToStrokes(c.svg, root);
    const strokes = raw.map((s) => ({ d: s.d, kind: 'glyph', color, line: i, tag: s.tag, dataC: s.dataC }));
    parts.push(strokes);
    lineMeta.push({ index: i, tex: lines[i], x: L.x, top: L.top, boxTop: L.boxTop, width: L.width, height: L.height, eqX: L.eqX });
  });
  return buildDrawable({
    id: el.id,
    type: 'math',
    parts,
    partStarts: evenStarts(parts.length),
    fallbackBounds: { x: layout.inner.x, y: layout.inner.y, w: 0, h: 0 },
    meta: { inner: layout.inner, lines: lineMeta, aligned: layout.aligned, fontPx: layout.px },
  });
}
