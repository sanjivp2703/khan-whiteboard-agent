// server/index.js — startServer({port, lessonsDir, host, ...}) → {port, close()} and the CLI-less
// entry: `node server/index.js --port N --lessons-dir D`. The `khan` CLI (slice 05) wraps this.
import http from 'node:http';
import { promises as fs, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lesson-store.js';
import { createWatcher } from './watcher.js';
import { createIngest } from './ingest.js';
import { createControl } from './control.js';
import { createWait } from './wait.js';
import { createHttpHandler } from './http.js';
import { createSse } from './sse.js';
import { createLifecycle, defaultOpener } from './lifecycle.js';
import { selectProvider, ttsStatus } from './tts/index.js';
import { createTtsCache } from './tts/cache.js';
import { prepareValidator } from '../shared/schema/validate.js';

export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_PORT = 7777;

export function readConfig(root = REPO_ROOT) {
  const path = join(root, '.khan', 'config.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.port] 0 = random free port
 * @param {string} [opts.host]
 * @param {string} [opts.lessonsDir]
 * @param {string} [opts.cacheDir]
 * @param {object} [opts.env] defaults to process.env
 * @param {object} [opts.config] defaults to .khan/config.json
 * @param {function} [opts.opener] browser opener (tests inject a spy)
 * @param {boolean} [opts.exitOnIdle] process.exit on idle (CLI only)
 * @param {function} [opts.log]
 */
export async function startServer(opts = {}) {
  const env = opts.env || process.env;
  const config = opts.config || readConfig();
  const host = opts.host || env.KHAN_HOST || '127.0.0.1';
  const requestedPort = opts.port !== undefined ? Number(opts.port) : Number(env.KHAN_PORT || config.port || DEFAULT_PORT);
  const lessonsDir = resolve(opts.lessonsDir || env.KHAN_LESSONS_DIR || join(REPO_ROOT, '.khan', 'lessons'));
  const cacheDir = resolve(opts.cacheDir || env.KHAN_CACHE_DIR || join(REPO_ROOT, '.khan', 'cache', 'tts'));
  const log = opts.log || (() => {});
  await fs.mkdir(lessonsDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await prepareValidator({ font: true, math: false });

  const provider = opts.provider || await selectProvider(env, config);
  const cache = createTtsCache({ dir: cacheDir });
  const store = createStore({ lessonsDir, provider });
  const control = createControl(store);
  const wait = createWait({ store, env });
  let server = null;
  let port = requestedPort;

  const lifecycle = createLifecycle({
    env,
    opener: opts.opener || defaultOpener,
    idleExitMs: opts.idleExitMs,
    onIdleExit: (why) => {
      log(`idle exit (${why})`);
      if (opts.onIdleExit) opts.onIdleExit(why);
      if (opts.exitOnIdle) { close().finally(() => process.exit(0)); }
    },
  });

  const sse = createSse({
    store,
    onConnect: () => lifecycle.noteActivity(),
    onDisconnect: () => { if (totalClients() === 0) lifecycle.noteAllClientsGone(); },
  });
  const totalClients = () => [...store.lessons.keys()].reduce((n, id) => n + sse.count(id), 0);

  const ingest = createIngest({
    store, cache, control, provider, env, log,
    onChange: (lesson) => sse.broadcast(lesson),
    onNewOutline: (lesson) => { lifecycle.noteActivity(); lifecycle.openBrowser(`http://${host}:${port}/lesson/${lesson.lessonId}`); },
    onEnded: () => lifecycle.noteEnded(),
  });

  const watcher = createWatcher({
    lessonsDir,
    onOutline: (lessonId, json, error) => ingest.ingestOutline(lessonId, json, error),
    onScene: (lessonId, sceneId, json, error) => { ingest.ingestScene(lessonId, sceneId, json, error).catch((e) => log('ingest error', e)); },
    intervalMs: Number(env.KHAN_WATCH_INTERVAL_MS) > 0 ? Number(env.KHAN_WATCH_INTERVAL_MS) : 300,
    stableMs: Number(env.KHAN_WATCH_STABLE_MS) > 0 ? Number(env.KHAN_WATCH_STABLE_MS) : 250,
    log,
  });

  // requests can only arrive after listen(), so the handler is built once the real port is known
  let handler = null;
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => resolvePromise());
  });
  port = server.address().port;
  handler = createHttpHandler({ store, ingest, sse, wait, repoRoot: REPO_ROOT, port, host, lessonsDir, provider, log });
  watcher.start();

  async function close() {
    watcher.stop();
    ingest.dispose();
    lifecycle.dispose();
    sse.closeAll();
    await control.flush();
    await new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); });
  }

  const info = { port, host, url: `http://${host}:${port}`, lessonsDir, cacheDir, tts: ttsStatus(provider), store, ingest, lifecycle, watcher, provider, cache, wait, close };
  return info;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a === '--lessons-dir') out.lessonsDir = argv[++i];
    else if (a.startsWith('--lessons-dir=')) out.lessonsDir = a.slice(14);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--cache-dir') out.cacheDir = argv[++i];
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  startServer({ ...args, exitOnIdle: true, log: (...m) => console.error('[khan]', ...m) })
    .then((info) => {
      console.log(JSON.stringify({ ok: true, port: info.port, host: info.host, url: info.url, lessonsDir: info.lessonsDir, tts: info.tts }));
      const stop = () => info.close().finally(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
}
