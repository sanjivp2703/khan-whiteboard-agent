// player/renderer/core/timing-window.js — the draw window of an element, needed to map a
// list's absolute `itemAt[]` fractions into normalized part starts (layout-core/timing).
// The engine may pass the resolved window as `ctx.window = {at, end}`; without it the window
// is reconstructed from the element's own `at` and the next element's explicit `at` in
// `ctx.elementsById` order (0.95 when the element is last or the next `at` is omitted).
import { TIMING } from '../../../shared/layout-core/constants.js';
import { partStarts as timingPartStarts } from '../../../shared/layout-core/timing.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** @returns {{at:number, end:number}} */
export function elementWindow(el, ctx) {
  if (ctx && ctx.window && isNum(ctx.window.at) && isNum(ctx.window.end) && ctx.window.end >= ctx.window.at) {
    return { at: ctx.window.at, end: ctx.window.end };
  }
  let at = isNum(el.at) ? el.at : (Array.isArray(el.itemAt) && isNum(el.itemAt[0]) ? el.itemAt[0] : 0);
  let end = TIMING.lastWindowEnd;
  if (ctx && ctx.elementsById && typeof ctx.elementsById.keys === 'function') {
    const ids = [...ctx.elementsById.keys()];
    const i = ids.indexOf(el.id);
    if (i >= 0 && i + 1 < ids.length) {
      const next = ctx.elementsById.get(ids[i + 1]);
      if (next && isNum(next.at)) end = next.at;
    }
  }
  if (end < at) end = at;
  return { at, end };
}

/** Normalized part starts for `count` parts, honouring `itemAt` when it is a full numeric array. */
export function partStartsFor(count, el, ctx) {
  const itemAt = Array.isArray(el.itemAt) && el.itemAt.length === count && el.itemAt.every(isNum) ? el.itemAt : null;
  if (!itemAt) return timingPartStarts(count, null, null);
  return timingPartStarts(count, elementWindow(el, ctx), itemAt);
}
