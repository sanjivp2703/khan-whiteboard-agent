// cli/lesson.js — shared helpers: resolve the lessons dir, read the inbox, poll the playlist.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REGEX } from '../shared/layout-core/constants.js';
import { CliError } from './output.js';
import { get, sleep } from './http.js';
import { defaultLessonsDir } from './paths.js';

export function checkLessonId(id) {
  if (typeof id !== 'string' || !REGEX.lessonId.test(id)) throw new CliError('BAD_LESSON_ID', `lessonId "${id}" must match ^[a-z0-9-]{8,64}$`);
  return id;
}

export function checkSceneId(id) {
  if (typeof id !== 'string' || !REGEX.sceneId.test(id)) throw new CliError('BAD_SCENE_ID', `sceneId "${id}" must be s001… (lesson) or q001-a01… (answer)`);
  return id;
}

/** --lessons-dir > the running server's lessonsDir > KHAN_LESSONS_DIR > <KHAN_HOME>/lessons */
export function resolveLessonsDir(env, flags, running) {
  if (flags['lessons-dir']) return resolve(flags['lessons-dir']);
  if (running && running.lessonsDir) return resolve(running.lessonsDir);
  return defaultLessonsDir(env);
}

export function lessonDir(lessonsDir, lessonId) { return join(lessonsDir, lessonId); }

export function requireLessonFolder(lessonsDir, lessonId) {
  const dir = lessonDir(lessonsDir, lessonId);
  if (!existsSync(join(dir, 'outline.json'))) throw new CliError('NO_LESSON', `no lesson "${lessonId}" under ${lessonsDir} (write it with "khan outline" first)`);
  return dir;
}

/** control/inbox.json → {pending, questions, rejects, notices, readyAhead}; zeros when unreadable. */
export function readInboxSummary(dir) {
  const path = join(dir, 'control', 'inbox.json');
  let inbox = null;
  try { inbox = JSON.parse(readFileSync(path, 'utf8')); } catch { /* missing or mid-rewrite */ }
  const pending = Array.isArray(inbox && inbox.pending) ? inbox.pending : [];
  return {
    pending: pending.length,
    questions: pending.filter((p) => p && p.kind === 'question').length,
    rejects: pending.filter((p) => p && p.kind === 'reject').length,
    notices: Array.isArray(inbox && inbox.notices) ? inbox.notices : [],
    readyAhead: inbox && inbox.buffer && Number.isInteger(inbox.buffer.readyAhead) ? inbox.buffer.readyAhead : null,
  };
}

/** Poll until pred(playlist) is truthy or the deadline passes; returns the last playlist (or null). */
export async function pollPlaylist(baseUrl, lessonId, pred, { timeoutMs = 3000, everyMs = 100 } = {}) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    const r = await get(`${baseUrl}/api/lesson/${lessonId}/playlist`, { timeoutMs: 2000 });
    if (r.status === 200 && r.body && typeof r.body === 'object') {
      last = r.body;
      if (pred(last)) return { playlist: last, waitedMs: Date.now() - t0, done: true };
    }
    if (Date.now() - t0 >= timeoutMs) return { playlist: last, waitedMs: Date.now() - t0, done: false };
    await sleep(everyMs);
  }
}

/** Wait until the server knows the lesson's outline (GET /outline → 200). */
export async function waitForOutline(baseUrl, lessonId, { timeoutMs = 3000, everyMs = 100 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const r = await get(`${baseUrl}/api/lesson/${lessonId}/outline`, { timeoutMs: 2000 });
    if (r.status === 200) return true;
    if (Date.now() - t0 >= timeoutMs) return false;
    await sleep(everyMs);
  }
}
