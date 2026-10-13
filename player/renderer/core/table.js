// player/renderer/core/table.js — `table` drawable, gridless the way Sal draws tables
// (change-khan-feel, study §4 item 10, V5 3:20–4:09): no grid lines; the header row is
// underlined; cells are written cell by cell row-major (one part per cell), left-aligned in
// their column; every row after the first takes the next accent after the element's colour
// (wrapping around the five accents). Column widths and row heights come from measure.js,
// so the validator's fit is unchanged.
import { measureTable } from '../../../shared/layout-core/measure.js';
import { TABLE_LAYOUT } from '../../../shared/layout-core/constants.js';
import { colorOf, tokens } from '../../../shared/layout-core/tokens.js';
import { lineHeight } from '../../../shared/handwriting.js';
import { buildDrawable, blockStrokes, roughFit, roughLine, roughStrokes, expandRect, elementColor, requireField, ROUGH_ENVELOPE } from './drawable.js';

export const ACCENTS = Object.freeze(['accent1', 'accent2', 'accent3', 'accent4', 'accent5']);

/**
 * Colour token of table row `r` for an element colour token `base`: row 0 keeps `base`; row r ≥ 1
 * is the r-th accent after `base` (wrapping). A non-accent base (chalk, muted) counts as "before accent1".
 */
export function rowColorToken(base, r) {
  if (r === 0) return base;
  const i = ACCENTS.indexOf(base);
  return ACCENTS[(i + r) % ACCENTS.length];
}

export function prepareTable(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const rows = requireField(el, 'rows');
  if (!Array.isArray(rows)) throw new Error(`renderer-core: table "${el.id}" rows must be an array`);
  const rect = ctx.slotRect(slot);
  const m = measureTable(el, rect);
  const baseToken = typeof el.color === 'string' && (ACCENTS.includes(el.color) || el.color === 'muted') ? el.color : 'chalk';
  const seed = ctx.seed(el.id);
  const outer = { x: m.inner.x, y: m.inner.y, w: m.inner.w, h: m.height };
  const rowTops = [];
  let y = outer.y;
  for (const rh of m.rowHeights) { rowTops.push(y); y += rh; }
  const colX = (c) => outer.x + c * m.colWidth;

  const parts = [];
  const extraBounds = [];
  const cellMeta = [];
  const rowColors = [];
  const lh = lineHeight(m.style);
  const header = el.header === true;
  m.cells.forEach((rowCells, ri) => {
    const token = rowColorToken(baseToken, ri);
    const color = ri === 0 ? elementColor(el) : colorOf(token);
    rowColors.push(token === 'chalk' ? tokens.chalk : color);
    rowCells.forEach((cell, ci) => {
      const cx = colX(ci);
      const cellRect = { x: cx, y: rowTops[ri], w: m.colWidth, h: m.rowHeights[ri] };
      const textH = cell.lines.length * lh;
      const top = cellRect.y + Math.max(0, (cellRect.h - textH) / 2);
      const strokes = [];
      const { strokes: text, lineRects } = blockStrokes(cell.lines, m.style, cx + TABLE_LAYOUT.cellPad, top, color, seed + 13 * (ri * 16 + ci + 1), {
        align: 'left', meta: { row: ri, col: ci }, hand: { key: `${el.id}:r${ri}c${ci}` },
      });
      strokes.push(...text);
      if (header && ri === 0) {
        const uy = cellRect.y + cellRect.h - 4;
        const x1 = cx + TABLE_LAYOUT.cellPad, x2 = cx + m.colWidth - TABLE_LAYOUT.cellPad;
        const env = expandRect({ x: x1, y: uy, w: x2 - x1, h: 0 }, ROUGH_ENVELOPE);
        const paths = roughFit(seed + 977 * (ci + 1), env, (r) => roughLine(r, x1, uy, x2, uy));
        strokes.push(...roughStrokes(paths, color, { headerUnderline: true, row: ri, col: ci }));
        extraBounds.push(env);
      }
      parts.push(strokes);
      cellMeta.push({ row: ri, col: ci, rect: cellRect, lines: cell.lines, lineRects, color });
    });
  });
  return buildDrawable({
    id: el.id,
    type: 'table',
    parts,
    extraBounds,
    fallbackBounds: { x: m.inner.x, y: m.inner.y, w: 0, h: 0 },
    meta: { inner: m.inner, outer, cols: m.cols, rows: rows.length, colWidth: m.colWidth, rowTops, rowHeights: m.rowHeights, cells: cellMeta, header, style: m.style, grid: false, rowColors },
  });
}
