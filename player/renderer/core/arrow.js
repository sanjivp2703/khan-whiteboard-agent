// player/renderer/core/arrow.js — `arrow` drawable: a rough line from the edge of the `from`
// element's content rect to the edge of the `to` element's content rect (facing edges, never
// centres, never through either interior), a rough arrowhead, optional note-size label placed
// beside the midpoint where it overlaps neither rect.
import { SLOT_PAD, CANVAS_W } from '../../../shared/layout-core/constants.js';
import { rectInset } from '../../../shared/layout-core/grid.js';
import { textWidth, lineHeight, wrap } from '../../../shared/handwriting.js';
import { buildDrawable, blockStrokes, roughFit, roughLine, roughStrokes, expandRect, rectsIntersect, clampRectInto, elementColor, requireField, ROUGH_ENVELOPE, BOARD_BOUNDS } from './drawable.js';

export const HEAD_LEN = 16;
export const HEAD_HALF = 8;
const LABEL_STYLE = 'note';
const LABEL_GAP = 10;

/** Rect an arrow attaches to: the element's slot rect inset by SLOT_PAD (its content area). */
export function attachRect(boardRect) {
  return rectInset(boardRect, SLOT_PAD);
}

function overlap(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  return hi > lo ? [lo, hi] : null;
}

/**
 * Anchor points on the facing edges of rects A and B.
 * @returns {{p1:{x,y}, p2:{x,y}, axis:'h'|'v', fromEdge:string, toEdge:string}}
 */
export function arrowAnchors(A, B) {
  const ax1 = A.x + A.w, ay1 = A.y + A.h, bx1 = B.x + B.w, by1 = B.y + B.h;
  const xo = overlap(A.x, ax1, B.x, bx1);
  const yo = overlap(A.y, ay1, B.y, by1);
  const acx = A.x + A.w / 2, acy = A.y + A.h / 2, bcx = B.x + B.w / 2, bcy = B.y + B.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  let axis;
  if (xo && !yo) axis = 'v';
  else if (yo && !xo) axis = 'h';
  else axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  if (axis === 'v') {
    const cx = xo ? (xo[0] + xo[1]) / 2 : null;
    if (dy >= 0) return { p1: { x: cx ?? acx, y: ay1 }, p2: { x: cx ?? bcx, y: B.y }, axis, fromEdge: 'bottom', toEdge: 'top' };
    return { p1: { x: cx ?? acx, y: A.y }, p2: { x: cx ?? bcx, y: by1 }, axis, fromEdge: 'top', toEdge: 'bottom' };
  }
  const cy = yo ? (yo[0] + yo[1]) / 2 : null;
  if (dx >= 0) return { p1: { x: ax1, y: cy ?? acy }, p2: { x: B.x, y: cy ?? bcy }, axis, fromEdge: 'right', toEdge: 'left' };
  return { p1: { x: A.x, y: cy ?? acy }, p2: { x: bx1, y: cy ?? bcy }, axis, fromEdge: 'left', toEdge: 'right' };
}

/** Arrowhead wing points for a shaft ending at p2 coming from p1. */
export function headPoints(p1, p2) {
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len;
  const bx = p2.x - ux * HEAD_LEN, by = p2.y - uy * HEAD_LEN;
  return [
    { x: bx + -uy * HEAD_HALF, y: by + ux * HEAD_HALF },
    { x: bx - -uy * HEAD_HALF, y: by - ux * HEAD_HALF },
  ];
}

/**
 * Label box beside the midpoint: perpendicular to the shaft, pushed outwards until it clears
 * both rects (first the "natural" side, then the other), clamped into the canvas.
 */
export function placeLabel(p1, p2, w, h, rects) {
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len;
  let nx = -uy, ny = ux;                 // perpendicular
  if (Math.abs(ny) >= Math.abs(nx) ? ny > 0 : nx < 0) { nx = -nx; ny = -ny; } // prefer up / right
  // far enough along the normal that the label box clears the shaft whatever its angle
  const base = LABEL_GAP + Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
  const candidates = [];
  for (const side of [1, -1]) for (let d = base; d <= 220; d += 8) candidates.push({ side, d });
  let fallback = null;
  for (const { side, d } of candidates) {
    const cx = mx + side * nx * d, cy = my + side * ny * d;
    const r = clampRectInto({ x: cx - w / 2, y: cy - h / 2, w, h }, BOARD_BOUNDS);
    if (!fallback) fallback = r;
    if (!rects.some((R) => rectsIntersect(R, r))) return r;
  }
  return fallback;
}

export function prepareArrow(el, ctx) {
  const from = requireField(el, 'from', 'string');
  const to = requireField(el, 'to', 'string');
  const fromRect = ctx.boardRects.get(from);
  const toRect = ctx.boardRects.get(to);
  if (!fromRect || !toRect) throw new Error(`renderer-core: arrow "${el.id}" references "${!fromRect ? from : to}", which is not on the board`);
  const A = attachRect(fromRect), B = attachRect(toRect);
  const { p1, p2, axis, fromEdge, toEdge } = arrowAnchors(A, B);
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const [w1, w2] = headPoints(p1, p2);
  const shaftEnv = expandRect(rectFromPoints([p1, p2]), ROUGH_ENVELOPE);
  const headEnv = expandRect(rectFromPoints([p2, w1, w2]), ROUGH_ENVELOPE);
  const shaft = roughFit(seed, shaftEnv, (r) => roughLine(r, p1.x, p1.y, p2.x, p2.y));
  const head = roughFit(seed + 1, headEnv, (r) => [...roughLine(r, w1.x, w1.y, p2.x, p2.y), ...roughLine(r, w2.x, w2.y, p2.x, p2.y)]);
  const strokes = [...roughStrokes(shaft, color, { shaft: true }), ...roughStrokes(head, color, { head: true })];
  const extraBounds = [shaftEnv, headEnv];
  let labelRect = null;
  if (typeof el.label === 'string' && el.label.trim() !== '') {
    const lines = wrap(el.label, LABEL_STYLE, CANVAS_W / 3);
    const w = Math.max(...lines.map((l) => textWidth(l, LABEL_STYLE)));
    const h = lines.length * lineHeight(LABEL_STYLE);
    labelRect = placeLabel(p1, p2, w, h, [A, B]);
    const { strokes: text } = blockStrokes(lines, LABEL_STYLE, labelRect.x, labelRect.y, color, seed + 2, { meta: { label: true } });
    strokes.push(...text);
  }
  return buildDrawable({
    id: el.id,
    type: 'arrow',
    parts: [strokes],
    partStarts: [0],
    extraBounds,
    meta: { from, to, fromRect: A, toRect: B, p1, p2, axis, fromEdge, toEdge, head: [w1, w2], labelRect, label: el.label || null },
  });
}

function rectFromPoints(pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

