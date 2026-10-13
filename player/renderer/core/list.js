// player/renderer/core/list.js — `list` drawable: items one at a time (parts). Unordered lists
// draw no marker (indent only, the way Sal stacks lines — change-khan-feel, study §4 item 12);
// ordered lists get a hand-written number per item. Text is wrapped at inner.w − bulletIndent
// (measure.js), so measurement is unchanged either way.
import { measureList } from '../../../shared/layout-core/measure.js';
import { LIST_LAYOUT } from '../../../shared/layout-core/constants.js';
import { buildDrawable, blockStrokes, lineStrokes, baselineFor, elementColor, requireField } from './drawable.js';
import { partStartsFor } from './timing-window.js';

export function prepareList(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const items = requireField(el, 'items');
  if (!Array.isArray(items)) throw new Error(`renderer-core: list "${el.id}" items must be an array`);
  const rect = ctx.slotRect(slot);
  const m = measureList(el, rect);
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const style = m.style;
  const textX = m.inner.x + LIST_LAYOUT.bulletIndent;
  const parts = [];
  const itemMeta = [];
  const ordered = el.ordered === true;
  m.items.forEach((item, i) => {
    const top = m.inner.y + item.y;
    const baseline = baselineFor(style, top);
    const strokes = [];
    if (ordered) {
      const { strokes: num } = lineStrokes(`${i + 1}.`, style, m.inner.x, baseline, color, seed + 7 * (i + 1), { marker: true, item: i }, { key: `${el.id}:n${i}` });
      strokes.push(...num);
    }
    const { strokes: text, lineRects } = blockStrokes(item.lines, style, textX, top, color, seed + 97 * (i + 1), { meta: { item: i }, hand: { key: `${el.id}:i${i}` } });
    strokes.push(...text);
    parts.push(strokes);
    itemMeta.push({ index: i, top, lines: item.lines, lineRects, height: item.height });
  });
  return buildDrawable({
    id: el.id,
    type: 'list',
    parts,
    partStarts: partStartsFor(parts.length, el, ctx),
    fallbackBounds: { x: m.inner.x, y: m.inner.y, w: 0, h: 0 },
    meta: { inner: m.inner, items: itemMeta, ordered, marker: ordered ? 'number' : 'none', style },
  });
}
