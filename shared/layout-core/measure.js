// shared/layout-core/measure.js — pure, deterministic fit measurement for text, list,
// code, table and math elements. Used by the validator (server) and the drawables
// (player) so both agree on what fits. Requires the handwriting font to be loaded
// (shared/handwriting.js loadFont) for text/list/table; code and math are font-free.
import { wrapDetailed, lineHeight, textWidth } from '../handwriting.js';
import { rectInset, slotSpan } from './grid.js';
import { CAPS, CODE_CHAR_ADVANCE, LINE_HEIGHTS, LIST_LAYOUT, TABLE_LAYOUT, MATH_LAYOUT, DEFAULT_TEXT_STYLE, SLOT_PAD } from './constants.js';

/** Words of a string: whitespace-separated non-empty tokens. */
export function countWords(str) {
  if (typeof str !== 'string') return 0;
  return str.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Word cap for a text element in a slot: min(10 × cells, 40). */
export function textWordCap(slot) {
  const { cells } = slotSpan(slot);
  return Math.min(CAPS.textWordsPerCell * cells, CAPS.textWordsMax);
}

function reason(code, message) { return { code, message }; }

/**
 * Measure a `text` element inside `rect` (the slot rect; SLOT_PAD is applied here).
 * @returns {{style, inner, lines:string[], lineHeight:number, width:number, height:number, fits:boolean, reasons:Array}}
 */
export function measureTextElement(el, rect) {
  const style = el.style || DEFAULT_TEXT_STYLE;
  const inner = rectInset(rect, SLOT_PAD);
  const { lines, hardSplit } = wrapDetailed(el.text ?? '', style, inner.w);
  const lh = lineHeight(style);
  const height = lines.length * lh;
  const width = Math.max(0, ...lines.map((l) => textWidth(l, style)));
  const reasons = [];
  if (hardSplit) reasons.push(reason('OVERFLOW', `a word is wider than the slot (${inner.w} px) at style ${style}`));
  if (height > inner.h) reasons.push(reason('OVERFLOW', `${lines.length} lines × ${lh} px = ${height} px exceed the slot height ${inner.h} px`));
  return { style, inner, lines, lineHeight: lh, width, height, fits: reasons.length === 0, reasons };
}

/**
 * Measure a `list` element: each item wrapped at inner.w − bulletIndent, items stacked with itemGap.
 */
export function measureList(el, rect) {
  const style = LIST_LAYOUT.style;
  const inner = rectInset(rect, SLOT_PAD);
  const textW = inner.w - LIST_LAYOUT.bulletIndent;
  const lh = lineHeight(style);
  const items = [];
  const reasons = [];
  let height = 0;
  const list = Array.isArray(el.items) ? el.items : [];
  list.forEach((item, i) => {
    const { lines, hardSplit } = wrapDetailed(String(item ?? ''), style, textW);
    if (hardSplit) reasons.push(reason('OVERFLOW', `item ${i + 1}: a word is wider than the list text width (${textW} px)`));
    const h = lines.length * lh;
    items.push({ text: String(item ?? ''), lines, height: h, y: height });
    height += h + (i + 1 < list.length ? LIST_LAYOUT.itemGap : 0);
  });
  if (height > inner.h) reasons.push(reason('OVERFLOW', `list height ${height} px exceeds slot height ${inner.h} px`));
  return { style, inner, items, lineHeight: lh, height, fits: reasons.length === 0, reasons };
}

/**
 * Measure a `code` element: fixed advance, fixed line height; caps per span plus pixel fit.
 */
export function measureCode(el, rect) {
  const inner = rectInset(rect, SLOT_PAD);
  const { cols, rows } = slotSpan(el.slot);
  const lines = Array.isArray(el.lines) ? el.lines.map((l) => String(l ?? '')) : [];
  const lh = LINE_HEIGHTS.code;
  const lineCap = CAPS.codeLinesPerRow * rows;
  const charCap = CAPS.codeCharsPerCol * cols;
  const maxChars = Math.max(0, ...lines.map((l) => [...l].length));
  const reasons = [];
  if (lines.length > lineCap) reasons.push(reason('CAP_LINES', `${lines.length} lines exceed ${lineCap} (7 × rowSpan ${rows})`));
  if (maxChars > charCap) reasons.push(reason('CAP_CHARS', `a line has ${maxChars} chars, cap is ${charCap} (22 × colSpan ${cols})`));
  const height = lines.length * lh;
  const width = maxChars * CODE_CHAR_ADVANCE;
  if (reasons.length === 0) { // pixel fit only matters once the caps pass (one fault, one code)
    if (height > inner.h) reasons.push(reason('OVERFLOW', `code height ${height} px exceeds slot height ${inner.h} px`));
    if (width > inner.w) reasons.push(reason('OVERFLOW', `code width ${width} px exceeds slot width ${inner.w} px`));
  }
  return { inner, lines, lineHeight: lh, charAdvance: CODE_CHAR_ADVANCE, lineCap, charCap, width, height, fits: reasons.length === 0, reasons };
}

/**
 * Measure a `table` element: equal column widths; cells wrapped at note style up to
 * TABLE_LAYOUT.maxCellLines lines; row height from the tallest cell; total height must fit.
 */
export function measureTable(el, rect) {
  const style = TABLE_LAYOUT.style;
  const inner = rectInset(rect, SLOT_PAD);
  const rows = Array.isArray(el.rows) ? el.rows : [];
  const cols = rows.length ? Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0))) : 0;
  const colWidth = cols ? inner.w / cols : inner.w;
  const textW = colWidth - 2 * TABLE_LAYOUT.cellPad;
  const lh = lineHeight(style);
  const reasons = [];
  const cells = [];
  const rowHeights = [];
  let height = 0;
  rows.forEach((row, ri) => {
    const rowCells = [];
    let maxLines = 1;
    (Array.isArray(row) ? row : []).forEach((cell, ci) => {
      const { lines, hardSplit } = wrapDetailed(String(cell ?? ''), style, textW);
      if (hardSplit) reasons.push(reason('OVERFLOW', `cell r${ri + 1}c${ci + 1}: a word is wider than the column (${Math.floor(textW)} px)`));
      if (lines.length > TABLE_LAYOUT.maxCellLines) reasons.push(reason('OVERFLOW', `cell r${ri + 1}c${ci + 1} wraps to ${lines.length} lines (max ${TABLE_LAYOUT.maxCellLines})`));
      maxLines = Math.max(maxLines, lines.length);
      rowCells.push({ text: String(cell ?? ''), lines });
    });
    const rh = maxLines * lh + 2 * TABLE_LAYOUT.cellPad;
    rowHeights.push(rh);
    cells.push(rowCells);
    height += rh;
  });
  if (height > inner.h) reasons.push(reason('OVERFLOW', `table height ${height} px exceeds slot height ${inner.h} px`));
  return { style, inner, cols, colWidth, rowHeights, cells, lineHeight: lh, height, fits: reasons.length === 0, reasons };
}

/**
 * Measure math lines from texToSvg dimensions ([{width, height}] in em) at MATH_LAYOUT.fontPx.
 */
export function measureMath(dims, rect) {
  const inner = rectInset(rect, SLOT_PAD);
  const px = MATH_LAYOUT.fontPx;
  const reasons = [];
  let height = 0;
  let width = 0;
  const lines = dims.map((d, i) => {
    const w = d.width * px;
    const h = Math.max(d.height * px, LINE_HEIGHTS.body);
    width = Math.max(width, w);
    const y = height;
    height += h + (i + 1 < dims.length ? MATH_LAYOUT.lineGap : 0);
    return { width: w, height: h, y, eqX: d.eqX === null || d.eqX === undefined ? null : d.eqX * px };
  });
  if (width > inner.w) reasons.push(reason('OVERFLOW', `math width ${Math.round(width)} px exceeds slot width ${inner.w} px`));
  if (height > inner.h) reasons.push(reason('OVERFLOW', `math height ${Math.round(height)} px exceeds slot height ${inner.h} px`));
  return { inner, lines, width, height, fontPx: px, fits: reasons.length === 0, reasons };
}
