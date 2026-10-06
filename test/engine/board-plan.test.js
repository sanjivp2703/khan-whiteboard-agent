import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { planBoardAt, boardIdsBefore, boardHistory, countSvgElements, nextEntryAfter } from '../../player/engine/board-plan.js';
import { FIXTURES } from '../foundation/helpers/fixtures.js';

const ids = (plan) => plan.ids.map((x) => x.id);
const allOnes = (plan) => plan.ids.every((x) => x.u === 1);

function loadLesson(name, group = 'lessons') {
  const dir = join(FIXTURES, group, name, 'scenes');
  const scenes = new Map();
  for (const f of readdirSync(dir).sort()) { const s = JSON.parse(readFileSync(join(dir, f), 'utf8')); scenes.set(s.sceneId, s); }
  return scenes;
}
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const entriesFor = (scenes, order) => order.map((sceneId, position) => ({ sceneId, position, durationMs: Math.max(1500, Math.round((words(scenes.get(sceneId).narration) / 150) * 60000)) }));

test('boardPlan: first scene, t=0 → empty; mid-scene → elements with start < t; past last → all', () => {
  const scenes = loadLesson('fx-build-region');
  const entries = entriesFor(scenes, ['s001', 's002', 's003', 's004']);
  // s001: title (at 0), cache (at 0.425); D = 11600
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', 0)), []);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', 0.001)), ['title']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', 4.93)), ['title']); // 0.425 × 11.6 = 4.93 exactly: start < t is strict
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', 4.931)), ['title', 'cache']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', 999)), ['title', 'cache']);
  assert.ok(allOnes(planBoardAt(entries, scenes, 's001', 999)));
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', -5)), []);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's001', NaN)), []);
});

test('boardPlan: mid-region scenes carry the whole board since the last wipe; after a wipe the board is empty', () => {
  const scenes = loadLesson('fx-build-region');
  const entries = entriesFor(scenes, ['s001', 's002', 's003', 's004']);
  // start of s002: everything of s001
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's002', 0)), ['title', 'cache']);
  assert.deepEqual(boardIdsBefore(entries, scenes, 's002'), ['title', 'cache']);
  // s002 at t: client (at 0.1 → 1.28 s), serve (0.6 → 7.68 s)
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's002', 1.3)), ['title', 'cache', 'client']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's002', 8)), ['title', 'cache', 'client', 'serve']);
  // start of s003: s001 + s002 complete (criterion 8's expected set)
  assert.deepEqual(boardIdsBefore(entries, scenes, 's003'), ['title', 'cache', 'client', 'serve']);
  const p3 = planBoardAt(entries, scenes, 's003', 5);
  assert.deepEqual(ids(p3), ['title', 'cache', 'client', 'serve', 'steps']);
  assert.deepEqual(p3.ids.map((x) => x.sceneId), ['s001', 's001', 's002', 's002', 's003']);
  assert.equal(p3.wipeIndex, 0);
  // s004 is a wipe: nothing before its first element, which reuses the id "title"
  assert.deepEqual(boardIdsBefore(entries, scenes, 's004'), []);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's004', 0)), []);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's004', 1)), ['title']);
  assert.equal(planBoardAt(entries, scenes, 's004', 1).wipeIndex, 3);
  // explicit duration override
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's002', 0.5, { durationMs: 1000 })), ['title', 'cache', 'client']);
});

test('boardPlan: degraded scene — dropped elements are simply absent from the effective scene', () => {
  const scenes = loadLesson('fx-degrade-flow', 'degrade');
  const s2 = scenes.get('s002');
  const effective = { ...s2, elements: s2.elements.filter((e) => e.id !== 'bad') };
  scenes.set('s002', effective);
  const entries = entriesFor(scenes, ['s001', 's002', 's003']);
  const plan = planBoardAt(entries, scenes, 's002', 999);
  assert.deepEqual(ids(plan), ['good', 'note']);
  // narration-only degradation (elements: []) draws nothing of its own but keeps the earlier board on a region
  scenes.set('s002', { ...s2, board: { mode: 'region', slots: 'F4' }, elements: [] });
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's002', 999)), ['ok1']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's003', 999)), ['ok3']);
});

test('boardPlan: answer scenes live on their own track and never on the lesson board', () => {
  const scenes = loadLesson('fx-answer-insert');
  const order = ['s001', 's002', 'q001-a01', 'q002-a01', 'q001-a02', 's003', 's004'];
  const entries = entriesFor(scenes, order);
  // lesson board at s003 ignores the inserted answers (every lesson scene here is a wipe anyway)
  assert.deepEqual(boardHistory(entries, scenes, 's003').trackIds, ['s001', 's002', 's003']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 's003', 999)), ['t3']);
  // answer board: q001-a02 (region) builds on q001-a01 (wipe) and excludes q002 and the lesson
  assert.deepEqual(boardHistory(entries, scenes, 'q001-a02').trackIds, ['q001-a01', 'q001-a02']);
  assert.deepEqual(boardIdsBefore(entries, scenes, 'q001-a02'), ['a1']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 'q001-a02', 999)), ['a1', 'a2']);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 'q002-a01', 0)), []);
  assert.deepEqual(ids(planBoardAt(entries, scenes, 'q002-a01', 5)), ['b1']);
  // resuming s002 at t = 3 after the answers: only s002's started elements, nothing from q001/q002
  const resume = planBoardAt(entries, scenes, 's002', 3);
  assert.deepEqual(ids(resume), ['t2']);
  assert.ok(!ids(resume).some((id) => ['a1', 'a2', 'b1'].includes(id)));
  // a region lesson scene after answers still sees only lesson scenes
  const region = new Map(scenes);
  region.set('s003', { ...scenes.get('s003'), board: { mode: 'region', slots: 'A2:C2' }, elements: [{ id: 't3', type: 'text', slot: 'A2:C2', text: 'x' }] });
  assert.deepEqual(boardIdsBefore(entries, region, 's003'), ['t2']);
});

test('boardPlan: target not loaded yet plans the earlier board only; svg counter', () => {
  const scenes = loadLesson('fx-build-region');
  const entries = entriesFor(scenes, ['s001', 's002', 's003', 's004']);
  const partial = new Map(scenes); partial.delete('s003');
  assert.deepEqual(ids(planBoardAt(entries, partial, 's003', 5)), ['title', 'cache', 'client', 'serve']);
  assert.deepEqual(ids(planBoardAt([], new Map(), 's009', 5)), []);
  const tour = loadLesson('fx-full-tour');
  assert.equal(countSvgElements([...tour.values()]), 1);
  assert.equal(countSvgElements([null, { elements: [{ type: 'svg' }, { type: 'svg' }, { type: 'text' }] }]), 2);
});

test('nextEntryAfter: lesson order; answer scenes in position unless already played this pass; a manual jump starts a new pass (QA finding 1)', () => {
  const order = ['s001', 's002', 'q001-a01', 'q002-a01', 'q003-a01', 'q001-a02', 's003', 's004'];
  const entries = order.map((sceneId, position) => ({ sceneId, position }));
  const id = (e) => (e ? e.sceneId : null);
  assert.equal(id(nextEntryAfter(entries, null)), 's001');
  assert.equal(id(nextEntryAfter(entries, 's001')), 's002');
  // a fresh pass (after a rewind): answers replay in position, in playlist order
  assert.equal(id(nextEntryAfter(entries, 's002')), 'q001-a01');
  assert.equal(id(nextEntryAfter(entries, 'q001-a01')), 'q002-a01');
  assert.equal(id(nextEntryAfter(entries, 'q003-a01')), 'q001-a02');
  assert.equal(id(nextEntryAfter(entries, 'q001-a02')), 's003');
  // the live flow: every answer already played in this pass → the next LESSON scene, no replay
  const pass = new Set(['s001', 'q001-a01', 'q002-a01', 'q003-a01', 'q001-a02', 's002']);
  assert.equal(id(nextEntryAfter(entries, 's002', pass)), 's003');
  // partially played (the user jumped away before the rest arrived): unplayed answers still play in position
  assert.equal(id(nextEntryAfter(entries, 's002', new Set(['q001-a01']))), 'q002-a01');
  assert.equal(id(nextEntryAfter(entries, 'q002-a01', new Set(['q001-a01', 'q003-a01']))), 'q001-a02');
  // lesson scenes are never skipped, even when already played (a rewound lesson replays its scenes)
  assert.equal(id(nextEntryAfter(entries, 's003', new Set(['s004']))), 's004');
  // end of the list, unknown scene, empty playlist
  assert.equal(nextEntryAfter(entries, 's004'), null);
  assert.equal(nextEntryAfter(entries, 'zzz'), null);
  assert.equal(nextEntryAfter([], null), null);
  // only already-played answers remain → nothing to play (the engine then stalls or ends per `final`)
  assert.equal(nextEntryAfter(entries.slice(0, 6), 's002', pass), null);
  // any iterable works for the pass set
  assert.equal(id(nextEntryAfter(entries, 's002', ['q001-a01', 'q002-a01', 'q003-a01', 'q001-a02'])), 's003');
  // the input is not mutated
  assert.deepEqual(entries.map(id), order);
});
