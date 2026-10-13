// player/engine/scheduler.js — the audio-clock scheduler (spec §6 "Clock", "Writing pace", "Audio
// yields to the pen"; brief 04 items 3–4; change-khan-feel items 1–2). Pure, DOM-free.
//
// For a scene with audio duration D (ms) and resolved timing windows (layout-core/timing.js):
//   start     = at × D
//   windowEnd = nextAt × D   (0.95 × D for the last element)
//   needMs    = naturalMs + pauseMs   handwriting time at PEN_PX_PER_S (from the drawable) plus the
//                                     word / line micro-pauses (PEN_WORD_GAP_MS, PEN_LINE_GAP_MS)
//   drawEnd   = start + needMs   when it fits the window: the pen then parks on the element's tip
//                                for the rest of the window (the engine's hover mode)
//             = windowEnd        when it does not fit and another element follows: the draw is
//                                compressed to the window as a last resort (`compressed`, `ratio`;
//                                the engine logs it as a `compressed` event)
//             = start + needMs   for the LAST element, never compressed: the yield-to-pen rule
//                                holds silence for it, capped (effectiveTime / isSceneComplete)
//             = windowEnd        when needMs is unknown (no drawable, or a zero-length drawable such
//                                as a pointer highlight, which parks over its target for its window)
//   u(t)      = piecewise linear in [start, drawEnd]: strokes advance linearly in u, and a line-gap
//               hold sits between the drawable's parts (list items, equation lines, table rows), so
//               the pen rests at the end of a line before starting the next (`segs`).
// The scene is complete when the audio has ended AND every element has reached u = 1. If the
// strokes outrun the audio, the clock keeps running on held silence for at most `yieldCapMs`
// (wall time, since the audio clock has stopped); past the cap the remaining strokes snap to 1.
import { resolveTiming } from '../../shared/layout-core/timing.js';
import { PEN_WORD_GAP_MS, PEN_LINE_GAP_MS, PEN_TRAVEL_MS } from '../../shared/layout-core/constants.js';

export const DEFAULT_YIELD_CAP_MS = 1500;
export { PEN_TRAVEL_MS };

const words = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);

/**
 * Word, line and part counts of an element's handwritten content — what the micro-pauses are
 * counted on. Lines come from the script (code/math lines, list items, table rows) or, for text,
 * from the drawable's wrapped lines when it exposes them (`meta.lines`); parts come from the
 * drawable (`partStarts`). `lines` is never below `parts`.
 */
export function contentCounts(el, drawable) {
  const type = el && el.type;
  let w = 0;
  let lines = 1;
  if (type === 'text') {
    w = words(el.text);
    const wrapped = drawable && drawable.meta && drawable.meta.lines;
    if (Array.isArray(wrapped) && wrapped.length) lines = wrapped.length;
  } else if (type === 'list') {
    const items = Array.isArray(el.items) ? el.items : [];
    lines = Math.max(1, items.length);
    for (const it of items) w += words(it);
  } else if (type === 'table') {
    const rows = Array.isArray(el.rows) ? el.rows : [];
    lines = Math.max(1, rows.length);
    for (const r of rows) for (const c of (Array.isArray(r) ? r : [])) w += words(c);
  } else if (type === 'code' || type === 'math') {
    lines = Math.max(1, Array.isArray(el.lines) ? el.lines.length : 1);
  } else if (type === 'box' || type === 'arrow' || type === 'sketch') {
    w = words(el.label);
  }
  const parts = drawable && Array.isArray(drawable.partStarts) && drawable.partStarts.length > 0 ? drawable.partStarts.length : 1;
  return { words: w, lines: Math.max(lines, parts), parts };
}

/**
 * Micro-pause budget of an element: one word gap per word beyond the first of each line, one line
 * gap per line beyond the first. Line gaps that fall on part boundaries become real holds in the
 * timeline (`holds`); the rest of the budget is folded into the stroke time (the drawable does not
 * expose word boundaries, so those gaps slow the strokes evenly instead).
 */
export function pauseProfile(el, drawable) {
  const c = contentCounts(el, drawable);
  const wordGaps = Math.max(0, c.words - c.lines);
  const lineGaps = Math.max(0, c.lines - 1);
  const holds = Math.max(0, c.parts - 1);
  return { wordGaps, lineGaps, holds, pauseMs: wordGaps * PEN_WORD_GAP_MS + lineGaps * PEN_LINE_GAP_MS };
}

/**
 * Draw segments of a multi-part element: u advances linearly inside each part's segment and holds
 * between them. Times are relative to `start`; the last segment ends exactly at `spanMs`. Holds
 * never take more than half the span (a compressed element keeps most of its time for ink).
 */
function buildSegments(partStarts, spanMs, holdMs) {
  const bounds = [0];
  for (let i = 1; i < partStarts.length; i++) bounds.push(Math.min(1, Math.max(bounds[i - 1], partStarts[i])));
  bounds.push(1);
  const n = bounds.length - 1; // segments
  const holdTotal = Math.min(holdMs * (n - 1), spanMs * 0.5);
  const hold = n > 1 ? holdTotal / (n - 1) : 0;
  const strokeMs = spanMs - holdTotal;
  const segs = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const u0 = bounds[k];
    const u1 = bounds[k + 1];
    const t1 = k === n - 1 ? spanMs : t + (u1 - u0) * strokeMs;
    segs.push({ u0, u1, t0: t, t1 });
    t = t1 + (k < n - 1 ? hold : 0);
  }
  return segs;
}

function lookup(drawables, id) {
  if (!drawables) return null;
  return typeof drawables.get === 'function' ? drawables.get(id) : drawables[id];
}

/**
 * @param {object} scene effective scene (elements in list order)
 * @param {number} durationMs audio duration
 * @param {Map<string,{naturalMs:number,partStarts?:number[],meta?:object}>|object|null} drawables by element id
 * @param {{naturalMsScale?:number}} [opts] test knob: stretches natural durations (strokes and pauses)
 * @returns {Array<{id:string, index:number, start:number, windowEnd:number, drawEnd:number, naturalMs:number,
 *   pauseMs:number, compressed:boolean, ratio:number, last:boolean, segs:Array<{u0:number,u1:number,t0:number,t1:number}>|null}>}
 */
export function buildTimeline(scene, durationMs, drawables = null, opts = {}) {
  const D = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const scale = Number.isFinite(opts.naturalMsScale) && opts.naturalMsScale > 0 ? opts.naturalMsScale : 1;
  const windows = resolveTiming(scene);
  const elements = (scene && scene.elements) || [];
  const n = elements.length;
  return elements.map((el, i) => {
    const w = windows[i];
    const start = w.at * D;
    const windowEnd = Math.max(start, w.end * D);
    const windowMs = windowEnd - start;
    const d = lookup(drawables, el.id);
    const naturalMs = d && Number.isFinite(d.naturalMs) && d.naturalMs > 0 ? d.naturalMs * scale : 0;
    const last = i === n - 1;
    let pauseMs = 0;
    let drawEnd = windowEnd;
    let compressed = false;
    let ratio = 1;
    let segs = null;
    if (naturalMs > 0) {
      const prof = pauseProfile(el, d);
      pauseMs = prof.pauseMs * scale;
      const needMs = naturalMs + pauseMs;
      if (needMs <= windowMs || last) {
        drawEnd = start + needMs;
      } else {
        drawEnd = windowEnd;
        compressed = true;
        ratio = windowMs > 0 ? needMs / windowMs : Infinity;
      }
      if (prof.holds > 0 && drawEnd > start) {
        const holdMs = PEN_LINE_GAP_MS * scale * (compressed ? windowMs / needMs : 1);
        segs = buildSegments(d.partStarts, drawEnd - start, holdMs);
      }
    }
    return { id: el.id, index: i, start, windowEnd, drawEnd, naturalMs, pauseMs, compressed, ratio, last, segs };
  });
}

/** Draw progress of one timeline item at scene time t (ms). */
export function progressAt(item, t) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0; // ±Infinity
  if (t < item.start) return 0;
  const span = item.drawEnd - item.start;
  if (span <= 0) return 1;
  const e = t - item.start;
  if (e >= span) return 1;
  if (!item.segs) {
    const u = e / span;
    return u >= 1 ? 1 : u <= 0 ? 0 : u;
  }
  for (const s of item.segs) {
    if (e < s.t0) return s.u0;           // holding at the end of the previous part
    if (e < s.t1) return s.t1 > s.t0 ? s.u0 + (s.u1 - s.u0) * ((e - s.t0) / (s.t1 - s.t0)) : s.u1;
  }
  return 1;
}

/** Scene time (ms) at which the last stroke completes (0 for an empty timeline). */
export function timelineEnd(timeline) {
  let end = 0;
  for (const it of timeline) if (it.drawEnd > end) end = it.drawEnd;
  return end;
}

/** Items whose draw was compressed to their window (natural time exceeded it; last resort). */
export function compressedItems(timeline) {
  return timeline.filter((it) => it.compressed);
}

/**
 * Index of the element the pen belongs to at t: the latest started element with u < 1, else the
 * latest finished one (the pen parks there), or −1. With `leadMs` > 0 the pen anticipates: before
 * the first element starts it waits at the first element (index 0), and once the active element
 * is complete it moves on to the next one `leadMs` before that one's start, so the travel tween
 * lands as the ink begins (change-khan-feel item 6).
 */
export function activeIndex(timeline, t, { leadMs = 0 } = {}) {
  let active = -1;
  for (let i = 0; i < timeline.length; i++) {
    const it = timeline[i];
    if (t >= it.start) {
      if (progressAt(it, t) < 1) active = i;
      else if (active < 0 || timeline[active].drawEnd <= it.drawEnd) active = i; // latest finished so far (pen parks there)
    }
  }
  if (leadMs > 0 && timeline.length) {
    if (active < 0) return 0;
    const next = active + 1;
    if (next < timeline.length && progressAt(timeline[active], t) >= 1 && t >= timeline[next].start - leadMs) return next;
  }
  return active;
}

/**
 * The effective scene clock. While the audio plays, its currentTime is the clock. Once it has
 * ended the clock continues on held silence (`holdMs` of wall time since the audio ended) up to
 * `yieldCapMs`; beyond the cap `snap` is true and every element is treated as complete.
 * @param {{audioMs:number, audioEnded:boolean, durationMs:number, holdMs?:number, yieldCapMs?:number}} p
 * @returns {{t:number, snap:boolean, holding:boolean}}
 */
export function effectiveTime({ audioMs, audioEnded, durationMs, holdMs = 0, yieldCapMs = DEFAULT_YIELD_CAP_MS }) {
  if (!audioEnded) return { t: Math.max(0, audioMs || 0), snap: false, holding: false };
  const D = Number.isFinite(durationMs) ? durationMs : (audioMs || 0);
  if (holdMs >= yieldCapMs) return { t: Infinity, snap: true, holding: false };
  return { t: Math.max(D, audioMs || 0) + Math.max(0, holdMs), snap: false, holding: true };
}

/** True when the audio has ended and every element is at u = 1 under the effective clock. */
export function isSceneComplete(timeline, { audioEnded, t, snap }) {
  if (!audioEnded) return false;
  if (snap) return true;
  for (const it of timeline) if (progressAt(it, t) < 1) return false;
  return true;
}

/** True when strokes will still be running when the audio ends (the yield rule will engage). */
export function needsYield(timeline, durationMs) {
  return timelineEnd(timeline) > durationMs + 1e-9;
}

/** Element ids whose draw has started (u > 0) at t, in list order. */
export function startedIds(timeline, t, { forced = null } = {}) {
  const out = [];
  for (const it of timeline) if ((forced && forced.has(it.id)) || progressAt(it, t) > 0) out.push(it.id);
  return out;
}
