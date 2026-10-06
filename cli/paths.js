// cli/paths.js — where the CLI keeps its state and finds the server (brief 05).
// Everything lives under KHAN_HOME (default <repo>/.khan): server.json (pidfile), server.log,
// lessons/ and cache/tts. Tests point KHAN_HOME at a temp dir so nothing touches the real repo.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SERVER_ENTRY = join(REPO_ROOT, 'server', 'index.js');
export const DEFAULT_PORT = 7777;
export const DEFAULT_HOST = '127.0.0.1';

export function khanHome(env = process.env) {
  return resolve(env.KHAN_HOME || join(REPO_ROOT, '.khan'));
}

export function serverInfoPath(env = process.env) { return join(khanHome(env), 'server.json'); }
export function serverLogPath(env = process.env) { return join(khanHome(env), 'server.log'); }

export function readConfig(env = process.env) {
  const path = join(khanHome(env), 'config.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

/** --lessons-dir > KHAN_LESSONS_DIR > <KHAN_HOME>/lessons */
export function defaultLessonsDir(env = process.env) {
  return env.KHAN_LESSONS_DIR ? resolve(env.KHAN_LESSONS_DIR) : join(khanHome(env), 'lessons');
}

/** --cache-dir > KHAN_CACHE_DIR > <KHAN_HOME>/cache/tts */
export function defaultCacheDir(env = process.env) {
  return env.KHAN_CACHE_DIR ? resolve(env.KHAN_CACHE_DIR) : join(khanHome(env), 'cache', 'tts');
}

/** --port > KHAN_PORT > config.port > 7777 */
export function defaultPort(env = process.env) {
  if (env.KHAN_PORT !== undefined && env.KHAN_PORT !== '' && Number.isInteger(Number(env.KHAN_PORT))) return Number(env.KHAN_PORT);
  const cfg = readConfig(env);
  if (Number.isInteger(cfg.port)) return cfg.port;
  return DEFAULT_PORT;
}

export function lessonUrl(host, port, lessonId) {
  return `http://${host}:${port}/lesson/${lessonId}`;
}
