// player/engine/pen.js — the pen cursor on the #pen overlay canvas (brief 04 item 7).
// Modes: 'hidden' (waiting/ended), 'draw' (follows the active drawable's tip), 'park' (rests at a
// point, e.g. a pointer highlight or a paused stroke), 'idle' (stalled/thinking: hover wobble plus
// a slow re-trace of the last highlight/box paths). The idle animation runs on wall time — it is
// decoration, not sync. Nothing here touches playback state.
import { drawPartial } from '../../shared/strokes.js';

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

  /** Chalk stick: a short tilted rounded bar with a bright tip, drawn at (x, y). */
  function glyph(x, y, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 4);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(6, 8, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = tokens.chalk;
    ctx.strokeStyle = tokens.boardBg;
    ctx.lineWidth = 1.5;
    roundRect(ctx, -4, -34, 8, 34, 3);
    ctx.fill(); ctx.stroke();
    // tip
    ctx.fillStyle = tokens.accent1;
    ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
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
