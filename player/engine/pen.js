// player/engine/pen.js — the pen cursor on the #pen overlay canvas (brief 04 item 7;
// change-khan-feel item 6: hover-and-point cursor).
// Modes: 'hidden' (waiting/ended), 'draw' (follows the active drawable's tip), 'hover' (the
// element is written or not yet started while the narration goes on: the pen rests on the tip
// with a slow 1–3 px drift, like a hand pointing at what is being talked about), 'park' (rests
// exactly at a point: paused, or a pointer highlight), 'idle' (stalled/thinking: hover wobble plus
// a slow re-trace of the last highlight/box paths).
// Travel: when the engine moves a hovering pen by a long way (from a written element to the start
// of the next one), the arrow travels there with an ease-in-out tween of up to PEN_TRAVEL_MS of
// wall time (shorter for shorter jumps, see travelMs) instead of jumping; the engine anticipates
// the next element by PEN_TRAVEL_MS (scheduler.activeIndex leadMs) so the pen lands as — or just
// before — the ink begins. While drawing, the arrow follows the tip directly (a line return, a
// rough.js second pass): the ink is always under the pen, as in Sal's videos. The hover drift, the idle
// animation and the travel run on wall time — they are decoration, not sync. Nothing here touches
// playback state.
//
// The cursor is the classic OS arrow pointer (design cycle 1, design/01-khan-look-research.md §4:
// Khan Academy videos point with the plain white mouse arrow, made a bit bigger). It is drawn
// white with a dark outline on purpose — like an OS cursor it is not board content, so it does not
// follow the chalk/accent tokens. The hotspot (arrow tip) is exactly the point the engine passes
// (once the travel has arrived).
import { drawPartial } from '../../shared/strokes.js';
import { PEN_TRAVEL_MS, PEN_HOVER_PX } from '../../shared/layout-core/constants.js';

export { PEN_TRAVEL_MS, PEN_HOVER_PX };

/** Classic arrow outline at OS size (px, hotspot at 0,0): left edge, notch, tail, back to the tip. */
export const ARROW_SHAPE = Object.freeze([
  [0, 0], [0, 16.4], [4.3, 12.6], [7.2, 19.3], [9.9, 18.1], [7.0, 11.6], [12.2, 11.6],
].map((p) => Object.freeze(p)));
/** The arrow is drawn ~1.35x an OS default pointer (about 16 x 26 board px). */
export const ARROW_SCALE = 1.35;
export const ARROW_FILL = '#FFFFFF';
export const ARROW_OUTLINE = '#000000';
export const ARROW_OUTLINE_WIDTH = 1.6;
/**
 * A tip jump at least this far (board px) is travelled with the tween; shorter moves are followed
 * directly. 80 px is above any hop inside a line of handwriting (the widest 44 px glyph plus a word
 * space ≈ 57 px, code 10 px per char) and below a line return or an element-to-element move.
 */
export const TRAVEL_MIN_PX = 80;
/** A jump of this length (or more) takes the full PEN_TRAVEL_MS; shorter jumps take proportionally less, never under TRAVEL_MIN_FRACTION of it. */
export const TRAVEL_FULL_PX = 500;
export const TRAVEL_MIN_FRACTION = 0.4;
/** Alpha of the arrow per mode (draw is opaque). */
export const HOVER_ALPHA = 0.85;

/** Travel duration (ms of wall time) for a jump of `px` board px. */
export function travelMs(px) {
  const f = Math.min(1, Math.max(TRAVEL_MIN_FRACTION, px / TRAVEL_FULL_PX));
  return PEN_TRAVEL_MS * f;
}

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createPen(canvas, tokens) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  let mode = 'hidden';
  let tip = null;           // {x, y} the engine's point (target) in board px
  let pos = null;           // {x, y} where the arrow is drawn (equals tip once a travel has arrived)
  let travel = null;        // {from:{x,y}, ms:number, startedAt:number|null} tween in flight
  let idlePaths = [];       // SVG path strings to re-trace while idle
  let idleColor = tokens.muted;
  let lastDrawnKey = '';

  function clear() { ctx.clearRect(0, 0, W, H); }

  /** White arrow pointer with a dark outline; its tip is at (x, y). Absolute coordinates, no transform. */
  function glyph(x, y, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 6;
    ctx.beginPath();
    ARROW_SHAPE.forEach(([px, py], i) => {
      const ax = x + px * ARROW_SCALE, ay = y + py * ARROW_SCALE;
      if (i === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
    });
    ctx.closePath();
    // a soft shadow lifts the arrow off coloured strokes (invisible on the black board itself)
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = ARROW_FILL;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = ARROW_OUTLINE;
    ctx.lineWidth = ARROW_OUTLINE_WIDTH;
    ctx.stroke();
    ctx.restore();
  }

  /** Advance the travel tween (wall time) and return where the arrow is drawn this frame. */
  function place(now) {
    if (!travel) { pos = { x: tip.x, y: tip.y }; return pos; }
    if (travel.startedAt === null) travel.startedAt = now;
    const k = (now - travel.startedAt) / travel.ms;
    if (k >= 1) { travel = null; pos = { x: tip.x, y: tip.y }; return pos; }
    const e = easeInOut(Math.max(0, k));
    pos = { x: travel.from.x + (tip.x - travel.from.x) * e, y: travel.from.y + (tip.y - travel.from.y) * e };
    return pos;
  }

  return {
    get mode() { return mode; },
    get tip() { return tip ? { ...tip } : null; },
    /** Where the arrow is drawn now (differs from `tip` only while travelling). */
    get pos() { return pos ? { ...pos } : null; },
    get travelling() { return travel !== null; },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      lastDrawnKey = '';
      if (m === 'park' || m === 'hidden') travel = null; // a parked pen sits on its point; a hidden one forgets the trip
    },
    setTip(p) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const prev = tip;
      tip = { x: p.x, y: p.y };
      if (!pos) { pos = { x: p.x, y: p.y }; return; }
      // a long jump of the target while hovering (or idling) starts — or restarts, from where the
      // arrow is now — a travel; a running travel follows a moving target without restarting; while
      // drawing or parked the arrow follows the tip directly
      const jump = prev ? dist(prev, tip) : 0;
      if ((mode === 'hover' || mode === 'idle') && jump >= TRAVEL_MIN_PX) travel = { from: { x: pos.x, y: pos.y }, ms: travelMs(Math.max(jump, dist(pos, tip))), startedAt: null };
    },
    setIdlePaths(paths, color) { idlePaths = Array.isArray(paths) ? paths.filter(Boolean) : []; idleColor = color || tokens.muted; },
    /** Draw one frame. `now` = performance.now() (used by the travel, hover and idle animations only). */
    frame(now) {
      if (mode === 'hidden') { if (lastDrawnKey !== 'hidden') { clear(); lastDrawnKey = 'hidden'; } return; }
      if (!tip) { if (lastDrawnKey !== 'none') { clear(); lastDrawnKey = 'none'; } return; }
      const at = place(now);
      const s = now / 1000;
      if (mode === 'idle') {
        clear();
        const dx = Math.sin(s * 1.3) * 9 + Math.sin(s * 2.9) * 3;
        const dy = Math.cos(s * 1.1) * 7 + Math.cos(s * 2.3) * 2;
        if (idlePaths.length) {
          // slow retrace: 0 → 1 over 3 s, pause, repeat
          const phase = (s % 4) / 3;
          const f = Math.min(1, phase);
          ctx.save();
          ctx.strokeStyle = idleColor;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.45 * (1 - Math.max(0, phase - 1) * 3);
          ctx.setLineDash([6, 6]);
          for (const d of idlePaths) { try { drawPartial(ctx, d, f); } catch { /* bad path: ignore */ } }
          ctx.restore();
        }
        glyph(at.x + dx, at.y + dy, 0.9);
        lastDrawnKey = '';
        return;
      }
      if (mode === 'hover') {
        // a hand resting on what is being talked about: a slow drift of a few px, much smaller and
        // calmer than the idle (stalled) wobble; no drift while still travelling there
        clear();
        const drift = travel ? 0 : PEN_HOVER_PX;
        const dx = drift * (0.7 * Math.sin(s * 0.9) + 0.3 * Math.sin(s * 2.3));
        const dy = drift * (0.7 * Math.cos(s * 0.6) + 0.3 * Math.cos(s * 1.7));
        glyph(at.x + dx, at.y + dy, HOVER_ALPHA);
        lastDrawnKey = '';
        return;
      }
      const key = `${mode}:${Math.round(at.x)}:${Math.round(at.y)}`;
      if (key === lastDrawnKey) return;
      clear();
      glyph(at.x, at.y, mode === 'park' ? 0.8 : 1);
      lastDrawnKey = key;
    },
  };
}
