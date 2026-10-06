// `arrow` drawable (brief 02 criterion 9 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_PAD } from '../../shared/layout-core/constants.js';
import { rectInset } from '../../shared/layout-core/grid.js';
import { arrowAnchors, attachRect, HEAD_LEN } from '../../player/renderer/core/arrow.js';
import { setup, listFixtureLessons, prepareLesson, prepare, rectContainsRect, BOARD, slotRect } from './helpers.js';

before(async () => { await setup(); });

const onBoundary = (p, r, eps = 2) => {
  const inX = p.x >= r.x - eps && p.x <= r.x + r.w + eps;
  const inY = p.y >= r.y - eps && p.y <= r.y + r.h + eps;
  const onV = Math.abs(p.x - r.x) <= eps || Math.abs(p.x - (r.x + r.w)) <= eps;
  const onH = Math.abs(p.y - r.y) <= eps || Math.abs(p.y - (r.y + r.h)) <= eps;
  return inX && inY && (onV || onH);
};
const strictlyInside = (p, r, eps = 2) => p.x > r.x + eps && p.x < r.x + r.w - eps && p.y > r.y + eps && p.y < r.y + r.h - eps;
const intersects = (a, b) => !(b.x >= a.x + a.w || b.x + b.w <= a.x || b.y >= a.y + a.h || b.y + b.h <= a.y);
const gapBetween = (A, B) => Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w), B.y - (A.y + A.h), A.y - (B.y + B.h));

test('criterion 9: every fixture arrow starts and ends on the boundary of the from/to content rects, never inside either', async () => {
  let n = 0;
  for (const l of listFixtureLessons()) {
    for (const { sceneId, el, ctx, drawable: d } of await prepareLesson(l.lessonId)) {
      if (el.type !== 'arrow') continue;
      const where = `${l.lessonId}/${sceneId}/${el.id}`;
      const A = d.meta.fromRect, B = d.meta.toRect;
      assert.deepEqual(A, rectInset(slotRect(ctx.elementsById.get(el.from).slot), SLOT_PAD), where);
      assert.deepEqual(B, rectInset(slotRect(ctx.elementsById.get(el.to).slot), SLOT_PAD), where);
      assert.ok(onBoundary(d.meta.p1, A), `${where}: p1 ${JSON.stringify(d.meta.p1)} not on ${JSON.stringify(A)}`);
      assert.ok(onBoundary(d.meta.p2, B), `${where}: p2 ${JSON.stringify(d.meta.p2)} not on ${JSON.stringify(B)}`);
      if (!intersects(A, B)) {
        assert.ok(!strictlyInside(d.meta.p1, B) && !strictlyInside(d.meta.p2, A), where);
      }
      // the drawn shaft really runs p1 → p2 (preserved vertices) and the head sits at p2
      const shaft = d.strokes.find((s) => s.shaft);
      const first = shaft.flat[0].points[0], last = shaft.flat[0].points[shaft.flat[0].points.length - 1];
      assert.ok(Math.hypot(first[0] - d.meta.p1.x, first[1] - d.meta.p1.y) <= 2, `${where}: shaft start`);
      assert.ok(Math.hypot(last[0] - d.meta.p2.x, last[1] - d.meta.p2.y) <= 2, `${where}: shaft end`);
      const head = d.strokes.filter((s) => s.head);
      assert.ok(head.length >= 2, where);
      for (const h of head) {
        const pts = h.flat.flatMap((sp) => sp.points);
        assert.ok(pts.some((p) => Math.hypot(p[0] - d.meta.p2.x, p[1] - d.meta.p2.y) <= 2), `${where}: head not at the tip`);
      }
      assert.ok(rectContainsRect(BOARD, d.bounds), where);
      n++;
    }
  }
  assert.ok(n >= 12, `only ${n} arrows`);
});

test('criterion 9: same-column elements attach top/bottom; same-row attach right/left; both directions', async () => {
  const arrows = Object.fromEntries((await prepareLesson('fx-core-arrows')).filter((x) => x.el.type === 'arrow').map((x) => [x.el.id, x.drawable.meta]));
  assert.equal(arrows.from_north.axis, 'v'); assert.equal(arrows.from_north.fromEdge, 'bottom'); assert.equal(arrows.from_north.toEdge, 'top');
  assert.equal(arrows.from_south.axis, 'v'); assert.equal(arrows.from_south.fromEdge, 'top'); assert.equal(arrows.from_south.toEdge, 'bottom');
  assert.equal(arrows.to_east.axis, 'h'); assert.equal(arrows.to_east.fromEdge, 'right'); assert.equal(arrows.to_east.toEdge, 'left');
  assert.equal(arrows.to_west.axis, 'h'); assert.equal(arrows.to_west.fromEdge, 'left'); assert.equal(arrows.to_west.toEdge, 'right');
  // vertical arrows share one x; horizontal arrows share one y
  assert.equal(arrows.from_north.p1.x, arrows.from_north.p2.x);
  assert.equal(arrows.to_east.p1.y, arrows.to_east.p2.y);
  // diagonal (no overlap on either axis) still leaves from an edge midpoint and arrives at one
  assert.ok(['h', 'v'].includes(arrows.diag.axis));
  // pure geometry: a wide element above a narrow one attaches bottom→top at the overlap centre, never through the interior
  const a = arrowAnchors(attachRect(slotRect('A1:F1')), attachRect(slotRect('A2')));
  assert.equal(a.axis, 'v');
  assert.equal(a.p1.y, attachRect(slotRect('A1:F1')).y + attachRect(slotRect('A1:F1')).h);
  assert.equal(a.p2.y, attachRect(slotRect('A2')).y);
  assert.ok(a.p1.x > slotRect('A2').x && a.p1.x < slotRect('A2').x + slotRect('A2').w);
});

test('criterion 9: labels are hand-written beside the midpoint and overlap neither rect whenever there is room; 4-word labels render', async () => {
  let labelled = 0;
  for (const l of listFixtureLessons()) {
    for (const { sceneId, el, drawable: d } of await prepareLesson(l.lessonId)) {
      if (el.type !== 'arrow' || !el.label) continue;
      const where = `${l.lessonId}/${sceneId}/${el.id}`;
      const L = d.meta.labelRect;
      assert.ok(L && rectContainsRect(BOARD, L), where);
      const glyphs = d.strokes.filter((s) => s.label);
      assert.equal(glyphs.map((s) => s.char).join(''), el.label.replace(/\s+/g, ''), where);
      assert.ok(glyphs.every((s) => s.kind === 'glyph' && s.color === d.strokes[0].color), where);
      if (gapBetween(d.meta.fromRect, d.meta.toRect) >= L.h + 2 * 10) {
        assert.ok(!intersects(L, d.meta.fromRect) && !intersects(L, d.meta.toRect), `${where}: label ${JSON.stringify(L)} overlaps a rect`);
      }
      // the label clears the shaft: its rect does not contain the midpoint
      const m = { x: (d.meta.p1.x + d.meta.p2.x) / 2, y: (d.meta.p1.y + d.meta.p2.y) / 2 };
      assert.ok(!(m.x > L.x && m.x < L.x + L.w && m.y > L.y && m.y < L.y + L.h), where);
      labelled++;
    }
  }
  assert.ok(labelled >= 8);
  const four = (await prepareLesson('fx-core-arrows')).find((x) => x.el.id === 'to_west');
  assert.equal(four.el.label.split(' ').length, 4);
  assert.ok(four.drawable.strokes.filter((s) => s.label).length > 10);
});

test('criterion 9: an arrow whose `from` was drawn in an earlier scene (via boardRects) renders; the head is HEAD_LEN long', async () => {
  const miss = (await prepareLesson('fx-type-arrow')).find((x) => x.el.id === 'miss');
  assert.equal(miss.sceneId, 's002');
  assert.ok(miss.drawable.paths.length >= 3);
  assert.deepEqual(miss.drawable.meta.fromRect, rectInset(slotRect('C1:D3'), SLOT_PAD));
  const [w1, w2] = miss.drawable.meta.head;
  const p2 = miss.drawable.meta.p2;
  for (const w of [w1, w2]) assert.ok(Math.abs(Math.hypot(w.x - p2.x, w.y - p2.y) - Math.hypot(HEAD_LEN, 8)) < 1e-6);
  // determinism across scenes: the same arrow prepared from a rebuilt ctx is identical
  const again = prepare(miss.el, miss.ctx);
  assert.deepEqual(again.paths, miss.drawable.paths);
});
