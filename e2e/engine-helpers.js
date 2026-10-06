// e2e/engine-helpers.js — shared helpers for the slice 04 Playwright specs (not a spec itself).
//
// The Playwright config starts ONE server over a temp copy of fixtures/lessons (KHAN_E2E_ROOT).
// Each engine test gets its own lesson folder in that directory with a fresh lessonId: the test
// acts as the producer, copying fixture scenes in (rewriting `lessonId`) one at a time when the
// scenario needs a stall, or all at once when it does not. Lesson ids must match ^[a-z0-9-]{8,64}$.
import { readFileSync, mkdirSync, writeFileSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURES = join(ROOT, 'fixtures');

export function lessonsDir() {
  const root = process.env.KHAN_E2E_ROOT;
  if (!root) throw new Error('KHAN_E2E_ROOT is not set (playwright.config.js sets it)');
  return join(root, 'lessons');
}

let counter = 0;
/** A fresh, valid lessonId: eng-<name>-<random><n> */
export function freshLessonId(name) {
  counter++;
  const rand = Math.random().toString(36).slice(2, 8);
  return `eng-${name}-${rand}${counter}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64);
}

export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export function fixtureScene(fixture, sceneId, group = 'lessons') {
  return readJson(join(FIXTURES, group, fixture, 'scenes', `${sceneId}.json`));
}
export function fixtureSceneIds(fixture, group = 'lessons') {
  return readdirSync(join(FIXTURES, group, fixture, 'scenes')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}
export function fixtureOutline(fixture, group = 'lessons') {
  return readJson(join(FIXTURES, group, fixture, 'outline.json'));
}

function writeAtomic(file, obj) {
  writeFileSync(`${file}.tmp`, JSON.stringify(obj, null, 2));
  renameSync(`${file}.tmp`, file);
}

/**
 * A producer stand-in for one test lesson.
 * @param {string} fixture fixture lesson name
 * @param {{name?:string, group?:string}} [o]
 */
export function makeLesson(fixture, { name = fixture.replace(/^fx-/, ''), group = 'lessons' } = {}) {
  const lessonId = freshLessonId(name);
  const dir = join(lessonsDir(), lessonId);
  mkdirSync(join(dir, 'scenes'), { recursive: true });
  const api = {
    lessonId, dir, fixture, group,
    /** Write outline.json (rewritten lessonId). Call first. */
    writeOutline(mutate = (o) => o) {
      const o = mutate({ ...fixtureOutline(fixture, group), lessonId });
      writeAtomic(join(dir, 'outline.json'), o);
      return o;
    },
    /** Copy one fixture scene in (atomic), optionally mutated. Returns the written scene. */
    writeScene(sceneId, mutate = (s) => s) {
      const s = mutate({ ...fixtureScene(fixture, sceneId, group), lessonId });
      writeAtomic(join(dir, 'scenes', `${s.sceneId}.json`), s);
      return s;
    },
    /** Write an arbitrary scene object (lessonId is set for you). */
    writeRaw(scene) {
      const s = { ...scene, lessonId };
      writeAtomic(join(dir, 'scenes', `${s.sceneId}.json`), s);
      return s;
    },
    /** Outline plus the given scenes (default: every lesson scene s*, not answer scenes). */
    writeAll(sceneIds = fixtureSceneIds(fixture, group).filter((id) => id.startsWith('s'))) {
      api.writeOutline();
      return sceneIds.map((id) => api.writeScene(id));
    },
    sceneIds: () => fixtureSceneIds(fixture, group),
    hasScene: (id) => existsSync(join(dir, 'scenes', `${id}.json`)),
  };
  return api;
}

export function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Record every POST /position and /question body, in order, as the browser sends them. */
export function recordPosts(page) {
  const posts = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    const url = req.url();
    const m = /\/api\/lesson\/[^/]+\/(position|question)/.exec(url);
    if (!m) return;
    let body = null;
    try { body = JSON.parse(req.postData() || 'null'); } catch { body = req.postData(); }
    posts.push({ kind: m[1], ...body, at: Date.now() });
  });
  return posts;
}

/** Wait until the server has ingested the lesson folder (the real flow opens the browser only then). */
export async function waitForLessonKnown(page, lessonId, timeout = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await page.request.get(`/api/lesson/${lessonId}/playlist`);
    if (r.status() === 200) return;
    if (Date.now() - t0 > timeout) throw new Error(`server never registered lesson ${lessonId}`);
    await sleep(60);
  }
}

/** Open the lesson page and wait for the engine hooks + the first playlist snapshot. */
export async function openLesson(page, lessonId, { debug = false, config = {} } = {}) {
  await waitForLessonKnown(page, lessonId);
  await page.goto(`/lesson/${lessonId}${debug ? '?debug=1' : ''}`);
  await page.waitForFunction(() => window.__khan && window.__khan.engine && window.__khan.engine.stub === false, null, { timeout: 20_000 });
  if (Object.keys(config).length) await page.evaluate((c) => Object.assign(window.__khan.engine.config, c), config);
  await page.waitForFunction(() => window.__khan.engine.playlist !== null, null, { timeout: 20_000 });
  return page;
}

export const engine = {
  state: (page) => page.evaluate(() => window.__khan.engine.state),
  position: (page) => page.evaluate(() => window.__khan.engine.position),
  drawn: (page) => page.evaluate(() => window.__khan.engine.drawnElementIds()),
  stack: (page) => page.evaluate(() => window.__khan.engine.resumeStack),
  playlist: (page) => page.evaluate(() => window.__khan.engine.playlist),
  events: (page) => page.evaluate(() => window.__khan.engine.events),
  audio: (page) => page.evaluate(() => ({ paused: window.__khan.engine.audio.paused, currentTime: window.__khan.engine.audio.currentTime, duration: window.__khan.engine.audio.duration, ended: window.__khan.engine.audio.ended, src: window.__khan.engine.audio.currentSrc })),
  async waitForState(page, state, timeout = 30_000) {
    await page.waitForFunction((s) => window.__khan.engine.state === s, state, { timeout });
  },
  /** Resolves once `sceneId` is the current scene AND its audio has loaded (so raw audio reads are its own). */
  async waitForScene(page, sceneId, timeout = 30_000) {
    await page.waitForFunction((id) => { const e = window.__khan.engine; return e.position.sceneId === id && e.current && !e.current.loading; }, sceneId, { timeout, polling: 15 });
  },
  async waitForSceneTime(page, sceneId, t, timeout = 30_000) {
    await page.waitForFunction(([id, tt]) => { const p = window.__khan.engine.position; return p.sceneId === id && p.t >= tt && window.__khan.engine.state === 'playing'; }, [sceneId, t], { timeout, polling: 15 });
  },
  async waitForStatuses(page, want, timeout = 30_000) {
    await page.waitForFunction((w) => {
      const pl = window.__khan.engine.playlist;
      if (!pl) return false;
      const got = Object.fromEntries(pl.entries.map((e) => [e.sceneId, e.status]));
      return Object.entries(w).every(([id, st]) => got[id] === st);
    }, want, { timeout });
  },
  async waitForEntryCount(page, n, timeout = 30_000) {
    await page.waitForFunction((k) => window.__khan.engine.playlist && window.__khan.engine.playlist.entries.length >= k, n, { timeout });
  },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** expect() wrapper used for drawn-id sets (order-insensitive). */
export function expectSameSet(actual, expected, message) {
  expect([...new Set(actual)].sort(), message).toEqual([...new Set(expected)].sort());
}

/**
 * Intercept the lesson's SSE stream and serve a mutated copy of the real playlist snapshot
 * instead (used to simulate `audioUrl: null` and `tts.ready: false`, which the silent provider
 * never produces). The real REST routes (scenes, audio, position, question) stay live.
 * @param {(snapshot:object) => object} mutate
 */
export async function routeSse(page, lessonId, mutate) {
  await page.route(`**/api/lesson/${lessonId}/events`, async (route) => {
    const res = await route.fetch({ url: `${new URL(route.request().url()).origin}/api/lesson/${lessonId}/playlist`, headers: {} });
    const snapshot = mutate(await res.json());
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: `event: playlist\ndata: ${JSON.stringify(snapshot)}\n\n` });
  });
}
