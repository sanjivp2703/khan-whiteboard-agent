// player/renderer/pictures/sketch.js — `sketch` drawable: a library shape fitted into the slot
// (aspect preserved), roughened with the seeded rough wrapper, optional hand-written label.
import { SKETCH_SHAPES } from '../../../shared/layout-core/constants.js';
import { SKETCH_LIBRARY } from './sketch-library.js';
import {
  pictureRects, roughFor, tokenColor, roughStrokes, hachureStrokes, transformPath, fitAspect,
  fitText, writeLines, buildDrawable, textBlockHeight,
} from './common.js';

const LABEL_GAP = 8;

/** Map a unit-box point into a rect. */
const mapInto = (rect) => ([x, y]) => [rect.x + x * rect.w, rect.y + y * rect.h];

/** Rough strokes for one library primitive placed in `rect`. */
function primitiveStrokes(prim, rect, r, color) {
  const m = mapInto(rect);
  const fillPaths = (paths) => (prim.fill ? hachureStrokes(paths, color) : []);
  switch (prim.k) {
    case 'ellipse': {
      const [cx, cy] = m([prim.cx, prim.cy]);
      const w = prim.rx * 2 * rect.w, h = prim.ry * 2 * rect.h;
      const out = roughStrokes(r.ellipse(cx, cy, w, h), color);
      if (prim.fill) out.push(...fillPaths(r.ellipse(cx, cy, w, h, { fill: color, stroke: 'none' })));
      return out;
    }
    case 'rect': {
      const [x, y] = m([prim.x, prim.y]);
      const w = prim.w * rect.w, h = prim.h * rect.h;
      const out = roughStrokes(r.rectangle(x, y, w, h), color);
      if (prim.fill) out.push(...fillPaths(r.rectangle(x, y, w, h, { fill: color, stroke: 'none' })));
      return out;
    }
    case 'line': {
      const [x1, y1] = m([prim.x1, prim.y1]);
      const [x2, y2] = m([prim.x2, prim.y2]);
      return roughStrokes(r.line(x1, y1, x2, y2), color);
    }
    case 'poly': {
      const pts = prim.pts.map(m);
      const out = roughStrokes(prim.closed ? r.polygon(pts) : r.linearPath(pts), color);
      if (prim.fill && prim.closed) out.push(...fillPaths(r.polygon(pts, { fill: color, stroke: 'none' })));
      return out;
    }
    case 'path': {
      const d = transformPath(prim.d, m);
      const out = roughStrokes(r.path(d), color);
      if (prim.fill) out.push(...fillPaths(r.path(d, { fill: color, stroke: 'none' })));
      return out;
    }
    case 'arc': {
      const [cx, cy] = m([prim.cx, prim.cy]);
      return roughStrokes(r.arc(cx, cy, prim.rx * 2 * rect.w, prim.ry * 2 * rect.h, prim.start, prim.stop, false), color);
    }
    default:
      throw new Error(`sketch-library: unknown primitive kind "${prim.k}"`);
  }
}

/**
 * prepare(element, ctx) for `sketch`.
 * Layout: label beneath (default) or inside the shape's `labelInside` region when the library says so
 * and the text fits there; otherwise beneath. Label style body → note, ≤ 2 lines.
 */
export function prepareSketch(element, ctx) {
  const shapeName = element.shape;
  const def = SKETCH_LIBRARY[shapeName];
  if (!def || !SKETCH_SHAPES.includes(shapeName)) {
    throw new Error(`sketch: unknown shape "${shapeName}" (library has: ${Object.keys(SKETCH_LIBRARY).join(', ')})`);
  }
  const { outer, inner, safe } = pictureRects(element.slot);
  const color = tokenColor(element.color);
  const r = roughFor(ctx, element);
  const label = typeof element.label === 'string' && element.label.trim() ? element.label.trim() : null;

  let placement = 'none';
  let shapeRect = fitAspect(def.aspect, safe);
  let labelFit = null;
  let labelBox = null;

  if (label) {
    // try inside first
    if (def.labelInside) {
      const region = {
        x: shapeRect.x + def.labelInside.x * shapeRect.w,
        y: shapeRect.y + def.labelInside.y * shapeRect.h,
        w: def.labelInside.w * shapeRect.w,
        h: def.labelInside.h * shapeRect.h,
      };
      const fit = fitText(label, region.w, { styles: ['body', 'note'], maxLines: 2 });
      if (fit.width <= region.w && fit.height <= region.h) {
        placement = 'inside';
        labelFit = fit;
        labelBox = { x: region.x, y: region.y + (region.h - fit.height) / 2, w: region.w, h: fit.height };
      }
    }
    if (placement !== 'inside') {
      placement = 'beneath';
      labelFit = fitText(label, safe.w, { styles: ['body', 'note'], maxLines: 2 });
      const labelH = textBlockHeight(labelFit.style, labelFit.lines.length);
      const area = { x: safe.x, y: safe.y, w: safe.w, h: Math.max(10, safe.h - labelH - LABEL_GAP) };
      shapeRect = fitAspect(def.aspect, area);
      labelBox = { x: safe.x, y: Math.min(shapeRect.y + shapeRect.h + LABEL_GAP, safe.y + safe.h - labelH), w: safe.w, h: labelH };
    }
  }

  const shapeStrokes = [];
  for (const prim of def.primitives) {
    if (prim.unlessLabel && placement === 'inside') continue;
    shapeStrokes.push(...primitiveStrokes(prim, shapeRect, r, color));
  }
  const parts = [{ kind: 'shape', strokes: shapeStrokes, meta: { shape: shapeName, rect: shapeRect } }];

  let labelStrokes = [];
  if (label) {
    const written = writeLines(labelFit.lines, labelFit.style, labelBox.x, labelBox.y, labelBox.w, color, { align: 'center' });
    labelStrokes = written.strokes;
    parts.push({ kind: 'label', strokes: labelStrokes, meta: { style: labelFit.style, lines: labelFit.lines, box: written.box, placement } });
  }

  return buildDrawable({
    id: element.id,
    type: 'sketch',
    parts,
    fallbackRect: inner,
    picture: { kind: 'sketch', shape: shapeName, aspect: def.aspect, shapeRect, labelPlacement: placement, labelStyle: labelFit ? labelFit.style : null, slotRect: outer, safeRect: safe },
  });
}
