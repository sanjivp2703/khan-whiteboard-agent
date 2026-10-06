// khan outline <lessonId|-> < outline.json
// Shape-checks the outline (schema, title, 3–12 scenes, s001.. in sequence), creates the lesson
// folder, writes outline.json atomically, waits for the server to ingest it and opens the browser.
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { validateOutline } from '../../shared/schema/validate.js';
import { SCHEMA_OUTLINE } from '../../shared/layout-core/constants.js';
import { emit, readStdin, parseJsonInput, CliError } from '../output.js';
import { generateLessonId } from '../lesson-id.js';
import { writeJsonAtomic } from '../atomic.js';
import { findRunningServer } from '../server-ctl.js';
import { checkLessonId, resolveLessonsDir, lessonDir, waitForOutline } from '../lesson.js';
import { lessonUrl, defaultPort, DEFAULT_HOST } from '../paths.js';
import { openBrowser } from '../open.js';

const DEFAULT_PRODUCER = Object.freeze({ kind: 'claude-code-skill', version: '1' });

/** Pure: returns {outline, errors}. Exported for unit tests. */
export function prepareOutline(input, lessonIdArg, now = new Date()) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { outline: null, errors: [{ elementId: null, code: 'BAD_SCHEMA', message: 'outline must be a JSON object' }] };
  }
  const outline = { ...input };
  if (outline.schema === undefined) outline.schema = SCHEMA_OUTLINE;
  if (!outline.producer) outline.producer = { ...DEFAULT_PRODUCER };
  let lessonId;
  if (lessonIdArg === '-') {
    lessonId = typeof outline.lessonId === 'string' && outline.lessonId ? outline.lessonId : generateLessonId(outline.title, now);
  } else {
    lessonId = lessonIdArg;
    if (typeof outline.lessonId === 'string' && outline.lessonId && outline.lessonId !== lessonId) {
      return { outline: null, errors: [{ elementId: null, code: 'BAD_LESSON_ID', message: `outline.lessonId "${outline.lessonId}" does not match the argument "${lessonId}"` }] };
    }
  }
  outline.lessonId = lessonId;
  const r = validateOutline(outline, { lessonId });
  const errors = [...r.errors];
  if (Array.isArray(outline.scenes)) {
    outline.scenes.forEach((s, i) => {
      const want = `s${String(i + 1).padStart(3, '0')}`;
      if (s && typeof s === 'object' && typeof s.sceneId === 'string' && s.sceneId !== want) {
        errors.push({ elementId: null, code: 'BAD_SCENE_ID', message: `scenes[${i}].sceneId is "${s.sceneId}"; expected "${want}" (ids run s001, s002… in order)` });
      }
    });
  }
  return { outline, errors };
}

export async function outline({ positionals, flags, pretty, env = process.env, stdin }) {
  const [arg] = positionals;
  if (arg !== '-') checkLessonId(arg);
  const input = parseJsonInput(await readStdin(stdin), 'outline');
  const { outline: out, errors } = prepareOutline(input, arg);
  if (errors.length) throw new CliError('BAD_OUTLINE', `outline rejected (${errors.map((e) => e.code).join(', ')})`, { details: errors });
  const lessonId = out.lessonId;

  const running = await findRunningServer(env);
  const lessonsDir = resolveLessonsDir(env, flags, running);
  const dir = lessonDir(lessonsDir, lessonId);
  await fs.mkdir(join(dir, 'scenes'), { recursive: true });
  await writeJsonAtomic(join(dir, 'outline.json'), out);

  const host = running ? running.host : DEFAULT_HOST;
  const port = running ? running.port : defaultPort(env);
  const url = lessonUrl(host, port, lessonId);
  let ingested = false;
  let opened = false;
  if (running) {
    ingested = await waitForOutline(running.url, lessonId, { timeoutMs: flags['timeout-ms'] ?? 3000 });
    if (ingested) opened = openBrowser(url, env, flags);
  }
  emit({ ok: true, lessonId, url, lessonsDir, dir, scenes: out.scenes.length, server: !!running, ingested, opened }, pretty);
  return 0;
}
