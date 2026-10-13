// The pen cursor (player/engine/pen.js): a white arrow pointer with a dark outline, slightly
// larger than an OS default, whose tip is the exact point the engine passes (design cycle 1).
// Drawn against a recording 2D context; the module API (createPen, modes, setTip, setIdlePaths,
// frame) is the contract the engine depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPen, ARROW_SHAPE, ARROW_SCALE, ARROW_FILL, ARROW_OUTLINE } from '../../player/engine/pen.js';
import { tokens } from '../../shared/layout-core/tokens.js';

/** A 2D context that records every call (name + args) and every property assignment in order. */
function recordingCanvas() {
  const log = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (typeof k !== 'string') return undefined;
      return (...args) => { log.push({ call: k, args }); };
    },
    set(_, k, v) { log.push({ set: k, value: v }); return true; },
  });
  return { canvas: { width: 1600, height: 900, getContext: () => ctx }, log };
}

const calls = (log, name) => log.filter((e) => e.call === name);
const sets = (log, name) => log.filter((e) => e.set === name).map((e) => e.value);
/** Points of the polygon traced by the last beginPath..closePath (moveTo + lineTo args). */
function lastPolygon(log) {
  const start = log.map((e) => e.call).lastIndexOf('beginPath');
  return log.slice(start).filter((e) => e.call === 'moveTo' || e.call === 'lineTo').map((e) => e.args);
}
function bounds(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

test('API: starts hidden with no tip; modes switch; setTip ignores non-finite points', () => {
  const { canvas } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  assert.equal(pen.mode, 'hidden');
  assert.equal(pen.tip, null);
  pen.setTip({ x: NaN, y: 1 }); assert.equal(pen.tip, null);
  pen.setTip({ x: 100, y: 200 }); assert.deepEqual(pen.tip, { x: 100, y: 200 });
  for (const m of ['draw', 'park', 'idle', 'hidden']) { pen.setMode(m); assert.equal(pen.mode, m); }
  assert.equal(typeof pen.setIdlePaths, 'function');
  assert.equal(typeof pen.frame, 'function');
});

test('hidden: the overlay is cleared once and nothing is drawn', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setTip({ x: 10, y: 10 });
  pen.frame(0); pen.frame(16);
  assert.equal(calls(log, 'clearRect').length, 1);
  assert.equal(calls(log, 'fill').length, 0);
});

test('draw: a white arrow with a dark outline whose tip (hotspot) is exactly the engine point; ~1.3x an OS pointer', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setTip({ x: 412.5, y: 233.25 });
  pen.setMode('draw');
  pen.frame(0);
  const poly = lastPolygon(log);
  assert.equal(poly.length, ARROW_SHAPE.length, 'one vertex per shape point');
  assert.deepEqual(poly[0], [412.5, 233.25], 'the first vertex (the arrow tip) is the hotspot');
  const b = bounds(poly);
  assert.equal(b.x, 412.5, 'the arrow hangs down-right from the tip: nothing left of the hotspot');
  assert.equal(b.y, 233.25, 'nothing above the hotspot');
  assert.ok(b.h >= 22 && b.h <= 30, `about 1.3x a 19 px OS arrow tall (got ${b.h})`);
  assert.ok(b.w >= 14 && b.w <= 20, `about 1.3x a 12 px OS arrow wide (got ${b.w})`);
  assert.ok(ARROW_SCALE >= 1.25 && ARROW_SCALE <= 1.4);
  // white fill, dark outline, filled then stroked, with the closed classic silhouette
  assert.equal(ARROW_FILL.toLowerCase(), '#ffffff');
  assert.equal(ARROW_OUTLINE.toLowerCase(), '#000000');
  assert.ok(sets(log, 'fillStyle').includes(ARROW_FILL));
  assert.ok(sets(log, 'strokeStyle').includes(ARROW_OUTLINE));
  assert.equal(calls(log, 'fill').length, 1);
  assert.equal(calls(log, 'stroke').length, 1);
  assert.equal(calls(log, 'closePath').length, 1);
  assert.ok(sets(log, 'globalAlpha').includes(1));
  // the classic shape: a notch (the tail) — some vertex is right of the tail base and lower than the notch
  const notch = poly[2], tail = poly[3];
  assert.ok(tail[1] > notch[1] && tail[0] > notch[0], 'tail hangs below and right of the notch');
});

test('draw: the same tip and mode is not redrawn; moving the tip clears and redraws; park is translucent', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setTip({ x: 10, y: 20 });
  pen.setMode('draw');
  pen.frame(0);
  const n = log.length;
  pen.frame(16);
  assert.equal(log.length, n, 'no-op frame when nothing changed');
  pen.setTip({ x: 50, y: 60 });
  pen.frame(32);
  assert.equal(calls(log, 'clearRect').length, 2);
  assert.deepEqual(lastPolygon(log)[0], [50, 60]);
  pen.setMode('park');
  pen.frame(48);
  assert.equal(sets(log, 'globalAlpha').at(-1), 0.8);
});

test('idle: the arrow wobbles around the tip over wall time and the idle paths are retraced dashed in the given colour', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setTip({ x: 300, y: 300 });
  pen.setIdlePaths(['M0 0 L100 0', null, 'M0 10 L100 10'], tokens.accent2);
  pen.setMode('idle');
  pen.frame(0);
  const a = lastPolygon(log)[0];
  pen.frame(700);
  const b = lastPolygon(log)[0];
  assert.notDeepEqual(a, b, 'the hover wobble moves the arrow');
  for (const p of [a, b]) { assert.ok(Math.abs(p[0] - 300) <= 13 && Math.abs(p[1] - 300) <= 10, 'wobble stays within a few px of the tip'); }
  assert.ok(calls(log, 'setLineDash').length >= 2, 'retrace is dashed');
  assert.ok(sets(log, 'strokeStyle').includes(tokens.accent2), 'retrace uses the given colour');
  assert.equal(sets(log, 'globalAlpha').at(-1), 0.9, 'the idle arrow is slightly translucent');
});
