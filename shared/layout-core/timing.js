// shared/layout-core/timing.js — per-element draw windows (spec §4.4 common fields; brief 00 C1).
//
// Rules: `at` ∈ [0, 0.9]; elements without `at` are spaced evenly across [0.08, 0.85] in list
// order — talk first: the voice leads for ≈ 8 % of the audio before the first stroke
// (TIMING.firstAt; change-khan-feel item 5) — an omitted run between two anchors is spaced evenly
// between them; explicit `at` values (including 0) are honoured and must be non-decreasing in
// list order (else BAD_AT). An element's window runs from its `at` to the next element's `at`
// (0.95 for the last). Multi-part elements reveal their parts evenly across the window unless
// `itemAt[]` (list) overrides; itemAt must be ascending and inside the window. These resolved
// windows are the validator's contract (itemAt ranges, BAD_AT); at play time the scheduler keeps
// the explicit anchors and the span of each omitted run but shares that span by handwriting need
// (player/engine/scheduler.js weightWindows, qa/04 finding 1a).
import { TIMING } from './constants.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Default `at` values for n elements with none given: firstAt + (0.85 − firstAt) * i / n (each gets an equal window). */
export function defaultAts(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(n === 0 ? 0 : round6(TIMING.firstAt + ((TIMING.defaultSpan - TIMING.firstAt) * i) / n));
  return out;
}

function round6(v) { return Math.round(v * 1e6) / 1e6; }

/**
 * Fill omitted `at` values. Explicit ones are kept; each run of omitted elements is spread
 * evenly between the previous resolved `at` (or firstAt for a leading run — talk first; halved
 * when the first anchor is nearer than 2 × firstAt) and the next explicit `at` (or 0.85,
 * exclusive — like the i/n default).
 * @param {Array<{at?:number}>} elements
 * @returns {number[]}
 */
export function resolveAts(elements) {
  const n = elements.length;
  const ats = new Array(n).fill(null);
  for (let i = 0; i < n; i++) if (isNum(elements[i] && elements[i].at)) ats[i] = elements[i].at;
  if (ats.every((a) => a === null)) return defaultAts(n);
  let i = 0;
  while (i < n) {
    if (ats[i] !== null) { i++; continue; }
    let j = i;
    while (j < n && ats[j] === null) j++;
    const runLen = j - i;
    const hi = j < n ? ats[j] : TIMING.defaultSpan; // next anchor, or the default span end (exclusive)
    const lo = i === 0 ? Math.min(TIMING.firstAt, hi / 2) : ats[i - 1];
    if (i === 0) {
      // leading run: starts at firstAt (talk first), hi is exclusive (same as the i/n default)
      const step = (hi - lo) / runLen;
      for (let k = 0; k < runLen; k++) ats[i + k] = round6(lo + step * k);
    } else {
      // run after an explicit anchor: strictly between lo and hi
      const step = (hi - lo) / (runLen + 1);
      for (let k = 0; k < runLen; k++) ats[i + k] = round6(lo + step * (k + 1));
    }
    i = j;
  }
  return ats;
}

/**
 * Timing errors for a scene's elements (shape-level): returns [{elementId, code:'BAD_AT', message}].
 * Checks range of explicit `at`, non-decreasing order, and `itemAt` (type, length, ascending, in window).
 */
export function checkTiming(elements) {
  const errors = [];
  if (!Array.isArray(elements)) return errors;
  let prev = -Infinity;
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    if (el.at !== undefined) {
      if (!isNum(el.at) || el.at < 0 || el.at > TIMING.atMax) {
        errors.push({ elementId: el.id ?? null, code: 'BAD_AT', message: `at must be a number in [0, ${TIMING.atMax}], got ${JSON.stringify(el.at)}` });
        continue;
      }
      if (el.at < prev) {
        errors.push({ elementId: el.id ?? null, code: 'BAD_AT', message: `at (${el.at}) must be non-decreasing in list order (previous ${prev})` });
      }
      prev = Math.max(prev, el.at);
    }
  }
  // itemAt checks need resolved windows
  const bad = new Set(errors.map((e) => e.elementId));
  if (errors.length === 0) {
    const windows = resolveTiming({ elements });
    windows.forEach((w, idx) => {
      const el = elements[idx];
      if (!el || el.itemAt === undefined) return;
      const items = Array.isArray(el.items) ? el.items.length : null;
      if (!Array.isArray(el.itemAt) || el.itemAt.some((v) => !isNum(v))) {
        errors.push({ elementId: el.id ?? null, code: 'BAD_FIELD', message: 'itemAt must be an array of numbers' });
        return;
      }
      if (items !== null && el.itemAt.length !== items) {
        errors.push({ elementId: el.id ?? null, code: 'BAD_FIELD', message: `itemAt has ${el.itemAt.length} entries for ${items} items` });
        return;
      }
      const err = itemAtError(el.itemAt, w);
      if (err && !bad.has(el.id)) errors.push({ elementId: el.id ?? null, code: 'BAD_AT', message: err });
    });
  }
  return errors;
}

/** Null when itemAt is strictly ascending and every value lies in [window.at, window.end); else a message. */
export function itemAtError(itemAt, window) {
  for (let i = 0; i < itemAt.length; i++) {
    const v = itemAt[i];
    if (i > 0 && v <= itemAt[i - 1]) return `itemAt must be strictly ascending (itemAt[${i}]=${v} <= itemAt[${i - 1}]=${itemAt[i - 1]})`;
    if (v < window.at - 1e-9 || v >= window.end - 1e-9) return `itemAt[${i}]=${v} lies outside the element window [${window.at}, ${window.end})`;
  }
  return null;
}

/**
 * Resolve draw windows for a scene: [{id, at, end, explicit}] in list order.
 * Assumes checkTiming returned no errors (invalid `at` values are treated as omitted).
 */
export function resolveTiming(scene) {
  const elements = (scene && scene.elements) || [];
  const clean = elements.map((el) => ({ at: el && isNum(el.at) && el.at >= 0 && el.at <= TIMING.atMax ? el.at : undefined }));
  const ats = resolveAts(clean);
  return elements.map((el, i) => {
    const at = ats[i];
    const end = i + 1 < ats.length ? Math.max(at, ats[i + 1]) : TIMING.lastWindowEnd;
    return { id: el && el.id, at, end: Math.max(end, at), explicit: clean[i].at !== undefined };
  });
}

/**
 * Normalized part starts in [0,1) within an element's window.
 * With `itemAt` (absolute fractions of the scene) they are mapped into the window; else even spacing i/count.
 */
export function partStarts(count, window, itemAt) {
  const n = Math.max(1, count | 0);
  if (Array.isArray(itemAt) && itemAt.length === n && window && window.end > window.at) {
    const span = window.end - window.at;
    return itemAt.map((v) => round6(clamp01((v - window.at) / span, true)));
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push(i / n);
  return out;
}

function clamp01(v, exclusiveTop) {
  if (v < 0) return 0;
  if (exclusiveTop) return v >= 1 ? 0.999999 : v;
  return v > 1 ? 1 : v;
}
