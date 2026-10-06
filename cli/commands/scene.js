// khan scene <lessonId> <sceneId> < scene.json
// Atomic write, then wait (≤ 3 s) for the server to validate; print ONE line the skill can read.
import { join } from 'node:path';
import { SCHEMA_SCENE } from '../../shared/layout-core/constants.js';
import { emit, readStdin, parseJsonInput, CliError, serverDown } from '../output.js';
import { writeJsonAtomic } from '../atomic.js';
import { findRunningServer } from '../server-ctl.js';
import { checkLessonId, checkSceneId, resolveLessonsDir, requireLessonFolder, readInboxSummary, pollPlaylist } from '../lesson.js';

const SETTLED = new Set(['ready', 'rejected', 'degraded']);

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

export async function scene({ positionals, flags, pretty, env = process.env, stdin }) {
  const [lessonId, sceneId] = positionals;
  checkLessonId(lessonId);
  checkSceneId(sceneId);
  const input = parseJsonInput(await readStdin(stdin), 'scene');
  const prepared = prepareScene(input, lessonId, sceneId);

  const running = await findRunningServer(env);
  if (!running) throw serverDown('no khan server is running; run "khan serve" first');
  const lessonsDir = resolveLessonsDir(env, flags, running);
  const dir = requireLessonFolder(lessonsDir, lessonId);
  await writeJsonAtomic(join(dir, 'scenes', `${sceneId}.json`), prepared);

  const { playlist, waitedMs } = await pollPlaylist(running.url, lessonId, (p) => {
    const e = p.entries.find((x) => x.sceneId === sceneId);
    return !!(e && (SETTLED.has(e.status) || e.degraded));
  }, { timeoutMs: flags['timeout-ms'] ?? 3000 });
  const entry = playlist ? playlist.entries.find((x) => x.sceneId === sceneId) : null;
  const inbox = readInboxSummary(dir);
  const out = summarizeEntry(entry, inbox, playlist, waitedMs);
  out.lessonId = lessonId;
  out.sceneId = sceneId;
  emit(out, pretty);
  return 0;
}
