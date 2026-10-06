// Shared test helpers for fixture lessons (foundation and later slices may import this).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateScene } from '../../../shared/schema/validate.js';
import { createOccupancy, fromJSON } from '../../../shared/layout-core/occupancy.js';

export const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
export const FIXTURES = join(REPO_ROOT, 'fixtures');

/** Lesson directories under fixtures/lessons (and fixtures/degrade when includeDegrade). */
export function listFixtureLessons({ includeDegrade = false } = {}) {
  const dirs = ['lessons', ...(includeDegrade ? ['degrade'] : [])];
  const out = [];
  for (const d of dirs) {
    const base = join(FIXTURES, d);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const full = join(base, name);
      if (statSync(full).isDirectory() && existsSync(join(full, 'outline.json'))) out.push({ lessonId: name, dir: full, group: d });
    }
  }
  return out;
}

export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Scenes of a lesson folder in file order: [{file, scene}]. */
export function loadScenes(lessonDir) {
  const scenesDir = join(lessonDir, 'scenes');
  return readdirSync(scenesDir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, scene: readJSON(join(scenesDir, f)) }));
}

/**
 * Validate every scene of a lesson with the occupancy chain the server uses
 * (lesson scenes by number; each question's answer scenes chained from a01).
 * @returns {Promise<Array<{file, scene, result, ms}>>}
 */
export async function validateLesson(lessonDir, lessonId) {
  const chains = { lesson: createOccupancy() };
  const out = [];
  for (const { file, scene } of loadScenes(lessonDir)) {
    const key = typeof scene.sceneId === 'string' && scene.sceneId.startsWith('q') ? scene.sceneId.slice(0, 4) : 'lesson';
    if (!chains[key]) chains[key] = createOccupancy();
    const t0 = performance.now();
    const result = await validateScene(scene, chains[key], { lessonId });
    const ms = performance.now() - t0;
    chains[key] = result.occupancy;
    out.push({ file, scene, result, ms });
  }
  return out;
}

/** Invalid fixtures: [{name, scene, expected, occupancy}]. */
export function listInvalidFixtures() {
  const dir = join(FIXTURES, 'invalid');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json') && !f.endsWith('.occupancy.json'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.json$/, '');
      const occPath = join(dir, `${name}.occupancy.json`);
      return {
        name,
        scene: readJSON(join(dir, f)),
        expected: readJSON(join(dir, `${name}.expected.json`)),
        occupancy: existsSync(occPath) ? fromJSON(readJSON(occPath)) : createOccupancy(),
      };
    });
}
