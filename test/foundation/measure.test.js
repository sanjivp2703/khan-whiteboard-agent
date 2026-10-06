import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadFont, textWidth } from '../../shared/handwriting.js';
import { measureTextElement, measureList, measureCode, measureTable, measureMath, textWordCap, countWords } from '../../shared/layout-core/measure.js';
import { slotRect } from '../../shared/layout-core/grid.js';
import { SLOT_PAD, LINE_HEIGHTS, CAPS } from '../../shared/layout-core/constants.js';

before(async () => { await loadFont(); });

const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');

test('countWords and textWordCap', () => {
  assert.equal(countWords('a b  c\nd'), 4);
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
  assert.equal(textWordCap('A1'), 10);
  assert.equal(textWordCap('A1:B1'), 20);
  assert.equal(textWordCap('A1:D1'), 40);
  assert.equal(textWordCap('A1:F4'), CAPS.textWordsMax);
});

test('text wrap is deterministic and fits inside the inner rect', () => {
  const el = { text: words(10), style: 'body' };
  const a = measureTextElement(el, slotRect('A1'));
  const b = measureTextElement(el, slotRect('A1'));
  assert.deepEqual(a, b);
  assert.equal(a.fits, true);
  assert.equal(a.inner.w, 250 - 2 * SLOT_PAD);
  assert.ok(a.width <= a.inner.w);
  assert.ok(a.height <= a.inner.h);
});

test('text overflow detection at the boundary (one line under / over)', () => {
  const inner = slotRect('A1');
  const innerH = 200 - 2 * SLOT_PAD; // 176
  const maxLines = Math.floor(innerH / LINE_HEIGHTS.body); // 4
  // build a text with exactly maxLines lines of one word each by using words wider than half the width
  const wide = 'mmmmmmmmmmm'; // wide enough that two don't fit on a 226 px line at body size
  assert.ok(textWidth(wide + ' ' + wide, 'body') > 226 - 0);
  const under = measureTextElement({ text: words(maxLines, wide), style: 'body' }, inner);
  assert.equal(under.lines.length, maxLines);
  assert.equal(under.fits, true);
  const over = measureTextElement({ text: words(maxLines + 1, wide), style: 'body' }, inner);
  assert.equal(over.lines.length, maxLines + 1);
  assert.equal(over.fits, false);
  assert.equal(over.reasons[0].code, 'OVERFLOW');
});

test('a single word wider than the slot is OVERFLOW', () => {
  const r = measureTextElement({ text: 'Supercalifragilisticexpialidociousness', style: 'title' }, slotRect('A1'));
  assert.equal(r.fits, false);
  assert.ok(r.reasons.some((x) => x.code === 'OVERFLOW' && /wider/.test(x.message)));
});

test('list measurement stacks items with the bullet indent', () => {
  const ok = measureList({ items: ['alpha', 'beta', 'gamma'] }, slotRect('A1'));
  assert.equal(ok.fits, true);
  assert.equal(ok.items.length, 3);
  assert.equal(ok.items[1].y, LINE_HEIGHTS.body + 6);
  const tooMany = measureList({ items: Array.from({ length: 6 }, (_, i) => words(8, 'longword' + i)) }, slotRect('A1'));
  assert.equal(tooMany.fits, false);
  assert.equal(tooMany.reasons.at(-1).code, 'OVERFLOW');
});

test('code measurement: caps per span and fixed advance', () => {
  const ok = measureCode({ slot: 'A1', lines: ['const a = 1;', 'return a;'] }, slotRect('A1'));
  assert.equal(ok.fits, true);
  assert.equal(ok.lineCap, 7);
  assert.equal(ok.charCap, 22);
  const longLine = measureCode({ slot: 'A1', lines: ['x'.repeat(23)] }, slotRect('A1'));
  assert.equal(longLine.fits, false);
  assert.equal(longLine.reasons[0].code, 'CAP_CHARS');
  const manyLines = measureCode({ slot: 'A1', lines: Array(8).fill('x') }, slotRect('A1'));
  assert.equal(manyLines.reasons[0].code, 'CAP_LINES');
  const exact = measureCode({ slot: 'A1:B1', lines: Array(7).fill('x'.repeat(44)) }, slotRect('A1:B1'));
  assert.equal(exact.fits, true, JSON.stringify(exact.reasons));
});

test('table measurement: equal columns, wrapped cells, overflow when too tall or too narrow', () => {
  const ok = measureTable({ rows: [['Index', 'Value'], ['0', 'alpha'], ['1', 'beta']] }, slotRect('A1'));
  assert.equal(ok.fits, true);
  assert.equal(ok.cols, 2);
  assert.equal(ok.rowHeights.length, 3);
  const narrow = measureTable({ rows: [['abcdefghijkl', 'b', 'c', 'd', 'e', 'f']] }, slotRect('A1:B1'));
  assert.equal(narrow.fits, false);
  assert.equal(narrow.reasons[0].code, 'OVERFLOW');
  const tall = measureTable({ rows: Array(6).fill(['a', 'b']) }, slotRect('A1'));
  assert.equal(tall.fits, false);
  const tallOk = measureTable({ rows: Array(6).fill(['a', 'b']) }, slotRect('A1:A2'));
  assert.equal(tallOk.fits, true);
});

test('math measurement from em dimensions', () => {
  const ok = measureMath([{ width: 5, height: 1.2, eqX: 2 }, { width: 6, height: 1.1, eqX: null }], slotRect('A1:B1'));
  assert.equal(ok.fits, true);
  assert.equal(ok.lines[0].eqX, 2 * 28);
  assert.equal(ok.lines[1].eqX, null);
  const wide = measureMath([{ width: 9, height: 1, eqX: null }], slotRect('A1'));
  assert.equal(wide.fits, false);
  assert.equal(wide.reasons[0].code, 'OVERFLOW');
});
