// shared/schema/validate.js — the single owner of element-level validation (spec §5).
//
//   await validateScene(scene, occupancySet, {lessonId})
//     → { ok, errors: [{elementId|null, code, message}], occupancy: newOccupancySet, effective: scene, artifacts }
//
// Pipeline: shape → content → layout. Elements that fail an earlier stage are skipped by later
// stages so one fault yields one code. Deterministic; no randomness. `occupancy` is the input
// set when the scene is not ok. The handwriting font must be loaded (shared/handwriting.js)
// before text/list/table measurement — call `await prepareValidator()` once.
import { createOccupancy, applyScene, fromJSON } from '../layout-core/occupancy.js';
import { loadFont, isFontLoaded } from '../handwriting.js';
import { ready as mathReady } from '../math.js';
import { REGEX, SCHEMA_OUTLINE, CAPS } from '../layout-core/constants.js';
import { checkShape } from './shape.js';
import { checkContent } from './content.js';
import { checkLayout } from './layout.js';
import { err, badElementIds } from './errors.js';

export { ERROR_CODES, codesOf, badElementIds } from './errors.js';

/** Load the font (and warm up MathJax) so validation is synchronous-fast afterwards. */
export async function prepareValidator({ font = true, math = true } = {}) {
  if (font && !isFontLoaded()) await loadFont();
  if (math) await mathReady();
}

function toOccupancy(occ) {
  if (!occ) return createOccupancy();
  if (occ.cells instanceof Set && occ.elements instanceof Map) return occ;
  return fromJSON(occ);
}

/**
 * Validate one scene against the board occupancy.
 * @param {any} scene parsed JSON (anything; non-objects yield BAD_SCHEMA)
 * @param {import('../layout-core/occupancy.js').Occupancy|object} occupancySet
 * @param {{lessonId?: string}} [opts]
 */
export async function validateScene(scene, occupancySet, opts = {}) {
  const occupancy = toOccupancy(occupancySet);
  if (!isFontLoaded()) await loadFont();
  const shape = checkShape(scene, opts);
  if (shape.fatal) return { ok: false, errors: shape.errors, occupancy, effective: null, artifacts: new Map() };
  const skip = new Set(shape.badIds);
  const content = await checkContent(scene, skip);
  for (const id of badElementIds(content.errors)) skip.add(id);
  const layout = checkLayout(scene, occupancy, skip, content.artifacts);
  const errors = [...shape.errors, ...content.errors, ...layout.errors];
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    occupancy: ok ? applyScene(occupancy, scene) : occupancy,
    effective: ok ? scene : null,
    artifacts: content.artifacts,
  };
}

/** Parse JSON text then validate; a parse failure is a single BAD_JSON error. */
export async function validateSceneText(text, occupancySet, opts = {}) {
  let scene;
  try { scene = JSON.parse(text); } catch (e) {
    return { ok: false, errors: [err(null, 'BAD_JSON', `scene is not valid JSON: ${e.message}`)], occupancy: toOccupancy(occupancySet), effective: null, artifacts: new Map() };
  }
  return validateScene(scene, occupancySet, opts);
}

/** New scene object without the given element ids (used by the degrade path). */
export function dropElements(scene, ids) {
  const drop = new Set(ids);
  return { ...scene, elements: (scene.elements || []).filter((el, i) => !(el && drop.has(el.id)) && !drop.has(`#${i}`)) };
}

/** Validate outline.json: { ok, errors }. */
export function validateOutline(outline, opts = {}) {
  const errors = [];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(outline)) return { ok: false, errors: [err(null, 'BAD_SCHEMA', 'outline must be a JSON object')] };
  if (outline.schema !== SCHEMA_OUTLINE) errors.push(err(null, 'BAD_SCHEMA', `schema must be "${SCHEMA_OUTLINE}"`));
  if (typeof outline.lessonId !== 'string' || !REGEX.lessonId.test(outline.lessonId)) errors.push(err(null, 'BAD_LESSON_ID', 'lessonId must match the lessonId pattern'));
  else if (opts.lessonId && outline.lessonId !== opts.lessonId) errors.push(err(null, 'BAD_LESSON_ID', `lessonId "${outline.lessonId}" does not match the folder "${opts.lessonId}"`));
  if (typeof outline.title !== 'string' || !outline.title.trim()) errors.push(err(null, 'MISSING_FIELD', 'title must be a non-empty string'));
  if (!Array.isArray(outline.scenes)) errors.push(err(null, 'MISSING_FIELD', 'scenes must be an array'));
  else {
    if (outline.scenes.length < CAPS.outlineScenesMin || outline.scenes.length > CAPS.outlineScenesMax) errors.push(err(null, 'CAP_COUNT', `outline has ${outline.scenes.length} scenes; allowed ${CAPS.outlineScenesMin}–${CAPS.outlineScenesMax}`));
    const seen = new Set();
    outline.scenes.forEach((s, i) => {
      if (!isObj(s)) { errors.push(err(null, 'BAD_FIELD', `scenes[${i}] must be an object`)); return; }
      if (typeof s.sceneId !== 'string' || !REGEX.lessonSceneId.test(s.sceneId)) errors.push(err(null, 'BAD_SCENE_ID', `scenes[${i}].sceneId must match s\\d{3}`));
      else if (seen.has(s.sceneId)) errors.push(err(null, 'DUP_ID', `scenes[${i}].sceneId "${s.sceneId}" repeats`));
      else seen.add(s.sceneId);
      if (typeof s.title !== 'string') errors.push(err(null, 'MISSING_FIELD', `scenes[${i}].title must be a string`));
    });
  }
  return { ok: errors.length === 0, errors };
}
