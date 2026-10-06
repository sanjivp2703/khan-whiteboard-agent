import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFont, loadFontFromBytes, measure, wrap, wrapDetailed, glyphPaths, textWidth, isFontLoaded, defaultFontSource } from '../../shared/handwriting.js';
import { CODE_CHAR_ADVANCE, FONT_SIZES, LINE_HEIGHTS } from '../../shared/layout-core/constants.js';
import { SNAPSHOT_STRINGS, STYLES } from './fixtures/measurement-snapshot.js';

before(async () => { await loadFont(); });

test('font loads from the default vendored path and from bytes', () => {
  assert.equal(isFontLoaded(), true);
  assert.match(defaultFontSource(), /vendor\/fonts\/PatrickHand-Regular\.ttf$/);
  const bytes = readFileSync(defaultFontSource());
  const f = loadFontFromBytes(bytes);
  assert.equal(f.unitsPerEm, 1000);
});

test('measurement snapshot is stable (deterministic across runs)', () => {
  const snap = JSON.parse(readFileSync(new URL('./fixtures/measurement-snapshot.json', import.meta.url), 'utf8'));
  for (const style of STYLES) {
    for (const s of SNAPSHOT_STRINGS) {
      const m = measure(s, style);
      assert.deepEqual(m, snap[style][s], `measure(${JSON.stringify(s)}, ${style})`);
      assert.equal(m.lineHeight, LINE_HEIGHTS[style]);
    }
  }
});

test('code style uses the fixed per-character advance', () => {
  assert.equal(textWidth('abcdef', 'code'), 6 * CODE_CHAR_ADVANCE);
  assert.equal(textWidth('iiiiii', 'code'), textWidth('WWWWWW', 'code'));
  assert.notEqual(textWidth('iiiiii', 'body'), textWidth('WWWWWW', 'body'));
  const g = glyphPaths('ab', 'code', 10, 20);
  assert.deepEqual(g.map((x) => x.advance), [CODE_CHAR_ADVANCE, CODE_CHAR_ADVANCE]);
  assert.deepEqual(g.map((x) => x.x), [10, 10 + CODE_CHAR_ADVANCE]);
});

test('measure scales with style size', () => {
  const t = measure('Hello', 'title').width;
  const b = measure('Hello', 'body').width;
  assert.ok(Math.abs(t / b - FONT_SIZES.title / FONT_SIZES.body) < 0.01);
  assert.ok(measure('Hello', 'body').ascent > 0);
  assert.ok(measure('Hello', 'body').descent > 0);
  assert.throws(() => measure('x', 'huge'), /unknown style/);
});

test('wrap: greedy, never splits a word that fits on a line', () => {
  const text = 'The cache stores the response for later reuse so repeated requests are fast';
  const lines = wrap(text, 'body', 226);
  assert.ok(lines.length >= 3);
  assert.equal(lines.join(' '), text);
  for (const l of lines) assert.ok(textWidth(l, 'body') <= 226, `line too wide: ${l}`);
  // a wide line holds everything
  assert.deepEqual(wrap('one two three', 'body', 5000), ['one two three']);
  // explicit newline
  assert.deepEqual(wrap('a\nb', 'body', 5000), ['a', 'b']);
  // whitespace collapse
  assert.deepEqual(wrap('  a   b  ', 'note', 5000), ['a b']);
});

test('wrap: a word wider than the line is hard-split and flagged', () => {
  const r = wrapDetailed('Supercalifragilisticexpialidocious', 'body', 100);
  assert.equal(r.hardSplit, true);
  assert.ok(r.lines.length > 1);
  assert.equal(r.lines.join(''), 'Supercalifragilisticexpialidocious');
  for (const l of r.lines) assert.ok(textWidth(l, 'body') <= 100);
  const ok = wrapDetailed('short words only', 'body', 100);
  assert.equal(ok.hardSplit, false);
});

test('glyphPaths: one entry per character, advances sum to the measured width, paths are SVG data', () => {
  const text = 'Hello world';
  const g = glyphPaths(text, 'body', 0, 100);
  assert.equal(g.length, text.length);
  const total = g.reduce((s, x) => s + x.advance, 0);
  assert.ok(Math.abs(total - textWidth(text, 'body')) < 0.05, `${total} vs ${textWidth(text, 'body')}`);
  assert.match(g[0].d, /^M[-\d.]/);
  assert.equal(g[5].char, ' ');
  assert.equal(g[5].d, '');
});
