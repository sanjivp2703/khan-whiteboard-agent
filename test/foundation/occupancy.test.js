import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOccupancy, applyScene, intersectCells, toJSON, fromJSON, hasId, freeCells, occupancyEquals, cloneOccupancy } from '../../shared/layout-core/occupancy.js';

const wipeScene = {
  board: { mode: 'wipe' },
  elements: [
    { id: 't1', type: 'text', slot: 'A1:B1', text: 'x' },
    { id: 'c1', type: 'code', slot: 'C2', lines: ['a', 'b', 'c'] },
    { id: 'ar', type: 'arrow', from: 't1', to: 'c1' },
  ],
};
const regionScene = {
  board: { mode: 'region', slots: 'D3:E4' },
  elements: [{ id: 'bx', type: 'box', slot: 'D3:E4' }, { id: 'hl', type: 'highlight', target: 't1' }],
};

test('wipe replaces, region accumulates', () => {
  const o0 = createOccupancy();
  const o1 = applyScene(o0, wipeScene);
  assert.deepEqual([...o1.cells].sort(), ['A1', 'B1', 'C2']);
  assert.deepEqual([...o1.elements.keys()].sort(), ['ar', 'c1', 't1']);
  assert.equal(o1.elements.get('c1').lineCount, 3);
  assert.equal(o1.elements.get('ar').slot, undefined);
  const o2 = applyScene(o1, regionScene);
  assert.deepEqual([...o2.cells].sort(), ['A1', 'B1', 'C2', 'D3', 'D4', 'E3', 'E4']);
  assert.equal(hasId(o2, 'hl'), true);
  assert.equal(hasId(o2, 't1'), true);
  // input not mutated
  assert.equal(o1.cells.size, 3);
  const o3 = applyScene(o2, { board: { mode: 'wipe' }, elements: [{ id: 'n', type: 'text', slot: 'F4', text: 'y' }] });
  assert.deepEqual([...o3.cells], ['F4']);
  assert.equal(hasId(o3, 't1'), false);
});

test('intersection and free cells', () => {
  const o1 = applyScene(createOccupancy(), wipeScene);
  assert.deepEqual(intersectCells(o1, ['A1', 'A2', 'C2']), ['A1', 'C2']);
  assert.deepEqual(intersectCells(o1, ['F4']), []);
  assert.equal(freeCells(o1).length, 21);
  assert.equal(freeCells(createOccupancy()).length, 24);
});

test('toJSON / fromJSON round trip and equality', () => {
  const o1 = applyScene(createOccupancy(), wipeScene);
  const json = toJSON(o1);
  assert.deepEqual(json.cells, ['A1', 'B1', 'C2']);
  assert.deepEqual(json.elements.c1, { type: 'code', slot: 'C2', lineCount: 3 });
  const back = fromJSON(JSON.parse(JSON.stringify(json)));
  assert.equal(occupancyEquals(o1, back), true);
  assert.equal(occupancyEquals(o1, cloneOccupancy(o1)), true);
  assert.equal(occupancyEquals(o1, createOccupancy()), false);
  assert.equal(fromJSON(null).cells.size, 0);
});
