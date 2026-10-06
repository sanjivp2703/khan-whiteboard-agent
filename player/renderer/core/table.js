// player/renderer/core/table.js — `table` drawable: rough grid lines (muted) first, then cells
// written cell by cell row-major (one part per cell); header row underlined; equal column
// widths from the slot (measure.js), note-size text centred in each cell.
import { measureTable } from '../../../shared/layout-core/measure.js';
import { TABLE_LAYOUT } from '../../../shared/layout-core/constants.js';
import { colorOf } from '../../../shared/layout-core/tokens.js';
import { lineHeight } from '../../../shared/handwriting.js';
import { buildDrawable, blockStrokes, roughFit, roughRect, roughLine, roughStrokes, expandRect, elementColor, requireField, ROUGH_ENVELOPE } from './drawable.js';

export function prepareTable(el, ctx) {
  const slot = requireField(el, 'slot', 'string');
  const rows = requireField(el, 'rows');
  if (!Array.isArray(rows)) throw new Error(`renderer-core: table "${el.id}" rows must be an array`);
  const rect = ctx.slotRect(slot);
  const m = measureTable(el, rect);
  const color = elementColor(el);
  const muted = colorOf('muted');
  const seed = ctx.seed(el.id);
  const outer = { x: m.inner.x, y: m.inner.y, w: m.inner.w, h: m.height };
  const gridEnvelope = expandRect(outer, ROUGH_ENVELOPE);
  const rowTops = [];
  let y = outer.y;
  for (const rh of m.rowHeights) { rowTops.push(y); y += rh; }
  const colX = (c) => outer.x + c * m.colWidth;

  // part 0: the grid
  const gridPaths = roughFit(seed, gridEnvelope, (r) => {
    const out = [...roughRect(r, outer.x, outer.y, outer.w, outer.h)];
    for (let c = 1; c < m.cols; c++) out.push(...roughLine(r, colX(c), outer.y, colX(c), outer.y + outer.h));
    for (let ri = 1; ri < rowTops.length; ri++) out.push(...roughLine(r, outer.x, rowTops[ri], outer.x + outer.w, rowTops[ri]));
    return out;
  });
  const parts = [roughStrokes(gridPaths, muted, { grid: true, lineWidth: 1.8 })];
  const extraBounds = [gridEnvelope];
  const cellMeta = [];
  const lh = lineHeight(m.style);
  const header = el.header === true;
  m.cells.forEach((rowCells, ri) => {
    rowCells.forEach((cell, ci) => {
      const cx = colX(ci);
      const cellRect = { x: cx, y: rowTops[ri], w: m.colWidth, h: m.rowHeights[ri] };
      const textH = cell.lines.length * lh;
      const top = cellRect.y + Math.max(0, (cellRect.h - textH) / 2);
      const strokes = [];
      const { strokes: text, lineRects } = blockStrokes(cell.lines, m.style, cx + TABLE_LAYOUT.cellPad, top, color, seed + 13 * (ri * 16 + ci + 1), {
        align: 'center', width: m.colWidth - 2 * TABLE_LAYOUT.cellPad, meta: { row: ri, col: ci },
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
      cellMeta.push({ row: ri, col: ci, rect: cellRect, lines: cell.lines, lineRects });
    });
  });
  return buildDrawable({
    id: el.id,
    type: 'table',
    parts,
    extraBounds,
    meta: { inner: m.inner, outer, cols: m.cols, rows: rows.length, colWidth: m.colWidth, rowTops, rowHeights: m.rowHeights, cells: cellMeta, header, style: m.style },
  });
}
