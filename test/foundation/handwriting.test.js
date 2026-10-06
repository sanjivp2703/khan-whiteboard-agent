import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFont, loadFontFromBytes, measure, wrap, wrapDetailed, glyphPaths, textWidth, isFontLoaded, defaultFontSource, formatCoord, commandsToPathData, getFont } from '../../shared/handwriting.js';
import { CODE_CHAR_ADVANCE, FONT_SIZES, LINE_HEIGHTS } from '../../shared/layout-core/constants.js';
import { SNAPSHOT_STRINGS, STYLES } from './fixtures/measurement-snapshot.js';
import { listFixtureLessons, loadScenes } from './helpers/fixtures.js';

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

// QA finding 8: the vendored opentype toPathData emitted `NaN` coordinates for ~2 % of glyphs
// (string-concatenation rounding breaks when the fraction prints in exponent notation).
// glyphPaths now serializes the glyph's own path commands with a fixed-decimal formatter.
test('formatCoord: fixed decimals, never NaN, never -0, exponent-notation fractions handled', () => {
  assert.equal(formatCoord(1 + 1.2e-7), '1');          // the fraction that broke roundDecimal
  assert.equal(formatCoord(1.2e-7), '0');
  assert.equal(formatCoord(-0.001), '0');
  assert.equal(formatCoord(12), '12');
  assert.equal(formatCoord(12.3), '12.30');
  assert.equal(formatCoord(-12.346), '-12.35');
  assert.equal(formatCoord(0.005), '0.01');
  assert.throws(() => formatCoord(NaN), RangeError);
  assert.throws(() => formatCoord(Infinity), RangeError);
  assert.equal(commandsToPathData([{ type: 'M', x: 1, y: -2.5 }, { type: 'L', x: 3.25, y: 4 }, { type: 'Q', x1: 1, y1: 1, x: 2, y: 2 }, { type: 'C', x1: 0, y1: 0, x2: 1, y2: 1, x: 2, y: 2 }, { type: 'Z' }]), 'M1-2.50L3.25 4Q1 1 2 2C0 0 1 1 2 2Z');
});

test('glyphPaths: no NaN in any glyph over every fixture string × 4 styles × many offsets; geometry matches the glyph commands', () => {
  const strings = new Set(SNAPSHOT_STRINGS);
  for (const { dir } of listFixtureLessons({ includeDegrade: true })) {
    for (const { scene } of loadScenes(dir)) {
      for (const el of scene.elements || []) {
        if (typeof el.text === 'string') strings.add(el.text);
        if (typeof el.label === 'string') strings.add(el.label);
        if (Array.isArray(el.items)) for (const it of el.items) strings.add(String(it));
        if (Array.isArray(el.lines)) for (const l of el.lines) strings.add(String(l));
        if (Array.isArray(el.rows)) for (const row of el.rows) for (const cell of row) strings.add(String(cell));
      }
    }
  }
  assert.ok(strings.size >= 100, `expected a large fixture sample, got ${strings.size} strings`);
  const offsets = [0, 50, 50.74, 0.1, 1 / 3, 12.345, 100.000001, 333.333, 1549.9];
  const token = /^(?:[MLCQ](?:-?\d+(?:\.\d{2})?)(?: ?-?\d+(?:\.\d{2})?)*|Z)+$/;
  let glyphs = 0;
  let nonEmpty = 0;
  for (const style of STYLES) {
    for (const x of offsets) {
      const y = 100 + x * 0.11;
      for (const s of strings) {
        for (const g of glyphPaths(s, style, x, y)) {
          glyphs++;
          if (g.d === '') continue;
          nonEmpty++;
          assert.ok(!g.d.includes('NaN'), `NaN in glyph "${g.char}" of "${s}" (${style}, x=${x})`);
          assert.match(g.d, token, `malformed path for "${g.char}" (${style}, x=${x}): ${g.d.slice(0, 60)}`);
        }
      }
    }
  }
  assert.ok(glyphs > 50_000, `scanned only ${glyphs} glyphs`);
  assert.ok(nonEmpty > 40_000);
  // the serialized data is the glyph's own commands (2-decimal rounding), i.e. the same geometry
  const f = getFont();
  const g = glyphPaths('q', 'title', 50, 100)[0];
  const cmds = f.charToGlyph('q').getPath(50, 100, FONT_SIZES.title).commands;
  assert.equal(g.d, commandsToPathData(cmds));
  const nums = g.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const expected = cmds.flatMap((c) => ['x1', 'y1', 'x2', 'y2', 'x', 'y'].filter((k) => c[k] !== undefined).map((k) => c[k]));
  assert.equal(nums.length, expected.length);
  for (let i = 0; i < nums.length; i++) assert.ok(Math.abs(nums[i] - expected[i]) <= 0.005 + 1e-9, `coordinate ${i}: ${nums[i]} vs ${expected[i]}`);
});
