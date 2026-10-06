// Slice 04 — the audio clock, the yield rule, position reporting, stalls and pause.
// Criteria 3, 4, 5, 6, 7 of briefs/04-player-engine.md.
import { test, expect } from '@playwright/test';
import { makeLesson, openLesson, collectErrors, recordPosts, engine, fixtureScene, sleep } from './engine-helpers.js';
import { resolveTiming } from '../shared/layout-core/timing.js';

test('criterion 3: drawnElementIds grows in `at` order and never before at × D (10 samples during fx-build-region s001)', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-build-region');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 2 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready', s004: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 0.01);
  // sample drawn set and audio clock atomically, 10 times, ~0.7 s of audio apart (cache starts at 4.93 s)
  const samples = await page.evaluate(async () => {
    const out = [];
    const e = window.__khan.engine;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      out.push({ t: e.audio.currentTime, drawn: e.drawnElementIds(), scene: e.position.sceneId });
      await new Promise((r) => setTimeout(r, 350));
    }
    return out;
  });
  const scene = fixtureScene('fx-build-region', 's001');
  const D = (await engine.playlist(page)).entries.find((x) => x.sceneId === 's001').durationMs / 1000;
  const starts = Object.fromEntries(resolveTiming(scene).map((w) => [w.id, w.at * D]));
  let prev = [];
  for (const s of samples) {
    expect(s.scene).toBe('s001');
    // grows, in list order (= at order), never shrinks
    expect(s.drawn.length).toBeGreaterThanOrEqual(prev.length);
    expect(s.drawn).toEqual(scene.elements.map((el) => el.id).slice(0, s.drawn.length));
    for (const id of s.drawn) expect(starts[id], `${id} drawn at t=${s.t}`).toBeLessThanOrEqual(s.t + 1e-6);
    prev = s.drawn;
  }
  expect(samples[0].drawn.length).toBeLessThan(2);
  expect(samples[samples.length - 1].drawn).toEqual(['title', 'cache']);
  expect(errors).toEqual([]);
});

/** Draw progress of every timeline element under the engine's last painted clock (1 = complete). */
const progressNow = (page) => page.evaluate(() => {
  const c = window.__khan.engine.current;
  return c.timeline.map((it) => (c.forced.has(it.id) || c.lastPaintT >= it.drawEnd ? 1 : Math.max(0, Math.min(1, (c.lastPaintT - it.start) / (it.drawEnd - it.start)))));
});

/** Spec §6 "audio yields to the pen": completion no earlier than audio end, no later than audio end + cap (+ tolerance), every element at u = 1. */
async function expectYieldRule(page, events, sceneId, cap, toleranceMs = 200) {
  const endedAt = events.find((e) => e.type === 'audio-ended' && e.sceneId === sceneId).at;
  const complete = events.find((e) => e.type === 'scene-complete' && e.sceneId === sceneId);
  expect(complete.at).toBeGreaterThanOrEqual(endedAt);
  expect(complete.at - endedAt).toBeLessThanOrEqual(cap + toleranceMs);
  expect(complete.holdMs).toBeLessThanOrEqual(cap + toleranceMs);
  // the pen was never cut off: when the scene completed every element had reached u = 1 (held to the end or snapped at the cap)
  const u = await progressNow(page);
  expect(u.length).toBeGreaterThan(0);
  expect(u).toEqual(u.map(() => 1));
  return { endedAt, complete };
}

test('criterion 4: yield rule — fx-long-stroke completes no earlier than audio end and no later than audio end + YIELD_CAP + 200 ms; all ids drawn; then ended', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-long-stroke');
  lesson.writeAll();
  // stretch natural stroke durations ×20 so the pen outruns the (6 s) narration of s003 by far and the cap must decide
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4, naturalMsScale: 20 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'ended', 60_000);
  const cap = await page.evaluate(() => window.__khan.engine.config.yieldCapMs);
  expect(cap).toBe(1500);
  const { endedAt, complete } = await expectYieldRule(page, await engine.events(page), 's003', cap);
  expect(complete.at - endedAt).toBeGreaterThanOrEqual(cap - 100); // the strokes were far from done: the cap decided
  expect(complete.snap).toBe(true);
  expect(await engine.drawn(page)).toEqual(['para', 'grid']);
  expect(await engine.state(page)).toBe('ended');
  // unstretched strokes: whether the real drawables (para ≈ 8.1 s, grid ≈ 12.4 s of natural drawing against a 6 s
  // narration, QA finding 3) finish inside the hold or hit the cap is a property of the renderers, not of the
  // engine — so assert the spec rule itself: never before audio end, never past audio end + cap, nothing cut short
  const lesson2 = makeLesson('fx-long-stroke');
  lesson2.writeAll();
  await openLesson(page, lesson2.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'ended', 60_000);
  const r2 = await expectYieldRule(page, await engine.events(page), 's003', cap);
  // a snap (hold ≥ cap) and a natural finish (hold < cap) are both legal; whichever happened, it is self-consistent
  expect(r2.complete.snap).toBe(r2.complete.holdMs >= cap);
  expect(await engine.drawn(page)).toEqual(['para', 'grid']);
  expect(await engine.state(page)).toBe('ended');
  expect(errors).toEqual([]);
});

test('criterion 5: POST /position end N then start N+1, in order, and nothing mid-scene', async ({ page }) => {
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'ended', 40_000);
  const seq = posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`);
  expect(seq).toEqual(['start s001', 'end s001', 'start s002', 'end s002', 'start s003', 'end s003']);
  // the server saw them in that order too
  const status = await (await page.request.get(`/api/lesson/${lesson.lessonId}/status`)).json();
  expect(status.player.position).toEqual(expect.objectContaining({ sceneId: 's003', event: 'end' }));
  expect(status.ended).toBe(true);
  expect(errors).toEqual([]);
});

test('criterion 6: stall — pen idles, no spinner/buffering, captions at the configured thresholds, resumes 400–900 ms after the scene arrives', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-build-region');
  lesson.writeOutline();
  lesson.writeScene('s001');
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4, stallCaptionMs: 1000, stuckCaptionMs: 3000 } });
  await engine.waitForStatuses(page, { s001: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'stalled', 30_000);
  const stalledAt = Date.now();
  const caption = page.getByTestId('caption');
  expect(await caption.textContent()).toBe('');
  expect(await page.evaluate(() => window.__khan.engine.pen.mode)).toBe('idle');
  // no spinner, no "buffering" anywhere in the chrome
  expect(await page.locator('#engine-root').textContent()).not.toMatch(/buffering/i);
  expect(await page.locator('#engine-root [role="progressbar"], #engine-root .spinner, #engine-root progress').count()).toBe(0);
  await sleep(Math.max(0, 600 - (Date.now() - stalledAt)));
  expect(await caption.textContent()).toBe('');
  await expect(caption).toHaveText('khan is thinking…', { timeout: 2_000 });
  await expect(caption).toContainText('generation seems stuck', { timeout: 3_000 });
  await expect(caption).toContainText(/last write \d+ s ago|no producer write yet/);
  // the audio is silent during the stall
  expect((await engine.audio(page)).paused).toBe(true);
  // the producer catches up
  lesson.writeScene('s002');
  await engine.waitForState(page, 'playing', 20_000);
  const events = await engine.events(page);
  const readyAt = events.find((e) => e.type === 'playlist' && e.ready.includes('s002')).at;
  const playingAt = [...events].reverse().find((e) => e.type === 'transition' && e.to === 'playing').at;
  expect(playingAt - readyAt).toBeGreaterThanOrEqual(400);
  expect(playingAt - readyAt).toBeLessThanOrEqual(900);
  expect((await engine.position(page)).sceneId).toBe('s002');
  await expect(caption).toHaveText('');
  expect(errors).toEqual([]);
});

test('criterion 7: pause/resume — space toggles; audio paused, currentTime and drawn set frozen for 500 ms; resume continues from the same time', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId);
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 1.0);
  await page.locator('body').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('state')).toHaveText('paused');
  const a1 = await engine.audio(page);
  const d1 = await engine.drawn(page);
  expect(a1.paused).toBe(true);
  await sleep(500);
  const a2 = await engine.audio(page);
  expect(a2.paused).toBe(true);
  expect(a2.currentTime).toBe(a1.currentTime);
  expect(await engine.drawn(page)).toEqual(d1);
  expect(await page.evaluate(() => window.__khan.engine.pen.mode)).toBe('park');
  await page.getByTestId('pause-button').click(); // the button works too
  await expect(page.getByTestId('state')).toHaveText('playing');
  const a3 = await engine.audio(page);
  expect(a3.paused).toBe(false);
  expect(a3.currentTime).toBeGreaterThanOrEqual(a1.currentTime);
  expect(a3.currentTime - a1.currentTime).toBeLessThan(0.5);
  await sleep(300);
  expect((await engine.audio(page)).currentTime).toBeGreaterThan(a3.currentTime);
  expect(errors).toEqual([]);
});
