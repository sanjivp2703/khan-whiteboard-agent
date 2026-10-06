// player/renderer/core/text.js — `text` drawable: handwriting wrapped to the slot inner width
// (shared measure.js, so fit agrees with the validator), revealed glyph by glyph.
import { measureTextElement } from '../../../shared/layout-core/measure.js';
import { buildDrawable, blockStrokes, elementColor, requireField } from './drawable.js';

export function prepareText(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const text = requireField(el, 'text', 'string');
  const rect = ctx.slotRect(slot);
  const m = measureTextElement({ ...el, text }, rect);
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const { strokes, lineRects } = blockStrokes(m.lines, m.style, m.inner.x, m.inner.y, color, seed);
  return buildDrawable({
    id: el.id,
    type: 'text',
    parts: [strokes],
    partStarts: [0],
    fallbackBounds: { x: m.inner.x, y: m.inner.y, w: 0, h: 0 },
    meta: { style: m.style, lines: m.lines, lineRects, inner: m.inner, lineHeight: m.lineHeight },
  });
}
