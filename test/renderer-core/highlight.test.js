// `highlight` drawable (brief 02 criterion 10 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_HEIGHTS, SLOT_PAD } from '../../shared/layout-core/constants.js';
import { rectInset } from '../../shared/layout-core/grid.js';
import { setup, listFixtureLessons, prepareLesson, fixtureElement, prepare, rectContainsRect, BOARD, slotRect } from './helpers.js';

before(async () => { await setup(); });

const expand = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const pointsOf = (d) => d.strokes.flatMap((s) => s.flat.flatMap((sp) => sp.points));

test('criterion 10: circle/underline/strike/pointer geometry holds for every fixture highlight', async () => {
  const seen = new Set();
  for (const l of listFixtureLessons()) {
    for (const { sceneId, el, drawable: d } of await prepareLesson(l.lessonId)) {
      if (el.type !== 'highlight') continue;
      const where = `${l.lessonId}/${sceneId}/${el.id}`;
      const style = el.style || 'circle';
      seen.add(style);
      const T = d.meta.targetRect;
      assert.ok(rectContainsRect(d.meta.boardRect, T), `${where}: target rect outside the target slot`);
      assert.ok(rectContainsRect(BOARD, d.bounds), where);
      if (style === 'circle') {
        assert.ok(rectContainsRect(d.bounds, T), `${where}: ring bounds do not enclose the target`);
        assert.ok(rectContainsRect(expand(T, 20), d.bounds), `${where}: ring margin > 20 px`);
        assert.equal(d.paths.length, 1);
        // the drawn ring really goes around: its points reach all four sides of the ring box
        const pts = pointsOf(d);
        const ring = d.meta.ring;
        assert.ok(pts.some((p) => p[0] <= ring.x + 6) && pts.some((p) => p[0] >= ring.x + ring.w - 6), where);
        assert.ok(pts.some((p) => p[1] <= ring.y + 6) && pts.some((p) => p[1] >= ring.y + ring.h - 6), where);
      } else if (style === 'underline') {
        const bottom = d.meta.lastLine.y + d.meta.lastLine.h;
        for (const p of pointsOf(d)) assert.ok(p[1] >= bottom - 1 && p[1] <= bottom + 12, `${where}: underline y ${p[1]} not within 12 px below ${bottom}`);
        const xs = pointsOf(d).map((p) => p[0]);
        assert.ok(Math.min(...xs) <= d.meta.lastLine.x + 2 && Math.max(...xs) >= d.meta.lastLine.x + d.meta.lastLine.w - 2, where);
      } else if (style === 'strike') {
        const mid = T.y + T.h / 2;
        for (const p of pointsOf(d)) assert.ok(Math.abs(p[1] - mid) <= 5, `${where}: strike y ${p[1]} vs middle ${mid}`);
        const xs = pointsOf(d).map((p) => p[0]);
        assert.ok(Math.min(...xs) <= T.x + 1 && Math.max(...xs) >= T.x + T.w - 1, where);
      } else if (style === 'pointer') {
        assert.deepEqual(d.paths, []);
        assert.equal(d.naturalMs, 0);
        const tips = [0, 0.25, 0.5, 0.75, 1].map((u) => d.tipAt(u));
        for (const t of tips) assert.deepEqual(t, tips[0], where);
        assert.ok(tips[0].x < T.x && tips[0].x >= T.x - 20, `${where}: pointer not adjacent`);
        assert.equal(tips[0].y, T.y + T.h / 2);
      }
      if (Number.isInteger(el.line)) {
        const target = fixtureElement(l.lessonId, sceneId, el.id).ctx.elementsById.get(el.target);
        assert.equal(target.type, 'code');
        const inner = rectInset(slotRect(target.slot), SLOT_PAD);
        assert.equal(T.y, inner.y + (el.line - 1) * LINE_HEIGHTS.code, `${where}: line y-range`);
        assert.equal(T.h, LINE_HEIGHTS.code);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['circle', 'pointer', 'strike', 'underline']);
});

test('criterion 10: with `line`, every style uses only that code line (circle, underline, strike, pointer)', () => {
  const { ctx } = fixtureElement('fx-type-highlight', 's002', 'line2');
  const snippet = ctx.elementsById.get('snippet');
  const inner = rectInset(slotRect(snippet.slot), SLOT_PAD);
  for (const style of ['circle', 'underline', 'strike', 'pointer']) {
    const d = prepare({ id: `h_${style}`, type: 'highlight', target: 'snippet', style, line: 3 }, ctx);
    const T = d.meta.targetRect;
    assert.equal(T.y, inner.y + 2 * LINE_HEIGHTS.code, style);
    assert.equal(T.h, LINE_HEIGHTS.code, style);
    assert.equal(T.w, [...snippet.lines[2]].length * 10, style);
    if (style === 'pointer') assert.equal(d.tipAt(0.3).y, T.y + T.h / 2);
    else for (const p of pointsOf(d)) assert.ok(p[1] >= T.y - 24 && p[1] <= T.y + T.h + 24, `${style}: ${p[1]}`);
  }
});

test('highlights reach back to elements of earlier scenes; the default style is circle; text targets ring the measured text, not the whole slot', async () => {
  const ring = (await prepareLesson('fx-build-region')).find((x) => x.el.id === 'ring');
  assert.equal(ring.sceneId, 's003');
  assert.equal(ring.drawable.meta.style, 'circle');
  assert.ok(ring.drawable.paths.length === 1);
  assert.ok(rectContainsRect(slotRect('A1:C1'), ring.drawable.meta.targetRect));
  assert.ok(ring.drawable.meta.targetRect.w < slotRect('A1:C1').w / 2, 'rings the words, not the three-cell slot');
  const ring2 = (await prepareLesson('fx-type-highlight')).find((x) => x.el.id === 'ring2');
  assert.equal(ring2.el.style, undefined);
  assert.equal(ring2.drawable.meta.style, 'circle');
  assert.ok(ring2.drawable.meta.targetRect.w < 150, 'a four-letter title');
});

test('non-core targets (sketch etc.) fall back to the content rect; a box target rings the box stroke', async () => {
  const { ctx } = fixtureElement('fx-full-tour', 's009', 'mostly');
  const d = prepare({ id: 'h', type: 'highlight', target: 'client', style: 'circle' }, ctx);
  assert.deepEqual(d.meta.targetRect, rectInset(slotRect('A2'), SLOT_PAD));
  const b = prepare({ id: 'hb', type: 'highlight', target: 'cache', style: 'strike' }, ctx);
  assert.deepEqual(b.meta.targetRect, rectInset(slotRect('B2:C2'), SLOT_PAD / 2));
});
