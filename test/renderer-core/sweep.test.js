// All-fixtures sweeps for the core drawables (brief 02 criteria 1–4, 13, 14): registration,
// containment, determinism, monotonic reveal, DOM-free paint, naturalMs agreement, performance.
// Runs over every fixture lesson present, so fixtures added by later slices are covered too.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../player/registry.js';
import { naturalMs } from '../../shared/strokes.js';
import { setup, core, CORE_TYPES, BOARD, listFixtureLessons, lessonScenes, makeDrawCtx, prepare, prepareLesson, reseed, containerOf, rectContainsRect, completeCount, fakeCtx2d } from './helpers.js';

before(async () => { await setup(); });

const near = (a, b, eps) => Math.abs(a - b) <= eps;
const rectsNear = (a, b, eps) => near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.w, b.w, eps) && near(a.h, b.h, eps);

test('criterion 1: importing the core renderer registers exactly the eight writing types', () => {
  for (const t of CORE_TYPES) assert.equal(registry.get(t), core.prepares[t], t);
  for (const t of ['sketch', 'diagram', 'plot', 'svg']) assert.equal(registry.has(t), false, `${t} must be left to slice 03`);
  assert.deepEqual(CORE_TYPES, ['text', 'list', 'code', 'table', 'math', 'box', 'arrow', 'highlight']);
});

test('criterion 2: bounds of every core element of every fixture lesson lie inside its slot rect (canvas for arrows/highlights); nothing pending', async () => {
  let n = 0;
  for (const l of listFixtureLessons()) {
    for (const { sceneId, el, drawable: d } of await prepareLesson(l.lessonId)) {
      const where = `${l.lessonId}/${sceneId}/${el.id} (${el.type})`;
      assert.equal(d.pending, false, `${where} is pending: ${d.meta && d.meta.reason}`);
      assert.equal(d.id, el.id, where);
      assert.equal(d.type, el.type, where);
      assert.ok(rectContainsRect(containerOf(el), d.bounds), `${where}: bounds ${JSON.stringify(d.bounds)} escape ${JSON.stringify(containerOf(el))}`);
      assert.ok(rectContainsRect(BOARD, d.bounds), where);
      // every stroke actually drawn lies inside bounds (bounds are a true envelope)
      for (const s of d.strokes) if (s.bounds) assert.ok(rectContainsRect(d.bounds, s.bounds, 0.01), `${where}: stroke escapes bounds`);
      assert.ok(d.parts >= 1 && d.partStarts.length === d.parts, where);
      for (let i = 0; i < d.partStarts.length; i++) {
        assert.ok(d.partStarts[i] >= 0 && d.partStarts[i] < 1, where);
        if (i > 0) assert.ok(d.partStarts[i] >= d.partStarts[i - 1], `${where}: partStarts not ascending`);
      }
      assert.equal(d.paths.length, d.strokes.length, where);
      n++;
    }
  }
  assert.ok(n >= 100, `only ${n} core elements swept`);
});

test('criterion 3: prepare is deterministic; a different seed changes rough paths but not bounds (≤ 2 px) nor glyph paths', async () => {
  for (const l of listFixtureLessons()) {
    const scenes = lessonScenes(l.dir);
    await core.warm(scenes);
    scenes.forEach((s, i) => {
      const ctx = makeDrawCtx(scenes, i);
      for (const el of s.elements) {
        if (!CORE_TYPES.includes(el.type)) continue;
        const where = `${l.lessonId}/${s.sceneId}/${el.id}`;
        const a = prepare(el, ctx);
        const b = prepare(el, ctx);
        assert.deepEqual(a.paths, b.paths, where);
        assert.deepEqual(a.bounds, b.bounds, where);
        assert.deepEqual(a.partStarts, b.partStarts, where);
        assert.equal(a.naturalMs, b.naturalMs, where);
        const c = prepare(el, reseed(ctx));
        assert.ok(rectsNear(a.bounds, c.bounds, 2), `${where}: bounds moved with the seed ${JSON.stringify(a.bounds)} vs ${JSON.stringify(c.bounds)}`);
        const glyphsA = a.strokes.filter((x) => x.kind === 'glyph' && !x.fallback).map((x) => x.d);
        const glyphsC = c.strokes.filter((x) => x.kind === 'glyph' && !x.fallback).map((x) => x.d);
        assert.deepEqual(glyphsA, glyphsC, `${where}: glyph paths depend on the seed`);
        const roughA = a.strokes.filter((x) => x.kind !== 'glyph').map((x) => x.d);
        const roughC = c.strokes.filter((x) => x.kind !== 'glyph').map((x) => x.d);
        assert.equal(roughA.length, roughC.length, where);
        if (roughA.length) assert.notDeepEqual(roughA, roughC, `${where}: rough paths ignore the seed`);
      }
    });
  }
});

test('criterion 4: reveal is monotonic in u, reaches every stroke at u=1, draws nothing at u=0, and tipAt follows the active stroke', async () => {
  for (const l of listFixtureLessons()) {
    for (const { sceneId, el, drawable: d } of await prepareLesson(l.lessonId)) {
      const where = `${l.lessonId}/${sceneId}/${el.id}`;
      assert.equal(completeCount(d, 0), 0, where);
      let last = 0;
      for (let i = 1; i <= 20; i++) {
        const u = i / 20;
        const c = completeCount(d, u);
        assert.ok(c >= last, `${where}: complete strokes fell from ${last} to ${c} at u=${u}`);
        last = c;
        const p = d.progress(u);
        const tip = d.tipAt(u);
        if (u < 1 && p.current >= 0) assert.ok(tip && Number.isFinite(tip.x) && Number.isFinite(tip.y), `${where}: tipAt(${u}) null while a stroke is in progress`);
        if (tip) assert.ok(rectContainsRect(BOARD, { x: tip.x, y: tip.y, w: 0, h: 0 }), `${where}: tip off canvas`);
      }
      assert.equal(completeCount(d, 1), d.paths.length, `${where}: not every stroke complete at u=1`);
      if (d.paths.length) assert.ok(d.tipAt(1), where);
    }
  }
});

test('naturalMs equals strokes.naturalMs(paths); pointer highlights have no paths and zero naturalMs', async () => {
  for (const l of listFixtureLessons()) {
    for (const { sceneId, el, drawable: d } of await prepareLesson(l.lessonId)) {
      const where = `${l.lessonId}/${sceneId}/${el.id}`;
      assert.ok(near(d.naturalMs, naturalMs(d.paths), 1e-6), `${where}: ${d.naturalMs} vs ${naturalMs(d.paths)}`);
      if (el.type === 'highlight' && el.style === 'pointer') { assert.deepEqual(d.paths, []); assert.equal(d.naturalMs, 0); }
      else assert.ok(d.naturalMs > 0, where);
    }
  }
});

test('criterion 13: paint touches only the given 2D context (no DOM, no measureText) and at u=1 draws every stroke', async () => {
  for (const { el, drawable: d } of await prepareLesson('fx-core-dense')) {
    const { ctx, calls } = fakeCtx2d();
    d.paint(ctx, 1);
    d.paint(ctx, 0.37);
    d.paint(ctx, 0);
    assert.equal(calls.measureText, undefined, el.id);
    assert.equal(calls.fillText, undefined, el.id);
    if (d.paths.length) {
      assert.ok(calls.stroke >= d.paths.length, `${el.id}: ${calls.stroke} strokes for ${d.paths.length} paths`);
      if (['text', 'code', 'math'].includes(el.type)) assert.ok(calls.fill >= 1, `${el.id}: glyphs are filled when complete`);
      assert.ok(calls.save >= 1 && calls.restore === calls.save, el.id);
    } else {
      assert.equal(calls.stroke, undefined, `${el.id}: pointer painted something`);
    }
  }
});

test('criterion 14: preparing the densest core scene takes < 150 ms in Node', async () => {
  const scenes = (await import('./helpers.js')).fixtureScenes('fx-core-dense');
  await core.warm(scenes);
  const run = (index) => {
    const ctx = makeDrawCtx(scenes, index);
    const t0 = performance.now();
    for (const el of scenes[index].elements) if (CORE_TYPES.includes(el.type)) prepare(el, ctx);
    return performance.now() - t0;
  };
  for (let i = 0; i < scenes.length; i++) run(i); // warm the JIT once
  for (let i = 0; i < scenes.length; i++) {
    const ms = Math.min(run(i), run(i));
    assert.ok(ms < 150, `scene ${scenes[i].sceneId} took ${ms.toFixed(1)} ms`);
  }
});

test('a missing required field throws a clear error (validated input is assumed, never guessed)', () => {
  const ctx = makeDrawCtx([{ sceneId: 's001', board: { mode: 'wipe' }, elements: [] }], 0);
  assert.throws(() => prepare({ id: 't', type: 'text', slot: 'A1' }, ctx), /missing required field "text"/);
  assert.throws(() => prepare({ id: 'l', type: 'list', slot: 'A1:B2' }, ctx), /missing required field "items"/);
  assert.throws(() => prepare({ id: 'c', type: 'code', lines: ['x'] }, ctx), /missing required field "slot"/);
  assert.throws(() => prepare({ id: 'm', type: 'math', slot: 'A1:B1' }, ctx), /missing required field "lines"/);
  assert.throws(() => prepare({ id: 'a', type: 'arrow', from: 'x' }, ctx), /missing required field "to"/);
  assert.throws(() => prepare({ id: 'a', type: 'arrow', from: 'x', to: 'y' }, ctx), /not on the board/);
  assert.throws(() => prepare({ id: 'h', type: 'highlight', target: 'nope' }, ctx), /not on the board/);
});
