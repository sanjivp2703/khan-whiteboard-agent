// khan status <lessonId> — /api/lesson/<id>/status as one JSON line (includes tts.ready).
import { emit, CliError, serverDown } from '../output.js';
import { get } from '../http.js';
import { findRunningServer } from '../server-ctl.js';
import { checkLessonId } from '../lesson.js';

export async function status({ positionals, pretty, env = process.env }) {
  const [lessonId] = positionals;
  checkLessonId(lessonId);
  const running = await findRunningServer(env);
  if (!running) throw serverDown('no khan server is running; run "khan serve" first');
  const r = await get(`${running.url}/api/lesson/${lessonId}/status`, { timeoutMs: 5000 });
  if (r.status === 404) throw new CliError('UNKNOWN_LESSON', `the server does not know lesson "${lessonId}"`, { details: { tts: running.tts } });
  if (r.status !== 200 || !r.body || typeof r.body !== 'object') throw new CliError(`HTTP_${r.status}`, (r.body && r.body.error) || String(r.body));
  emit({ ok: true, ...r.body, url: `${running.url}/lesson/${lessonId}` }, pretty);
  return 0;
}
