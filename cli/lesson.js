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

/** Parse control/inbox.json, or null when missing / mid-rewrite. */
export function readInbox(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'control', 'inbox.json'), 'utf8')); } catch { return null; }
}

/** inbox object → {pending, questions, rejects, notices, readyAhead}; zeros when null. */
export function summarizeInbox(inbox) {
  const pending = Array.isArray(inbox && inbox.pending) ? inbox.pending : [];
  return {
    pending: pending.length,
    questions: pending.filter((p) => p && p.kind === 'question').length,
    rejects: pending.filter((p) => p && p.kind === 'reject').length,
    notices: Array.isArray(inbox && inbox.notices) ? inbox.notices : [],
    readyAhead: inbox && inbox.buffer && Number.isInteger(inbox.buffer.readyAhead) ? inbox.buffer.readyAhead : null,
  };
}

/** control/inbox.json → {pending, questions, rejects, notices, readyAhead}; zeros when unreadable. */
export function readInboxSummary(dir) {
  return summarizeInbox(readInbox(dir));
}

/**
 * Does this on-disk inbox reflect the playlist entry we just observed? The server rewrites the
 * inbox asynchronously (a serialized queue) after every state change, so the file on disk can lag
 * the HTTP snapshot by one or more writes: an older one from before this write, or the one built
 * when the scene was merely `validating`. A consistent inbox
 *   - carries this write's `producerLastWriteAt` (the stamp the playlist reports), and
 *   - agrees with the entry's verdict: a `rejected` scene has its pending reject (a rewrite clears
 *     the old one before validation, so a stale post-write inbox cannot fake this); a `degraded`
 *     scene has its `degraded` notice; an accepted scene has no pending reject for it.
 */
export function inboxReflects(inbox, entry, lastWriteAt) {
  if (!inbox || typeof inbox !== 'object') return false;
  if (lastWriteAt && inbox.producerLastWriteAt !== lastWriteAt) return false;
  if (!entry) return true;
  const pending = Array.isArray(inbox.pending) ? inbox.pending : [];
  const hasReject = pending.some((p) => p && p.kind === 'reject' && p.sceneId === entry.sceneId);
  if (entry.status === 'rejected') return hasReject;
  if (hasReject) return false;
  if (entry.degraded) {
    const notices = Array.isArray(inbox.notices) ? inbox.notices : [];
    return notices.some((n) => n && n.kind === 'degraded' && n.sceneId === entry.sceneId);
  }
  return true;
}

/**
 * Re-read control/inbox.json until pred(inbox) holds or the deadline passes.
 * @returns {Promise<{inbox: object|null, consistent: boolean}>} the last inbox read
 */
export async function waitForInbox(dir, pred, { timeoutMs = 2000, everyMs = 25 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const inbox = readInbox(dir);
    if (pred(inbox)) return { inbox, consistent: true };
    if (Date.now() - t0 >= timeoutMs) return { inbox, consistent: false };
    await sleep(everyMs);
  }
}

/**
 * Pending counts derived from the server's own snapshot, for when the inbox file never caught up.
 * Same rule the server applies to inbox.pending: a reject is pending exactly while its scene's
 * status is `rejected` (a rewrite or a degrade clears it); a question is pending until any scene
 * carrying its questionId is ingested (answeredBy non-empty).
 */
export function inboxFromPlaylist(playlist) {
  const entries = Array.isArray(playlist && playlist.entries) ? playlist.entries : [];
  const questions = Array.isArray(playlist && playlist.questions) ? playlist.questions : [];
  const rejects = entries.filter((e) => e && e.status === 'rejected').length;
  const open = questions.filter((q) => q && !(Array.isArray(q.answeredBy) && q.answeredBy.length > 0)).length;
  return { pending: rejects + open, questions: open, rejects };
}

/** Per-request timeout inside polls: generous, so a server busy under load is retried, not declared down. */
const POLL_REQUEST_TIMEOUT_MS = 5000;

/**
 * Poll until pred(playlist) is truthy or the deadline passes; returns the last playlist (or null).
 * `extendWhile(playlist)` may keep the poll going past `timeoutMs` (up to `maxWaitMs`) while the
 * server is still working on the answer the caller needs (e.g. no validation verdict yet).
 * Transient request failures are retried until the deadline; only when the server never answered
 * at all does the last error propagate.
 */
export async function pollPlaylist(baseUrl, lessonId, pred, { timeoutMs = 3000, maxWaitMs = timeoutMs, everyMs = 100, extendWhile = () => false } = {}) {
  const t0 = Date.now();
  let last = null;
  let lastError = null;
  for (;;) {
    try {
      const r = await get(`${baseUrl}/api/lesson/${lessonId}/playlist`, { timeoutMs: POLL_REQUEST_TIMEOUT_MS });
      if (r.status === 200 && r.body && typeof r.body === 'object') {
        last = r.body;
        if (pred(last)) return { playlist: last, waitedMs: Date.now() - t0, done: true };
      }
    } catch (e) {
      lastError = e;
    }
    const elapsed = Date.now() - t0;
    const deadline = last && extendWhile(last) ? Math.max(timeoutMs, maxWaitMs) : timeoutMs;
    if (elapsed >= deadline) {
      if (last === null && lastError) throw lastError;
      return { playlist: last, waitedMs: elapsed, done: false };
    }
    await sleep(everyMs);
  }
}

/** Wait until the server knows the lesson's outline (GET /outline → 200); transient errors are retried. */
export async function waitForOutline(baseUrl, lessonId, { timeoutMs = 3000, everyMs = 100 } = {}) {
  const t0 = Date.now();
  let lastError = null;
  let answered = false;
  for (;;) {
    try {
      const r = await get(`${baseUrl}/api/lesson/${lessonId}/outline`, { timeoutMs: POLL_REQUEST_TIMEOUT_MS });
      answered = true;
      if (r.status === 200) return true;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() - t0 >= timeoutMs) {
      if (!answered && lastError) throw lastError;
      return false;
    }
    await sleep(everyMs);
  }
}
