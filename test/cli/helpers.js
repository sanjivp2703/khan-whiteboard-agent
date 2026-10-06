// test/cli/helpers.js — run bin/khan as a child, isolated KHAN_HOME, in-process server + pidfile,
// a fake player that posts positions. Nothing here touches the real .khan/.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../server/index.js';

export const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const BIN = join(REPO_ROOT, 'bin', 'khan');
export const FIXTURES = join(REPO_ROOT, 'fixtures');
export const SKILL_PATH = join(REPO_ROOT, '.claude', 'skills', 'khan', 'SKILL.md');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fresh KHAN_HOME and a minimal, clean env (no inherited KHAN_* / OPENAI_API_KEY). */
export function makeHome(extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), 'khan-cli-'));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR || tmpdir(),
    KHAN_HOME: home,
    KHAN_TTS: 'silent',
    KHAN_NO_OPEN: '1',
    KHAN_WATCH_INTERVAL_MS: '80',
    KHAN_WATCH_STABLE_MS: '100',
    KHAN_IDLE_EXIT_MS: String(60 * 60 * 1000),
    ...extraEnv,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return {
    home,
    env,
    lessonsDir: join(home, 'lessons'),
    serverJson: join(home, 'server.json'),
    readServerJson() { return existsSync(this.serverJson) ? JSON.parse(readFileSync(this.serverJson, 'utf8')) : null; },
    cleanup() { rmSync(home, { recursive: true, force: true }); },
  };
}

/**
 * Run `khan <args>`; resolves {code, stdout, stderr, json, lines, ms}. `json` = first stdout line parsed (or null).
 */
export function runKhan(args, { stdin, env, timeoutMs = 60000, cwd = REPO_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [BIN, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`khan ${args.join(' ')} timed out after ${timeoutMs} ms\nstdout: ${out}\nstderr: ${err}`)); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = out.split('\n').filter((l) => l.length > 0);
      let json = null;
      try { json = lines.length ? JSON.parse(lines[0]) : null; } catch { /* not JSON */ }
      resolve({ code, stdout: out, stderr: err, json, lines, ms: Date.now() - t0 });
    });
    if (stdin !== undefined) child.stdin.end(typeof stdin === 'string' ? stdin : JSON.stringify(stdin));
    else child.stdin.end();
  });
}

/** Start a child `khan` without waiting; returns {child, done: Promise<result>}. For blocking `wait`. */
export function startKhan(args, { env, cwd = REPO_ROOT } = {}) {
  const t0 = Date.now();
  const child = spawn(process.execPath, [BIN, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.end();
  const done = new Promise((resolve) => child.on('close', (code) => {
    const lines = out.split('\n').filter((l) => l.length > 0);
    let json = null;
    try { json = lines.length ? JSON.parse(lines[0]) : null; } catch { /* not JSON */ }
    resolve({ code, stdout: out, stderr: err, json, lines, ms: Date.now() - t0 });
  }));
  return { child, done };
}

/**
 * An in-process foundation server on port 0 over <home>/lessons, registered in <home>/server.json
 * so CLI children find it (pid = this process, which is alive).
 */
export async function startHomeServer(h, { extraEnv = {}, opts = {} } = {}) {
  mkdirSync(h.lessonsDir, { recursive: true });
  const cacheDir = join(h.home, 'cache', 'tts');
  const env = { ...h.env, ...extraEnv };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const opened = [];
  const info = await startServer({ port: 0, lessonsDir: h.lessonsDir, cacheDir, env, config: {}, opener: (u) => opened.push(u), ...opts });
  writeFileSync(h.serverJson, JSON.stringify({ port: info.port, host: info.host, pid: process.pid, startedAt: new Date().toISOString(), lessonsDir: info.lessonsDir, cacheDir, url: info.url }));
  const base = info.url;
  const api = {
    info, base, opened, lessonsDir: h.lessonsDir,
    async get(p) { const r = await fetch(base + p); return { status: r.status, body: await safeJson(r) }; },
    async post(p, body) { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await safeJson(r) }; },
    async playlist(lessonId) { const r = await api.get(`/api/lesson/${lessonId}/playlist`); return r.status === 200 ? r.body : null; },
    async waitFor(pred, { timeoutMs = 10000, every = 50, what = 'condition' } = {}) {
      const t0 = Date.now();
      for (;;) {
        const v = await pred();
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await sleep(every);
      }
    },
    async waitForStatuses(lessonId, want, timeoutMs = 10000) {
      return api.waitFor(async () => {
        const p = await api.playlist(lessonId);
        if (!p) return null;
        const got = Object.fromEntries(p.entries.map((e) => [e.sceneId, e.status]));
        for (const [id, st] of Object.entries(want)) if (got[id] !== st) return null;
        return p;
      }, { timeoutMs, what: `statuses ${JSON.stringify(want)}` });
    },
    /** fake player: start then end for one scene */
    async play(lessonId, sceneId, { startOnly = false, t = 0 } = {}) {
      await api.post(`/api/lesson/${lessonId}/position`, { sceneId, event: 'start', t });
      if (!startOnly) await api.post(`/api/lesson/${lessonId}/position`, { sceneId, event: 'end' });
    },
    async close() { await info.close(); },
  };
  return api;
}

async function safeJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export async function killPid(pid, { timeoutMs = 3000 } = {}) {
  if (!pid || !pidAlive(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const t0 = Date.now();
  while (pidAlive(pid) && Date.now() - t0 < timeoutMs) await sleep(50);
  if (pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

export async function healthOk(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); return r.status === 200 ? await r.json() : null; } catch { return null; }
}

// ---- scene / outline builders ----
export const outlineOf = (title, n, over = {}) => ({
  title,
  scenes: Array.from({ length: n }, (_, i) => ({ sceneId: `s${String(i + 1).padStart(3, '0')}`, title: `Scene ${i + 1}`, goal: 'g' })),
  ...over,
});

export const NARRATION = 'A perfectly ordinary narration that is long enough to clear the fifteen word minimum for a valid scene file.';

export const sceneOf = (sceneId, over = {}) => ({
  title: sceneId,
  narration: NARRATION,
  board: { mode: 'wipe' },
  elements: [{ id: 't', type: 'text', slot: 'A1:B1', style: 'body', text: `scene ${sceneId}` }],
  final: false,
  ...over,
});

/** An invalid scene: a 9-word title in a single column (CAP_WORDS + SLOT_TOO_SMALL). */
export const badSceneOf = (sceneId, over = {}) => sceneOf(sceneId, {
  elements: [{ id: 't', type: 'text', slot: 'A1', style: 'title', text: 'Nine words in a title is too many here' }],
  ...over,
});

export function readFixtureScene(lessonId, sceneId) {
  return JSON.parse(readFileSync(join(FIXTURES, 'lessons', lessonId, 'scenes', `${sceneId}.json`), 'utf8'));
}
