// khan serve [--port N] [--lessons-dir D] [--cache-dir C] [--foreground]
import { resolve } from 'node:path';
import { ensureServer, findRunningServer, describe, writeServerInfo, removeServerInfo } from '../server-ctl.js';
import { defaultPort, defaultLessonsDir, defaultCacheDir, DEFAULT_HOST } from '../paths.js';
import { emit, CliError } from '../output.js';

export async function serve({ flags, pretty, env = process.env }) {
  if (flags.foreground) return serveForeground({ flags, pretty, env });
  const { info, spawned } = await ensureServer(env, { port: flags.port, lessonsDir: flags['lessons-dir'], cacheDir: flags['cache-dir'] });
  emit(describe(info, spawned), pretty);
  return 0;
}

/** Run the server in this process (humans / tests); prints the same JSON line, then stays up. */
async function serveForeground({ flags, pretty, env }) {
  const port = flags.port ?? defaultPort(env);
  const running = await findRunningServer(env, { port });
  if (running) throw new CliError('ALREADY_RUNNING', `a khan server is already running on port ${running.port} (pid ${running.pid ?? 'unknown'})`, { details: describe(running, false) });
  const { startServer } = await import('../../server/index.js');
  const lessonsDir = resolve(flags['lessons-dir'] || defaultLessonsDir(env));
  const cacheDir = resolve(flags['cache-dir'] || defaultCacheDir(env));
  const info = await startServer({ port, host: DEFAULT_HOST, lessonsDir, cacheDir, env: { ...env, KHAN_NO_OPEN: '1' }, exitOnIdle: true, log: (...m) => console.error('[khan]', ...m) });
  const record = { port: info.port, host: info.host, pid: process.pid, startedAt: new Date().toISOString(), lessonsDir: info.lessonsDir, cacheDir: info.cacheDir, url: info.url };
  await writeServerInfo(env, record);
  emit({ ...describe({ ...record, tts: info.tts }, true), foreground: true }, pretty);
  const stop = () => { removeServerInfo(env).catch(() => {}).then(() => info.close()).finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null; // keep running
}
