// khan wait <lessonId> [--timeout S]   (default 540, server caps at 600)
// Prints exactly the server's one JSON object: event question|reject|continue|finished|
// player-closed|timeout, always with `notices`. Server down → {"event":"error","code":"SERVER_DOWN"} exit 2.
import { emit, EXIT } from '../output.js';
import { get } from '../http.js';
import { findRunningServer } from '../server-ctl.js';
import { checkLessonId } from '../lesson.js';

export const DEFAULT_WAIT_SECONDS = 540;
export const MAX_WAIT_SECONDS = 600;

export async function wait({ positionals, flags, pretty, env = process.env }) {
  const [lessonId] = positionals;
  checkLessonId(lessonId);
  const timeout = Math.min(MAX_WAIT_SECONDS, flags.timeout ?? DEFAULT_WAIT_SECONDS);
  try {
    const running = await findRunningServer(env);
    if (!running) { emit({ event: 'error', code: 'SERVER_DOWN', message: 'no khan server is running; run "khan serve" first' }, pretty); return EXIT.SERVER_DOWN; }
    const r = await get(`${running.url}/api/lesson/${lessonId}/wait?timeout=${timeout}`, { timeoutMs: (timeout + 30) * 1000 });
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
      emit({ event: 'error', code: `HTTP_${r.status}`, message: (r.body && r.body.error) || String(r.body) }, pretty);
      return EXIT.ERROR;
    }
    emit(r.body, pretty);
    return EXIT.OK;
  } catch (e) {
    if (e && e.code === 'SERVER_DOWN') { emit({ event: 'error', code: 'SERVER_DOWN', message: e.message }, pretty); return EXIT.SERVER_DOWN; }
    throw e;
  }
}
