// Slice 04 — rewind and skip. Criteria 8 and 9 of briefs/04-player-engine.md.
import { test, expect } from '@playwright/test';
import { makeLesson, openLesson, collectErrors, recordPosts, engine, fixtureScene, expectSameSet } from './engine-helpers.js';

test('criterion 8: rewind during s003 to s002 → board = all scenes since the last wipe up to s001; s002 audio from 0; start posted; jump to a wipe scene → empty board', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-build-region');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 2 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready', s004: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's003', 2.0, 60_000);
  // the board carries s001 + s002 + part of s003 now
  const before = await engine.drawn(page);
  expect(before).toEqual(expect.arrayContaining(['title', 'cache', 'client', 'serve']));
  await page.getByTestId('sidebar-item-s002').click();
  await engine.waitForScene(page, 's002', 10_000);
  const snap = await page.evaluate(() => ({ drawn: window.__khan.engine.drawnElementIds(), t: window.__khan.engine.audio.currentTime, state: window.__khan.engine.state }));
  // expected: every element of the scenes since the last wipe up to K−1 (= s001), computed from the fixtures
  const expected = fixtureScene('fx-build-region', 's001').elements.map((e) => e.id);
  expectSameSet(snap.drawn, expected);
  expect(snap.t).toBeLessThan(0.2);
  expect(snap.state).toBe('playing');
  expect(posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`)).toContain('start s002');
  expect(posts.filter((p) => p.kind === 'position').pop()).toEqual(expect.objectContaining({ event: 'start', sceneId: 's002' }));
  // a jump while paused stays paused at t = 0: a wipe scene shows an empty board before its first element
  await page.getByTestId('pause-button').click();
  await expect(page.getByTestId('state')).toHaveText('paused');
  await page.getByTestId('sidebar-item-s004').click();
  await engine.waitForScene(page, 's004', 10_000);
  expect(await engine.drawn(page)).toEqual([]);
  expect(await engine.state(page)).toBe('paused');
  expect((await engine.audio(page)).paused).toBe(true);
  await page.getByTestId('pause-button').click();
  await page.waitForFunction(() => window.__khan.engine.drawnElementIds().length > 0);
  expect(await engine.drawn(page)).toEqual(['title']); // s004 reuses the id after the wipe
  await expect(page.getByTestId('sidebar-item-s004')).toHaveAttribute('aria-current', 'true');
  // the deterministic planner agrees with what was painted
  const plan = await page.evaluate(() => window.__khan.engine.planBoardAt('s003', 0).ids.map((x) => x.id));
  expectSameSet(plan, ['title', 'cache', 'client', 'serve']);
  expect(errors).toEqual([]);
});

test('criterion 9: skip → on a not-ready later scene does nothing; on a ready one jumps', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeOutline();
  lesson.writeScene('s001');
  // s002 arrives invalid (3-word narration → rejected, not ready)
  lesson.writeScene('s002', (s) => ({ ...s, narration: 'far too short' }));
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 1 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'rejected' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 0.3);
  const before = await engine.position(page);
  await page.locator('body').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect(await engine.state(page)).toBe('playing');
  expect((await engine.position(page)).sceneId).toBe('s001');
  expect((await engine.position(page)).t).toBeGreaterThan(before.t);
  // clicking the not-ready sidebar item does nothing either (it is aria-disabled, so force the
  // click past Playwright's actionability check — a user can click it; the engine must ignore it)
  await expect(page.getByTestId('sidebar-item-s002')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('sidebar-item-s002').click({ force: true });
  await page.waitForTimeout(200);
  expect((await engine.position(page)).sceneId).toBe('s001');
  const refused = (await engine.events(page)).filter((e) => e.type === 'refused' && e.action === 'JUMP');
  expect(refused.length).toBeGreaterThanOrEqual(2);
  // the producer rewrites s002 validly → ready → skip works
  lesson.writeScene('s002');
  await engine.waitForStatuses(page, { s002: 'ready' });
  await page.keyboard.press('ArrowRight');
  await engine.waitForScene(page, 's002', 10_000);
  expect(await engine.state(page)).toBe('playing');
  expect((await engine.audio(page)).currentTime).toBeLessThan(1);
  // → on the last entry (no next) does nothing
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  expect((await engine.position(page)).sceneId).toBe('s002');
  expect(errors).toEqual([]);
});
