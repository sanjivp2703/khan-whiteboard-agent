// player/engine/scheduler.js — the audio-clock scheduler (spec §6 "Clock", "Audio yields to the
// pen"; brief 04 items 3–4). Pure, DOM-free.
//
// For a scene with audio duration D (ms) and resolved timing windows (layout-core/timing.js):
//   start    = at × D
//   windowEnd = nextAt × D   (0.95 × D for the last element)
//   drawEnd  = start + max(windowEnd − start, naturalMs)   (the pen never rushes a stroke)
//   u(t)     = clamp((t − start) / (drawEnd − start), 0, 1)
// The scene is complete when the audio has ended AND every element has reached u = 1. If the
// strokes outrun the audio, the clock keeps running on held silence for at most `yieldCapMs`
// (wall time, since the audio clock has stopped); past the cap the remaining strokes snap to 1.
import { resolveTiming } from '../../shared/layout-core/timing.js';

export const DEFAULT_YIELD_CAP_MS = 1500;

/**
 * @param {object} scene effective scene (elements in list order)
 * @param {number} durationMs audio duration
 * @param {Map<string,{naturalMs:number}>|object|null} drawables by element id (only naturalMs is read)
 * @param {{naturalMsScale?:number}} [opts]
 * @returns {Array<{id:string, index:number, start:number, windowEnd:number, drawEnd:number, naturalMs:number}>}
 */
export function buildTimeline(scene, durationMs, drawables = null, opts = {}) {
  const D = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const scale = Number.isFinite(opts.naturalMsScale) && opts.naturalMsScale > 0 ? opts.naturalMsScale : 1;
  const windows = resolveTiming(scene);
  const elements = (scene && scene.elements) || [];
  return elements.map((el, i) => {
    const w = windows[i];
    const start = w.at * D;
    const windowEnd = Math.max(start, w.end * D);
    const d = drawables ? (typeof drawables.get === 'function' ? drawables.get(el.id) : drawables[el.id]) : null;
    const naturalMs = d && Number.isFinite(d.naturalMs) && d.naturalMs > 0 ? d.naturalMs * scale : 0;
    const drawEnd = start + Math.max(windowEnd - start, naturalMs);
    return { id: el.id, index: i, start, windowEnd, drawEnd, naturalMs };
  });
}

/** Draw progress of one timeline item at scene time t (ms). */
export function progressAt(item, t) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0; // ±Infinity
  if (t < item.start) return 0;
  const span = item.drawEnd - item.start;
  if (span <= 0) return 1;
  const u = (t - item.start) / span;
  return u >= 1 ? 1 : u <= 0 ? 0 : u;
}

/** Scene time (ms) at which the last stroke completes (0 for an empty timeline). */
export function timelineEnd(timeline) {
  let end = 0;
  for (const it of timeline) if (it.drawEnd > end) end = it.drawEnd;
  return end;
}

/** Index of the element currently drawing at t (the latest started element with u < 1), or −1. */
export function activeIndex(timeline, t) {
  let active = -1;
  for (let i = 0; i < timeline.length; i++) {
    const it = timeline[i];
    if (t >= it.start) {
      if (progressAt(it, t) < 1) active = i;
      else if (active < 0 || timeline[active].drawEnd <= it.drawEnd) active = i; // latest finished so far (pen parks there)
    }
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
