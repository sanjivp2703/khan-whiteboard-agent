// player/renderer/pictures/sketch.js — `sketch` drawable at Sal's doodle scale (design/02-khan-video-study.md
// §2.6, §4 item 11): a library shape 60–120 px tall, centred in the slot rather than filling it,
// roughened with the seeded rough wrapper, with the label hand-written beside it (wide slots) or
// beneath it. Bounds always stay inside the slot.
import { SKETCH_SHAPES } from '../../../shared/layout-core/constants.js';
import { slotSpan } from '../../../shared/layout-core/grid.js';
import { SKETCH_LIBRARY } from './sketch-library.js';
import {
  pictureRects, roughFor, tokenColor, roughStrokes, hachureStrokes, transformPath, fitAspect,
  fitText, writeLines, buildDrawable, textBlockHeight,
} from './common.js';

const LABEL_GAP = 10;
/** Doodle height (px): Sal's tiny pictures are 60–120 px tall on a 1600 board. */
export const DOODLE_HEIGHT = 110;
export const DOODLE_MIN_HEIGHT = 60;
export const DOODLE_MAX_HEIGHT = 120;

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

/** The doodle rect for a shape inside `area`: DOODLE_HEIGHT tall (aspect kept), shrunk only when the area is smaller, centred. */
function doodleRect(aspect, area) {
  const box = { w: Math.min(area.w, DOODLE_HEIGHT * aspect), h: Math.min(area.h, DOODLE_HEIGHT) };
  return fitAspect(aspect, { x: area.x + (area.w - box.w) / 2, y: area.y + (area.h - box.h) / 2, w: box.w, h: box.h });
}

/**
 * prepare(element, ctx) for `sketch`.
 * Layout: the doodle and its label form one group centred in the safe rect. The label goes beside
 * the doodle (to its right, vertically centred) when the slot is wider than tall and a single body
 * line fits; otherwise beneath it, centred. Label style body → note, ≤ 2 lines.
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
  let shapeRect = doodleRect(def.aspect, safe);
  let labelFit = null;
  let labelBox = null;

  if (label) {
    const span = slotSpan(element.slot);
    const wide = span.cols > span.rows;
    const oneLine = fitText(label, safe.w, { styles: ['body'], maxLines: 1 });
    const doodleW = Math.min(safe.w, DOODLE_HEIGHT * def.aspect);
    if (wide && oneLine.lines.length === 1 && doodleW + LABEL_GAP + oneLine.width <= safe.w) {
      // beside: [doodle][gap][label] centred as a group
      placement = 'beside';
      labelFit = oneLine;
      const labelH = textBlockHeight(labelFit.style, 1);
      const groupW = doodleW + LABEL_GAP + labelFit.width;
      const x0 = safe.x + (safe.w - groupW) / 2;
      shapeRect = doodleRect(def.aspect, { x: x0, y: safe.y, w: doodleW, h: safe.h });
      labelBox = { x: shapeRect.x + shapeRect.w + LABEL_GAP, y: shapeRect.y + shapeRect.h / 2 - labelH / 2, w: labelFit.width, h: labelH };
    } else {
      // beneath: [doodle] over [label], the pair centred vertically
      placement = 'beneath';
      labelFit = fitText(label, safe.w, { styles: ['body', 'note'], maxLines: 2 });
      const labelH = textBlockHeight(labelFit.style, labelFit.lines.length);
      const avail = { x: safe.x, y: safe.y, w: safe.w, h: Math.max(10, safe.h - labelH - LABEL_GAP) };
      const probe = doodleRect(def.aspect, avail);
      const groupH = probe.h + LABEL_GAP + labelH;
      const y0 = safe.y + Math.max(0, (safe.h - groupH) / 2);
      shapeRect = { x: probe.x, y: y0, w: probe.w, h: probe.h };
      labelBox = { x: safe.x, y: Math.min(shapeRect.y + shapeRect.h + LABEL_GAP, safe.y + safe.h - labelH), w: safe.w, h: labelH };
    }
  }

  const shapeStrokes = [];
  for (const prim of def.primitives) shapeStrokes.push(...primitiveStrokes(prim, shapeRect, r, color));
  const parts = [{ kind: 'shape', strokes: shapeStrokes, meta: { shape: shapeName, rect: shapeRect } }];

  if (label) {
    const written = writeLines(labelFit.lines, labelFit.style, labelBox.x, labelBox.y, labelBox.w, color, { align: placement === 'beside' ? 'left' : 'center' });
    parts.push({ kind: 'label', strokes: written.strokes, meta: { style: labelFit.style, lines: labelFit.lines, box: written.box, placement } });
  }

  return buildDrawable({
    id: element.id,
    type: 'sketch',
    parts,
    fallbackRect: inner,
    picture: { kind: 'sketch', shape: shapeName, aspect: def.aspect, shapeRect, labelPlacement: placement, labelStyle: labelFit ? labelFit.style : null, slotRect: outer, safeRect: safe },
  });
}
