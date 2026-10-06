// khan play <lessonId> [--lessons-dir D] [--no-open]
// Replay a finished lesson folder: ensure the server (spawning it if needed), check the folder,
// wait until the server has ingested the outline, print the URL and open the browser.
// No model is involved; audio comes from the TTS cache (foundation).
import { ensureServer, findRunningServer } from '../server-ctl.js';
import { emit } from '../output.js';
import { checkLessonId, resolveLessonsDir, requireLessonFolder, waitForOutline } from '../lesson.js';
import { openBrowser } from '../open.js';

export async function play({ positionals, flags, pretty, env = process.env }) {
  const [lessonId] = positionals;
  checkLessonId(lessonId);
  const already = await findRunningServer(env, { port: flags.port });
  const lessonsDir = resolveLessonsDir(env, flags, already);
  requireLessonFolder(lessonsDir, lessonId);
  const { info, spawned } = await ensureServer(env, { port: flags.port, lessonsDir: flags['lessons-dir'] ? lessonsDir : undefined, cacheDir: flags['cache-dir'] });
  const url = `${info.url}/lesson/${lessonId}`;
  const ingested = await waitForOutline(info.url, lessonId, { timeoutMs: flags['timeout-ms'] ?? 5000 });
  const opened = openBrowser(url, env, flags);
  emit({ ok: true, lessonId, url, port: info.port, lessonsDir: info.lessonsDir, spawned, ingested, opened, tts: info.tts ?? null }, pretty);
  return 0;
}
