// player/harness-track.js — which scenes form the board history of a scene (Node-testable).
// Lesson scenes: every lesson scene before it in playlist order. Answer scenes: the answer
// scenes of the same question up to it (the first answer scene is always a wipe).
import { REGEX } from '../shared/layout-core/constants.js';

export function kindOfScene(sceneId) {
  return REGEX.answerSceneId.test(sceneId) ? 'answer' : 'lesson';
}

/** @param {Array<{sceneId:string}>} entries playlist entries in order @returns {string[]} sceneIds up to and including target */
export function trackScenes(entries, targetId) {
  const ids = entries.map((e) => e.sceneId);
  const kind = kindOfScene(targetId);
  const out = [];
  for (const id of ids) {
    if (kind === 'lesson' && kindOfScene(id) !== 'lesson') continue;
    if (kind === 'answer' && !(kindOfScene(id) === 'answer' && id.slice(0, 4) === targetId.slice(0, 4))) continue;
    out.push(id);
    if (id === targetId) break;
  }
  if (!out.includes(targetId)) out.push(targetId);
  return out;
}
