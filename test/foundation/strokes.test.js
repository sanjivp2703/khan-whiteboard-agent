import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathLength, pointAt, partialPath, parsePath, pathPoints, pathBounds, flatten, rough, seedFor, naturalMs, drawPartial } from '../../shared/strokes.js';
import { PEN_PX_PER_S } from '../../shared/layout-core/constants.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('pathLength and pointAt on known shapes', () => {
  close(pathLength('M0 0 L100 0'), 100);
  close(pathLength('M0 0 h10 v10 h-10 z'), 40);
  close(pathLength('M0 0 L3 4'), 5);
  close(pathLength('M0 0 L100 0 M0 10 L50 10'), 150); // two subpaths
  const circ = pathLength('M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0');
  assert.ok(Math.abs(circ - 2 * Math.PI * 10) < 0.2, `circle length ${circ}`);
  assert.deepEqual(pointAt('M0 0 L100 0', 0), { x: 0, y: 0 });
  assert.deepEqual(pointAt('M0 0 L100 0', 0.25), { x: 25, y: 0 });
  assert.deepEqual(pointAt('M0 0 L100 0', 1), { x: 100, y: 0 });
  const rectMid = pointAt('M0 0 h10 v10 h-10 z', 0.5); // half way round: (10,10)
  close(rectMid.x, 10); close(rectMid.y, 10);
  const second = pointAt('M0 0 L100 0 M0 10 L50 10', 0.9); // 135 px in: 35 px along the second subpath
  close(second.x, 35); close(second.y, 10);
  assert.equal(pointAt('', 0.5), null);
  close(pathLength(''), 0);
});

test('parsePath normalizes relative/shorthand commands; arcs become cubics', () => {
  const segs = parsePath('m10 10 l5 0 h5 v5 s1 1 2 2 q1 1 2 2 t1 1 a2 2 0 0 1 4 0 z');
  assert.deepEqual(segs.map((s) => s.type).slice(0, 4), ['M', 'L', 'L', 'L']);
  assert.ok(segs.some((s) => s.type === 'C'));
  assert.ok(segs.some((s) => s.type === 'Q'));
  assert.equal(segs.at(-1).type, 'Z');
  assert.deepEqual(parsePath('M1 2 3 4'), [{ type: 'M', pts: [1, 2] }, { type: 'L', pts: [3, 4] }]); // implicit lineto
  assert.throws(() => parsePath('M0 0 X 1'), /illegal character/);
  assert.throws(() => parsePath('M0 0 L 1'), /argument count/);
  assert.throws(() => parsePath('1 2'), /before any command/);
  assert.deepEqual(pathPoints('M1 1 C2 2 3 3 4 4'), [[1, 1], [2, 2], [3, 3], [4, 4]]);
  assert.deepEqual(pathBounds('M0 0 L10 5 L-2 7'), { x: -2, y: 0, w: 12, h: 7 });
  assert.equal(pathBounds(''), null);
  assert.equal(flatten('M0 0 L1 1 M5 5 L6 6').length, 2);
});

test('partialPath returns a prefix of the given length fraction', () => {
  assert.equal(partialPath('M0 0 L100 0 L100 100', 0.75), 'M0 0 L100 0 L100 50');
  assert.equal(partialPath('M0 0 L100 0 L100 100', 1), 'M0 0 L100 0 L100 100');
  assert.equal(partialPath('M0 0 L100 0 L100 100', 0.25), 'M0 0 L50 0');
  // drawPartial issues the matching canvas calls
  const calls = [];
  const ctx = { beginPath: () => calls.push('begin'), moveTo: (x, y) => calls.push(`M${x},${y}`), lineTo: (x, y) => calls.push(`L${x},${y}`), stroke: () => calls.push('stroke') };
  drawPartial(ctx, 'M0 0 L100 0 L100 100', 0.75);
  assert.deepEqual(calls, ['begin', 'M0,0', 'L100,0', 'L100,50', 'stroke']);
});

test('seeded rough output is identical across calls and differs for another seed', () => {
  const a = rough('box1').rectangle(10, 10, 100, 50);
  const b = rough('box1').rectangle(10, 10, 100, 50);
  const c = rough('box2').rectangle(10, 10, 100, 50);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 1 && typeof a[0] === 'string' && /^M/.test(a[0]));
  assert.equal(seedFor('box1'), seedFor('box1'));
  assert.notEqual(seedFor('box1'), seedFor('box2'));
  assert.ok(seedFor('') > 0);
  assert.equal(rough(77).seed, 77);
  // every generator is wired
  const r = rough('all');
  assert.ok(r.line(0, 0, 10, 10).length >= 1);
  assert.ok(r.ellipse(50, 50, 40, 20).length >= 1);
  assert.ok(r.circle(50, 50, 40).length >= 1);
  assert.ok(r.polygon([[0, 0], [10, 0], [5, 8]]).length >= 1);
  assert.ok(r.path('M0 0 L10 10 L20 0').length >= 1);
  assert.ok(r.arc(50, 50, 40, 40, 0, Math.PI).length >= 1);
  assert.ok(r.linearPath([[0, 0], [10, 0], [10, 10]]).length >= 1);
  assert.ok(r.curve([[0, 0], [10, 5], [20, 0]]).length >= 1);
  // fill adds hachure paths after the stroke paths
  const filled = r.circle(50, 50, 40, { fill: 'accent1' });
  assert.ok(filled.length > r.circle(50, 50, 40).length);
});

test('naturalMs = total length / PEN_PX_PER_S', () => {
  close(naturalMs(['M0 0 L100 0']), (100 / PEN_PX_PER_S) * 1000);
  close(naturalMs(['M0 0 L100 0', 'M0 0 L50 0']), (150 / PEN_PX_PER_S) * 1000);
  close(naturalMs('M0 0 L100 0'), (100 / PEN_PX_PER_S) * 1000);
  close(naturalMs([]), 0);
  close(naturalMs(['']), 0);
});
