// `table` drawable (brief 02 criterion 8 + edge cases).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tokens } from '../../shared/layout-core/tokens.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, fixtureElement, rectContainsRect, slotRect } from './helpers.js';

before(async () => { await setup(); });

const cellStrokes = (d, r, c) => d.strokes.filter((s) => s.row === r && s.col === c);

test('criterion 8: the 6×6 near-cap fixtures fit; grid first, then cells revealed row-major', async () => {
  for (const [lessonId, id] of [['fx-type-table', 'big'], ['fx-core-dense', 'grid66']]) {
    const t = (await prepareLesson(lessonId)).find((x) => x.el.id === id);
    const d = t.drawable;
    assert.equal(d.meta.cols, 6);
    assert.equal(d.meta.rows, 6);
    assert.equal(d.parts, 1 + 36, `${id} parts`);
    assert.ok(rectContainsRect(slotRect(t.el.slot), d.bounds), `${id} bounds`);
    const grid = d.strokes.filter((s) => s.grid);
    assert.ok(grid.length >= 1 && grid.every((s) => s.part === 0 && s.color === tokens.muted));
    assert.equal(d.strokes[0].grid, true);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      const part = 1 + r * 6 + c;
      const strokes = cellStrokes(d, r, c);
      assert.ok(strokes.length >= 1, `${id} cell ${r},${c}`);
      assert.ok(strokes.every((s) => s.part === part), `${id} cell ${r},${c} is in part ${part}`);
    }
    // each cell's text is centred in its column
    for (const cell of d.meta.cells) {
      const glyphs = d.strokes.filter((s) => s.row === cell.row && s.col === cell.col && s.kind === 'glyph');
      const x0 = Math.min(...glyphs.map((s) => s.bounds.x)), x1 = Math.max(...glyphs.map((s) => s.bounds.x + s.bounds.w));
      const cx = cell.rect.x + cell.rect.w / 2;
      assert.ok(Math.abs((x0 + x1) / 2 - cx) < 8, `${id} cell ${cell.row},${cell.col} off-centre: ${(x0 + x1) / 2} vs ${cx}`);
      assert.ok(x0 >= cell.rect.x && x1 <= cell.rect.x + cell.rect.w, `${id} cell ${cell.row},${cell.col} overflows its column`);
    }
  }
});

test('criterion 8: header row is visibly distinct — one extra stroke (the underline) per header cell', () => {
  const { el, ctx } = fixtureElement('fx-type-table', 's001', 'policies');
  const withHeader = prepare(el, ctx);
  const without = prepare({ ...el, header: false }, ctx);
  for (let r = 0; r < el.rows.length; r++) for (let c = 0; c < el.rows[0].length; c++) {
    const a = cellStrokes(withHeader, r, c), b = cellStrokes(without, r, c);
    if (r === 0) {
      assert.equal(a.length, b.length + 1, `header cell ${c}`);
      const under = a.filter((s) => s.headerUnderline);
      assert.equal(under.length, 1);
      assert.equal(under[0].kind, 'rough');
      const bottom = withHeader.meta.rowTops[0] + withHeader.meta.rowHeights[0];
      assert.ok(under[0].bounds.y + under[0].bounds.h <= bottom + 0.01 && under[0].bounds.y >= bottom - 12);
    } else {
      assert.equal(a.length, b.length, `data cell ${r},${c}`);
    }
  }
});

test('edge cases: a 2×1 table with header (an array drawn as index row + data row style), single column', () => {
  const el = { id: 't', type: 'table', slot: 'A1', header: true, rows: [['i'], ['3']] };
  const d = prepare(el, makeDrawCtx([scene('s001', 'wipe', [el])], 0));
  assert.equal(d.parts, 3);
  assert.equal(d.meta.cols, 1);
  assert.equal(cellStrokes(d, 0, 0).filter((s) => s.headerUnderline).length, 1);
  assert.equal(cellStrokes(d, 1, 0).filter((s) => s.headerUnderline).length, 0);
  assert.ok(rectContainsRect(slotRect('A1'), d.bounds));
  const arr = fixtureElement('fx-type-table', 's003', 'arr');
  const a = prepare(arr.el, arr.ctx);
  assert.equal(a.parts, 1 + 12);
  assert.equal(a.meta.rowTops.length, 2);
});
