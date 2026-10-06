// cli/server-ctl.js — find, health-check, spawn and record the local server (brief 05 `serve`).
//
// Pidfile: <KHAN_HOME>/server.json {port, host, pid, startedAt, lessonsDir, cacheDir, url}.
// A server is "running" when its pid is alive (or unknown) AND GET /api/health answers ok.
// A stale pidfile (dead pid / no health) is ignored and overwritten by the next spawn.
//
// The spawned server gets KHAN_NO_OPEN=1: the CLI opens the browser itself (`outline` once the
// new lesson is ingested, `play` for replays). Reason: the foundation server opens a tab for
// EVERY lesson folder present at startup, which over an accumulated .khan/lessons would open a
// tab per old lesson each time the server starts (verified; reported to the foundation).
import { spawn } from 'node:child_process';
import { promises as fs, existsSync, readFileSync, mkdirSync, openSync, closeSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { get, sleep } from './http.js';
import { CliError } from './output.js';
import { SERVER_ENTRY, DEFAULT_HOST, serverInfoPath, serverLogPath, khanHome, defaultLessonsDir, defaultCacheDir, defaultPort } from './paths.js';

export function readServerInfo(env = process.env) {
  const path = serverInfoPath(env);
  if (!existsSync(path)) return null;
  try {
    const info = JSON.parse(readFileSync(path, 'utf8'));
    return info && Number.isInteger(info.port) ? info : null;
  } catch { return null; }
}

export async function writeServerInfo(env, info) {
  mkdirSync(khanHome(env), { recursive: true });
  const path = serverInfoPath(env);
  await fs.writeFile(`${path}.tmp`, JSON.stringify(info, null, 2) + '\n');
  await fs.rename(`${path}.tmp`, path);
  return info;
}

export async function removeServerInfo(env) {
  await fs.rm(serverInfoPath(env), { force: true });
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

/** GET /api/health → body or null (never throws). */
export async function health(host, port, timeoutMs = 3000) {
  try {
    const r = await get(`http://${host}:${port}/api/health`, { timeoutMs });
    return r.status === 200 && r.body && r.body.ok === true ? r.body : null;
  } catch { return null; }
}

/**
 * The running server, if any: first the pidfile, then the requested port (a server started by
 * hand, e.g. `npm run serve`, has no pidfile).
 * @returns {Promise<object|null>} {port, host, url, pid, lessonsDir, tts, source}
 */
export async function findRunningServer(env = process.env, { port, host = DEFAULT_HOST } = {}) {
  const info = readServerInfo(env);
  if (info && (info.pid == null || pidAlive(info.pid))) {
    const h = await health(info.host || host, info.port);
    if (h) return { ...info, host: info.host || host, lessonsDir: h.lessonsDir, tts: h.tts, url: `http://${info.host || host}:${info.port}`, source: 'pidfile' };
  }
  const p = port ?? defaultPort(env);
  if (!info || info.port !== p) {
    const h = await health(host, p);
    if (h) return { port: p, host, url: `http://${host}:${p}`, pid: null, startedAt: null, lessonsDir: h.lessonsDir, tts: h.tts, source: 'port' };
  }
  return null;
}

/**
 * Ensure a server is running; spawn one detached when none is healthy.
 * @returns {Promise<{info: object, spawned: boolean}>}
 */
export async function ensureServer(env = process.env, { port, lessonsDir, cacheDir, host = DEFAULT_HOST, timeoutMs = 5000 } = {}) {
  const explicitLessons = lessonsDir !== undefined;
  const wantLessons = resolve(lessonsDir || defaultLessonsDir(env));
  const wantCache = resolve(cacheDir || defaultCacheDir(env));
  const running = await findRunningServer(env, { port, host });
  if (running) {
    if (explicitLessons && resolve(running.lessonsDir) !== wantLessons) {
      throw new CliError('LESSONS_DIR_MISMATCH', `a khan server is already running on port ${running.port} over ${running.lessonsDir}; stop it (pid ${running.pid ?? 'unknown'}) or omit --lessons-dir`, { details: { running: running.lessonsDir, requested: wantLessons, pid: running.pid, port: running.port } });
    }
    return { info: running, spawned: false };
  }
  const info = await spawnServer(env, { port: port ?? defaultPort(env), host, lessonsDir: wantLessons, cacheDir: wantCache, timeoutMs });
  return { info, spawned: true };
}

async function spawnServer(env, { port, host, lessonsDir, cacheDir, timeoutMs }) {
  mkdirSync(khanHome(env), { recursive: true });
  mkdirSync(lessonsDir, { recursive: true });
  const logPath = serverLogPath(env);
  const logFd = openSync(logPath, 'a');
  const offset = statSync(logPath).size;
  const args = [SERVER_ENTRY, '--port', String(port), '--host', host, '--lessons-dir', lessonsDir, '--cache-dir', cacheDir];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...env, KHAN_NO_OPEN: '1' },
    cwd: khanHome(env),
  });
  closeSync(logFd);
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  child.on('error', (e) => { exited = { code: null, signal: null, error: e.message }; });
  child.unref();

  const t0 = Date.now();
  let startLine = null;
  while (Date.now() - t0 < timeoutMs) {
    if (exited) break;
    startLine = startLine || readStartLine(logPath, offset);
    if (startLine && startLine.ok === false) break;
    if (startLine && startLine.ok === true) {
      const h = await health(startLine.host || host, startLine.port, 1000);
      if (h) {
        const info = { port: startLine.port, host: startLine.host || host, url: startLine.url, pid: child.pid, startedAt: new Date().toISOString(), lessonsDir: h.lessonsDir, cacheDir, tts: h.tts, source: 'spawned' };
        await writeServerInfo(env, { port: info.port, host: info.host, pid: info.pid, startedAt: info.startedAt, lessonsDir: info.lessonsDir, cacheDir, url: info.url });
        return info;
      }
    }
    await sleep(100);
  }
  const tail = tailOf(logPath, offset);
  const why = exited ? `server exited (${exited.error || `code ${exited.code}${exited.signal ? `, signal ${exited.signal}` : ''}`})` : (startLine && startLine.ok === false ? `server failed to start: ${startLine.error}` : `server did not become healthy within ${timeoutMs} ms`);
  throw new CliError('SERVER_START_FAILED', `${why}; see ${logPath}`, { details: { log: tail } });
}

/** The first `{"ok":...}` JSON line the server printed after `offset`, or null. */
function readStartLine(logPath, offset) {
  let text;
  try { text = readFileSync(logPath, 'utf8').slice(offset); } catch { return null; }
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try { const j = JSON.parse(line); if (typeof j.ok === 'boolean') return j; } catch { /* partial line */ }
  }
  return null;
}

function tailOf(logPath, offset) {
  try { return readFileSync(logPath, 'utf8').slice(offset).trim().split('\n').slice(-10).join('\n'); } catch { return ''; }
}

/** Public shape printed by `serve`/`play`. */
export function describe(info, spawned) {
  return { ok: true, port: info.port, host: info.host, url: info.url, pid: info.pid ?? null, lessonsDir: info.lessonsDir, tts: info.tts ?? null, spawned };
}
