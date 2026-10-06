// server/playlist.js — pure playlist logic: ordering (spec §4.1), `ended`, buffer depth, snapshot.
import { REGEX } from '../shared/layout-core/constants.js';

export function kindOf(sceneId) {
  return REGEX.answerSceneId.test(sceneId) ? 'answer' : 'lesson';
}

const num = (s) => Number(s.replace(/\D/g, '')) || 0;
const lessonNum = (id) => Number(id.slice(1));
const qOf = (id) => id.slice(0, 4);
const aNum = (id) => Number(id.slice(6));

/**
 * Order playlist entries: lesson scenes by number; each question's answer scenes immediately
 * after their `insertAfter` scene, grouped by qId (questions in id order), a01, a02… — and
 * nested answers after the answer scene they interrupt. Orphans (insertAfter not present)
 * go at the end in qId order.
 * @param {Array<{sceneId:string, insertAfter?:string|null}>} entries
 */
export function orderEntries(entries) {
  const byId = new Map(entries.map((e) => [e.sceneId, e]));
  const lesson = entries.filter((e) => kindOf(e.sceneId) === 'lesson').sort((a, b) => lessonNum(a.sceneId) - lessonNum(b.sceneId));
  const answers = entries.filter((e) => kindOf(e.sceneId) === 'answer');
  const groups = new Map(); // insertAfter → Map<qId, entries[]>
  for (const a of answers) {
    const parent = a.insertAfter && byId.has(a.insertAfter) ? a.insertAfter : null;
    if (!groups.has(parent)) groups.set(parent, new Map());
    const g = groups.get(parent);
    const q = qOf(a.sceneId);
    if (!g.has(q)) g.set(q, []);
    g.get(q).push(a);
  }
  const out = [];
  const seen = new Set();
  const emit = (entry) => {
    if (seen.has(entry.sceneId)) return;
    seen.add(entry.sceneId);
    out.push(entry);
    const g = groups.get(entry.sceneId);
    if (!g) return;
    for (const q of [...g.keys()].sort((a, b) => num(a) - num(b))) {
      for (const a of g.get(q).sort((x, y) => aNum(x.sceneId) - aNum(y.sceneId))) emit(a);
    }
  };
  for (const l of lesson) emit(l);
  const orphans = groups.get(null);
  if (orphans) for (const q of [...orphans.keys()].sort((a, b) => num(a) - num(b))) for (const a of orphans.get(q).sort((x, y) => aNum(x.sceneId) - aNum(y.sceneId))) emit(a);
  // anything still unseen (cycles) at the end
  for (const e of entries) emit(e);
  return out;
}

/** Last lesson scene present (by number) or null. */
export function lastLessonEntry(ordered) {
  const lesson = ordered.filter((e) => kindOf(e.sceneId) === 'lesson');
  return lesson.length ? lesson[lesson.length - 1] : null;
}

/**
 * ended = player reported `end` for the last playlist entry AND the last lesson scene present is
 * final AND every question has a final answer scene present.
 */
export function deriveEnded({ ordered, lastEndSceneId, questions }) {
  if (!ordered.length || !lastEndSceneId) return false;
  if (ordered[ordered.length - 1].sceneId !== lastEndSceneId) return false;
  const last = lastLessonEntry(ordered);
  if (!last || !last.final) return false;
  for (const q of questions) if (!q.complete) return false;
  return true;
}

/** Ready entries after the player's last `start` position (all ready entries before any start). */
export function readyAhead(ordered, lastStartSceneId) {
  let from = 0;
  if (lastStartSceneId) {
    const idx = ordered.findIndex((e) => e.sceneId === lastStartSceneId);
    if (idx >= 0) from = idx + 1;
  }
  let n = 0;
  for (let i = from; i < ordered.length; i++) if (ordered[i].status === 'ready') n++;
  return n;
}

export const STATUSES = Object.freeze(['pending', 'validating', 'voicing', 'ready', 'rejected', 'degraded']);
