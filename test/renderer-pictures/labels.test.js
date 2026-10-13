// Slice 03 — picture label sizes are the pictures' own (design/02-khan-video-study.md §2.6–2.7), decoupled
// from the prose FONT_SIZES that change-khan-feel raised: a bigger prose body must not grow diagram node
// labels, edge labels, plot tick numbers or svg text. Regression for the three failures that the prose
// jump caused (dense diagram no longer fitting a 2×2 slot, edge label collisions, svg body cap).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { FONT_SIZES, LINE_HEIGHTS } from '../../shared/layout-core/constants.js';
import { measure, wrap } from '../../shared/handwriting.js';
import { pathBounds } from '../../shared/strokes.js';
import {
  PICTURE_LABEL_PX, PICTURE_LINE_HEIGHTS, PICTURE_LABEL_STYLES, fontPx, labelLineHeight, labelMeasure, labelWrap,
  fitText, textBlockHeight, writeAt, writeLines, unionRects,
} from '../../player/renderer/pictures/common.js';
import { prepareDiagram, preparePlot, prepareSvg, prepareSketch } from '../../player/renderer/pictures/index.js';
import { ensureFont, ctxFor } from './helpers.js';

before(ensureFont);

const glyphBounds = (strokes) => unionRects(strokes.map((s) => pathBounds(s.d)));

test('picture label sizes are fixed at the study values and smaller than the prose sizes they are named after', () => {
  assert.deepEqual(PICTURE_LABEL_PX, { body: 28, note: 22 });
  assert.deepEqual(PICTURE_LINE_HEIGHTS, { body: 36, note: 28 });
  assert.deepEqual([...PICTURE_LABEL_STYLES], ['body', 'note']);
  for (const s of PICTURE_LABEL_STYLES) {
    assert.ok(PICTURE_LABEL_PX[s] < FONT_SIZES[s], `${s}: picture label ${PICTURE_LABEL_PX[s]} px < prose ${FONT_SIZES[s]} px`);
    assert.ok(PICTURE_LINE_HEIGHTS[s] < LINE_HEIGHTS[s]);
    assert.equal(fontPx(s), PICTURE_LABEL_PX[s]);
    assert.equal(labelLineHeight(s), PICTURE_LINE_HEIGHTS[s]);
  }
  assert.throws(() => fontPx('title'), /unknown label style/);
  assert.throws(() => labelMeasure('x', 'code'), /unknown label style/);
});

test('labelMeasure and labelWrap are the shared handwriting metrics scaled to the picture size (the font is linear)', () => {
  const text = 'interrupt or wait';
  for (const s of PICTURE_LABEL_STYLES) {
    const k = PICTURE_LABEL_PX[s] / FONT_SIZES.body;
    const ref = measure(text, 'body');
    const m = labelMeasure(text, s);
    assert.ok(Math.abs(m.width - ref.width * k) < 1e-9, `${s}: width scales`);
    assert.ok(Math.abs(m.ascent - ref.ascent * k) < 1e-9 && Math.abs(m.descent - ref.descent * k) < 1e-9, `${s}: ascent/descent scale`);
    assert.equal(m.lineHeight, PICTURE_LINE_HEIGHTS[s]);
    // a 1600-board sanity check: the label is narrower than it would be at the prose size of the same name
    assert.ok(m.width < measure(text, s).width);
    // wrapping at a width W behaves like wrapping the reference style at W / k
    assert.deepEqual(labelWrap('one two three four five six seven', s, 120), wrap('one two three four five six seven', 'body', 120 / k));
  }
  // fitText prefers body and drops to note; the heights are the picture line heights
  const wide = fitText('Hit?', 400);
  assert.equal(wide.style, 'body');
  assert.equal(wide.height, PICTURE_LINE_HEIGHTS.body);
  const narrow = fitText('Concept ledger', labelMeasure('Concept ledger', 'body').width - 1, { maxLines: 1 });
  assert.equal(narrow.style, 'note');
  assert.equal(narrow.lines.length, 1);
  assert.equal(textBlockHeight('note', 2), 2 * PICTURE_LINE_HEIGHTS.note);
});

test('writeAt / writeLines draw glyphs at the picture size: ink stays inside the reported box and a capital is about 0.7 × the size tall', () => {
  for (const s of PICTURE_LABEL_STYLES) {
    const w = writeAt('Hg', s, 100, 200, 'white', { anchor: 'start' });
    const gb = glyphBounds(w.strokes);
    assert.ok(gb.x >= w.box.x - 1 && gb.x + gb.w <= w.box.x + w.box.w + 1, `${s}: ink within the box horizontally`);
    assert.ok(gb.y >= w.box.y - 1 && gb.y + gb.h <= w.box.y + w.box.h + 1, `${s}: ink within the box vertically`);
    const cap = writeAt('H', s, 0, 0, 'white');
    const hb = glyphBounds(cap.strokes);
    assert.ok(hb.h > 0.55 * PICTURE_LABEL_PX[s] && hb.h < 0.85 * PICTURE_LABEL_PX[s], `${s}: cap height ${hb.h.toFixed(1)} px for ${PICTURE_LABEL_PX[s]} px`);
    // and clearly smaller than the same capital at the prose size of the same name
    assert.ok(hb.h < 0.85 * FONT_SIZES[s] * (PICTURE_LABEL_PX[s] / FONT_SIZES[s]) + 1);
    const lines = writeLines(['Event', 'queue'], s, 50, 50, 200, 'white', { align: 'center' });
    assert.equal(lines.box.h, 2 * PICTURE_LINE_HEIGHTS[s]);
    const lb = glyphBounds(lines.strokes);
    assert.ok(lb.y >= lines.box.y - 1 && lb.y + lb.h <= lines.box.y + lines.box.h + 1, `${s}: two lines stay inside the block`);
    // scale composes with the style size
    const half = writeAt('Hg', s, 0, 0, 'white', { scale: 0.5 });
    assert.ok(Math.abs(half.width - w.width / 2) < 1e-9);
  }
});

test('every picture type writes its labels at the picture sizes, not the prose sizes', () => {
  const dg = { id: 'dg', type: 'diagram', slot: 'A1:C2', mermaid: 'flowchart TD\nA[Load] -->|yes| B{Hit?}' };
  const d = prepareDiagram(dg, ctxFor([dg]));
  assert.equal(d.picture.style, 'body');
  assert.equal(d.picture.textScale, 1);
  const node = d.picture.nodes[0];
  assert.ok(Math.abs(node.label.box.h - PICTURE_LINE_HEIGHTS.body) < 1e-6, 'node label block is one picture body line');
  assert.ok(Math.abs(node.label.box.w - labelMeasure('Load', 'body').width) < 1e-6);
  const edge = d.picture.edges[0];
  assert.ok(Math.abs(edge.labelBox.h - PICTURE_LINE_HEIGHTS.note) < 1e-6, 'edge label is one picture note line');

  const pl = { id: 'pl', type: 'plot', slot: 'A1:B2', fn: 'x^2', xRange: [-2, 2], xLabel: 'time' };
  const p = preparePlot(pl, ctxFor([pl]));
  const noteM = labelMeasure('Hg', 'note');
  for (const t of [...p.picture.ticks.x, ...p.picture.ticks.y]) assert.ok(Math.abs(t.box.h - (noteM.ascent + noteM.descent)) < 1e-6, `tick ${t.value} at the picture note size`);
  assert.ok(Math.abs(p.picture.names.xBox.w - labelMeasure('time', 'note').width) < 1e-6, 'axis name at the picture note size');

  const sv = { id: 'sv', type: 'svg', slot: 'A1:B2', svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><text x="10" y="50" fill="chalk">plain</text><text x="10" y="80" font-size="40" fill="chalk">big</text></svg>' };
  const s = prepareSvg(sv, ctxFor([sv]));
  assert.equal(s.picture.partMeta[0].size, PICTURE_LABEL_PX.note);
  assert.equal(s.picture.partMeta[1].size, PICTURE_LABEL_PX.body, 'oversized svg text is capped at the picture body size');

  const sk = { id: 'sk', type: 'sketch', slot: 'A1:B1', shape: 'rock', label: 'rock' };
  const k = prepareSketch(sk, ctxFor([sk]));
  const lab = k.picture.partMeta[1];
  assert.equal(lab.style, 'body');
  assert.ok(Math.abs(lab.box.h - PICTURE_LINE_HEIGHTS.body) < 1e-6, 'sketch label is one picture body line');
});
