// player/renderer/core/box.js — `box` drawable: a rough rectangle around the slot rect inset by
// SLOT_PAD/2, with an optional hand-written note-size label at the top-left inside the stroke.
import { SLOT_PAD, BOX_LAYOUT } from '../../../shared/layout-core/constants.js';
import { rectInset, rectContainsRect } from '../../../shared/layout-core/grid.js';
import { wrap } from '../../../shared/handwriting.js';
import { buildDrawable, blockStrokes, roughFit, roughRect, roughStrokes, expandRect, boundsOfPaths, elementColor, requireField, ROUGH_ENVELOPE } from './drawable.js';

export const BOX_INSET = SLOT_PAD / 2;
const LABEL_PAD_X = 10;

/** Rectangle the box stroke follows (ideal geometry; wobble stays within ROUGH_ENVELOPE). */
export function boxRect(slotRectValue) {
  return rectInset(slotRectValue, BOX_INSET);
}

export function prepareBox(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const rect = ctx.slotRect(slot);
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const frame = boxRect(rect);
  const envelope = expandRect(frame, Math.min(ROUGH_ENVELOPE, BOX_INSET - 1));
  const paths = roughFit(seed, envelope, (r) => roughRect(r, frame.x, frame.y, frame.w, frame.h));
  const strokes = roughStrokes(paths, color, { frame: true });
  let labelRects = [];
  if (typeof el.label === 'string' && el.label.trim() !== '') {
    const style = BOX_LAYOUT.labelStyle;
    const maxW = Math.max(20, frame.w - 2 * LABEL_PAD_X);
    const lines = wrap(el.label, style, maxW);
    const { strokes: text, lineRects } = blockStrokes(lines, style, frame.x + LABEL_PAD_X, frame.y + BOX_LAYOUT.labelPad, color, seed + 1, { meta: { label: true } });
    // labels are not fit-validated upstream: never let a glyph escape the slot
    for (const s of text) {
      const b = boundsOfPaths([s.d]);
      if (!b || rectContainsRect(rect, b)) strokes.push(s);
    }
    labelRects = lineRects;
  }
  return buildDrawable({
    id: el.id,
    type: 'box',
    parts: [strokes],
    partStarts: [0],
    extraBounds: [envelope],
    meta: { frame, labelRects, label: el.label || null },
  });
}
