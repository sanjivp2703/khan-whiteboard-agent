// `code` drawable (brief 02 criterion 7 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_CHAR_ADVANCE, LINE_HEIGHTS, SLOT_PAD } from '../../shared/layout-core/constants.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, fixtureElement, rectContainsRect, slotRect } from './helpers.js';

before(async () => { await setup(); });

test('criterion 7: characters advance by exactly CODE_CHAR_ADVANCE and lines by the code line height', () => {
  const { el, ctx } = fixtureElement('fx-type-code', 's003', 'dense');
  const d = prepare(el, ctx);
  for (let li = 0; li < el.lines.length; li++) {
    const glyphs = d.strokes.filter((s) => s.kind === 'glyph' && s.line === li);
    assert.equal(glyphs.length, 22, `line ${li}`);
    for (let j = 1; j < glyphs.length; j++) assert.equal(glyphs[j].x - glyphs[j - 1].x, CODE_CHAR_ADVANCE);
    assert.equal(glyphs[0].x, d.meta.inner.x);
    assert.equal(d.meta.lineRects[li].y, d.meta.inner.y + li * LINE_HEIGHTS.code);
  }
  assert.equal(d.meta.charAdvance, CODE_CHAR_ADVANCE);
  assert.ok(rectContainsRect(slotRect('A1'), d.bounds));
});

test('criterion 7: 14 lines at the character cap fit their slots (fx-type-code s002: 3 cols; fx-core-dense: 2 cols)', async () => {
  const full = (await prepareLesson('fx-type-code')).find((x) => x.el.id === 'full');
  assert.equal(full.drawable.meta.lines.length, 14);
  assert.ok(rectContainsRect(slotRect(full.el.slot), full.drawable.bounds));
  const code14 = (await prepareLesson('fx-core-dense')).find((x) => x.el.id === 'code14');
  assert.equal(code14.drawable.meta.lines.length, 14);
  assert.ok(Math.max(...code14.el.lines.map((l) => l.length)) <= 44);
  assert.ok(rectContainsRect(slotRect(code14.el.slot), code14.drawable.bounds));
});

test('criterion 7: a tab renders as two spaces (never a throw); lang is accepted and ignored', () => {
  const el = { id: 'c', type: 'code', slot: 'A1', lang: 'py', lines: ['\tx = 1', 'y\t=\t2'] };
  const d = prepare(el, makeDrawCtx([scene('s001', 'wipe', [el])], 0));
  assert.deepEqual(d.meta.lines, ['  x = 1', 'y  =  2']);
  const x = d.strokes.find((s) => s.char === 'x');
  assert.equal(x.x, d.meta.inner.x + 2 * CODE_CHAR_ADVANCE);
  assert.ok(d.strokes.every((s) => s.color === tokens.chalk || s.frame), 'one chalk color, no syntax colors');
});

test('the frame is a faint rough rectangle in muted around the slot inner rect, drawn first, inside the slot', () => {
  const { el, ctx } = fixtureElement('fx-type-code', 's001', 'lookup');
  const d = prepare(el, ctx);
  const frame = d.strokes.filter((s) => s.frame);
  assert.ok(frame.length >= 1);
  assert.equal(d.strokes[0].frame, true);
  for (const s of frame) { assert.equal(s.kind, 'faint'); assert.equal(s.color, tokens.muted); }
  const slot = slotRect(el.slot);
  assert.deepEqual(d.meta.frameRect, { x: slot.x + SLOT_PAD - 4, y: slot.y + SLOT_PAD - 4, w: slot.w - 2 * (SLOT_PAD - 4), h: slot.h - 2 * (SLOT_PAD - 4) });
  assert.ok(rectContainsRect(slot, d.bounds));
  assert.equal(d.parts, 1);
});

test('edge cases: a single line, an empty line, and a line of spaces', () => {
  const el = { id: 'c', type: 'code', slot: 'A1', lines: ['return 1;'] };
  const d = prepare(el, makeDrawCtx([scene('s001', 'wipe', [el])], 0));
  assert.equal(d.strokes.filter((s) => s.kind === 'glyph').length, 'return1;'.length);
  const e2 = { id: 'c', type: 'code', slot: 'A1', lines: ['', '   ', 'x'] };
  const d2 = prepare(e2, makeDrawCtx([scene('s001', 'wipe', [e2])], 0));
  assert.equal(d2.strokes.filter((s) => s.kind === 'glyph').length, 1);
  assert.equal(d2.strokes.find((s) => s.char === 'x').line, 2);
});
