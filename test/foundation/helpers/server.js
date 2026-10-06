// Test helper: an in-process server on a random port with temp lessons/cache dirs and the silent provider.
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../../server/index.js';
import { FIXTURES } from './fixtures.js';

export const TEST_ENV = Object.freeze({
  KHAN_TTS: 'silent',
  KHAN_NO_OPEN: '1',
  KHAN_WATCH_INTERVAL_MS: '80',
  KHAN_WATCH_STABLE_MS: '100',
});

/**
 * @param {object} extraEnv merged over TEST_ENV
 * @param {object} opts passed to startServer, except `populate(lessonsDir)` — a hook that fills the
 *   lessons dir BEFORE the server starts (to test the startup scan / replay path)
 */
export async function startTestServer(extraEnv = {}, { populate = null, ...opts } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'khan-test-'));
  const lessonsDir = join(root, 'lessons');
  const cacheDir = join(root, 'cache');
  mkdirSync(lessonsDir, { recursive: true });
  const env = { ...TEST_ENV, ...extraEnv };
  const opened = [];
  if (populate) await populate(lessonsDir);
  const info = await startServer({ port: 0, lessonsDir, cacheDir, env, config: {}, opener: (url) => opened.push(url), ...opts });
  const base = info.url;
  const api = {
    info, root, lessonsDir, cacheDir, base, opened,
    url: (p) => base + p,
    async get(p, headers = {}) { const r = await fetch(base + p, { headers }); return { status: r.status, headers: r.headers, body: await safeJson(r) }; },
    async post(p, body, headers = {}) { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, headers: r.headers, body: await safeJson(r) }; },
    copyFixture(lessonId, { from = 'lessons', as = lessonId, onlyScenes = null } = {}) {
      const src = join(FIXTURES, from, lessonId);
      const dest = join(lessonsDir, as);
      mkdirSync(join(dest, 'scenes'), { recursive: true });
      cpSync(join(src, 'outline.json'), join(dest, 'outline.json'));
      const scenes = onlyScenes || null;
      cpSync(join(src, 'scenes'), join(dest, 'scenes'), { recursive: true, filter: (s) => scenes === null || !s.endsWith('.json') || scenes.some((id) => s.endsWith(`${id}.json`)) });
      return dest;
    },
    writeScene(lessonId, scene, { atomic = true, name } = {}) {
      const dir = join(lessonsDir, lessonId, 'scenes');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name || `${scene.sceneId}.json`);
      if (atomic) { writeFileSync(`${file}.tmp`, JSON.stringify(scene, null, 2)); renameSync(`${file}.tmp`, file); }
      else writeFileSync(file, JSON.stringify(scene, null, 2));
      return file;
    },
    writeOutline(lessonId, outline) {
      const dir = join(lessonsDir, lessonId);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'outline.json');
      writeFileSync(`${file}.tmp`, JSON.stringify(outline, null, 2));
      renameSync(`${file}.tmp`, file);
    },
    async playlist(lessonId) { const r = await api.get(`/api/lesson/${lessonId}/playlist`); return r.status === 200 ? r.body : null; },
    async waitFor(pred, { timeoutMs = 8000, every = 50, what = 'condition' } = {}) {
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
    async close() { await info.close(); rmSync(root, { recursive: true, force: true }); },
  };
  return api;
}

async function safeJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open an SSE connection; returns {status, events: [], close(), next(event)} and resolves once the
 * first `until` event (default `playlist`) arrives. `next(name)` resolves with the next event of
 * that name received after the call.
 */
export async function openSse(url, { until = 'playlist' } = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
  const events = [];
  const waiters = []; // {name, resolve}
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let resolveFirst;
  const first = new Promise((r) => { resolveFirst = r; });
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = { event: 'message', data: null };
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
          }
          if (ev.data !== null) {
            events.push(ev);
            if (ev.event === until) resolveFirst(ev);
            for (const w of waiters.splice(0)) { if (w.name === ev.event) w.resolve(ev); else waiters.push(w); }
          }
        }
      }
    } catch { /* aborted */ }
  })();
  await first;
  return { status: res.status, headers: res.headers, events, close: () => controller.abort(), next: (name) => new Promise((resolve) => waiters.push({ name, resolve })) };
}
