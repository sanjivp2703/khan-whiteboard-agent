// Slice 04 — sidebar, start gate (both orders), transcript/keyboard basics, end summary, letterbox.
// Criteria 1, 2, 16, 17, 18, 19 of briefs/04-player-engine.md.
import { test, expect } from '@playwright/test';
import { makeLesson, openLesson, collectErrors, engine, fixtureScene, fixtureSceneIds } from './engine-helpers.js';

test('criterion 1: sidebar lists every outline scene before any scene is ready; badges track status; state reads waiting', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeOutline();
  await openLesson(page, lesson.lessonId);
  await expect(page.getByTestId('state')).toHaveText('waiting');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  for (const id of ['s001', 's002', 's003']) {
    const item = page.getByTestId(`sidebar-item-${id}`);
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('data-status', 'planned');
    await expect(item).toHaveAttribute('data-ready', 'false');
  }
  await expect(page.getByTestId('sidebar-item-s002')).toContainText('Two');
  await expect(page.getByTestId('lesson-title')).toHaveText('Three short scenes');
  // scenes arrive: badges follow the playlist via SSE
  lesson.writeScene('s001');
  await expect(page.getByTestId('sidebar-item-s001')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
  await expect(page.getByTestId('sidebar-item-s001')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('sidebar-item-s002')).toHaveAttribute('data-status', 'planned');
  lesson.writeScene('s002'); lesson.writeScene('s003');
  await engine.waitForStatuses(page, { s002: 'ready', s003: 'ready' });
  await expect(page.getByTestId('sidebar-item-s003')).toHaveAttribute('data-status', 'ready');
  // still waiting: no click yet
  expect(await engine.state(page)).toBe('waiting');
  expect(await engine.drawn(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('criterion 2a: click Start before scene 1 is ready → armed, then playing the moment it is ready', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeOutline();
  await openLesson(page, lesson.lessonId);
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('state')).toHaveText('armed');
  await expect(page.getByTestId('start-button')).toBeDisabled();
  expect(await engine.state(page)).toBe('armed');
  lesson.writeScene('s001');
  await engine.waitForState(page, 'playing');
  await expect(page.getByTestId('state')).toHaveText('playing');
  await page.waitForFunction(() => window.__khan.engine.audio.currentTime > 0.05);
  const audio = await engine.audio(page);
  expect(audio.paused).toBe(false);
  expect(audio.src).toContain(`/api/lesson/${lesson.lessonId}/audio/s001`);
  await expect(page.getByTestId('start-gate')).toBeHidden();
  expect((await engine.position(page)).sceneId).toBe('s001');
  expect(errors).toEqual([]);
});

test('criterion 2b: scene 1 ready first, then click anywhere → playing immediately', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll(['s001']);
  await openLesson(page, lesson.lessonId);
  await engine.waitForStatuses(page, { s001: 'ready' });
  await expect(page.getByTestId('state')).toHaveText('waiting');
  // any click arms: click the gate backdrop far from the Start button, not the button itself
  await page.getByTestId('start-gate').click({ position: { x: 12, y: 12 } });
  await engine.waitForState(page, 'playing', 5_000);
  await page.waitForFunction(() => window.__khan.engine.audio.currentTime > 0.05, null, { timeout: 5_000 });
  const audio = await engine.audio(page);
  expect(audio.paused).toBe(false);
  expect(audio.src).toContain('/audio/s001');
  // position start posted for s001 (server side)
  await expect.poll(async () => (await (await page.request.get(`/api/lesson/${lesson.lessonId}/status`)).json()).player.position).toEqual(expect.objectContaining({ sceneId: 's001', event: 'start' }));
  // QA finding 9: the engine awaited the renderer-core `ready` hook (MathJax initialised) before its first playlist/paint
  const events = await engine.events(page);
  const readyEv = events.find((e) => e.type === 'renderer-ready');
  expect(readyEv).toEqual(expect.objectContaining({ hook: true, outcome: 'ready' }));
  expect(events.indexOf(readyEv)).toBeLessThan(events.findIndex((e) => e.type === 'scene-start'));
  expect(errors).toEqual([]);
});

test('criterion 17: transcript is a live region equal to the narration at each scene start; keyboard works with focus on body; buttons have names', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  const transcript = page.getByTestId('transcript');
  await expect(transcript).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('start-button')).toHaveAccessibleName(/start/i); // visible only while waiting
  await page.locator('body').focus();
  await page.keyboard.press('Space'); // arms
  await engine.waitForState(page, 'playing');
  await expect(transcript).toHaveText(fixtureScene('fx-eng-short', 's001').narration);
  await page.keyboard.press('Space'); // pause
  await expect(page.getByTestId('state')).toHaveText('paused');
  await page.keyboard.press('Space'); // resume
  await expect(page.getByTestId('state')).toHaveText('playing');
  await page.keyboard.press('ArrowRight'); // skip to s002 (ready)
  await engine.waitForScene(page, 's002');
  await expect(transcript).toHaveText(fixtureScene('fx-eng-short', 's002').narration);
  await page.keyboard.press('ArrowLeft'); // back to s001
  await engine.waitForScene(page, 's001');
  await expect(transcript).toHaveText(fixtureScene('fx-eng-short', 's001').narration);
  await page.keyboard.press('Shift+?');
  await expect(page.getByTestId('state')).toHaveText('thinking');
  await expect(page.getByTestId('question-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('state')).toHaveText('playing');
  // accessible names
  for (const [id, name] of [['pause-button', /pause|resume/i], ['ask-button', /ask/i], ['sidebar-item-s001', /scene s001/i], ['sidebar-toggle', /scene list/i], ['transcript-toggle', /transcript/i]]) {
    await expect(page.getByTestId(id)).toHaveAccessibleName(name);
  }
  await expect(page.getByTestId('sidebar')).toHaveAttribute('aria-label', 'Scenes');
  expect(errors).toEqual([]);
});

test('criterion 16a: fx-full-tour plays through to ended; summary shows scenes=10, degraded=0, svg=1, questions=0', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-full-tour');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 8 } });
  const want = Object.fromEntries(fixtureSceneIds('fx-full-tour').map((id) => [id, 'ready']));
  await engine.waitForStatuses(page, want);
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'ended', 100_000);
  const summary = page.getByTestId('summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute('data-scenes', '10');
  await expect(summary).toHaveAttribute('data-degraded', '0');
  await expect(summary).toHaveAttribute('data-svg', '1');
  await expect(summary).toHaveAttribute('data-questions', '0');
  await expect(page.getByTestId('summary-scenes')).toHaveText('10');
  // the server derived `ended` from the posted positions
  await expect.poll(async () => (await (await page.request.get(`/api/lesson/${lesson.lessonId}/status`)).json()).ended).toBe(true);
  // the pen is hidden once ended; the Ask button still works (criterion 13 covers the flow)
  expect(await page.evaluate(() => window.__khan.engine.pen.mode)).toBe('hidden');
  await expect(page.getByTestId('ask-button')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('criterion 18: letterboxing — 1000×1000 → 1000×562 centred vertically; 2000×900 → 1600×900 centred horizontally', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId);
  await page.setViewportSize({ width: 1000, height: 1000 });
  let box = await page.locator('#board').boundingBox();
  expect(Math.abs(box.width - 1000)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - 562.5)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y - (1000 - box.height) / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x)).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 2000, height: 900 });
  box = await page.locator('#board').boundingBox();
  expect(Math.abs(box.width - 1600)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - 900)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.x - 200)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y)).toBeLessThanOrEqual(2);
  // the chrome lives inside the board box
  const root = await page.locator('#engine-root').boundingBox();
  expect(Math.abs(root.x - box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(root.width - box.width)).toBeLessThanOrEqual(1);
  // a 320 px wide phone (QA finding 10): board 320×180, no horizontal page scroll, every toolbar button whole and inside the board
  await page.setViewportSize({ width: 320, height: 640 });
  box = await page.locator('#board').boundingBox();
  expect(Math.abs(box.width - 320)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - 180)).toBeLessThanOrEqual(2);
  const widths = () => page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    truncated: [...document.querySelectorAll('.eng-top .eng-btn')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
  }));
  let w = await widths();
  expect(w.doc).toBeLessThanOrEqual(320);
  expect(w.body).toBeLessThanOrEqual(320);
  expect(w.truncated).toEqual([]);
  for (const id of ['sidebar-toggle', 'start-button', 'pause-button', 'ask-button', 'transcript-toggle']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, id).not.toBeNull();
    expect(b.x, id).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, id).toBeLessThanOrEqual(320.5);
  }
  // and while playing (gate gone, state pill reads playing)
  await engine.waitForStatuses(page, { s001: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'playing');
  w = await widths();
  expect(w.doc).toBeLessThanOrEqual(320);
  expect(w.truncated).toEqual([]);
  expect(errors).toEqual([]);
});
