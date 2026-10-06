// `list` drawable (brief 02 criterion 5 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { LIST_LAYOUT } from '../../shared/layout-core/constants.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, fixtureElement, rectContainsRect, slotRect } from './helpers.js';

before(async () => { await setup(); });

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('criterion 5: with itemAt, item k becomes visible exactly when u crosses partStarts[k] (fx-type-list s002)', () => {
  const { el, ctx } = fixtureElement('fx-type-list', 's002', 'six');
  const d = prepare(el, ctx);
  assert.equal(d.parts, 6);
  // window: at 0.05 → end 0.95 (last element of the scene); itemAt mapped into it
  const expected = el.itemAt.map((v) => (v - 0.05) / 0.9);
  d.partStarts.forEach((p, k) => assert.ok(near(p, expected[k], 1e-5), `partStarts[${k}]=${p} expected ${expected[k]}`));
  for (let k = 0; k < 6; k++) {
    const p = d.partStarts[k];
    if (p > 0) assert.equal(d.progress(p - 1e-4).part, k - 1, `just before item ${k}`);
    assert.equal(d.progress(p + 1e-4).part, k, `just after item ${k}`);
    // the first stroke of item k is in progress right after its start; nothing of item k before
    const after = d.progress(p + 1e-4);
    assert.equal(d.strokes[after.current >= 0 ? after.current : after.completeCount - 1].item, k);
  }
  assert.equal(d.progress(1).completeCount, d.paths.length);
});

test('criterion 5: without itemAt parts are evenly spaced; the engine may pass ctx.window to resolve itemAt', () => {
  const { el, ctx } = fixtureElement('fx-type-list', 's001', 'steps');
  const d = prepare(el, ctx);
  assert.deepEqual(d.partStarts, [0, 1 / 3, 2 / 3]);
  const timed = { ...el, at: 0.2, itemAt: [0.2, 0.4, 0.6] };
  const withWindow = prepare(timed, { ...ctx, window: { at: 0.2, end: 1.0 } });
  withWindow.partStarts.forEach((p, k) => assert.ok(near(p, [0, 0.25, 0.5][k], 1e-5), `${p}`));
  const heuristic = prepare(timed, ctx); // last element → window end 0.95
  heuristic.partStarts.forEach((p, k) => assert.ok(near(p, [0, 0.2 / 0.75, 0.4 / 0.75][k], 1e-5), `${p}`));
});

test('criterion 5: ordered lists draw hand-written numbers 1..n; unordered lists draw a rough bullet per item', () => {
  const { el, ctx } = fixtureElement('fx-type-list', 's002', 'six');
  const d = prepare(el, ctx);
  for (let k = 0; k < 6; k++) {
    const markers = d.strokes.filter((s) => s.marker && s.item === k);
    assert.deepEqual(markers.map((s) => s.char), [String(k + 1), '.'], `item ${k}`);
    assert.ok(markers.every((s) => s.kind === 'glyph' && s.part === k));
    // text starts after the bullet indent
    const text = d.strokes.filter((s) => !s.marker && s.item === k);
    assert.ok(text.length > 0);
    assert.ok(text.every((s) => s.x >= d.meta.inner.x + LIST_LAYOUT.bulletIndent - 0.001));
  }
  const un = fixtureElement('fx-type-list', 's001', 'steps');
  const b = prepare(un.el, un.ctx);
  for (let k = 0; k < 3; k++) {
    const markers = b.strokes.filter((s) => s.marker && s.item === k);
    assert.ok(markers.length >= 1 && markers.every((s) => s.kind === 'rough'), `bullet ${k}`);
    assert.ok(markers[0].bounds.w <= 16 && markers[0].bounds.h <= 16);
    assert.ok(markers[0].bounds.x >= slotRect(un.el.slot).x);
  }
});

test('criterion 5: six near-cap items of eight words each fit a rowSpan ≥ 2 slot (fx-core-dense s001)', async () => {
  const six8 = (await prepareLesson('fx-core-dense')).find((x) => x.el.id === 'six8');
  assert.equal(six8.drawable.parts, 6);
  assert.ok(rectContainsRect(slotRect(six8.el.slot), six8.drawable.bounds));
  for (const item of six8.drawable.meta.items) assert.ok(item.lines.length >= 1 && item.lines.join(' ') === six8.el.items[item.index]);
  const two = (await prepareLesson('fx-type-list')).find((x) => x.el.id === 'two');
  assert.equal(two.drawable.parts, 2);
  assert.ok(two.drawable.meta.items.every((i) => i.lines.length === 1), 'eight-word items fit one line across three columns');
});

test('edge cases: a 2-item list in one cell, long items wrapping to two lines, items stacked with the measured gap', () => {
  const el = { id: 'l', type: 'list', slot: 'A1', items: ['one', 'two'] };
  const ctx = makeDrawCtx([scene('s001', 'wipe', [el])], 0);
  const d = prepare(el, ctx);
  assert.equal(d.parts, 2);
  assert.deepEqual(d.partStarts, [0, 0.5]);
  assert.ok(rectContainsRect(slotRect('A1'), d.bounds));
  const wrapEl = { id: 'w', type: 'list', slot: 'A1:A2', items: ['these words will certainly wrap here', 'short'] };
  const w = prepare(wrapEl, makeDrawCtx([scene('s001', 'wipe', [wrapEl])], 0));
  assert.ok(w.meta.items[0].lines.length >= 2);
  assert.equal(w.meta.items[1].top - w.meta.items[0].top, w.meta.items[0].height + LIST_LAYOUT.itemGap);
  assert.ok(rectContainsRect(slotRect('A1:A2'), w.bounds));
});
