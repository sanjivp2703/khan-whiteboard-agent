// Shared helpers for the renderer-core (slice 02) unit tests: font + MathJax warm-up, fixture
// scenes with the foundation's DrawCtx, a recording fake 2D context, and reveal probes.
import { loadFont } from '../../shared/handwriting.js';
import { makeDrawCtx } from '../../player/registry.js';
import { slotRect, rectContainsRect } from '../../shared/layout-core/grid.js';
import { seedFor } from '../../shared/strokes.js';
import { kindOfScene } from '../../player/harness-track.js';
import { listFixtureLessons, loadScenes, readJSON } from '../foundation/helpers/fixtures.js';
import * as core from '../../player/renderer/core/index.js';
import { join } from 'node:path';

export { core, listFixtureLessons, loadScenes, readJSON, slotRect, rectContainsRect, makeDrawCtx };

export const CORE_TYPES = core.CORE_TYPES;
export const BOARD = { x: 0, y: 0, w: 1600, h: 900 };
export const LESSON = 'fx-unit-core';
export const NARR = 'This narration is long enough to clear the fifteen word minimum and short enough to stay well under the ninety word cap.';

let warmed = false;
/** Load the font and initialise MathJax once per process. */
export async function setup() {
  if (warmed) return;
  await loadFont();
  await core.ready();
  warmed = true;
}

export function scene(sceneId, mode, elements, slots) {
  return { schema: 'khan-scene/1', lessonId: LESSON, sceneId, title: sceneId, narration: NARR, board: slots ? { mode, slots } : { mode }, elements, final: false };
}

/** Lesson-track scenes of a fixture lesson (answer scenes excluded, as in the harness). */
export function lessonScenes(lessonDir) {
  return loadScenes(lessonDir).map((s) => s.scene).filter((s) => kindOfScene(s.sceneId) === 'lesson');
}

export function fixtureScenes(lessonId) {
  const l = listFixtureLessons().find((x) => x.lessonId === lessonId);
  if (!l) throw new Error(`fixture lesson ${lessonId} not found`);
  return lessonScenes(l.dir);
}

export function fixtureElement(lessonId, sceneId, elementId) {
  const scenes = fixtureScenes(lessonId);
  const index = scenes.findIndex((s) => s.sceneId === sceneId);
  const el = scenes[index].elements.find((e) => e.id === elementId);
  return { scenes, index, el, ctx: makeDrawCtx(scenes, index) };
}

/** Prepare every core element of a fixture lesson (after warming math). */
export async function prepareLesson(lessonId, { seed } = {}) {
  const scenes = fixtureScenes(lessonId);
  await core.warm(scenes);
  const out = [];
  scenes.forEach((s, i) => {
    const ctx = makeDrawCtx(scenes, i);
    if (seed) ctx.seed = seed;
    for (const el of s.elements) {
      if (!CORE_TYPES.includes(el.type)) continue;
      out.push({ lessonId, sceneId: s.sceneId, el, ctx, drawable: core.prepares[el.type](el, ctx) });
    }
  });
  return out;
}

/** A DrawCtx with a different seed function (same ids → different rough paths). */
export function reseed(ctx, salt = 'alt') {
  return { ...ctx, seed: (id) => seedFor(`${salt}:${id}`) };
}

export function prepare(el, ctx) {
  return core.prepares[el.type](el, ctx);
}

export function containerOf(el) {
  return el.slot ? slotRect(el.slot) : BOARD;
}

/** Fully drawn stroke count at u (uses the drawable's own reveal mapping). */
export function completeCount(d, u) {
  return d.progress(u).completeCount;
}

/** Counts of calls to a fake 2D context, plus every property set. */
export function fakeCtx2d() {
  const calls = {};
  const sets = {};
  const ctx = new Proxy({}, {
    get(_, k) {
      if (typeof k !== 'string') return undefined;
      return (...args) => { calls[k] = (calls[k] || 0) + 1; if (k === 'getImageData') return { data: new Uint8ClampedArray(4) }; return undefined; };
    },
    set(_, k, v) { sets[k] = v; return true; },
  });
  return { ctx, calls, sets };
}

export const fixturesRoot = join(new URL('../../', import.meta.url).pathname, 'fixtures');
