// change-player-ui — the viewer's chrome (design/03-player-ui-study.md, redirected 2026-10-13; spec §6
// "Player chrome", §10). A chaptered progress bar, elapsed / total, "Chapter N of M", the Chapters
// panel beside the board, the transcript strip, the start gate, the end card and the voice banner —
// and nothing a developer needs: no state names, scene ids or counts in the visible text.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeLesson, openLesson, collectErrors, engine, routeSse, waitForLessonKnown, fixtureSceneIds, ROOT } from './engine-helpers.js';

const SHOTS = join(ROOT, 'test-results', 'ui');
const VOICE_START = 'No voice yet — add your OpenAI key to hear khan speak.';
const VOICE_MID = 'Voice unavailable right now — the board keeps going.';

/** Every text node of the chrome that is actually rendered (not display:none, hidden, or visually hidden 1 px boxes). */
async function visibleChromeText(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.getElementById('engine-root'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const p = n.parentElement;
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = p.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      out.push(t);
    }
    return out.join(' | ');
  });
}

async function settled(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), null, { timeout: 5_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('chrome: one progress segment per chapter (dotted while not ready), m:ss / m:ss, "Chapter N of M", segment click jumps, s / t toggle, no scene ids or state names visible', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeOutline();
  lesson.writeScene('s001');
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 2 } });
  await engine.waitForStatuses(page, { s001: 'ready' });
  // start gate: title, hint from the outline (3 chapters; 1 known duration + 2 × 10 s ≈ 1 min)
  await expect(page.getByTestId('start-gate')).toBeVisible();
  await expect(page.getByTestId('start-hint')).toHaveText(/^3 chapters · about \d+ min · press space to start$/);
  await expect(page.getByTestId('start-button')).toBeEnabled();
  // progress: one segment per scene in the outline; s002 / s003 dotted (not ready); the total is approximate
  const segs = page.locator('.eng-seg');
  await expect(segs).toHaveCount(3);
  await expect(page.getByTestId('progress-segment-s001')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('progress-segment-s002')).toHaveAttribute('data-ready', 'false');
  await expect(page.getByTestId('progress-segment-s003')).toHaveAttribute('data-ready', 'false');
  expect(await page.getByTestId('progress-segment-s002').evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('dotted');
  await expect(page.getByTestId('time-elapsed')).toHaveText('0:00');
  await expect(page.getByTestId('time-total')).toHaveText(/^~\d+:\d{2}$/);
  // the chapters panel: numbers and titles, "soon" for scenes not ready, no ids, no badges
  await expect(page.getByTestId('sidebar-item-s001')).toHaveText(/^1One\d+:\d{2}$/);
  await expect(page.getByTestId('sidebar-item-s002')).toHaveText('2Twosoon');
  await expect(page.getByTestId('sidebar-item-s002')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('shortcut-hint')).toHaveText('space pause · ← → chapters · ? ask');
  // the rest arrives: segments turn solid, the total loses its "~"
  lesson.writeScene('s002'); lesson.writeScene('s003');
  await engine.waitForStatuses(page, { s002: 'ready', s003: 'ready' });
  await expect(page.getByTestId('progress-segment-s003')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('time-total')).toHaveText(/^\d+:\d{2}$/);
  const total = await page.getByTestId('time-total').textContent();
  const pl = await engine.playlist(page);
  const sumMs = pl.entries.reduce((a, e) => a + e.durationMs, 0);
  const [mm, ss] = total.split(':').map(Number);
  expect(Math.abs(mm * 60 + ss - sumMs / 1000)).toBeLessThanOrEqual(2);

  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 0.5);
  await expect(page.getByTestId('chapter-label')).toHaveText('Chapter 1 of 3');
  await expect(page.getByTestId('chapter-title')).toHaveText('One');
  await expect(page.getByTestId('pause-button')).toHaveAccessibleName('Pause');
  await expect(page.getByTestId('time-elapsed')).toHaveText(/^\d+:\d{2}$/);
  // elapsed moves (~4 Hz updates), the current segment fills
  await expect.poll(async () => page.getByTestId('progress-segment-s001').evaluate((e) => parseFloat(e.style.getPropertyValue('--p'))), { timeout: 10_000 }).toBeGreaterThan(5);
  await expect(page.getByTestId('progress-segment-s001')).toHaveAttribute('data-current', 'true');
  // nothing developer-facing is visible while playing: no scene ids, no state names, no counts
  const text = await visibleChromeText(page);
  expect(text).not.toMatch(/\bs0\d\d\b/);
  expect(text).not.toMatch(/\b(waiting|armed|playing|paused|stalled|thinking|ended|degraded|svg|planned|rejected)\b/i);
  expect(text).toContain('Chapter 1 of 3');
  // the state testid is still in the DOM with the engine's state name, just not visible
  await expect(page.getByTestId('state')).toHaveText('playing');
  const stateBox = await page.getByTestId('state').boundingBox();
  expect(stateBox.width).toBeLessThanOrEqual(1);
  // clicking a segment jumps to that scene's start (within-scene scrubbing is deferred)
  await page.getByTestId('progress-segment-s003').click();
  await engine.waitForScene(page, 's003', 10_000);
  expect((await engine.audio(page)).currentTime).toBeLessThan(1);
  await expect(page.getByTestId('chapter-label')).toHaveText('Chapter 3 of 3');
  await expect(page.getByTestId('chapter-title')).toHaveText('Three');
  await expect(page.getByTestId('progress-segment-s001')).toHaveAttribute('data-played', 'true');
  await expect(page.getByTestId('sidebar-item-s001')).not.toHaveAttribute('aria-current', 'true'); // not current any more
  await expect(page.getByTestId('sidebar-item-s003')).toHaveAttribute('aria-current', 'true');
  // the hover tip names the chapter with its start time
  const seg2 = await page.getByTestId('progress-segment-s002').boundingBox();
  await page.mouse.move(seg2.x + seg2.width / 2, seg2.y + seg2.height / 2);
  await expect(page.locator('.eng-tip')).toBeVisible();
  await expect(page.locator('.eng-tip')).toHaveText(/^\d+:\d{2}Two$/);
  await page.mouse.move(5, 5);
  // `t` expands the transcript strip to the full text and shows the chapter title; `t` again collapses it
  await page.locator('body').focus();
  await expect(page.getByTestId('transcript-panel')).toHaveAttribute('data-expanded', 'false');
  await expect(page.getByTestId('transcript-scene')).toBeHidden();
  await page.keyboard.press('t');
  await expect(page.getByTestId('transcript-panel')).toHaveAttribute('data-expanded', 'true');
  await expect(page.getByTestId('transcript-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('transcript-scene')).toHaveText('Three');
  await page.keyboard.press('t');
  await expect(page.getByTestId('transcript-panel')).toHaveAttribute('data-expanded', 'false');
  // `s` pins the chapters panel open while playing (and the top-bar button mirrors it)
  await page.keyboard.press('s');
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'true');
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'false');
  expect(errors).toEqual([]);
});

test('chrome: end card — "Lesson complete", title · N chapters, all segments played; Replay jumps to the first chapter; the question count appears only when asked', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'ended', 40_000);
  const summary = page.getByTestId('summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('Lesson complete');
  await expect(page.getByTestId('summary-line')).toHaveText('Three short scenes · 3 chapters');
  await expect(summary).toContainText('or pick a chapter to watch it again');
  for (const id of ['s001', 's002', 's003']) await expect(page.getByTestId(`progress-segment-${id}`)).toHaveAttribute('data-played', 'true');
  await expect(page.getByTestId('time-elapsed')).toHaveText(await page.getByTestId('time-total').textContent());
  const text = await visibleChromeText(page);
  expect(text).not.toMatch(/\bs0\d\d\b|scenes played|svg|degraded/i);
  // the developer counts survive, visually hidden
  await expect(page.getByTestId('summary-scenes')).toHaveText('3');
  await expect(summary).toHaveAttribute('data-questions', '0');
  // Replay: the first chapter plays again, the card goes away
  await page.getByTestId('replay-button').click();
  await engine.waitForScene(page, 's001', 20_000);
  expect(await engine.state(page)).toBe('playing');
  await expect(summary).toBeHidden();
  await expect(page.getByTestId('chapter-label')).toHaveText('Chapter 1 of 3');
  expect(errors).toEqual([]);
});

test('chrome: voice banner — one plain sentence before start when there is no key (never the provider reason); a key lost mid-lesson says the board keeps going', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  // before start
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await waitForLessonKnown(page, lesson.lessonId);
  await routeSse(page, lesson.lessonId, (snap) => ({ ...snap, tts: { provider: 'openai', voice: null, ready: false, reason: 'OPENAI_API_KEY not set' } }));
  await openLesson(page, lesson.lessonId);
  const banner = page.getByTestId('tts-missing-note');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(VOICE_START);
  expect(await visibleChromeText(page)).not.toContain('OPENAI_API_KEY');
  await expect(page.getByTestId('start-button')).toBeDisabled();
  await page.unroute(`**/api/lesson/${lesson.lessonId}/events`);

  // mid-lesson: the first snapshot is healthy, every later one (the stream reconnects) reports the key rejected
  const lesson2 = makeLesson('fx-eng-short');
  lesson2.writeAll();
  await waitForLessonKnown(page, lesson2.lessonId);
  let served = 0;
  await routeSse(page, lesson2.lessonId, (snap) => (++served === 1 ? snap : { ...snap, tts: { provider: 'openai', voice: 'ash', ready: false, reason: 'OpenAI rejected the key (401)' } }));
  await openLesson(page, lesson2.lessonId, { config: { playbackRate: 1 } });
  await expect(banner).toBeHidden();
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'playing');
  await expect(banner).toHaveText(VOICE_MID, { timeout: 30_000 });
  expect(await visibleChromeText(page)).not.toMatch(/401|rejected/);
  expect(['playing', 'paused', 'stalled', 'ended']).toContain(await engine.state(page)); // the board kept going
  expect(errors).toEqual([]);
});

test('chrome: phone width 390×780 — one column, board full width, controls and chapters under it, no horizontal scroll', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-full-tour');
  lesson.writeAll();
  await page.setViewportSize({ width: 390, height: 780 });
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 2 } });
  await engine.waitForStatuses(page, { s001: 'ready' });
  await settled(page);
  await page.screenshot({ path: join(SHOTS, 'phone-390x780-start.png') });
  const noScroll = async (label) => {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, root: document.getElementById('engine-root').scrollWidth, win: window.innerWidth }));
    expect(w.doc, `${label}: no horizontal scroll`).toBeLessThanOrEqual(w.win);
    expect(w.body, `${label}: no horizontal scroll (body)`).toBeLessThanOrEqual(w.win);
    expect(w.root, `${label}: no horizontal scroll (chrome)`).toBeLessThanOrEqual(w.win);
  };
  await noScroll('start');
  const area = await page.getByTestId('board-area').boundingBox();
  let board = await page.locator('#board').boundingBox();
  expect(Math.abs(board.width - area.width)).toBeLessThanOrEqual(2); // full width of its area
  expect(board.width).toBeGreaterThanOrEqual(360);
  expect(Math.abs(board.width / board.height - 16 / 9)).toBeLessThan(0.02);
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 1.0);
  await page.locator('body').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('state')).toHaveText('paused');
  await settled(page);
  board = await page.locator('#board').boundingBox();
  const controls = await page.locator('.eng-controls').boundingBox();
  const transcript = await page.getByTestId('transcript').boundingBox();
  const rail = await page.getByTestId('sidebar').boundingBox();
  expect(controls.y).toBeGreaterThanOrEqual(board.y + board.height - 0.5);
  expect(transcript.y).toBeGreaterThanOrEqual(controls.y + controls.height - 0.5);
  expect(rail.y).toBeGreaterThanOrEqual(transcript.y + transcript.height - 0.5);
  expect(rail.width).toBeGreaterThan(300); // a full-width list, not a side rail
  for (const id of ['pause-button', 'ask-button', 'transcript-toggle', 'sidebar-toggle']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, id).not.toBeNull();
    expect(b.x, id).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, id).toBeLessThanOrEqual(390.5);
  }
  await noScroll('paused');
  await page.screenshot({ path: join(SHOTS, 'phone-390x780-paused.png') });
  expect(errors).toEqual([]);
});

test('chrome: screenshots at 1280×720 — start gate, playing, thinking with the question form, ended (test-results/ui/)', async ({ page }) => {
  test.setTimeout(170_000);
  mkdirSync(SHOTS, { recursive: true });
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-full-tour');
  lesson.writeAll();
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 6 } });
  await engine.waitForStatuses(page, Object.fromEntries(fixtureSceneIds('fx-full-tour').map((id) => [id, 'ready'])));
  await settled(page);
  await page.screenshot({ path: join(SHOTS, 'desktop-1280x720-start.png') });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's002', 1.5, 60_000);
  await page.mouse.move(640, 300);
  await settled(page);
  await page.screenshot({ path: join(SHOTS, 'desktop-1280x720-playing.png') });
  await page.locator('body').focus();
  await page.keyboard.press('Shift+?');
  await expect(page.getByTestId('state')).toHaveText('thinking');
  await page.getByTestId('question-input').fill('Why does this matter?');
  await settled(page); // the chapters panel re-expands (not playing) before the shot
  await page.screenshot({ path: join(SHOTS, 'desktop-1280x720-thinking-question.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('state')).toHaveText('playing');
  await engine.waitForState(page, 'ended', 120_000);
  await settled(page);
  await page.screenshot({ path: join(SHOTS, 'desktop-1280x720-ended.png') });
  await expect(page.getByTestId('summary-line')).toHaveText(/ · 10 chapters$/);
  expect(errors).toEqual([]);
});
