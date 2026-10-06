import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSlot, slotRect, slotCells, slotSpan, slotContains, slotsIntersect, rectInset, isValidSlot, ALL_CELLS, cellName, SlotError,
} from '../../shared/layout-core/grid.js';
import { MARGIN, CELL_W, CELL_H, COL_LETTERS, SLOT_PAD } from '../../shared/layout-core/constants.js';

test('parseSlot: single cell and range', () => {
  assert.deepEqual(parseSlot('A1'), { c0: 0, r0: 0, c1: 0, r1: 0 });
  assert.deepEqual(parseSlot('B2:D3'), { c0: 1, r0: 1, c1: 3, r1: 2 });
  assert.deepEqual(parseSlot('F4'), { c0: 5, r0: 3, c1: 5, r1: 3 });
  assert.deepEqual(parseSlot('A1:F4'), { c0: 0, r0: 0, c1: 5, r1: 3 });
});

test('parseSlot: reversed range and out-of-bounds are errors with code BAD_SLOT', () => {
  for (const bad of ['D3:B2', 'B3:B2', 'C2:B2', 'G1', 'A5', 'a1', 'A0', 'A1:', 'A1:G1', 'A1 B2', '', 'B2:D3:E4']) {
    assert.throws(() => parseSlot(bad), (e) => e instanceof SlotError && e.code === 'BAD_SLOT', `expected ${bad} to fail`);
    assert.equal(isValidSlot(bad), false);
  }
  assert.throws(() => parseSlot(null), SlotError);
  assert.throws(() => parseSlot(42), SlotError);
});

test('slotRect: numbers for all 24 cells', () => {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const name = COL_LETTERS[c] + (r + 1);
      assert.deepEqual(slotRect(name), { x: MARGIN + CELL_W * c, y: MARGIN + CELL_H * r, w: CELL_W, h: CELL_H });
    }
  }
  assert.equal(ALL_CELLS.length, 24);
  assert.equal(ALL_CELLS[0], 'A1');
  assert.equal(ALL_CELLS[23], 'F4');
  assert.equal(cellName(1, 1), 'B2');
});

test('slotRect: ranges (brief example B2:D3 = x300 y250 w750 h400)', () => {
  assert.deepEqual(slotRect('B2:D3'), { x: 300, y: 250, w: 750, h: 400 });
  assert.deepEqual(slotRect('A1:F4'), { x: 50, y: 50, w: 1500, h: 800 });
  assert.deepEqual(slotRect('E3:F4'), { x: 1050, y: 450, w: 500, h: 400 });
  assert.deepEqual(slotRect('C1:C4'), { x: 550, y: 50, w: 250, h: 800 });
});

test('slotCells / slotSpan', () => {
  assert.deepEqual(slotCells('B2:C3'), ['B2', 'C2', 'B3', 'C3']);
  assert.deepEqual(slotCells('A1'), ['A1']);
  assert.deepEqual(slotSpan('B2:D3'), { cols: 3, rows: 2, cells: 6 });
  assert.deepEqual(slotSpan('F4'), { cols: 1, rows: 1, cells: 1 });
});

test('slotContains / slotsIntersect', () => {
  assert.equal(slotContains('A1:C2', 'B2'), true);
  assert.equal(slotContains('A1:C2', 'B2:C2'), true);
  assert.equal(slotContains('A1:C2', 'C3'), false);
  assert.equal(slotContains('A1:C2', 'A1:D2'), false);
  assert.equal(slotsIntersect('A1:B2', 'B2:C3'), true);
  assert.equal(slotsIntersect('A1:B2', 'C3'), false);
  assert.equal(slotsIntersect('A1', 'A1'), true);
  assert.equal(slotsIntersect('A1:F1', 'A2:F4'), false);
});

test('rectInset applies SLOT_PAD uniformly', () => {
  assert.deepEqual(rectInset({ x: 50, y: 50, w: 250, h: 200 }), { x: 50 + SLOT_PAD, y: 50 + SLOT_PAD, w: 250 - 2 * SLOT_PAD, h: 200 - 2 * SLOT_PAD });
  assert.deepEqual(rectInset({ x: 0, y: 0, w: 10, h: 10 }, 20), { x: 20, y: 20, w: 0, h: 0 });
});
