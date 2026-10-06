// `math` drawable (brief 02 criterion 6 + the compile cache).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { texToSvg } from '../../shared/math.js';
import { MATH_LAYOUT } from '../../shared/layout-core/constants.js';
import * as mc from '../../player/renderer/core/math-compile.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, fixtureScenes, rectContainsRect, slotRect } from './helpers.js';

before(async () => { await setup(); });

const eqCentre = (d, line) => {
  const eq = d.strokes.filter((s) => s.line === line && s.dataC === '3D');
  assert.ok(eq.length >= 1, `line ${line} has no = glyph`);
  // the top-level = is the widest one (sub/superscript = are scaled by 0.707)
  const top = eq.reduce((a, b) => (b.bounds.w > a.bounds.w ? b : a));
  return top.bounds.x + top.bounds.w / 2;
};

test('criterion 6: in every multi-line fx-type-math element whose lines all contain =, the rendered = centres agree within 0.5 px', async () => {
  let checked = 0;
  for (const { el, drawable: d } of await prepareLesson('fx-type-math')) {
    if (el.lines.length < 2 || !el.lines.every((l) => l.includes('='))) continue;
    assert.equal(d.meta.aligned, true, el.id);
    const xs = el.lines.map((_, i) => eqCentre(d, i));
    for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[0]) <= 0.5, `${el.id}: = at ${xs.join(', ')}`);
    d.meta.lines.forEach((L, i) => assert.ok(Math.abs(L.eqX - xs[i]) <= 0.5, `${el.id} line ${i}: meta eqX ${L.eqX} vs rendered ${xs[i]}`));
    checked++;
  }
  assert.ok(checked >= 3, `only ${checked} aligned elements checked`);
});

test('criterion 6: lines appear in turn (one part per line, even starts) and a 60-char line fits its slot', async () => {
  for (const { el, drawable: d } of await prepareLesson('fx-type-math')) {
    assert.equal(d.parts, el.lines.length);
    d.partStarts.forEach((p, i) => assert.ok(Math.abs(p - i / el.lines.length) < 1e-9));
    for (const s of d.strokes) assert.equal(s.part, s.line);
    assert.ok(rectContainsRect(slotRect(el.slot), d.bounds), el.id);
    assert.equal(d.pending, false);
  }
  let sixty = '\\frac{a}{b} + \\frac{c}{d} + \\frac{e}{f} = \\frac{g}{h} + ';
  while (sixty.length < 60) sixty += 'k';
  assert.equal(sixty.length, 60);
  const el = { id: 'm', type: 'math', slot: 'A1:D2', lines: [sixty, 'x = 1'] };
  const ctx = makeDrawCtx([scene('s001', 'wipe', [el])], 0);
  await mc.warmLines(el.lines);
  const d = prepare(el, ctx);
  assert.equal(d.pending, false);
  assert.ok(rectContainsRect(slotRect('A1:D2'), d.bounds));
  assert.equal(d.meta.aligned, true);
});

test('lines without = are left-aligned to the common start; a block that cannot align falls back to left alignment', async () => {
  const el = { id: 'm', type: 'math', slot: 'A1:B2', lines: ['\\alpha + \\beta', 'x = 1', '\\gamma'] };
  await mc.warmLines(el.lines);
  const d = prepare(el, makeDrawCtx([scene('s001', 'wipe', [el])], 0));
  assert.equal(d.meta.lines[0].x, d.meta.inner.x);
  assert.equal(d.meta.lines[2].x, d.meta.inner.x);
  assert.equal(d.meta.lines[0].eqX, null);
  // two lines with = whose aligned width would exceed a one-cell slot
  const wide = { id: 'w', type: 'math', slot: 'A1', lines: ['aaaaaaaa = b', 'c = dddddddd'] };
  await mc.warmLines(wide.lines);
  const w = prepare(wide, makeDrawCtx([scene('s001', 'wipe', [wide])], 0));
  assert.equal(w.meta.aligned, false);
  assert.ok(w.meta.lines.every((L) => L.x === w.meta.inner.x));
  assert.ok(rectContainsRect(slotRect('A1'), w.bounds));
});

test('the synchronous compile produces exactly what shared/math.js texToSvg produces, for every fixture math line', async () => {
  const lines = [];
  for (const lessonId of ['fx-type-math', 'fx-full-tour', 'fx-core-dense']) for (const s of fixtureScenes(lessonId)) for (const el of s.elements) if (el.type === 'math') lines.push(el.lines);
  assert.ok(lines.length >= 5);
  for (const ls of lines) {
    mc.clearCache();
    const sync = mc.compileSync(ls);
    const async_ = await texToSvg(ls);
    assert.deepEqual(sync, async_, ls.join(' | '));
  }
});

test('strokes are board-space paths scaled to MATH_LAYOUT.fontPx; glyphs include the fraction bars (rects) and no SVG text leaks into paths', async () => {
  const { el, drawable: d } = (await prepareLesson('fx-type-math')).find((x) => x.el.id === 'derive');
  assert.ok(d.strokes.some((s) => s.tag === 'rect'), 'fraction bar');
  assert.ok(d.strokes.every((s) => /^M[-\d.]/.test(s.d) && !s.d.includes('<')));
  assert.equal(d.meta.fontPx, MATH_LAYOUT.fontPx);
  // vertical layout agrees with measureMath: line boxes stacked with the gap, each at least the body line height
  for (let i = 1; i < d.meta.lines.length; i++) {
    const prev = d.meta.lines[i - 1], cur = d.meta.lines[i];
    assert.ok(Math.abs(cur.boxTop - (prev.boxTop + prev.height + MATH_LAYOUT.lineGap)) < 1e-6);
    assert.ok(cur.height >= 36);
  }
  assert.equal(el.lines.length, 3);
});

test('a line that does not compile never throws from prepare: it yields a pending drawable with a reason', async () => {
  const el = { id: 'bad', type: 'math', slot: 'A1:B1', lines: ['\\def\\x{1} x'] };
  const d = prepare(el, makeDrawCtx([scene('s001', 'wipe', [el])], 0));
  assert.equal(d.pending, true);
  assert.match(d.meta.reason, /not allowed/);
  assert.deepEqual(d.paths, []);
  assert.equal(d.parts, 1);
  assert.ok(rectContainsRect(slotRect('A1:B1'), d.bounds));
  assert.equal(d.tipAt(0.5), null);
  const n = await mc.warm([{ elements: [el] }]);
  assert.equal(n, 0, 'warm records the failure without throwing');
});
