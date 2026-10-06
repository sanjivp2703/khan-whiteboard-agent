// player/renderer/core/list.js — `list` drawable: items one at a time (parts), a rough bullet
// or a hand-written number per item, text wrapped at inner.w − bulletIndent (measure.js).
import { measureList } from '../../../shared/layout-core/measure.js';
import { LIST_LAYOUT } from '../../../shared/layout-core/constants.js';
import { lineHeight } from '../../../shared/handwriting.js';
import { buildDrawable, blockStrokes, lineStrokes, baselineFor, roughFit, roughStrokes, expandRect, elementColor, requireField, ROUGH_ENVELOPE } from './drawable.js';
import { partStartsFor } from './timing-window.js';

const BULLET_DIA = 8;

export function prepareList(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const items = requireField(el, 'items');
  if (!Array.isArray(items)) throw new Error(`renderer-core: list "${el.id}" items must be an array`);
  const rect = ctx.slotRect(slot);
  const m = measureList(el, rect);
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const style = m.style;
  const lh = lineHeight(style);
  const textX = m.inner.x + LIST_LAYOUT.bulletIndent;
  const parts = [];
  const extraBounds = [];
  const itemMeta = [];
  m.items.forEach((item, i) => {
    const top = m.inner.y + item.y;
    const baseline = baselineFor(style, top);
    const strokes = [];
    if (el.ordered === true) {
      const { strokes: num } = lineStrokes(`${i + 1}.`, style, m.inner.x, baseline, color, seed + 7 * (i + 1), { marker: true, item: i });
      strokes.push(...num);
    } else {
      const cx = m.inner.x + 10;
      const cy = baseline - lh * 0.28;
      const ideal = { x: cx - BULLET_DIA / 2, y: cy - BULLET_DIA / 2, w: BULLET_DIA, h: BULLET_DIA };
      const envelope = expandRect(ideal, ROUGH_ENVELOPE);
      // rough.circle's radius jitter (≈6 %) is negligible at bullet size, so the native circle is used here
      const paths = roughFit(seed + 7 * (i + 1), envelope, (r) => r.circle(cx, cy, BULLET_DIA));
      strokes.push(...roughStrokes(paths, color, { marker: true, item: i, lineWidth: 2 }));
      extraBounds.push(envelope);
    }
    const { strokes: text, lineRects } = blockStrokes(item.lines, style, textX, top, color, seed + 97 * (i + 1), { meta: { item: i } });
    strokes.push(...text);
    parts.push(strokes);
    itemMeta.push({ index: i, top, lines: item.lines, lineRects, height: item.height });
  });
  return buildDrawable({
    id: el.id,
    type: 'list',
    parts,
    partStarts: partStartsFor(parts.length, el, ctx),
    extraBounds,
    fallbackBounds: { x: m.inner.x, y: m.inner.y, w: 0, h: 0 },
    meta: { inner: m.inner, items: itemMeta, ordered: el.ordered === true, style },
  });
}
