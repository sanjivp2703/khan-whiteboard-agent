// shared/layout-core/grid.js — slot parsing and cell geometry (spec §4.4, brief 00 C1).
import { CANVAS_W, CANVAS_H, MARGIN, COLS, ROWS, CELL_W, CELL_H, COL_LETTERS, REGEX, SLOT_PAD } from './constants.js';

export class SlotError extends Error {
  constructor(message, slot) {
    super(message);
    this.name = 'SlotError';
    this.code = 'BAD_SLOT';
    this.slot = slot;
  }
}

/** Parse "B2" or "B2:D3" into 0-based inclusive bounds {c0, r0, c1, r1}. Throws SlotError. */
export function parseSlot(slot) {
  if (typeof slot !== 'string') throw new SlotError(`slot must be a string, got ${typeof slot}`, slot);
  const m = REGEX.slot.exec(slot);
  if (!m) throw new SlotError(`slot "${slot}" is not "<A-F><1-4>" or "<A-F><1-4>:<A-F><1-4>"`, slot);
  const c0 = COL_LETTERS.indexOf(m[1]);
  const r0 = Number(m[2]) - 1;
  const c1 = m[3] ? COL_LETTERS.indexOf(m[3]) : c0;
  const r1 = m[4] ? Number(m[4]) - 1 : r0;
  if (c1 < c0 || r1 < r0) throw new SlotError(`slot "${slot}" must run top-left to bottom-right`, slot);
  return { c0, r0, c1, r1 };
}

export function isValidSlot(slot) {
  try { parseSlot(slot); return true; } catch { return false; }
}

export function cellName(c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) throw new SlotError(`cell (${c},${r}) out of bounds`, null);
  return COL_LETTERS[c] + String(r + 1);
}

export function cellRect(c, r) {
  return { x: MARGIN + CELL_W * c, y: MARGIN + CELL_H * r, w: CELL_W, h: CELL_H };
}

/** Board-pixel rectangle of a slot. slotRect("B2:D3") = {x:300,y:250,w:750,h:400}. */
export function slotRect(slot) {
  const b = typeof slot === 'string' ? parseSlot(slot) : slot;
  return {
    x: MARGIN + CELL_W * b.c0,
    y: MARGIN + CELL_H * b.r0,
    w: CELL_W * (b.c1 - b.c0 + 1),
    h: CELL_H * (b.r1 - b.r0 + 1),
  };
}

/** Cell names covered by a slot, row-major. */
export function slotCells(slot) {
  const b = typeof slot === 'string' ? parseSlot(slot) : slot;
  const out = [];
  for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) out.push(cellName(c, r));
  return out;
}

/** {cols, rows, cells} of a slot. */
export function slotSpan(slot) {
  const b = typeof slot === 'string' ? parseSlot(slot) : slot;
  const cols = b.c1 - b.c0 + 1;
  const rows = b.r1 - b.r0 + 1;
  return { cols, rows, cells: cols * rows };
}

/** True when every cell of `inner` lies inside `outer`. */
export function slotContains(outer, inner) {
  const a = typeof outer === 'string' ? parseSlot(outer) : outer;
  const b = typeof inner === 'string' ? parseSlot(inner) : inner;
  return b.c0 >= a.c0 && b.c1 <= a.c1 && b.r0 >= a.r0 && b.r1 <= a.r1;
}

/** True when two slots share at least one cell. */
export function slotsIntersect(s1, s2) {
  const a = typeof s1 === 'string' ? parseSlot(s1) : s1;
  const b = typeof s2 === 'string' ? parseSlot(s2) : s2;
  return !(b.c0 > a.c1 || b.c1 < a.c0 || b.r0 > a.r1 || b.r1 < a.r0);
}

/** Rectangle shrunk by `pad` on every side (the content inset). */
export function rectInset(rect, pad = SLOT_PAD) {
  return { x: rect.x + pad, y: rect.y + pad, w: Math.max(0, rect.w - 2 * pad), h: Math.max(0, rect.h - 2 * pad) };
}

/** Inner (content) rectangle of a slot: slotRect minus SLOT_PAD. */
export function slotInnerRect(slot) {
  return rectInset(slotRect(slot), SLOT_PAD);
}

export function rectContainsRect(outer, inner, eps = 0.001) {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}

export function rectCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Union bounding box of rectangles. */
export function rectUnion(...rects) {
  const xs0 = Math.min(...rects.map((r) => r.x));
  const ys0 = Math.min(...rects.map((r) => r.y));
  const xs1 = Math.max(...rects.map((r) => r.x + r.w));
  const ys1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: xs0, y: ys0, w: xs1 - xs0, h: ys1 - ys0 };
}

/** All 24 cell names, row-major. */
export const ALL_CELLS = Object.freeze((() => {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push(cellName(c, r));
  return out;
})());

export const BOARD_RECT = Object.freeze({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H });
export const INNER_BOARD_RECT = Object.freeze({ x: MARGIN, y: MARGIN, w: CELL_W * COLS, h: CELL_H * ROWS });
