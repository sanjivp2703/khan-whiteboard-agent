// player/renderer/pictures/svg.js — `svg` drawable: the parsed subset AST ({viewBox, shapes}) is
// letterboxed into the slot inner rect and every shape becomes rough path strokes in the canvas
// pipeline. No DOM is ever created and the source string is never handed to the browser: only the
// allowlisted tag names are switched on; anything else is ignored and counted.
//
// Transforms: every shape is turned into an absolute path (rect → polygon, circle/ellipse → four
// cubic arcs, polyline/polygon → lines, path → parsed with arcs converted to cubics), then every
// point is mapped through the accumulated `g` transforms (shared/svg-subset.applyTransforms) and
// the letterbox fit. Cubic Béziers are affine-invariant, so rotate/scale/translate all work.
// `text` is handwriting at the anchor point; its size is the scaled font-size (capped to body,
// floored at 10 px) or note when no font-size is given; rotation is not applied to text.
import { parse as parseSvg, SHAPE_TAGS, parseTransform, applyTransforms } from '../../../shared/svg-subset.js';
import { pathBounds, parsePath } from '../../../shared/strokes.js';
import {
  pictureRects, roughFor, tokenColor, isColorToken, roughStrokes, hachureStrokes, transformPath, ellipsePath,
  polyPath, writeAt, buildDrawable, STROKE_WIDTH, fontPx, rectContains,
} from './common.js';

const MIN_TEXT_PX = 10;
const CLOSED_TAGS = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path']);

const num = (v, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

function numberList(value) {
  return String(value ?? '').trim().split(/[\s,]+/).filter((p) => p.length).map(Number).filter((n) => Number.isFinite(n));
}

/** Local (untransformed) path data for a shape node, or {skip: reason}. */
export function localPath(node) {
  const a = node.attrs || {};
  switch (node.tag) {
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (!(w > 0) || !(h > 0)) return { skip: 'zero-size rect' };
      return { d: polyPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true) };
    }
    case 'circle': {
      const r = num(a.r);
      if (!(r > 0)) return { skip: 'zero radius' };
      return { d: ellipsePath(num(a.cx), num(a.cy), r, r) };
    }
    case 'ellipse': {
      const rx = num(a.rx), ry = num(a.ry);
      if (!(rx > 0) || !(ry > 0)) return { skip: 'zero radius' };
      return { d: ellipsePath(num(a.cx), num(a.cy), rx, ry) };
    }
    case 'line': {
      const p = [[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]];
      if (p[0][0] === p[1][0] && p[0][1] === p[1][1]) return { skip: 'zero-length line' };
      return { d: polyPath(p, false) };
    }
    case 'polyline':
    case 'polygon': {
      const list = numberList(a.points);
      const pts = [];
      for (let i = 0; i + 1 < list.length; i += 2) pts.push([list[i], list[i + 1]]);
      if (pts.length < 2) return { skip: 'fewer than two points' };
      return { d: polyPath(pts, node.tag === 'polygon') };
    }
    case 'path': {
      const d = String(a.d ?? '').trim();
      if (!d) return { skip: 'empty path' };
      try { if (parsePath(d).length === 0) return { skip: 'empty path' }; } catch (e) { return { skip: `bad path: ${e.message}` }; }
      return { d };
    }
    default: return { skip: `unsupported tag ${node.tag}` };
  }
}

function lineWidthFor(attrs) {
  const sw = Number(attrs['stroke-width']);
  if (!Number.isFinite(sw) || sw <= 1) return STROKE_WIDTH;
  return sw <= 2.5 ? 3.5 : 4.5;
}

/**
 * prepare for `svg` from an already parsed AST (also used by tests with synthetic ASTs).
 * @param {object} element
 * @param {object} ctx
 * @param {{viewBox:{x,y,w,h}, shapes:object[]}} ast
 */
export function prepareSvgAst(element, ctx, ast) {
  const { inner, safe, outer } = pictureRects(element.slot);
  const r = roughFor(ctx, element);
  const vb = ast.viewBox;
  const scale = Math.min(safe.w / vb.w, safe.h / vb.h);
  const ox = safe.x + (safe.w - vb.w * scale) / 2 - vb.x * scale;
  const oy = safe.y + (safe.h - vb.h * scale) / 2 - vb.y * scale;
  const fit = ([x, y]) => [x * scale + ox, y * scale + oy];

  const parts = [];
  const ignored = [];
  const skipped = [];

  const shapePart = (node, ops) => {
    const attrs = node.attrs || {};
    const map = (p) => fit(applyTransforms(ops, p));
    if (node.tag === 'text') {
      const anchorPt = map([num(attrs.x), num(attrs.y)]);
      const p0 = applyTransforms(ops, [0, 0]), p1 = applyTransforms(ops, [1, 0]);
      const mag = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * scale;
      let size = attrs['font-size'] !== undefined ? num(attrs['font-size'], 16) * mag : fontPx('note');
      size = Math.max(MIN_TEXT_PX, Math.min(fontPx('body'), size));
      const fillAttr = attrs.fill, strokeAttr = attrs.stroke;
      const token = isColorToken(fillAttr) ? fillAttr : isColorToken(strokeAttr) ? strokeAttr : 'chalk';
      const anchor = ['start', 'middle', 'end'].includes(attrs['text-anchor']) ? attrs['text-anchor'] : 'start';
      const text = String(node.text || '').replace(/\s+/g, ' ').trim();
      if (!text) { skipped.push({ tag: 'text', reason: 'empty text' }); return; }
      let textScale = size / fontPx('body');
      let w = writeAt(text, 'body', anchorPt[0], anchorPt[1], tokenColor(token), { anchor, scale: textScale });
      if (w.box.w > safe.w) { textScale *= safe.w / w.box.w; w = writeAt(text, 'body', anchorPt[0], anchorPt[1], tokenColor(token), { anchor, scale: textScale }); }
      let dx = 0, dy = 0;
      if (w.box.x < safe.x) dx = safe.x - w.box.x;
      else if (w.box.x + w.box.w > safe.x + safe.w) dx = safe.x + safe.w - (w.box.x + w.box.w);
      if (w.box.y < safe.y) dy = safe.y - w.box.y;
      else if (w.box.y + w.box.h > safe.y + safe.h) dy = safe.y + safe.h - (w.box.y + w.box.h);
      if (dx || dy) w = writeAt(text, 'body', anchorPt[0] + dx, anchorPt[1] + dy, tokenColor(token), { anchor, scale: textScale });
      parts.push({ kind: 'svg:text', strokes: w.strokes, meta: { tag: 'text', text, size: textScale * fontPx('body'), anchor: anchorPt, box: w.box, shifted: [dx, dy], token } });
      return;
    }
    const local = localPath(node);
    if (local.skip) { skipped.push({ tag: node.tag, reason: local.skip }); return; }
    const d = transformPath(local.d, map);
    const strokeAttr = attrs.stroke;
    const strokeColor = strokeAttr === 'none' ? null : tokenColor(isColorToken(strokeAttr) ? strokeAttr : 'chalk');
    const fillToken = CLOSED_TAGS.has(node.tag) && isColorToken(attrs.fill) ? attrs.fill : null;
    const strokes = [];
    if (strokeColor) strokes.push(...roughStrokes(r.path(d), strokeColor, { width: lineWidthFor(attrs) }));
    if (fillToken) strokes.push(...hachureStrokes(r.path(d, { fill: tokenColor(fillToken), stroke: 'none' }), tokenColor(fillToken)));
    parts.push({ kind: `svg:${node.tag}`, strokes, meta: { tag: node.tag, nominal: pathBounds(d), stroke: strokeAttr === 'none' ? 'none' : (isColorToken(strokeAttr) ? strokeAttr : 'chalk'), fill: fillToken, hachure: fillToken !== null } });
  };

  const walk = (nodes, ops) => {
    for (const node of nodes || []) {
      if (!node || typeof node !== 'object' || typeof node.tag !== 'string') { ignored.push(String(node && node.tag)); continue; }
      if (node.tag === 'g') {
        let own = [];
        if (node.attrs && node.attrs.transform !== undefined) {
          try { own = parseTransform(node.attrs.transform); } catch { own = []; }
        }
        walk(node.children, [...ops, ...own]);
        continue;
      }
      if (SHAPE_TAGS.includes(node.tag)) { shapePart(node, ops); continue; }
      ignored.push(node.tag); // defense in depth: never drawn, never thrown
    }
  };
  walk(ast.shapes, []);

  const drawable = buildDrawable({
    id: element.id,
    type: 'svg',
    parts,
    fallbackRect: inner,
    picture: {
      kind: 'svg',
      viewBox: { ...vb },
      scale,
      offset: [ox, oy],
      fitRect: { x: ox + vb.x * scale, y: oy + vb.y * scale, w: vb.w * scale, h: vb.h * scale },
      ignored,
      skipped,
      shapeCount: parts.length,
      slotRect: outer,
      safeRect: safe,
      inSlot: null,
    },
  });
  drawable.picture.inSlot = rectContains(outer, drawable.bounds);
  return drawable;
}

/** prepare(element, ctx) for `svg` (re-parses the validated source with the shared parser). */
export function prepareSvg(element, ctx) {
  return prepareSvgAst(element, ctx, parseSvg(element.svg));
}
