// player/engine/pen.js — the pen cursor on the #pen overlay canvas (brief 04 item 7).
// Modes: 'hidden' (waiting/ended), 'draw' (follows the active drawable's tip), 'park' (rests at a
// point, e.g. a pointer highlight or a paused stroke), 'idle' (stalled/thinking: hover wobble plus
// a slow re-trace of the last highlight/box paths). The idle animation runs on wall time — it is
// decoration, not sync. Nothing here touches playback state.
//
// The cursor is the classic OS arrow pointer (design cycle 1, design/01-khan-look-research.md §4:
// Khan Academy videos point with the plain white mouse arrow, made a bit bigger). It is drawn
// white with a dark outline on purpose — like an OS cursor it is not board content, so it does not
// follow the chalk/accent tokens. The hotspot (arrow tip) is exactly the point the engine passes.
import { drawPartial } from '../../shared/strokes.js';

/** Classic arrow outline at OS size (px, hotspot at 0,0): left edge, notch, tail, back to the tip. */
export const ARROW_SHAPE = Object.freeze([
  [0, 0], [0, 16.4], [4.3, 12.6], [7.2, 19.3], [9.9, 18.1], [7.0, 11.6], [12.2, 11.6],
].map((p) => Object.freeze(p)));
/** The arrow is drawn ~1.35x an OS default pointer (about 16 x 26 board px). */
export const ARROW_SCALE = 1.35;
export const ARROW_FILL = '#FFFFFF';
export const ARROW_OUTLINE = '#000000';
export const ARROW_OUTLINE_WIDTH = 1.6;

export function createPen(canvas, tokens) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  let mode = 'hidden';
  let tip = null;           // {x, y} last known tip in board px
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

  return {
    get mode() { return mode; },
    get tip() { return tip ? { ...tip } : null; },
    setMode(m) { if (m !== mode) { mode = m; lastDrawnKey = ''; } },
    setTip(p) { if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) tip = { x: p.x, y: p.y }; },
    setIdlePaths(paths, color) { idlePaths = Array.isArray(paths) ? paths.filter(Boolean) : []; idleColor = color || tokens.muted; },
    /** Draw one frame. `now` = performance.now() (used only by the idle animation). */
    frame(now) {
      if (mode === 'hidden') { if (lastDrawnKey !== 'hidden') { clear(); lastDrawnKey = 'hidden'; } return; }
      if (!tip) { if (lastDrawnKey !== 'none') { clear(); lastDrawnKey = 'none'; } return; }
      if (mode === 'idle') {
        clear();
        const s = now / 1000;
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
        glyph(tip.x + dx, tip.y + dy, 0.9);
        lastDrawnKey = '';
        return;
      }
      const key = `${mode}:${Math.round(tip.x)}:${Math.round(tip.y)}`;
      if (key === lastDrawnKey) return;
      clear();
      glyph(tip.x, tip.y, mode === 'park' ? 0.8 : 1);
      lastDrawnKey = key;
    },
  };
}
