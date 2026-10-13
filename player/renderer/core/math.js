// player/renderer/core/math.js — `math` drawable: each LaTeX line compiled by shared/math.js
// (via math-compile.js cache), laid out at MATH_LAYOUT.fontPx with lines aligned so their `=`
// share one x (left-aligned fallback when the aligned block would not fit), appearing in
// turn (one part per line).
//
// Handwritten math (change-khan-feel, study §4 item 7): MathJax keeps doing the layout, but
// every glyph it places is re-drawn as the handwriting font's glyph fitted into that glyph's
// ink box (same position, same size, the same hand shear and jitter as the text around it).
// Rules — fraction bars, radical overlines (`<rect>`), and the bar-like glyphs `=`, `−`, `-` —
// stay as the plain strokes MathJax emits. A glyph the handwriting font lacks (Greek, arrows,
// ∂ …) keeps its MathJax outline with a light deterministic jitter.
import { measureMath } from '../../../shared/layout-core/measure.js';
import { MATH_LAYOUT } from '../../../shared/layout-core/constants.js';
import { rectInset } from '../../../shared/layout-core/grid.js';
import { SLOT_PAD } from '../../../shared/layout-core/constants.js';
import { getFont } from '../../../shared/handwriting.js';
import { parsePath } from '../../../shared/strokes.js';
import { buildDrawable, evenStarts, elementColor, requireField, boundsOfPaths, handJitter, handGlyphPath, jitterPath, mapSegments, segmentsToPath } from './drawable.js';
import { svgToStrokes } from './svg-strokes.js';
import { compiledFor, compileSync, compileErrorFor, ready, warmLines, isReady } from './math-compile.js';

/** MathJax glyph codes that are drawn as plain bars (kept as emitted). */
export const BAR_GLYPHS = Object.freeze(['3D', '2212', '2D', '2013', '2014', '2015', '2E3A']);

const GREEK_LOWER = 'αβγδεζηθικλμνξοπρστυφχψω';
const GREEK_UPPER = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
/** 58-glyph blocks of the Mathematical Greek alphabets: Α…Ω ϴ ∇ α…ω ∂ ϵ ϑ ϰ ϕ ϱ ϖ */
const GREEK_BLOCK = GREEK_UPPER.slice(0, 17) + 'ϴ' + GREEK_UPPER.slice(17) + '∇' + GREEK_LOWER + '∂ϵϑϰϕϱϖ';

/**
 * The plain character a MathJax `data-c` code stands for: Mathematical Alphanumeric Symbols
 * (italic, bold, script, fraktur, sans, mono …) fold onto their base letter or digit; ℎ onto h.
 */
export function mathChar(dataC) {
  if (!dataC) return null;
  const code = parseInt(dataC, 16);
  if (!Number.isFinite(code)) return null;
  if (code === 0x210E) return 'h';
  if (code >= 0x1D400 && code <= 0x1D6A3) {
    const i = (code - 0x1D400) % 52;
    return String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26);
  }
  if (code === 0x1D6A4) return 'i';
  if (code === 0x1D6A5) return 'j';
  if (code >= 0x1D6A8 && code <= 0x1D7CB) return [...GREEK_BLOCK][(code - 0x1D6A8) % 58] || null;
  if (code >= 0x1D7CE && code <= 0x1D7FF) return String((code - 0x1D7CE) % 10);
  return String.fromCodePoint(code);
}

function fontHas(ch) {
  const f = getFont();
  if (!f || !ch) return false;
  const g = f.charToGlyph(ch);
  return !!g && g.index !== 0;
}

/** Handwriting outline of `ch` with its origin at (0, 0) on the baseline, at `em` px per em. */
function handOutline(ch, em) {
  const f = getFont();
  const path = f.charToGlyph(ch).getPath(0, 0, em);
  const fmt = (v) => Math.round(v * 100) / 100;
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

/** Ratio above which a glyph is stretched non-uniformly into its box (tall delimiters, radicals, bars). */
const STRETCH_RATIO = 1.6;

/**
 * Fit the handwriting glyph for `ch` into the MathJax ink box `box` (board px). Uniform scale
 * when the two aspect ratios are close, else stretched to fill the box; centred in the box.
 * Returns the fitted path or null when the glyph has no ink.
 */
export function fitHandGlyph(ch, box, em, jitterKey, index) {
  const raw = handOutline(ch, em);
  if (!raw) return null;
  const sheared = handGlyphPath(raw, 0, handJitter(jitterKey, index));
  const hb = boundsOfPaths([sheared]);
  if (!hb || hb.w <= 0 || hb.h <= 0 || box.w <= 0 || box.h <= 0) return null;
  const kx = box.w / hb.w, ky = box.h / hb.h;
  const ratio = Math.max(kx, ky) / Math.min(kx, ky);
  const sx = ratio <= STRETCH_RATIO ? Math.min(kx, ky) : kx;
  const sy = ratio <= STRETCH_RATIO ? Math.min(kx, ky) : ky;
  const fw = hb.w * sx, fh = hb.h * sy;
  const ox = box.x + (box.w - fw) / 2 - hb.x * sx;
  const oy = box.y + (box.h - fh) / 2 - hb.y * sy;
  return segmentsToPath(mapSegments(parsePath(sheared), (x, y) => [ox + x * sx, oy + y * sy]));
}

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

/**
 * Board-space strokes for one compiled line: {d, kind:'glyph', char, dataC, tag, box, render}
 * where `render` is 'rule' (kept as emitted), 'hand' (fitted handwriting glyph) or
 * 'fallback' (MathJax outline, jittered). `box` is the MathJax ink box the stroke was fitted into.
 */
export function lineGlyphStrokes(raw, color, lineIndex, key) {
  const out = [];
  raw.forEach((s, gi) => {
    const box = boundsOfPaths([s.d]);
    const base = { kind: 'glyph', color, line: lineIndex, tag: s.tag, dataC: s.dataC, box, origin: s.origin, em: s.em };
    if (!box) return;
    if (s.tag !== 'path' || !s.dataC || BAR_GLYPHS.includes(s.dataC.toUpperCase())) {
      out.push({ ...base, d: s.d, render: 'rule' });
      return;
    }
    const ch = mathChar(s.dataC);
    const jitterKey = `${key}:m${lineIndex}`;
    if (ch && fontHas(ch)) {
      const d = fitHandGlyph(ch, box, s.em, jitterKey, gi);
      if (d) { out.push({ ...base, d, char: ch, render: 'hand' }); return; }
    }
    out.push({ ...base, d: jitterPath(s.d, `${jitterKey}#${gi}`, 0.5), char: ch, render: 'fallback' });
  });
  return out;
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
    parts.push(lineGlyphStrokes(raw, color, i, el.id));
    lineMeta.push({ index: i, tex: lines[i], x: L.x, top: L.top, boxTop: L.boxTop, width: L.width, height: L.height, eqX: L.eqX });
  });
  return buildDrawable({
    id: el.id,
    type: 'math',
    parts,
    partStarts: evenStarts(parts.length),
    fallbackBounds: { x: layout.inner.x, y: layout.inner.y, w: 0, h: 0 },
    meta: { inner: layout.inner, lines: lineMeta, aligned: layout.aligned, fontPx: layout.px, handwritten: true },
  });
}
