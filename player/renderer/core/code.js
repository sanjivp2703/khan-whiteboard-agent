// player/renderer/core/code.js — `code` drawable: handwriting at the fixed CODE_CHAR_ADVANCE,
// lines in order, inside a faint rough frame (muted) around the slot inner rect. `lang` is
// accepted and ignored visually; tabs are rendered as two spaces (validation rejects them).
import { measureCode } from '../../../shared/layout-core/measure.js';
import { SLOT_PAD } from '../../../shared/layout-core/constants.js';
import { colorOf } from '../../../shared/layout-core/tokens.js';
import { rectInset } from '../../../shared/layout-core/grid.js';
import { buildDrawable, blockStrokes, roughFit, roughRect, roughStrokes, expandRect, elementColor, requireField, ROUGH_ENVELOPE } from './drawable.js';

/** Frame inset from the slot rect: inside SLOT_PAD so its wobble envelope stays in the slot. */
const FRAME_INSET = SLOT_PAD - ROUGH_ENVELOPE;

export function normalizeCodeLine(line) {
  return String(line ?? '').replace(/\t/g, '  ');
}

export function prepareCode(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const rawLines = requireField(el, 'lines');
  if (!Array.isArray(rawLines)) throw new Error(`renderer-core: code "${el.id}" lines must be an array`);
  const lines = rawLines.map(normalizeCodeLine);
  const rect = ctx.slotRect(slot);
  const m = measureCode({ ...el, lines }, rect);
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const frameRect = rectInset(rect, FRAME_INSET);
  const envelope = expandRect(frameRect, ROUGH_ENVELOPE);
  const framePaths = roughFit(seed, envelope, (r) => roughRect(r, frameRect.x, frameRect.y, frameRect.w, frameRect.h));
  const strokes = roughStrokes(framePaths, colorOf('muted'), { kind: 'faint', frame: true });
  const { strokes: text, lineRects } = blockStrokes(lines, 'code', m.inner.x, m.inner.y, color, seed + 1);
  strokes.push(...text);
  return buildDrawable({
    id: el.id,
    type: 'code',
    parts: [strokes],
    partStarts: [0],
    extraBounds: [envelope],
    meta: { inner: m.inner, lines, lineRects, lineHeight: m.lineHeight, charAdvance: m.charAdvance, frameRect },
  });
}
