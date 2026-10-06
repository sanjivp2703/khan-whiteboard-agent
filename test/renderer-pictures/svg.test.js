// Slice 03 — `svg` drawable (brief 03 criterion 8, defense in depth, edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSvg, prepareSvgAst } from '../../player/renderer/pictures/index.js';
import { localPath } from '../../player/renderer/pictures/svg.js';
import { parse as parseSvg } from '../../shared/svg-subset.js';
import { slotRect, slotInnerRect } from '../../shared/layout-core/grid.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { ROUGH_MARGIN } from '../../player/renderer/pictures/common.js';
import { ensureFont, ctxFor, insideSlot, rectInside, REPO_ROOT } from './helpers.js';

before(ensureFont);

const el = (svg, slot = 'A1:B2', id = 'sv') => ({ id, type: 'svg', slot, svg });
const prep = (e) => prepareSvg(e, ctxFor([e]));
const prepAst = (ast, slot = 'A1:B2') => { const e = { id: 'syn', type: 'svg', slot }; return prepareSvgAst(e, ctxFor([e]), ast); };
const fixtureScene = (lesson, scene) => JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', 'lessons', lesson, 'scenes', `${scene}.json`), 'utf8'));
const safeOf = (slot) => { const r = slotInnerRect(slot); return { x: r.x + ROUGH_MARGIN, y: r.y + ROUGH_MARGIN, w: r.w - 2 * ROUGH_MARGIN, h: r.h - 2 * ROUGH_MARGIN }; };
const noNaN = (d) => d.paths.every((p) => !/NaN|Infinity/.test(p));
const wrap = (inner, vb = '0 0 100 100') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

test('for every fixture svg element the number of shape parts equals the AST shape count (≤ 40) and nothing is ignored', () => {
  const elements = [];
  for (const lesson of ['fx-type-svg', 'fx-pic-dense', 'fx-full-tour']) {
    for (const s of ['s001', 's002', 's003', 's008']) {
      let scene; try { scene = fixtureScene(lesson, s); } catch { continue; }
      for (const e of scene.elements) if (e.type === 'svg') elements.push(e);
    }
  }
  assert.ok(elements.length >= 7);
  for (const e of elements) {
    const ast = parseSvg(e.svg);
    const d = prep(e);
    assert.equal(d.parts, ast.shapeCount, `${e.id}: parts = shapes`);
    assert.ok(ast.shapeCount <= 40);
    assert.deepEqual(d.picture.ignored, []);
    assert.deepEqual(d.picture.skipped, []);
    assert.ok(insideSlot(d, e.slot), `${e.id}: bounds inside slot`);
    assert.ok(noNaN(d), `${e.id}: no NaN`);
  }
  const forty = fixtureScene('fx-type-svg', 's002').elements[0];
  assert.equal(prep(forty).parts, 40);
});

test('letterboxing: a shape on the viewBox edge is drawn at the safe inner edge (±2 px) for wide (10:1) and tall (1:10) viewBoxes and a non-zero origin', () => {
  const slot = 'A1:B2';
  const safe = safeOf(slot);
  const wide = prep(el(wrap('<rect x="0" y="0" width="100" height="10" stroke="chalk" fill="none"/>', '0 0 100 10'), slot));
  const nw = wide.picture.partMeta[0].nominal;
  assert.ok(Math.abs(nw.x - safe.x) <= 2 && Math.abs(nw.x + nw.w - (safe.x + safe.w)) <= 2, 'wide: spans the full safe width');
  assert.ok(Math.abs(nw.y + nw.h / 2 - (safe.y + safe.h / 2)) <= 2, 'wide: centred vertically');
  assert.ok(Math.abs(wide.picture.scale - safe.w / 100) < 1e-9);
  const tall = prep(el(wrap('<rect x="0" y="0" width="10" height="100" stroke="chalk" fill="none"/>', '0 0 10 100'), slot));
  const nt = tall.picture.partMeta[0].nominal;
  assert.ok(Math.abs(nt.y - safe.y) <= 2 && Math.abs(nt.y + nt.h - (safe.y + safe.h)) <= 2, 'tall: spans the full safe height');
  assert.ok(Math.abs(nt.x + nt.w / 2 - (safe.x + safe.w / 2)) <= 2, 'tall: centred horizontally');
  const origin = prep(el(wrap('<rect x="-50" y="-5" width="100" height="10" stroke="chalk" fill="none"/>', '-50 -5 100 10'), slot));
  const no = origin.picture.partMeta[0].nominal;
  assert.ok(Math.abs(no.x - safe.x) <= 2, 'non-zero origin maps to the left edge');
  // and the roughened result still never leaves the slot
  for (const d of [wide, tall, origin]) assert.ok(insideSlot(d, slot));
});

test('g transform="translate(...)" moves children; nested g compose; scale and rotate apply to geometry', () => {
  const base = prep(el(wrap('<rect x="10" y="10" width="20" height="20" stroke="chalk" fill="none"/>')));
  const moved = prep(el(wrap('<g transform="translate(20,0)"><rect x="10" y="10" width="20" height="20" stroke="chalk" fill="none"/></g>')));
  const scale = base.picture.scale;
  assert.ok(Math.abs((moved.picture.partMeta[0].nominal.x - base.picture.partMeta[0].nominal.x) - 20 * scale) < 1);
  const nested = prep(el(wrap('<g transform="translate(10,0)"><g transform="translate(10,0)"><rect x="10" y="10" width="20" height="20" stroke="chalk" fill="none"/></g></g>')));
  assert.ok(Math.abs((nested.picture.partMeta[0].nominal.x - base.picture.partMeta[0].nominal.x) - 20 * scale) < 1);
  const scaled = prep(el(wrap('<g transform="scale(2)"><rect x="10" y="10" width="20" height="20" stroke="chalk" fill="none"/></g>')));
  assert.ok(Math.abs(scaled.picture.partMeta[0].nominal.w - 2 * base.picture.partMeta[0].nominal.w) < 1);
  const rotated = prep(el(wrap('<g transform="rotate(45, 50, 50)"><rect x="40" y="40" width="20" height="20" stroke="chalk" fill="none"/></g>')));
  const rn = rotated.picture.partMeta[0].nominal;
  assert.ok(Math.abs(rn.w - 20 * Math.SQRT2 * scale) < 1, 'rotated square bounds grow by √2');
  assert.ok(insideSlot(rotated, 'A1:B2'));
});

test('text becomes handwriting (glyph fills), counts as one part, honours text-anchor and the body cap; six words are fine', () => {
  const d = prep(el(wrap('<text x="50" y="50" font-size="8" text-anchor="middle" fill="accent1">one two three four five six</text>')));
  assert.equal(d.parts, 1);
  assert.deepEqual(d.picture.partKinds, ['svg:text']);
  assert.ok(d.paths.length >= 20, 'one glyph stroke per non-space character');
  assert.ok(d.strokeInfo.every((s) => s.mode === 'fill' && s.color === tokens.accent1));
  const m = d.picture.partMeta[0];
  assert.ok(m.size <= 28 + 1e-9, 'capped to body');
  const anchorX = m.anchor[0];
  assert.ok(Math.abs(m.box.x + m.box.w / 2 - anchorX) < 2, 'middle anchor centres the text');
  assert.ok(insideSlot(d, 'A1:B2'));
  const noSize = prep(el(wrap('<text x="10" y="50" fill="chalk">plain</text>')));
  assert.ok(Math.abs(noSize.picture.partMeta[0].size - 22) < 1e-9, 'no font-size → note');
  const end = prep(el(wrap('<text x="90" y="50" font-size="5" text-anchor="end" fill="chalk">right</text>')));
  const em = end.picture.partMeta[0];
  assert.ok(Math.abs(em.box.x + em.box.w - em.anchor[0]) < 2);
  // text whose glyphs would run past the slot is shifted back inside
  const edge = prep(el(wrap('<text x="99" y="99" font-size="20" fill="chalk">long text here</text>')));
  assert.ok(insideSlot(edge, 'A1:B2'));
  assert.ok(edge.picture.partMeta[0].shifted[0] !== 0 || edge.picture.partMeta[0].shifted[1] !== 0);
});

test('fill="accent2" produces a light hachure in that token colour; fill="none" produces none; stroke="none" leaves only the hachure', () => {
  const filled = prep(el(wrap('<circle cx="50" cy="50" r="30" stroke="accent1" fill="accent2"/>')));
  const hach = filled.strokeInfo.filter((s) => s.mode === 'hachure');
  assert.ok(hach.length >= 1);
  assert.ok(hach.every((s) => s.color === tokens.accent2));
  assert.ok(filled.strokeInfo.some((s) => s.mode === 'stroke' && s.color === tokens.accent1));
  assert.equal(filled.picture.partMeta[0].hachure, true);
  const none = prep(el(wrap('<circle cx="50" cy="50" r="30" stroke="accent1" fill="none"/>')));
  assert.equal(none.strokeInfo.filter((s) => s.mode === 'hachure').length, 0);
  assert.equal(none.picture.partMeta[0].hachure, false);
  const onlyFill = prep(el(wrap('<rect x="10" y="10" width="80" height="80" stroke="none" fill="accent3"/>')));
  assert.ok(onlyFill.strokeInfo.length >= 1 && onlyFill.strokeInfo.every((s) => s.mode === 'hachure' && s.color === tokens.accent3));
  // open shapes never get a fill
  const line = prep(el(wrap('<polyline points="0,0 50,50 100,0" stroke="chalk" fill="accent1"/>')));
  assert.equal(line.strokeInfo.filter((s) => s.mode === 'hachure').length, 0);
});

test('defense in depth: unknown tags in a synthetic AST (script, image, use, foreignObject) are ignored and counted — never thrown, never drawn', () => {
  const ast = {
    viewBox: { x: 0, y: 0, w: 100, h: 100 },
    shapes: [
      { tag: 'script', attrs: {}, text: 'alert(1)' },
      { tag: 'rect', attrs: { x: '10', y: '10', width: '30', height: '30', stroke: 'chalk', fill: 'none' } },
      { tag: 'image', attrs: { href: 'x.png', x: '0', y: '0', width: '10', height: '10' } },
      { tag: 'g', attrs: { transform: 'translate(5,5)' }, children: [
        { tag: 'use', attrs: { href: '#a' } },
        { tag: 'foreignObject', attrs: {}, children: [] },
        { tag: 'circle', attrs: { cx: '70', cy: '70', r: '10', stroke: 'accent1' } },
      ] },
      { tag: 'video', attrs: {} },
    ],
  };
  const d = prepAst(ast);
  assert.equal(d.parts, 2, 'only rect and circle are drawn');
  assert.deepEqual(d.picture.partKinds, ['svg:rect', 'svg:circle']);
  assert.deepEqual(d.picture.ignored, ['script', 'image', 'use', 'foreignObject', 'video']);
  assert.ok(insideSlot(d, 'A1:B2'));
  // and the real parser would never let these through in the first place
  assert.throws(() => parseSvg(wrap('<script>alert(1)</script>')));
  assert.throws(() => parseSvg(wrap('<image href="x"/>')));
  assert.throws(() => parseSvg(wrap('<use href="#a"/>')));
  assert.throws(() => parseSvg(wrap('<foreignObject/>')));
});

test('degenerate shapes are skipped without NaN: zero-size rect, zero radius, zero-length line, empty path', () => {
  const svg = wrap('<rect x="10" y="10" width="0" height="20" stroke="chalk"/><circle cx="50" cy="50" r="0" stroke="chalk"/><line x1="5" y1="5" x2="5" y2="5" stroke="chalk"/><path d="" stroke="chalk"/><rect x="20" y="20" width="30" height="30" stroke="chalk" fill="none"/>');
  const d = prep(el(svg));
  assert.equal(d.parts, 1);
  assert.equal(d.picture.skipped.length, 4);
  assert.deepEqual(d.picture.skipped.map((s) => s.tag), ['rect', 'circle', 'line', 'path']);
  assert.ok(noNaN(d));
  assert.deepEqual(localPath({ tag: 'rect', attrs: { width: '0', height: '5' } }), { skip: 'zero-size rect' });
  // an svg with no drawable shapes still yields a valid Drawable (one empty part, zero-size bounds inside the slot)
  const empty = prepAst({ viewBox: { x: 0, y: 0, w: 10, h: 10 }, shapes: [{ tag: 'g', attrs: {}, children: [] }] });
  assert.equal(empty.parts, 1);
  assert.deepEqual(empty.paths, []);
  assert.equal(empty.naturalMs, 0);
  assert.equal(empty.tipAt(0.5), null);
  assert.ok(rectInside(slotRect('A1:B2'), empty.bounds));
});

test('paths with arcs (A) and curves (C, Q) render as rough strokes; 40 shapes and the fixture curves stay inside the slot', () => {
  const d = prep(el(wrap('<path d="M20 90 A 30 30 0 0 1 80 90" stroke="accent3" fill="none"/><path d="M10 80 C 30 10, 70 10, 90 80" stroke="accent1" fill="none"/><path d="M10 50 Q 50 0 90 50" stroke="accent2" fill="none"/>')));
  assert.equal(d.parts, 3);
  assert.ok(noNaN(d));
  assert.ok(insideSlot(d, 'A1:B2'));
  assert.ok(d.paths.every((p) => p.length > 20));
  const curves = fixtureScene('fx-pic-dense', 's003').elements.find((e) => e.id === 'curves');
  const dc = prep(curves);
  assert.equal(dc.parts, parseSvg(curves.svg).shapeCount);
  assert.ok(insideSlot(dc, curves.slot));
});

test('each shape is one part in document order (depth-first through g) and parts reveal in that order', () => {
  const d = prep(el(wrap('<rect x="0" y="0" width="10" height="10" stroke="chalk" fill="none"/><g><circle cx="50" cy="50" r="5" stroke="chalk"/><line x1="0" y1="90" x2="90" y2="90" stroke="chalk"/></g><text x="5" y="80" fill="chalk">t</text>')));
  assert.deepEqual(d.picture.partKinds, ['svg:rect', 'svg:circle', 'svg:line', 'svg:text']);
  assert.deepEqual(d.partStarts, [0, 0.25, 0.5, 0.75]);
  // a part completes exactly when the next part starts; just before, its last stroke is still in progress
  assert.equal(d.revealAt(0.25).complete, 1);
  assert.equal(d.revealAt(0.25 - 1e-9).complete, 0);
  assert.equal(d.revealAt(0.25 - 1e-9).partialIndex, 0);
  assert.equal(d.revealAt(0.5).complete, 2);
  assert.equal(d.revealAt(0.75).complete, 3);
  assert.equal(d.revealAt(1).complete, d.paths.length);
});
