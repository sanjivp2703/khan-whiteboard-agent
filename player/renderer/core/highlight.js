// player/renderer/core/highlight.js — `highlight` drawable: circle (rough ring), underline,
// strike, or pointer (draws nothing; the pen parks just left of the target). The target rect
// is the drawn extent of the target where it can be measured (text/code/list/table/math via
// the same measure.js the validator uses), else the element's content rect; `line` narrows a
// code target to one line.
import { SLOT_PAD, LINE_HEIGHTS } from '../../../shared/layout-core/constants.js';
import { rectInset } from '../../../shared/layout-core/grid.js';
import { measureTextElement, measureList, measureCode, measureTable } from '../../../shared/layout-core/measure.js';
import { textWidth } from '../../../shared/handwriting.js';
import { buildDrawable, roughFit, roughLine, roughEllipse, roughStrokes, expandRect, elementColor, requireField, ROUGH_ENVELOPE, BOARD_BOUNDS } from './drawable.js';
import { boxRect } from './box.js';
import { normalizeCodeLine } from './code.js';
import { compiledFor } from './math-compile.js';
import { mathLayout } from './math.js';

export const CIRCLE_MARGIN = 16;      // ideal ring margin; the wobble envelope adds ROUGH_ENVELOPE (≤ 20 total)
export const UNDERLINE_GAP = 3;
export const POINTER_GAP = 14;

/**
 * Target geometry: {rect, lastLine} where `rect` is the drawn extent used for circle/strike and
 * `lastLine` is the rect of the last text line (for underline). Falls back to the content rect.
 */
export function targetGeometry(targetEl, boardRect, line) {
  const content = rectInset(boardRect, SLOT_PAD);
  const fallback = { rect: content, lastLine: { x: content.x, y: content.y + content.h - 1, w: content.w, h: 1 } };
  if (!targetEl) return fallback;
  try {
    switch (targetEl.type) {
      case 'text': {
        const m = measureTextElement(targetEl, boardRect);
        const w = Math.max(1, m.width);
        const rect = { x: m.inner.x, y: m.inner.y, w, h: Math.max(1, m.height) };
        const last = m.lines.length - 1;
        const lastLine = { x: m.inner.x, y: m.inner.y + last * m.lineHeight, w: Math.max(1, textWidth(m.lines[last] || '', m.style)), h: m.lineHeight };
        return { rect, lastLine };
      }
      case 'code': {
        const lines = (Array.isArray(targetEl.lines) ? targetEl.lines : []).map(normalizeCodeLine);
        const m = measureCode({ ...targetEl, lines }, boardRect);
        const lh = LINE_HEIGHTS.code;
        if (Number.isInteger(line) && line >= 1 && line <= lines.length) {
          const chars = [...lines[line - 1]].length;
          const r = { x: m.inner.x, y: m.inner.y + (line - 1) * lh, w: Math.max(m.charAdvance, chars * m.charAdvance), h: lh };
          return { rect: r, lastLine: r };
        }
        const rect = { x: m.inner.x, y: m.inner.y, w: Math.max(1, m.width), h: Math.max(1, m.height) };
        const lastLine = { x: m.inner.x, y: m.inner.y + (lines.length - 1) * lh, w: Math.max(m.charAdvance, [...(lines[lines.length - 1] || '')].length * m.charAdvance), h: lh };
        return { rect, lastLine };
      }
      case 'list': {
        const m = measureList(targetEl, boardRect);
        const rect = { x: m.inner.x, y: m.inner.y, w: m.inner.w, h: Math.max(1, m.height) };
        const lastItem = m.items[m.items.length - 1];
        const lastLine = lastItem
          ? { x: m.inner.x, y: m.inner.y + lastItem.y + (lastItem.lines.length - 1) * m.lineHeight, w: m.inner.w, h: m.lineHeight }
          : fallback.lastLine;
        return { rect, lastLine };
      }
      case 'table': {
        const m = measureTable(targetEl, boardRect);
        const rect = { x: m.inner.x, y: m.inner.y, w: m.inner.w, h: Math.max(1, m.height) };
        return { rect, lastLine: { x: rect.x, y: rect.y + rect.h - 1, w: rect.w, h: 1 } };
      }
      case 'math': {
        const compiled = compiledFor(targetEl.lines);
        if (!compiled) return fallback;
        const lay = mathLayout(compiled, boardRect);
        const x0 = Math.min(...lay.lines.map((l) => l.x));
        const x1 = Math.max(...lay.lines.map((l) => l.x + l.width));
        const rect = { x: x0, y: lay.inner.y, w: Math.max(1, x1 - x0), h: Math.max(1, lay.height) };
        const last = lay.lines[lay.lines.length - 1];
        return { rect, lastLine: { x: last.x, y: last.boxTop, w: Math.max(1, last.width), h: last.height } };
      }
      case 'box': {
        const rect = boxRect(boardRect);
        return { rect, lastLine: { x: rect.x, y: rect.y + rect.h - 1, w: rect.w, h: 1 } };
      }
      default:
        return fallback;
    }
  } catch {
    return fallback;
  }
}

export function prepareHighlight(el, ctx) {
  const target = requireField(el, 'target', 'string');
  const boardRect = ctx.boardRects.get(target);
  if (!boardRect) throw new Error(`renderer-core: highlight "${el.id}" targets "${target}", which is not on the board`);
  const targetEl = ctx.elementsById.get(target) || null;
  const style = el.style || 'circle';
  const line = Number.isInteger(el.line) ? el.line : null;
  const geo = targetGeometry(targetEl, boardRect, line);
  const T = geo.rect;
  const color = elementColor(el);
  const seed = ctx.seed(el.id);
  const meta = { target, style, line, targetRect: T, lastLine: geo.lastLine, boardRect };

  if (style === 'pointer') {
    const tip = { x: T.x - POINTER_GAP, y: T.y + T.h / 2 };
    return buildDrawable({
      id: el.id, type: 'highlight', parts: [[]], partStarts: [0],
      bounds: { x: Math.max(0, tip.x), y: tip.y, w: 0, h: 0 },
      tipOverride: () => ({ ...tip }),
      meta: { ...meta, tip },
    });
  }
  let strokes, envelope;
  if (style === 'underline') {
    const L = geo.lastLine;
    const y = L.y + L.h + UNDERLINE_GAP;
    const x1 = L.x - 2, x2 = L.x + L.w + 2;
    envelope = expandRect({ x: x1, y, w: x2 - x1, h: 0 }, ROUGH_ENVELOPE);
    strokes = roughStrokes(roughFit(seed, envelope, (r) => roughLine(r, x1, y, x2, y)), color);
    meta.y = y;
  } else if (style === 'strike') {
    const y = T.y + T.h / 2;
    const x1 = T.x - 4, x2 = T.x + T.w + 4;
    envelope = expandRect({ x: x1, y, w: x2 - x1, h: 0 }, ROUGH_ENVELOPE);
    strokes = roughStrokes(roughFit(seed, envelope, (r) => roughLine(r, x1, y, x2, y)), color);
    meta.y = y;
  } else {
    const ring = expandRect(T, CIRCLE_MARGIN);
    envelope = expandRect(ring, ROUGH_ENVELOPE);
    strokes = roughStrokes(roughFit(seed, envelope, (r) => roughEllipse(r, ring.x + ring.w / 2, ring.y + ring.h / 2, ring.w, ring.h)), color);
    meta.ring = ring;
  }
  // highlights have no slot: keep the envelope on the canvas
  const clamped = {
    x: Math.max(BOARD_BOUNDS.x, envelope.x), y: Math.max(BOARD_BOUNDS.y, envelope.y),
  };
  clamped.w = Math.min(BOARD_BOUNDS.x + BOARD_BOUNDS.w, envelope.x + envelope.w) - clamped.x;
  clamped.h = Math.min(BOARD_BOUNDS.y + BOARD_BOUNDS.h, envelope.y + envelope.h) - clamped.y;
  return buildDrawable({
    id: el.id, type: 'highlight', parts: [strokes], partStarts: [0],
    bounds: clamped,
    meta,
  });
}
