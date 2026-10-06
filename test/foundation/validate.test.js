import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, validateSceneText, validateOutline, prepareValidator, dropElements, codesOf, ERROR_CODES } from '../../shared/schema/validate.js';
import { createOccupancy, applyScene, toJSON } from '../../shared/layout-core/occupancy.js';
import { ALL_CELLS, slotCells, parseSlot } from '../../shared/layout-core/grid.js';
import { SKETCH_SHAPES } from '../../shared/layout-core/constants.js';
import { listFixtureLessons, validateLesson, listInvalidFixtures, readJSON } from './helpers/fixtures.js';
import { join } from 'node:path';

before(async () => { await prepareValidator(); });

const LESSON = 'fx-unit-test';
const NARR = 'This narration is long enough to clear the fifteen word minimum and short enough to stay well under the ninety word cap.';
const base = (over = {}) => ({ schema: 'khan-scene/1', lessonId: LESSON, sceneId: 's001', title: 'T', narration: NARR, board: { mode: 'wipe' }, elements: [], final: false, ...over });
const txt = (id, slot, over = {}) => ({ id, type: 'text', slot, style: 'body', text: 'short text', ...over });
const v = (scene, occ = createOccupancy()) => validateScene(scene, occ, { lessonId: LESSON });
const codes = async (scene, occ) => codesOf((await v(scene, occ)).errors);

test('a minimal valid scene is ok and its occupancy reflects the elements', async () => {
  const r = await v(base({ elements: [txt('a', 'A1:B1')] }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(toJSON(r.occupancy).cells, ['A1', 'B1']);
  assert.equal(r.effective, r.effective && r.effective.sceneId === 's001' ? r.effective : null);
});

test('one code per error class (spot checks for codes not covered by fixtures)', async () => {
  const r = await validateSceneText('{not json', createOccupancy(), { lessonId: LESSON });
  assert.deepEqual(codesOf(r.errors), ['BAD_JSON']);
  assert.equal(r.ok, false);
  assert.deepEqual(await codes(null), ['BAD_SCHEMA']);
  assert.deepEqual(await codes('string'), ['BAD_SCHEMA']);
  assert.deepEqual(await codes(base({ schema: undefined })), ['BAD_SCHEMA']);
  assert.deepEqual(await codes(base({ elements: [txt('a', 'A1:B1', { at: 1.5 })] })), ['BAD_AT']);
  assert.deepEqual(await codes(base({ elements: [txt('a', 'A1:B1'), { id: 'h', type: 'highlight', target: 'a', slot: 'C1' }] })), ['BAD_FIELD']);
  assert.deepEqual(await codes(base({ title: 42, elements: [txt('a', 'A1:B1')] })), ['BAD_FIELD']);
  assert.deepEqual(await codes(base({ board: { mode: 'wipe', slots: 'A1' }, elements: [txt('a', 'A1:B1')] })), ['BAD_BOARD']);
  // every documented code is a known code
  for (const c of ['BAD_JSON', 'BAD_SCHEMA', 'MISSING_FIELD', 'BAD_FIELD', 'BAD_LESSON_ID', 'BAD_SCENE_ID', 'BAD_ID', 'DUP_ID', 'BAD_ENUM', 'BAD_BOARD', 'BAD_NARRATION', 'CAP_COUNT', 'CAP_WORDS', 'CAP_CHARS', 'CAP_LINES', 'BAD_AT', 'BAD_SLOT', 'SLOT_TOO_SMALL', 'OVERFLOW', 'OVERLAP', 'OUT_OF_REGION', 'REGION_OCCUPIED', 'BAD_REF', 'SELF_REF', 'BAD_LINE', 'BAD_MATH', 'BAD_MERMAID', 'BAD_EXPR', 'BAD_SVG']) {
    assert.ok(ERROR_CODES.includes(c), c);
  }
});

test('invalid fixture sweep: every fixture fails with exactly its expected codes (criterion 2)', async () => {
  const fixtures = listInvalidFixtures();
  assert.ok(fixtures.length >= 60, `only ${fixtures.length} invalid fixtures`);
  const seen = new Set();
  for (const f of fixtures) {
    const r = await validateScene(f.scene, f.occupancy, { lessonId: 'fx-invalid' });
    assert.equal(r.ok, false, `${f.name} should be invalid`);
    const got = codesOf(r.errors);
    const allowed = new Set([...f.expected.codes, ...(f.expected.alsoAllowed || [])]);
    for (const c of f.expected.codes) assert.ok(got.includes(c), `${f.name}: missing ${c}, got [${got}]`);
    for (const c of got) assert.ok(allowed.has(c), `${f.name}: unexpected code ${c}, got [${got}]`);
    for (const c of got) seen.add(c);
    // occupancy is unchanged when the scene is rejected
    assert.deepEqual(toJSON(r.occupancy), toJSON(f.occupancy));
  }
  // at least one fixture per code (except BAD_JSON, which needs raw text, and TTS_FAILED, which is a server status)
  for (const c of ERROR_CODES) {
    if (c === 'BAD_JSON' || c === 'TTS_FAILED') continue;
    assert.ok(seen.has(c), `no invalid fixture produces ${c}`);
  }
});

test('valid fixture sweep: every scene of every fixture lesson validates ok (incl. later slices\' fixtures)', async () => {
  const lessons = listFixtureLessons();
  assert.ok(lessons.length >= 16, `only ${lessons.length} fixture lessons`);
  for (const l of lessons) {
    const outline = readJSON(join(l.dir, 'outline.json'));
    const o = validateOutline(outline, { lessonId: l.lessonId });
    assert.ok(o.ok, `${l.lessonId}/outline.json: ${JSON.stringify(o.errors)}`);
    const results = await validateLesson(l.dir, l.lessonId);
    assert.ok(results.length >= 3, `${l.lessonId} has fewer than 3 scenes`);
    for (const { file, result } of results) {
      assert.ok(result.ok, `${l.lessonId}/${file}: ${JSON.stringify(result.errors)}`);
    }
    // outline scenes exist as files, lesson scenes are in the outline
    const files = new Set(results.map((r) => r.scene.sceneId));
    for (const s of outline.scenes) assert.ok(files.has(s.sceneId), `${l.lessonId}: outline scene ${s.sceneId} has no file`);
  }
});

test('degrade fixture: s002 is invalid with exactly one bad element, others valid', async () => {
  const [l] = listFixtureLessons({ includeDegrade: true }).filter((x) => x.lessonId === 'fx-degrade-flow');
  const results = await validateLesson(l.dir, l.lessonId);
  assert.equal(results[0].result.ok, true);
  assert.equal(results[1].result.ok, false);
  assert.deepEqual([...new Set(results[1].result.errors.map((e) => e.elementId))], ['bad']);
  assert.equal(results[2].result.ok, true);
  const fixed = dropElements(results[1].scene, ['bad']);
  assert.equal((await v({ ...fixed, lessonId: 'fx-degrade-flow' }, createOccupancy())).ok, false); // lessonId mismatch with LESSON
  assert.equal((await validateScene(fixed, createOccupancy(), { lessonId: 'fx-degrade-flow' })).ok, true);
});

test('performance and determinism over fx-full-tour (criterion 3)', async () => {
  const [l] = listFixtureLessons().filter((x) => x.lessonId === 'fx-full-tour');
  await validateLesson(l.dir, l.lessonId); // warm-up (font + MathJax already prepared)
  const a = await validateLesson(l.dir, l.lessonId);
  const b = await validateLesson(l.dir, l.lessonId);
  assert.equal(a.length, 10);
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i].ms < 100, `${a[i].file} took ${a[i].ms.toFixed(1)} ms`);
    assert.deepEqual({ ok: a[i].result.ok, errors: a[i].result.errors, occ: toJSON(a[i].result.occupancy) }, { ok: b[i].result.ok, errors: b[i].result.errors, occ: toJSON(b[i].result.occupancy) });
  }
});

// ---------- property test (criterion 4) ----------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const slotName = (c0, r0, c1, r1) => `${'ABCDEF'[c0]}${r0 + 1}${c1 !== c0 || r1 !== r0 ? `:${'ABCDEF'[c1]}${r1 + 1}` : ''}`;

/** Random non-overlapping slots inside the bounds [cMin..cMax]×[rMin..rMax]. */
function randomSlots(r, count, bounds) {
  const taken = new Set();
  const out = [];
  for (let tries = 0; tries < 200 && out.length < count; tries++) {
    const cols = 1 + Math.floor(r() * 2), rows = 1 + Math.floor(r() * 2);
    const c0 = bounds.c0 + Math.floor(r() * (bounds.c1 - bounds.c0 + 1 - cols + 1));
    const r0 = bounds.r0 + Math.floor(r() * (bounds.r1 - bounds.r0 + 1 - rows + 1));
    if (c0 < bounds.c0 || r0 < bounds.r0 || c0 + cols - 1 > bounds.c1 || r0 + rows - 1 > bounds.r1) continue;
    const name = slotName(c0, r0, c0 + cols - 1, r0 + rows - 1);
    const cells = slotCells(name);
    if (cells.some((c) => taken.has(c))) continue;
    cells.forEach((c) => taken.add(c));
    out.push(name);
  }
  return out;
}

function randomScene(r, i) {
  const regionMode = r() < 0.5;
  const bounds = regionMode
    ? (() => { const c0 = Math.floor(r() * 3), r0 = Math.floor(r() * 2); return { c0, r0, c1: c0 + 2 + Math.floor(r() * (6 - c0 - 2)), r1: r0 + 1 + Math.floor(r() * (4 - r0 - 1)) }; })()
    : { c0: 0, r0: 0, c1: 5, r1: 3 };
  const slots = randomSlots(r, 2 + Math.floor(r() * 3), bounds);
  const elements = slots.map((slot, k) => {
    const id = `e${k}`;
    const cells = slotCells(slot).length;
    switch (pick(r, ['text', 'text', 'list', 'code', 'box', 'sketch'])) {
      case 'text': return { id, type: 'text', slot, style: 'body', text: Array.from({ length: Math.min(3 * cells, 9) }, (_, j) => `w${j}`).join(' ') };
      case 'list': return { id, type: 'list', slot, items: ['one', 'two', 'three'].slice(0, 2 + Math.floor(r() * 2)) };
      case 'code': return { id, type: 'code', slot, lines: ['let a = 1;', 'a += 2;'].slice(0, 1 + Math.floor(r() * 2)) };
      case 'box': return { id, type: 'box', slot, label: 'box' };
      default: return { id, type: 'sketch', slot, shape: pick(r, SKETCH_SHAPES) };
    }
  });
  if (elements.length >= 2 && r() < 0.7) elements.push({ id: 'ar', type: 'arrow', from: elements[0].id, to: elements[1].id, label: 'to' });
  if (r() < 0.5) elements.push({ id: 'hl', type: 'highlight', target: elements[0].id, style: pick(r, ['circle', 'underline', 'strike', 'pointer']) });
  const board = regionMode ? { mode: 'region', slots: slotName(bounds.c0, bounds.r0, bounds.c1, bounds.r1) } : { mode: 'wipe' };
  // occupancy: for region scenes, fill every cell outside the region with an earlier element
  const occ = createOccupancy();
  if (regionMode) {
    const outside = ALL_CELLS.filter((c) => !slotCells(board.slots).includes(c));
    applyOccupancyCells(occ, outside);
  }
  return { scene: base({ sceneId: `s${String((i % 999) + 1).padStart(3, '0')}`, board, elements }), occ, bounds, regionMode };
}

function applyOccupancyCells(occ, cells) {
  cells.forEach((c, i) => { occ.cells.add(c); });
  occ.elements.set('earlier', { type: 'box', slot: 'A1' });
}

/** Inject one fault and return {scene, code} or null when the fault is not applicable. */
function injectFault(r, gen) {
  const scene = JSON.parse(JSON.stringify(gen.scene));
  const slotted = scene.elements.filter((e) => e.slot);
  const kind = pick(r, ['overlap', 'badref', 'capwords', 'outofregion']);
  if (kind === 'overlap' && slotted.length >= 2) {
    slotted[1].slot = slotted[0].slot; // same slot → overlap, unless one is a box containing the other: force both non-box
    for (const e of [slotted[0], slotted[1]]) if (e.type === 'box') { e.type = 'sketch'; e.shape = 'circle'; delete e.label; }
    return { scene, code: 'OVERLAP' };
  }
  if (kind === 'badref') {
    const ar = scene.elements.find((e) => e.type === 'arrow');
    if (ar) { ar.to = 'missing'; return { scene, code: 'BAD_REF' }; }
    scene.elements.push({ id: 'ar2', type: 'arrow', from: slotted[0].id, to: 'missing' });
    return { scene, code: 'BAD_REF' };
  }
  if (kind === 'capwords') {
    const t = slotted.find((e) => e.type === 'text');
    if (t) {
      const cap = Math.min(10 * slotCells(t.slot).length, 40);
      t.text = Array.from({ length: cap + 1 }, (_, j) => `w${j}`).join(' ');
      return { scene, code: 'CAP_WORDS' };
    }
    return null;
  }
  if (kind === 'outofregion' && gen.regionMode) {
    const b = gen.bounds;
    // pick a cell outside the region and give it to the first slotted element
    const outside = ALL_CELLS.find((c) => { const p = parseSlot(c); return p.c0 < b.c0 || p.c0 > b.c1 || p.r0 < b.r0 || p.r0 > b.r1; });
    if (!outside) return null;
    slotted[0].slot = outside;
    return { scene, code: 'OUT_OF_REGION' };
  }
  return null;
}

test('property: 200 random valid scenes pass; one injected fault each fails with the matching code (criterion 4)', async () => {
  const r = rng(20261006);
  let faults = 0;
  const faultCodes = {};
  for (let i = 0; i < 200; i++) {
    const gen = randomScene(r, i);
    const ok = await v(gen.scene, gen.occ);
    assert.ok(ok.ok, `random scene ${i} should be valid: ${JSON.stringify(ok.errors)}\n${JSON.stringify(gen.scene)}`);
    let faulty = null;
    for (let t = 0; t < 8 && !faulty; t++) faulty = injectFault(r, gen);
    if (!faulty) continue;
    faults++;
    const bad = await v(faulty.scene, gen.occ);
    assert.equal(bad.ok, false, `fault ${faulty.code} on scene ${i} should fail\n${JSON.stringify(faulty.scene)}`);
    assert.ok(bad.errors.some((e) => e.code === faulty.code), `scene ${i}: expected ${faulty.code}, got ${JSON.stringify(bad.errors)}`);
    faultCodes[faulty.code] = (faultCodes[faulty.code] || 0) + 1;
  }
  assert.ok(faults >= 150, `only ${faults} faults injected`);
  for (const c of ['OVERLAP', 'BAD_REF', 'CAP_WORDS', 'OUT_OF_REGION']) assert.ok(faultCodes[c] > 0, `fault ${c} never exercised`);
});

// ---------- specific layout rules ----------

test('box containment exception: elements inside a box do not overlap it; partial overlap does', async () => {
  const inside = base({ elements: [{ id: 'bx', type: 'box', slot: 'A1:C2', label: 'group' }, txt('t', 'B1'), txt('u', 'A2:B2')] });
  assert.equal((await v(inside)).ok, true);
  const partial = base({ elements: [{ id: 'bx', type: 'box', slot: 'A1:B2', label: 'group' }, txt('t', 'B1:C1')] });
  assert.deepEqual(await codes(partial), ['OVERLAP']);
  const boxInBox = base({ elements: [{ id: 'bx', type: 'box', slot: 'A1:C3' }, { id: 'by', type: 'box', slot: 'B2' }] });
  assert.equal((await v(boxInBox)).ok, true);
  const boxOverText = base({ elements: [txt('t', 'B1'), { id: 'bx', type: 'box', slot: 'A1:C2' }] });
  assert.equal((await v(boxOverText)).ok, true, 'box drawn after the text still contains it');
});

test('region: arrows and highlights are exempt from containment but must resolve; slotted elements must be inside', async () => {
  let occ = applyScene(createOccupancy(), base({ elements: [txt('old', 'A1:B1'), { id: 'oc', type: 'code', slot: 'C1', lines: ['a', 'b', 'c'] }] }));
  const ok = base({ sceneId: 's002', board: { mode: 'region', slots: 'D1:F2' }, elements: [txt('new', 'D1:E1'), { id: 'ar', type: 'arrow', from: 'old', to: 'new' }, { id: 'hl', type: 'highlight', target: 'oc', line: 3 }] });
  const r = await v(ok, occ);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(toJSON(r.occupancy).cells, ['A1', 'B1', 'C1', 'D1', 'E1']);
  assert.ok(r.occupancy.elements.has('ar') && r.occupancy.elements.has('old'));
  const outside = base({ sceneId: 's002', board: { mode: 'region', slots: 'D1:F2' }, elements: [txt('new', 'C2:D2')] });
  assert.deepEqual(await codes(outside, occ), ['OUT_OF_REGION']);
  const clash = base({ sceneId: 's002', board: { mode: 'region', slots: 'B1:D2' }, elements: [txt('new', 'D1')] });
  assert.deepEqual(await codes(clash, occ), ['REGION_OCCUPIED']);
  const dup = base({ sceneId: 's002', board: { mode: 'region', slots: 'D1:F2' }, elements: [txt('old', 'D1')] });
  assert.deepEqual(await codes(dup, occ), ['DUP_ID']);
  const badLine = base({ sceneId: 's002', board: { mode: 'region', slots: 'D1:F2' }, elements: [{ id: 'hl', type: 'highlight', target: 'oc', line: 4 }] });
  assert.deepEqual(await codes(badLine, occ), ['BAD_LINE']);
});

test('cross-scene BAD_REF: an id from before a wipe is gone', async () => {
  let occ = applyScene(createOccupancy(), base({ elements: [txt('old', 'A1:B1')] }));
  occ = (await v(base({ sceneId: 's002', board: { mode: 'wipe' }, elements: [txt('fresh', 'A1')] }), occ)).occupancy;
  assert.equal(occ.elements.has('old'), false);
  const r = await v(base({ sceneId: 's003', board: { mode: 'region', slots: 'C1:D1' }, elements: [{ id: 'ar', type: 'arrow', from: 'fresh', to: 'old' }] }), occ);
  assert.deepEqual(codesOf(r.errors), ['BAD_REF']);
  // after a wipe the id may be reused
  const reuse = await v(base({ sceneId: 's003', board: { mode: 'wipe' }, elements: [txt('old', 'A1')] }), occ);
  assert.equal(reuse.ok, true);
});

test('a shape fault on one element does not cascade into layout codes for it', async () => {
  const r = await v(base({ elements: [txt('a', 'ZZ9'), txt('b', 'A1:B1')] }));
  assert.deepEqual(codesOf(r.errors), ['BAD_SLOT']);
  assert.deepEqual(r.errors.map((e) => e.elementId), ['a']);
});

test('validateOutline', () => {
  const good = { schema: 'khan-outline/1', lessonId: LESSON, title: 'T', scenes: [{ sceneId: 's001', title: 'a' }, { sceneId: 's002', title: 'b' }, { sceneId: 's003', title: 'c' }] };
  assert.equal(validateOutline(good, { lessonId: LESSON }).ok, true);
  assert.deepEqual(codesOf(validateOutline({ ...good, scenes: good.scenes.slice(0, 2) }).errors), ['CAP_COUNT']);
  assert.deepEqual(codesOf(validateOutline({ ...good, lessonId: 'other-lesson' }, { lessonId: LESSON }).errors), ['BAD_LESSON_ID']);
  assert.deepEqual(codesOf(validateOutline({ ...good, scenes: [...good.scenes, { sceneId: 's001', title: 'dup' }] }).errors), ['DUP_ID']);
  assert.deepEqual(codesOf(validateOutline({ ...good, schema: 'x' }).errors), ['BAD_SCHEMA']);
  assert.deepEqual(codesOf(validateOutline(null).errors), ['BAD_SCHEMA']);
});
