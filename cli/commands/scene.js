// khan scene <lessonId> <sceneId> < scene.json
// Atomic write, then wait for the server to validate; print ONE line the skill can read.
//
// Timing (robust under load, QA finding 4):
//   1. poll the playlist up to --timeout-ms (3 s) for a settled status (ready|rejected|degraded)
//      observed AFTER this write was ingested (`producer.lastWriteAt` changes);
//   2. if the budget runs out while the server has not yet reached a verdict (still pending or
//      validating), keep polling up to --max-wait-ms (10 s) rather than report an undecided
//      status; a scene still `voicing` at the budget is reported as `voicing` (accepted);
//   3. the inbox counts come from control/inbox.json only once that file reflects THIS write
//      (the server rewrites it asynchronously): wait, bounded, for a consistent inbox; if it never
//      lands, derive the counts from the server's own snapshot and flag `inboxStale: true`.
import { join } from 'node:path';
import { SCHEMA_SCENE } from '../../shared/layout-core/constants.js';
import { emit, readStdin, parseJsonInput, CliError, serverDown } from '../output.js';
import { writeJsonAtomic } from '../atomic.js';
import { get } from '../http.js';
import { findRunningServer } from '../server-ctl.js';
import {
  checkLessonId, checkSceneId, resolveLessonsDir, requireLessonFolder, pollPlaylist,
  waitForInbox, inboxReflects, summarizeInbox, inboxFromPlaylist,
} from '../lesson.js';

const SETTLED = new Set(['ready', 'rejected', 'degraded']);
/** Statuses with no validation verdict yet; `khan scene` keeps waiting on these (up to --max-wait-ms). */
const UNDECIDED = new Set(['pending', 'validating']);
export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_WAIT_MS = 10000;
/** Bounded wait for control/inbox.json to catch up with the HTTP snapshot. */
export const INBOX_SYNC_MS = 2000;

/** Pure: fill in ids, refuse mismatches. Exported for unit tests. */
export function prepareScene(input, lessonId, sceneId) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new CliError('BAD_SCENE', 'scene must be a JSON object');
  const scene = { ...input };
  if (scene.schema === undefined) scene.schema = SCHEMA_SCENE;
  if (scene.lessonId === undefined) scene.lessonId = lessonId;
  else if (scene.lessonId !== lessonId) throw new CliError('ID_MISMATCH', `scene.lessonId "${scene.lessonId}" does not match the argument "${lessonId}"`);
  if (scene.sceneId === undefined) scene.sceneId = sceneId;
  else if (scene.sceneId !== sceneId) throw new CliError('ID_MISMATCH', `scene.sceneId "${scene.sceneId}" does not match the argument "${sceneId}"`);
  return scene;
}

export function summarizeEntry(entry, inbox, playlist, waitedMs) {
  const status = entry ? (entry.degraded ? 'degraded' : entry.status) : 'pending';
  return {
    ok: true,
    lessonId: playlist ? playlist.lessonId : undefined,
    sceneId: entry ? entry.sceneId : undefined,
    status,
    settled: SETTLED.has(status),
    degraded: !!(entry && entry.degraded),
    droppedElementIds: entry ? entry.droppedElementIds || [] : [],
    errors: entry ? entry.errors || [] : [],
    durationMs: entry ? entry.durationMs : null,
    readyAhead: playlist && playlist.buffer ? playlist.buffer.readyAhead : inbox.readyAhead,
    inbox: { pending: inbox.pending, questions: inbox.questions, rejects: inbox.rejects },
    notices: inbox.notices,
    waitedMs,
  };
}

/** The playlist entry for sceneId, or null. */
const entryOf = (playlist, sceneId) => (playlist && Array.isArray(playlist.entries) ? playlist.entries.find((x) => x.sceneId === sceneId) || null : null);

export async function scene({ positionals, flags, pretty, env = process.env, stdin }) {
  const [lessonId, sceneId] = positionals;
  checkLessonId(lessonId);
  checkSceneId(sceneId);
  const input = parseJsonInput(await readStdin(stdin), 'scene');
  const prepared = prepareScene(input, lessonId, sceneId);
  const timeoutMs = flags['timeout-ms'] ?? DEFAULT_TIMEOUT_MS;
  const maxWaitMs = Math.max(timeoutMs, flags['max-wait-ms'] ?? DEFAULT_MAX_WAIT_MS);

  const running = await findRunningServer(env);
  if (!running) throw serverDown('no khan server is running; run "khan serve" first');
  const lessonsDir = resolveLessonsDir(env, flags, running);
  const dir = requireLessonFolder(lessonsDir, lessonId);
  // On a rewrite the playlist still holds the previous attempt's settled entry, so remember the
  // server's last-ingest stamp and only accept a status observed after THIS write was ingested.
  let stampBefore = null;
  try {
    const before = await get(`${running.url}/api/lesson/${lessonId}/playlist`, { timeoutMs: 5000 });
    stampBefore = before.status === 200 && before.body && before.body.producer ? before.body.producer.lastWriteAt : null;
  } catch { /* a busy server: fall back to the time-based check below */ }
  const writeStartedAt = Date.now();
  await writeJsonAtomic(join(dir, 'scenes', `${sceneId}.json`), prepared);

  const t0 = Date.now();
  const ingested = (p) => {
    const stamp = p.producer ? p.producer.lastWriteAt : null;
    if (!stamp) return false;
    if (stampBefore !== null) return stamp !== stampBefore;
    return new Date(stamp).getTime() >= writeStartedAt - 1000; // same machine; the server stamps at ingest, after our write
  };
  const { playlist } = await pollPlaylist(running.url, lessonId, (p) => {
    if (!ingested(p)) return false;
    const e = entryOf(p, sceneId);
    return !!(e && (SETTLED.has(e.status) || e.degraded));
  }, {
    timeoutMs,
    maxWaitMs,
    extendWhile: (p) => { const e = entryOf(p, sceneId); return !ingested(p) || !e || UNDECIDED.has(e.status); },
  });
  const entry = entryOf(playlist, sceneId);
  const lastWriteAt = playlist && playlist.producer && ingested(playlist) ? playlist.producer.lastWriteAt : null;

  // The inbox file lags the HTTP snapshot; use it only once it reflects this write and this verdict.
  const inboxBudget = Math.max(500, Math.min(INBOX_SYNC_MS, maxWaitMs - (Date.now() - t0)));
  const { inbox: inboxFile, consistent } = await waitForInbox(dir, (ib) => inboxReflects(ib, entry, lastWriteAt), { timeoutMs: inboxBudget });
  const inbox = summarizeInbox(inboxFile);
  if (!consistent && playlist) Object.assign(inbox, inboxFromPlaylist(playlist));

  const out = summarizeEntry(entry, inbox, playlist, Date.now() - t0);
  out.lessonId = lessonId;
  out.sceneId = sceneId;
  if (!consistent) out.inboxStale = true;
  emit(out, pretty);
  return 0;
}
