// `text` drawable (brief 02 criterion 11 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from '../../shared/layout-core/tokens.js';
import { FONT_SIZES } from '../../shared/layout-core/constants.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, rectContainsRect, slotRect, fixtureElement } from './helpers.js';

before(async () => { await setup(); });

const txt = (id, slot, text, over = {}) => ({ id, type: 'text', slot, text, ...over });
const ctxFor = (...elements) => makeDrawCtx([scene('s001', 'wipe', elements)], 0);

function glyphHeight(d, ch) {
  const s = d.strokes.find((x) => x.kind === 'glyph' && x.char === ch);
  assert.ok(s, `glyph ${ch} missing`);
  return s.bounds.h;
}

test('criterion 11: title 44 / body 28 / note 22 px — glyph heights scale with the style sizes', () => {
  const els = [txt('t', 'A1:C1', 'Hg', { style: 'title' }), txt('b', 'A2:C2', 'Hg', { style: 'body' }), txt('n', 'A3:C3', 'Hg', { style: 'note' })];
  const ctx = ctxFor(...els);
  const [t, b, n] = els.map((el) => prepare(el, ctx));
  const hT = glyphHeight(t, 'H'), hB = glyphHeight(b, 'H'), hN = glyphHeight(n, 'H');
  assert.ok(hT > hB && hB > hN);
  assert.ok(Math.abs(hT / hB - FONT_SIZES.title / FONT_SIZES.body) < 0.05, `${hT}/${hB}`);
  assert.ok(Math.abs(hB / hN - FONT_SIZES.body / FONT_SIZES.note) < 0.05, `${hB}/${hN}`);
  for (const [d, style] of [[t, 'title'], [b, 'body'], [n, 'note']]) assert.equal(d.meta.style, style);
  // default style is body
  const def = prepare(txt('d', 'A4:B4', 'Hg'), ctxFor(txt('d', 'A4:B4', 'Hg')));
  assert.equal(def.meta.style, 'body');
  assert.equal(glyphHeight(def, 'H'), hB);
});

test('criterion 11: a 40-word body text in a 4-cell slot (near-cap fixture) wraps to fit the slot', async () => {
  const dense = (await prepareLesson('fx-core-dense')).find((x) => x.el.id === 'para40');
  assert.ok(dense.drawable.meta.lines.length >= 2);
  assert.ok(rectContainsRect(slotRect('A1:D1'), dense.drawable.bounds));
  assert.equal(dense.drawable.strokes.filter((s) => s.kind === 'glyph').length, [...dense.el.text.replace(/\s+/g, '')].length);
  const forty = (await prepareLesson('fx-type-text')).find((x) => x.el.id === 'forty');
  assert.ok(rectContainsRect(slotRect(forty.el.slot), forty.drawable.bounds));
});

test('criterion 11: colors resolve to token values by name; a missing color is chalk', () => {
  const els = [txt('a', 'A1', 'hi', { color: 'accent3' }), txt('b', 'B1', 'hi', { color: 'muted' }), txt('c', 'C1', 'hi')];
  const ctx = ctxFor(...els);
  assert.equal(prepare(els[0], ctx).strokes[0].color, tokens.accent3);
  assert.equal(prepare(els[1], ctx).strokes[0].color, tokens.muted);
  assert.equal(prepare(els[2], ctx).strokes[0].color, tokens.chalk);
});

test('glyphs are revealed in reading order: one part, strokes ordered by line then x', () => {
  const el = txt('p', 'A1:A2', 'Reading order matters for the pen, so glyphs follow the text left to right and top to bottom.');
  const d = prepare(el, ctxFor(el));
  assert.equal(d.parts, 1);
  assert.deepEqual(d.partStarts, [0]);
  assert.ok(d.meta.lines.length >= 3);
  let prev = null;
  for (const s of d.strokes) {
    if (prev) {
      assert.ok(s.line > prev.line || (s.line === prev.line && s.x >= prev.x), `glyph ${s.char} out of order`);
    }
    prev = s;
  }
  // every line's glyphs sit on that line's baseline inside the inner rect
  for (const s of d.strokes) assert.equal(s.baseline, d.meta.lineRects[s.line].baseline);
  assert.ok(rectContainsRect(d.meta.inner, { x: d.bounds.x, y: d.bounds.y, w: d.bounds.w, h: d.bounds.h }, 12));
});

test('edge cases: single word, punctuation/quotes/digits, and characters the font lacks become rough squares (never a throw)', () => {
  const one = txt('w', 'A1', 'Done');
  const d1 = prepare(one, ctxFor(one));
  assert.equal(d1.strokes.length, 4);
  const punct = txt('p', 'A1:C1', '"Quotes", (parens) & 42% — it\'s fine: #1!');
  const d2 = prepare(punct, ctxFor(punct));
  assert.ok(d2.strokes.length > 20);
  assert.ok(d2.strokes.every((s) => !s.fallback), 'all of these are in Patrick Hand');
  const odd = txt('o', 'A1:C1', 'next → done ≥ 3 😀 ok');
  const d3 = prepare(odd, ctxFor(odd));
  const fallbacks = d3.strokes.filter((s) => s.fallback);
  assert.ok(fallbacks.length >= 2, 'arrow and emoji are not in the font');
  for (const s of fallbacks) { assert.equal(s.kind, 'glyph'); assert.ok(s.bounds.w >= 3 && s.bounds.h >= 3); }
  assert.ok(d3.strokes.some((s) => s.char === '≥' && !s.fallback), '≥ is in the font');
  assert.ok(rectContainsRect(slotRect('A1:C1'), d3.bounds));
  // tabs/newlines in text are whitespace for wrapping
  const nl = txt('n', 'A1:B1', 'line one\nline two');
  assert.equal(prepare(nl, ctxFor(nl)).meta.lines.length, 2);
});

test('fixture text elements agree with the validator measurement (same lines, same inner rect)', () => {
  const { el, ctx } = fixtureElement('fx-type-text', 's001', 'body');
  const d = prepare(el, ctx);
  assert.deepEqual(d.meta.inner, { x: 62, y: 262, w: 476, h: 376 });
  assert.equal(d.meta.lineHeight, 36);
  assert.ok(d.meta.lines.join(' ') === el.text);
});
