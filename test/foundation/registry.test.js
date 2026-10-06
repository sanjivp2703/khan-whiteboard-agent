import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry, prepareFallback, boardRectsFor, makeDrawCtx } from '../../player/registry.js';
import { trackScenes, kindOfScene } from '../../player/harness-track.js';
import { slotRect, rectContainsRect } from '../../shared/layout-core/grid.js';
import { listFixtureLessons, loadScenes } from './helpers/fixtures.js';

const scene = (id, mode, elements, slots) => ({ sceneId: id, board: slots ? { mode, slots } : { mode }, elements });

test('registry: register/get/fallback', () => {
  assert.equal(registry.get('text'), registry.fallback);
  const prep = () => ({});
  registry.register('text', prep);
  assert.equal(registry.get('text'), prep);
  assert.equal(registry.has('text'), true);
  assert.deepEqual(registry.types(), ['text']);
  registry.unregister('text');
  assert.equal(registry.get('text'), prepareFallback);
  assert.throws(() => registry.register('x', 42), TypeError);
});

test('fallback drawable: bounds equal the slot rect; arrows span endpoints; highlights take the target; paint is DOM-free until called', () => {
  const scenes = [scene('s001', 'wipe', [
    { id: 'a', type: 'text', slot: 'A1:B1', text: 'x' }, { id: 'b', type: 'box', slot: 'D3:E4' },
    { id: 'ar', type: 'arrow', from: 'a', to: 'b' }, { id: 'hl', type: 'highlight', target: 'a' }, { id: 'pt', type: 'highlight', target: 'b', style: 'pointer' },
  ])];
  const ctx = makeDrawCtx(scenes, 0);
  const a = prepareFallback(scenes[0].elements[0], ctx);
  assert.deepEqual(a.bounds, slotRect('A1:B1'));
  assert.equal(a.parts, 1);
  assert.deepEqual(a.partStarts, [0]);
  assert.ok(a.naturalMs > 0);
  assert.equal(a.paths.length, 1);
  assert.deepEqual(a.tipAt(0), { x: 50, y: 50 });
  const ar = prepareFallback(scenes[0].elements[2], ctx);
  assert.deepEqual(ar.bounds, { x: 50, y: 50, w: 1250, h: 800 });
  assert.equal(ar.type, 'arrow');
  const hl = prepareFallback(scenes[0].elements[3], ctx);
  assert.deepEqual(hl.bounds, slotRect('A1:B1'));
  const pt = prepareFallback(scenes[0].elements[4], ctx);
  assert.deepEqual(pt.paths, []);
  assert.equal(pt.tipAt(0.5), null);
  // paint only touches the given 2D context
  const calls = [];
  const fake = new Proxy({}, { get: (_, k) => (k === 'globalAlpha' || k === 'strokeStyle' || k === 'fillStyle' || k === 'lineWidth' || k === 'font' || k === 'textBaseline') ? undefined : (...args) => { calls.push(String(k)); return undefined; }, set: () => true });
  a.paint(fake, 0.5);
  assert.ok(calls.includes('strokeRect') && calls.includes('fillText'));
  const missing = prepareFallback({ id: 'z', type: 'arrow', from: 'nope', to: 'b' }, ctx);
  assert.deepEqual(missing.paths, []);
  assert.deepEqual(missing.bounds, { x: 0, y: 0, w: 1600, h: 900 });
});

test('boardRectsFor honours wipes and ignores arrows/highlights', () => {
  const scenes = [
    scene('s001', 'wipe', [{ id: 'a', type: 'text', slot: 'A1' }, { id: 'ar', type: 'arrow', from: 'a', to: 'a' }]),
    scene('s002', 'region', [{ id: 'b', type: 'box', slot: 'B2' }], 'B2'),
    scene('s003', 'wipe', [{ id: 'c', type: 'sketch', slot: 'C3', shape: 'circle' }]),
  ];
  assert.deepEqual([...boardRectsFor(scenes, 0).keys()], ['a']);
  assert.deepEqual([...boardRectsFor(scenes, 1).keys()], ['a', 'b']);
  assert.deepEqual([...boardRectsFor(scenes, 2).keys()], ['c']);
  assert.deepEqual([...boardRectsFor(scenes).keys()], ['c']);
  assert.deepEqual(boardRectsFor(scenes, 1).get('b'), slotRect('B2'));
  const ctx = makeDrawCtx(scenes, 1);
  assert.deepEqual([...ctx.elementsById.keys()], ['a', 'ar', 'b']);
  assert.equal(typeof ctx.seed('a'), 'number');
  assert.equal(ctx.constants.CANVAS_W, 1600);
});

test('fallback bounds lie inside the slot rect for every slotted element of every fixture lesson', () => {
  for (const l of listFixtureLessons()) {
    const scenes = loadScenes(l.dir).map((s) => s.scene).filter((s) => kindOfScene(s.sceneId) === 'lesson');
    scenes.forEach((s, i) => {
      const ctx = makeDrawCtx(scenes, i);
      for (const el of s.elements) {
        const d = registry.get(el.type)(el, ctx);
        if (el.slot) assert.ok(rectContainsRect(slotRect(el.slot), d.bounds), `${l.lessonId}/${s.sceneId}/${el.id}`);
        else assert.ok(rectContainsRect({ x: 0, y: 0, w: 1600, h: 900 }, d.bounds), `${l.lessonId}/${s.sceneId}/${el.id}`);
      }
    });
  }
});

test('harness track selection', () => {
  const entries = ['s001', 's002', 'q001-a01', 'q002-a01', 'q001-a02', 's003', 's004'].map((sceneId) => ({ sceneId }));
  assert.deepEqual(trackScenes(entries, 's003'), ['s001', 's002', 's003']);
  assert.deepEqual(trackScenes(entries, 'q001-a02'), ['q001-a01', 'q001-a02']);
  assert.deepEqual(trackScenes(entries, 'q002-a01'), ['q002-a01']);
  assert.deepEqual(trackScenes(entries, 's009'), ['s001', 's002', 's003', 's004', 's009']);
  assert.equal(kindOfScene('q001-a01'), 'answer');
});
