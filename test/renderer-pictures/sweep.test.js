// Slice 03 — all-fixtures sweep: registration, containment, determinism, monotonic reveal,
// paint on a fake 2D context, performance and source hygiene (brief 03 criteria 1–4, 9, 10, 12, 13).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { registry, makeDrawCtx } from '../../player/registry.js';
import { PICTURE_TYPES } from '../../player/renderer/pictures/index.js';
import { slotRect, rectContainsRect } from '../../shared/layout-core/grid.js';
import { kindOfScene } from '../../player/harness-track.js';
import { listFixtureLessons, loadScenes, validateLesson } from '../foundation/helpers/fixtures.js';
import { prepareValidator } from '../../shared/schema/validate.js';
import { ensureFont, fakeCtx2d, signature, pictureSources, stripComments } from './helpers.js';

before(ensureFont);

/** Every picture element of every fixture lesson with its ctx: [{lessonId, sceneId, el, ctx}]. */
function allPictureElements() {
  const out = [];
  for (const l of listFixtureLessons()) {
    const scenes = loadScenes(l.dir).map((s) => s.scene).filter((s) => kindOfScene(s.sceneId) === 'lesson');
    scenes.forEach((s, i) => {
      const ctx = makeDrawCtx(scenes, i);
      for (const el of s.elements) if (PICTURE_TYPES.includes(el.type)) out.push({ lessonId: l.lessonId, sceneId: s.sceneId, el, ctx });
    });
  }
  return out;
}

test('exactly the four picture types are registered by importing player/renderer/pictures/index.js', () => {
  assert.deepEqual([...registry.types()].sort(), ['diagram', 'plot', 'sketch', 'svg']);
  for (const t of PICTURE_TYPES) assert.notEqual(registry.get(t), registry.fallback);
  assert.equal(registry.get('text'), registry.fallback, 'writing types are left to slice 02');
});

test('the slice fixtures (fx-pic-*) pass the shared validator', async () => {
  await prepareValidator();
  const mine = listFixtureLessons().filter((l) => l.lessonId.startsWith('fx-pic-'));
  assert.deepEqual(mine.map((l) => l.lessonId), ['fx-pic-dense', 'fx-pic-shapes']);
  for (const l of mine) {
    const results = await validateLesson(l.dir, l.lessonId);
    for (const r of results) assert.ok(r.result.ok, `${l.lessonId}/${r.file}: ${JSON.stringify(r.result.errors)}`);
  }
});

test('containment: bounds inside slotRect(slot) for every sketch/diagram/plot/svg element of every fixture lesson', () => {
  const items = allPictureElements();
  assert.ok(items.length >= 60, `found ${items.length} picture elements`);
  const seen = new Set();
  for (const { lessonId, sceneId, el, ctx } of items) {
    const d = registry.get(el.type)(el, ctx);
    seen.add(el.type);
    assert.equal(d.id, el.id);
    assert.equal(d.type, el.type);
    assert.ok(rectContainsRect(slotRect(el.slot), d.bounds), `${lessonId}/${sceneId}/${el.id}: ${JSON.stringify(d.bounds)} not inside ${JSON.stringify(slotRect(el.slot))}`);
    assert.ok(d.parts >= 1 && d.partStarts.length === d.parts && d.partStarts[0] === 0);
    for (let i = 1; i < d.partStarts.length; i++) assert.ok(d.partStarts[i] > d.partStarts[i - 1] && d.partStarts[i] < 1);
    assert.ok(Number.isFinite(d.naturalMs) && d.naturalMs >= 0);
    assert.ok(d.paths.every((p) => typeof p === 'string' && !/NaN|Infinity/.test(p)), `${lessonId}/${sceneId}/${el.id}: path data is finite`);
  }
  assert.deepEqual([...seen].sort(), ['diagram', 'plot', 'sketch', 'svg']);
});

test('determinism: two prepare calls → deep-equal paths/bounds/partStarts/naturalMs for every fixture element', () => {
  for (const { lessonId, sceneId, el, ctx } of allPictureElements()) {
    const a = registry.get(el.type)(el, ctx);
    const b = registry.get(el.type)(el, ctx);
    assert.equal(signature(a), signature(b), `${lessonId}/${sceneId}/${el.id}`);
  }
});

test('monotonic reveal: fully drawn strokes never decrease as u grows, reach paths.length at u=1; tipAt is non-null mid-stroke; paint strokes match', () => {
  for (const { lessonId, sceneId, el, ctx } of allPictureElements()) {
    const d = registry.get(el.type)(el, ctx);
    const tag = `${lessonId}/${sceneId}/${el.id}`;
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const r = d.revealAt(u);
      assert.ok(r.complete >= last, `${tag}: non-decreasing at u=${u}`);
      last = r.complete;
      if (u > 0 && u < 1 && r.partialIndex !== null) assert.ok(d.tipAt(u) !== null, `${tag}: tipAt(${u})`);
      // paint on a fake context: one stroke/fill per completed path (Node fallback strokes everything) plus at most one partial
      const { ctx: fake, calls } = fakeCtx2d();
      d.paint(fake, u);
      const drawn = calls.stroke + calls.fill;
      assert.ok(drawn === r.complete || drawn === r.complete + 1, `${tag}: paint at u=${u} drew ${drawn}, reveal says ${r.complete}`);
      assert.equal(calls.save, 1);
      assert.equal(calls.restore, 1);
    }
    assert.equal(d.revealAt(1).complete, d.paths.length, `${tag}: all strokes at u=1`);
    assert.equal(d.revealAt(0).complete, 0, `${tag}: nothing at u=0`);
    if (d.paths.length) assert.ok(d.tipAt(1) !== null && d.tipAt(0) !== null);
  }
});

test('performance: preparing the heaviest picture scene (fx-pic-dense s001, all four types) takes < 150 ms', () => {
  const items = allPictureElements().filter((x) => x.lessonId === 'fx-pic-dense' && x.sceneId === 's001');
  assert.equal(items.length, 4);
  for (const { el, ctx } of items) registry.get(el.type)(el, ctx); // warm-up (rough generator, font glyph cache)
  const t0 = performance.now();
  for (const { el, ctx } of items) registry.get(el.type)(el, ctx);
  const ms = performance.now() - t0;
  assert.ok(ms < 150, `prepare took ${ms.toFixed(1)} ms`);
});

test('source hygiene: no DOM creation, no image drawing, no dynamic code, no literal hex colours in player/renderer/pictures/', () => {
  const forbidden = [/innerHTML/, /DOMParser/, /drawImage/, /createElementNS/, /\beval\b/, /\bFunction\s*\(/, /measureText/, /document\.create/, /\.appendChild/];
  for (const { name, source } of pictureSources()) {
    for (const re of forbidden) assert.ok(!re.test(source), `${name} matches ${re}`);
    const code = stripComments(source);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), `${name} contains a literal hex colour`);
  }
});

test('node --check equivalent: every module in the directory imports cleanly', async () => {
  for (const name of ['common.js', 'sketch-library.js', 'sketch.js', 'diagram-layout.js', 'diagram.js', 'plot.js', 'svg.js', 'index.js']) {
    await import(`../../player/renderer/pictures/${name}`);
  }
});
