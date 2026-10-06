import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAts, resolveAts, resolveTiming, checkTiming, itemAtError, partStarts } from '../../shared/layout-core/timing.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('default spacing: n elements over [0, 0.85) as 0.85*i/n', () => {
  assert.deepEqual(defaultAts(1), [0]);
  const four = defaultAts(4);
  assert.deepEqual(four, [0, 0.2125, 0.425, 0.6375]);
  const eight = defaultAts(8);
  assert.equal(eight.length, 8);
  assert.equal(eight[0], 0);
  assert.ok(eight[7] < 0.85);
  for (let i = 1; i < 8; i++) close(eight[i] - eight[i - 1], 0.85 / 8);
});

test('explicit at values are kept; omitted runs are interpolated', () => {
  assert.deepEqual(resolveAts([{ at: 0.1 }, {}, {}, { at: 0.7 }]), [0.1, 0.3, 0.5, 0.7]);
  assert.deepEqual(resolveAts([{}, { at: 0.5 }, {}]), [0, 0.5, 0.675]);
  assert.deepEqual(resolveAts([{ at: 0.2 }, { at: 0.2 }]), [0.2, 0.2]);
  assert.deepEqual(resolveAts([{}, {}, { at: 0.4 }]), [0, 0.2, 0.4]);
});

test('windows run from at to the next at, 0.95 for the last', () => {
  const w = resolveTiming({ elements: [{ id: 'a' }, { id: 'b', at: 0.5 }, { id: 'c', at: 0.6 }] });
  assert.deepEqual(w.map((x) => [x.id, x.at, x.end]), [['a', 0, 0.5], ['b', 0.5, 0.6], ['c', 0.6, 0.95]]);
  assert.equal(w[0].explicit, false);
  assert.equal(w[1].explicit, true);
  const single = resolveTiming({ elements: [{ id: 'only', at: 0.9 }] });
  assert.deepEqual(single, [{ id: 'only', at: 0.9, end: 0.95, explicit: true }]);
});

test('checkTiming: range, order, itemAt', () => {
  assert.deepEqual(checkTiming([{ id: 'a', at: 0 }, { id: 'b', at: 0.9 }]), []);
  assert.equal(checkTiming([{ id: 'a', at: 0.95 }])[0].code, 'BAD_AT');
  assert.equal(checkTiming([{ id: 'a', at: -0.1 }])[0].code, 'BAD_AT');
  assert.equal(checkTiming([{ id: 'a', at: '0.2' }])[0].code, 'BAD_AT');
  const dec = checkTiming([{ id: 'a', at: 0.5 }, { id: 'b', at: 0.4 }]);
  assert.equal(dec.length, 1);
  assert.equal(dec[0].elementId, 'b');
  assert.equal(dec[0].code, 'BAD_AT');
  // itemAt inside the window and ascending is fine
  assert.deepEqual(checkTiming([{ id: 'l', type: 'list', items: ['a', 'b', 'c'], itemAt: [0.0, 0.1, 0.2], at: 0 }, { id: 't', at: 0.5 }]), []);
  // descending
  const desc = checkTiming([{ id: 'l', items: ['a', 'b'], itemAt: [0.3, 0.2] }]);
  assert.equal(desc[0].code, 'BAD_AT');
  // outside the window (window of l is [0, 0.5))
  const outside = checkTiming([{ id: 'l', items: ['a', 'b'], itemAt: [0.1, 0.6] }, { id: 't', at: 0.5 }]);
  assert.equal(outside[0].code, 'BAD_AT');
  // wrong length
  const wrongLen = checkTiming([{ id: 'l', items: ['a', 'b', 'c'], itemAt: [0.1, 0.2] }]);
  assert.equal(wrongLen[0].code, 'BAD_FIELD');
});

test('itemAtError helper and partStarts', () => {
  assert.equal(itemAtError([0.1, 0.2], { at: 0, end: 0.5 }), null);
  assert.match(itemAtError([0.2, 0.2], { at: 0, end: 0.5 }), /ascending/);
  assert.match(itemAtError([0.1, 0.5], { at: 0, end: 0.5 }), /outside/);
  assert.deepEqual(partStarts(4, { at: 0, end: 1 }), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(partStarts(2, { at: 0.2, end: 0.6 }, [0.2, 0.4]), [0, 0.5]);
  assert.deepEqual(partStarts(0, { at: 0, end: 1 }), [0]);
});
