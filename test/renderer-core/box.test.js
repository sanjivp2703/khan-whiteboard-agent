// `box` drawable (brief 02: rough rectangle inset by SLOT_PAD/2, optional label; containment).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_PAD, BOX_LAYOUT } from '../../shared/layout-core/constants.js';
import { rectInset } from '../../shared/layout-core/grid.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, fixtureElement, rectContainsRect, slotRect } from './helpers.js';

before(async () => { await setup(); });

test('the frame follows the slot rect inset by SLOT_PAD/2 and stays inside the slot for every fixture box', async () => {
  for (const lessonId of ['fx-type-box', 'fx-core-arrows', 'fx-full-tour', 'fx-core-dense']) {
    for (const { el, drawable: d } of await prepareLesson(lessonId)) {
      if (el.type !== 'box') continue;
      const slot = slotRect(el.slot);
      assert.deepEqual(d.meta.frame, rectInset(slot, SLOT_PAD / 2), el.id);
      assert.ok(rectContainsRect(slot, d.bounds), el.id);
      const frame = d.strokes.filter((s) => s.frame);
      assert.ok(frame.length >= 1 && frame.every((s) => s.kind === 'rough'), el.id);
      // the stroke really surrounds the frame rect (its envelope touches all four sides)
      const fb = frame.reduce((a, s) => ({ x: Math.min(a.x, s.bounds.x), y: Math.min(a.y, s.bounds.y), x1: Math.max(a.x1, s.bounds.x + s.bounds.w), y1: Math.max(a.y1, s.bounds.y + s.bounds.h) }), { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity });
      assert.ok(Math.abs(fb.x - d.meta.frame.x) <= 4 && Math.abs(fb.y - d.meta.frame.y) <= 4, el.id);
      assert.ok(Math.abs(fb.x1 - (d.meta.frame.x + d.meta.frame.w)) <= 4 && Math.abs(fb.y1 - (d.meta.frame.y + d.meta.frame.h)) <= 4, el.id);
      assert.equal(d.parts, 1);
    }
  }
});

test('the label is hand-written in note size at the top-left inside the stroke, in the element color', () => {
  const { el, ctx } = fixtureElement('fx-type-box', 's001', 'cache');
  const d = prepare(el, ctx);
  const label = d.strokes.filter((s) => s.label);
  assert.equal(label.map((s) => s.char).join(''), 'Cachelayer');
  assert.ok(label.every((s) => s.kind === 'glyph' && s.color === tokens.accent1));
  assert.equal(d.meta.labelRects.length, 1);
  assert.equal(d.meta.labelRects[0].y, d.meta.frame.y + BOX_LAYOUT.labelPad);
  assert.ok(d.meta.labelRects[0].x > d.meta.frame.x && d.meta.labelRects[0].x < d.meta.frame.x + 20);
  const plain = fixtureElement('fx-type-box', 's002', 'plain');
  const p = prepare(plain.el, plain.ctx);
  assert.ok(p.strokes.every((s) => s.frame));
  assert.equal(p.meta.label, null);
});

test('a six-word label in a one-cell box wraps and never escapes the slot; a box with elements inside renders alongside them', () => {
  const el = { id: 'b', type: 'box', slot: 'A1', label: 'extraordinarily lengthy labels wrap gracefully inside' };
  const d = prepare(el, makeDrawCtx([scene('s001', 'wipe', [el])], 0));
  assert.ok(d.meta.labelRects.length >= 2, 'wrapped');
  assert.ok(rectContainsRect(slotRect('A1'), d.bounds));
  assert.ok(d.strokes.filter((s) => s.label).length > 10);
  const inside = fixtureElement('fx-type-box', 's001', 'inside');
  const box = prepare(inside.ctx.elementsById.get('cache'), inside.ctx);
  const text = prepare(inside.el, inside.ctx);
  assert.ok(box.paths.length > 0 && text.paths.length > 0);
  assert.ok(rectContainsRect(box.bounds, text.bounds), 'the inner element lies inside the box');
});
