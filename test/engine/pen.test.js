// The pen cursor (player/engine/pen.js): a white arrow pointer with a dark outline, slightly
// larger than an OS default, whose tip is the exact point the engine passes (design cycle 1).
// change-khan-feel item 6: a hovering arrow travels between distant tips (one element to the
// next) with a short tween instead of jumping, and hovers (a slow few-px drift) on a written
// element while the narration goes on; while drawing it follows the tip directly.
// Drawn against a recording 2D context; the module API (createPen, modes, setTip, setIdlePaths,
// frame, pos, travelling) is the contract the engine depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPen, ARROW_SHAPE, ARROW_SCALE, ARROW_FILL, ARROW_OUTLINE, PEN_TRAVEL_MS, PEN_HOVER_PX, TRAVEL_MIN_PX, TRAVEL_FULL_PX, HOVER_ALPHA, travelMs } from '../../player/engine/pen.js';
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
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('API: starts hidden with no tip; modes switch; setTip ignores non-finite points; pos and travelling are exposed', () => {
  const { canvas } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  assert.equal(pen.mode, 'hidden');
  assert.equal(pen.tip, null);
  assert.equal(pen.pos, null);
  assert.equal(pen.travelling, false);
  pen.setTip({ x: NaN, y: 1 }); assert.equal(pen.tip, null);
  pen.setTip({ x: 100, y: 200 }); assert.deepEqual(pen.tip, { x: 100, y: 200 });
  assert.deepEqual(pen.pos, { x: 100, y: 200 }, 'the first tip is taken without travel');
  for (const m of ['draw', 'hover', 'park', 'idle', 'hidden']) { pen.setMode(m); assert.equal(pen.mode, m); }
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

test('draw: the same tip and mode is not redrawn; moving the tip clears and redraws at once (the ink is under the pen, even across a line return); park is translucent', () => {
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
  // a long jump while drawing (a new line, a rough.js second pass) is followed directly: no travel
  pen.setTip({ x: 650, y: 400 });
  assert.equal(pen.travelling, false);
  pen.frame(48);
  assert.deepEqual(lastPolygon(log)[0], [650, 400]);
  assert.deepEqual(pen.pos, { x: 650, y: 400 });
  pen.setMode('park');
  pen.frame(64);
  assert.equal(sets(log, 'globalAlpha').at(-1), 0.8);
});

test('hover travel: a long move of a hovering pen travels there over PEN_TRAVEL_MS with an ease-in-out tween — it leaves at once, is halfway at half time and arrives exactly', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setMode('hover');
  pen.setTip({ x: 72, y: 20 });
  pen.frame(0);
  assert.deepEqual(pen.pos, { x: 72, y: 20 });
  // the next element's first point, 500 px away (= TRAVEL_FULL_PX → the full PEN_TRAVEL_MS)
  assert.equal(TRAVEL_FULL_PX, 500);
  assert.equal(travelMs(500), PEN_TRAVEL_MS);
  assert.ok(PEN_TRAVEL_MS >= 250 && PEN_TRAVEL_MS <= 400, `travel ${PEN_TRAVEL_MS} ms (study: 0.3–0.5 s)`);
  pen.setTip({ x: 572, y: 20 });
  assert.equal(pen.travelling, true);
  assert.deepEqual(pen.tip, { x: 572, y: 20 }, 'tip is the engine point at once');
  pen.frame(100);                               // the travel starts on this frame: still at the old point (no drift while travelling)
  assert.deepEqual(lastPolygon(log)[0], [72, 20]);
  pen.frame(100 + PEN_TRAVEL_MS / 2);
  const mid = lastPolygon(log)[0];
  close(mid[0], 322); close(mid[1], 20);         // ease-in-out is symmetric: exactly halfway at half time
  assert.equal(pen.travelling, true);
  pen.frame(100 + PEN_TRAVEL_MS * 0.75);
  const late = lastPolygon(log)[0];
  assert.ok(late[0] > 322 + 125 && late[0] < 572, `eases out: ${late[0]} is past 3/4 of the way but not there yet`);
  pen.frame(100 + PEN_TRAVEL_MS - 1);
  assert.equal(pen.travelling, true);
  pen.frame(100 + PEN_TRAVEL_MS);
  assert.equal(pen.travelling, false);
  assert.deepEqual(pen.pos, { x: 572, y: 20 }, 'arrives exactly on the engine point');
  const p = lastPolygon(log)[0];
  assert.ok(Math.abs(p[0] - 572) <= PEN_HOVER_PX && Math.abs(p[1] - 20) <= PEN_HOVER_PX, 'then hovers there');
});

test('hover travel: shorter jumps take proportionally less time (never under 40 % of PEN_TRAVEL_MS); letter and word hops never travel', () => {
  assert.equal(TRAVEL_MIN_PX, 80, 'above the widest 44 px glyph plus a word space (≈ 57 px)');
  assert.equal(travelMs(1000), PEN_TRAVEL_MS);
  assert.equal(travelMs(500), PEN_TRAVEL_MS);
  close(travelMs(250), PEN_TRAVEL_MS * 0.5);
  close(travelMs(80), PEN_TRAVEL_MS * 0.4);
  close(travelMs(0), PEN_TRAVEL_MS * 0.4);
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setMode('hover');
  pen.setTip({ x: 100, y: 100 });
  pen.frame(0);
  for (const [x, y] of [[130, 100], [160, 102], [200, 98], [257, 100]]) { pen.setTip({ x, y }); pen.frame(10); assert.equal(pen.travelling, false, `hop to ${x},${y}`); }
  assert.deepEqual(pen.pos, { x: 257, y: 100 });
  pen.setTip({ x: 100, y: 300 });               // 254 px → about half the full travel
  assert.equal(pen.travelling, true);
  const ms = travelMs(Math.hypot(157, 200));
  assert.ok(ms > PEN_TRAVEL_MS * 0.5 && ms < PEN_TRAVEL_MS * 0.52, `${ms} ms`);
  pen.frame(500);
  pen.frame(500 + ms / 2);
  const mid = lastPolygon(log)[0];
  close(mid[0], (257 + 100) / 2); close(mid[1], 200);
  pen.frame(500 + ms);
  assert.equal(pen.travelling, false);
  assert.deepEqual(pen.pos, { x: 100, y: 300 });
});

test('hover travel: a running travel follows a moving target without restarting; a second long jump restarts from where the arrow is; draw, park and hidden never start one and park/hidden cancel it', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setMode('hover');
  pen.setTip({ x: 0, y: 0 });
  pen.frame(0);
  pen.setTip({ x: 500, y: 0 });                 // full travel
  pen.frame(1000);
  pen.setTip({ x: 520, y: 0 });                 // the target shifts 20 px: same travel, new target
  assert.equal(pen.travelling, true);
  pen.frame(1000 + PEN_TRAVEL_MS / 2);
  close(lastPolygon(log)[0][0], 260);           // halfway to the CURRENT target
  pen.frame(1000 + PEN_TRAVEL_MS);
  assert.deepEqual(pen.pos, { x: 520, y: 0 });
  // restart: a long jump mid-travel starts a fresh travel from the arrow's current position
  pen.setTip({ x: 1020, y: 0 });
  pen.frame(2000);
  pen.frame(2000 + PEN_TRAVEL_MS / 2);
  close(lastPolygon(log)[0][0], 770);
  pen.setTip({ x: 0, y: 400 });                 // jump again before arriving
  pen.frame(2000 + PEN_TRAVEL_MS / 2 + 1);
  const from = pen.pos;
  assert.ok(Math.abs(from.x - 770) < 10, `restarts from the current position (${from.x})`);
  pen.frame(2000 + PEN_TRAVEL_MS / 2 + 1 + PEN_TRAVEL_MS);
  assert.deepEqual(pen.pos, { x: 0, y: 400 });
  assert.equal(pen.travelling, false);
  // a travel in flight when the ink begins (hover → draw) finishes; no new travel starts while drawing
  pen.setTip({ x: 600, y: 400 });
  assert.equal(pen.travelling, true);
  pen.setMode('draw');
  assert.equal(pen.travelling, true, 'the trip already under way completes');
  pen.frame(3000);
  pen.frame(3000 + PEN_TRAVEL_MS);
  assert.equal(pen.travelling, false);
  assert.deepEqual(pen.pos, { x: 600, y: 400 });
  pen.setTip({ x: 0, y: 0 });
  assert.equal(pen.travelling, false, 'drawing follows the tip directly');
  pen.frame(3400);
  assert.deepEqual(lastPolygon(log)[0], [0, 0]);
  // paused: the pen parks exactly on its point, no travel, and a trip under way is dropped
  pen.setMode('hover');
  pen.setTip({ x: 900, y: 500 });
  assert.equal(pen.travelling, true);
  pen.setMode('park');
  assert.equal(pen.travelling, false);
  pen.frame(5000);
  assert.deepEqual(lastPolygon(log)[0], [900, 500]);
  pen.setTip({ x: 100, y: 100 });               // moving the tip while parked never travels
  assert.equal(pen.travelling, false);
  pen.frame(5016);
  assert.deepEqual(lastPolygon(log)[0], [100, 100]);
  pen.setMode('hover');
  pen.setTip({ x: 500, y: 100 });
  assert.equal(pen.travelling, true);
  pen.setMode('hidden');
  assert.equal(pen.travelling, false);
});

test('hover: the arrow drifts slowly within PEN_HOVER_PX of the tip, slightly translucent, with no retrace — much calmer than idle', () => {
  const { canvas, log } = recordingCanvas();
  const pen = createPen(canvas, tokens);
  pen.setTip({ x: 300, y: 300 });
  pen.setIdlePaths(['M0 0 L100 0'], tokens.accent2);
  pen.setMode('hover');
  assert.ok(PEN_HOVER_PX >= 1 && PEN_HOVER_PX <= 3, `hover radius ${PEN_HOVER_PX}`);
  const pts = [];
  for (let ms = 0; ms <= 6000; ms += 250) { pen.frame(ms); pts.push(lastPolygon(log)[0]); }
  assert.ok(pts.some((p) => p[0] !== pts[0][0] || p[1] !== pts[0][1]), 'the hover drift moves the arrow over wall time');
  for (const p of pts) assert.ok(Math.abs(p[0] - 300) <= PEN_HOVER_PX + 1e-9 && Math.abs(p[1] - 300) <= PEN_HOVER_PX + 1e-9, `drift ${p} stays within ${PEN_HOVER_PX} px of the tip`);
  const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - 300, p[1] - 300)));
  assert.ok(spread > 0.8, `the drift is visible (${spread.toFixed(2)} px)`);
  assert.equal(calls(log, 'setLineDash').length, 0, 'hover never retraces (that is the idle animation)');
  assert.equal(sets(log, 'globalAlpha').at(-1), HOVER_ALPHA);
  assert.ok(HOVER_ALPHA > 0.8 && HOVER_ALPHA < 1);
  assert.deepEqual(pen.pos, { x: 300, y: 300 }, 'pos is the resting point; the drift is decoration');
  // a long move while hovering travels (no drift during the trip), then hovers at the new point
  pen.setTip({ x: 800, y: 300 });
  pen.frame(7000);
  assert.deepEqual(lastPolygon(log)[0], [300, 300]);
  pen.frame(7000 + PEN_TRAVEL_MS / 2);
  close(lastPolygon(log)[0][0], 550);
  pen.frame(7000 + PEN_TRAVEL_MS + 500);
  const p = lastPolygon(log)[0];
  assert.ok(Math.abs(p[0] - 800) <= PEN_HOVER_PX && Math.abs(p[1] - 300) <= PEN_HOVER_PX);
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
