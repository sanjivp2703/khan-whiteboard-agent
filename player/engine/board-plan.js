// player/engine/board-plan.js — deterministic "board at (sceneId, t)" planner (spec §7 rewind
// and resume; brief 04 items 10–11). Pure, DOM-free.
//
// planBoardAt(entries, scenesById, sceneId, t) → { ids: [{id, u, sceneId}], trackIds, wipeIndex }
//   • the board history of a scene is its track (lesson scenes, or the answer scenes of the
//     same question) since the last wipe — the same rule the server validator and the harness use;
//   • every earlier scene's element is painted complete (u = 1);
//   • of the target scene, elements whose start (at × D) is strictly before t are complete and
//     the rest are absent (they draw live once playback resumes).
// Degraded scenes arrive as effective scenes (dropped elements already removed), so they need
// no special handling here; answer scenes never appear on the lesson board and vice versa.
import { kindOfScene, trackScenes } from '../harness-track.js';
import { resolveTiming } from '../../shared/layout-core/timing.js';

export { kindOfScene, trackScenes };

/** Scenes of the target's track since its last wipe, oldest first (missing scenes skipped). */
export function boardHistory(entries, scenesById, sceneId) {
  const trackIds = trackScenes(entries || [], sceneId);
  const scenes = [];
  for (const id of trackIds) {
    const scene = scenesById && (typeof scenesById.get === 'function' ? scenesById.get(id) : scenesById[id]);
    if (scene) scenes.push(scene);
    else if (id === sceneId) scenes.push(null); // target not loaded: plan the earlier board only
  }
  let wipeIndex = 0;
  for (let i = scenes.length - 1; i >= 0; i--) {
    const s = scenes[i];
    if (s && s.board && s.board.mode === 'wipe') { wipeIndex = i; break; }
  }
  return { trackIds, scenes, wipeIndex };
}

/**
 * @param {Array<{sceneId:string, durationMs?:number}>} entries playlist entries in order
 * @param {Map<string, object>|object} scenesById effective scenes
 * @param {string} sceneId target scene
 * @param {number} t seconds into the target scene
 * @param {{durationMs?:number}} [opts] override the target's duration (else the playlist entry's)
 */
export function planBoardAt(entries, scenesById, sceneId, t = 0, opts = {}) {
  const { trackIds, scenes, wipeIndex } = boardHistory(entries, scenesById, sceneId);
  const ids = [];
  const targetIndex = scenes.length - 1;
  for (let i = wipeIndex; i < targetIndex; i++) {
    const s = scenes[i];
    if (!s) continue;
    for (const el of s.elements || []) ids.push({ id: el.id, u: 1, sceneId: s.sceneId });
  }
  const target = scenes[targetIndex];
  if (target) {
    const entry = (entries || []).find((e) => e.sceneId === sceneId);
    const D = Number.isFinite(opts.durationMs) ? opts.durationMs : (entry && Number.isFinite(entry.durationMs) ? entry.durationMs : 0);
    const tMs = Math.max(0, (Number.isFinite(t) ? t : 0) * 1000);
    const windows = resolveTiming(target);
    (target.elements || []).forEach((el, i) => {
      const start = windows[i].at * D;
      if (start < tMs) ids.push({ id: el.id, u: 1, sceneId: target.sceneId });
    });
  }
  return { ids, trackIds, wipeIndex, historyScenes: scenes.slice(wipeIndex, targetIndex).filter(Boolean) };
}

/**
 * The playlist entry that plays after `afterSceneId` on the lesson track (spec §7 step 5 and the
 * rewind rule). Lesson scenes always follow in playlist order. Answer scenes sit after their
 * `insertAfter` scene for replay purposes, so they play in position EXCEPT when they already
 * played in the current pass (the live question flow: the answer ran, the interrupted scene
 * resumed and ended — the lesson must continue with the next lesson scene, not replay the
 * answer). A manual rewind/skip starts a new pass, so answers replay in position after it.
 * @param {Array<{sceneId:string}>} entries playlist entries in order
 * @param {string|null} afterSceneId the scene that just completed (null → the first entry)
 * @param {Set<string>|Iterable<string>} [playedThisPass] sceneIds completed since the last manual jump
 * @returns {object|null} the next entry, or null when nothing (unplayed) follows
 */
export function nextEntryAfter(entries, afterSceneId, playedThisPass = new Set()) {
  const list = entries || [];
  const played = playedThisPass instanceof Set ? playedThisPass : new Set(playedThisPass || []);
  let idx = afterSceneId == null ? -1 : list.findIndex((e) => e.sceneId === afterSceneId);
  if (afterSceneId != null && idx < 0) return null;
  for (idx += 1; idx < list.length; idx++) {
    const e = list[idx];
    if (kindOfScene(e.sceneId) === 'answer' && played.has(e.sceneId)) continue;
    return e;
  }
  return null;
}

/** Ids of every element on the board at the START of `sceneId` (its history only). */
export function boardIdsBefore(entries, scenesById, sceneId) {
  return planBoardAt(entries, scenesById, sceneId, 0).ids.filter((x) => x.sceneId !== sceneId).map((x) => x.id);
}

/** Count `svg` elements across a set of effective scenes (end-summary helper). */
export function countSvgElements(scenes) {
  let n = 0;
  for (const s of scenes) for (const el of (s && s.elements) || []) if (el.type === 'svg') n++;
  return n;
}
