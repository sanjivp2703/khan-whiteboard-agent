// Slice 04 — missing audio, no key, degraded scenes in the summary/sidebar.
// Criteria 14, 15, 16b of briefs/04-player-engine.md.
//
// The silent provider never fails, so `audioUrl: null` and `tts.ready: false` are simulated by
// intercepting the SSE stream and serving the real playlist snapshot with those fields changed
// (engine-helpers.routeSse). Everything else (scenes, audio, position, question) hits the server.
import { test, expect } from '@playwright/test';
import { makeLesson, openLesson, collectErrors, recordPosts, engine, routeSse, waitForLessonKnown, sleep } from './engine-helpers.js';

async function waitAllReady(page, lessonId, ids) {
  await waitForLessonKnown(page, lessonId);
  await expect.poll(async () => {
    const pl = await (await page.request.get(`/api/lesson/${lessonId}/playlist`)).json();
    const got = Object.fromEntries(pl.entries.map((e) => [e.sceneId, e.status]));
    return ids.every((id) => got[id] === 'ready');
  }, { timeout: 20_000 }).toBe(true);
}

test('criterion 14: a ready entry with audioUrl null is skipped with a visible note; the next scene plays; start/end still posted', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-eng-skip');
  lesson.writeAll();
  await waitAllReady(page, lesson.lessonId, ['s001', 's002', 's003']);
  await routeSse(page, lesson.lessonId, (snap) => ({
    ...snap,
    entries: snap.entries.map((e) => (e.sceneId === 's002' ? { ...e, audioUrl: null, errors: [...e.errors, { elementId: null, code: 'TTS_FAILED', message: 'simulated TTS failure' }] } : e)),
  }));
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await expect(page.getByTestId('sidebar-item-s002')).toContainText('no audio');
  await page.getByTestId('start-button').click();
  await engine.waitForScene(page, 's003', 40_000);
  const note = page.getByTestId('scene-skipped-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('s002');
  await expect(note).toContainText('skipped: audio unavailable');
  // the skipped scene's board content is still on the board for the region scenes after it
  expect(await engine.drawn(page)).toEqual(expect.arrayContaining(['before', 'silent']));
  await engine.waitForState(page, 'ended', 40_000);
  const seq = posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`);
  expect(seq).toEqual(['start s001', 'end s001', 'start s002', 'end s002', 'start s003', 'end s003']);
  await expect.poll(async () => (await (await page.request.get(`/api/lesson/${lesson.lessonId}/status`)).json()).ended).toBe(true);
  expect(errors).toEqual([]);
});

test('criterion 15: tts.ready=false → prominent "OpenAI key required" note with the reason; Start disabled; clicking does not arm', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await waitAllReady(page, lesson.lessonId, ['s001', 's002', 's003']);
  await routeSse(page, lesson.lessonId, (snap) => ({ ...snap, tts: { provider: 'openai', voice: null, ready: false, reason: 'OPENAI_API_KEY not set' } }));
  await openLesson(page, lesson.lessonId);
  const note = page.getByTestId('tts-missing-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('OpenAI key required');
  await expect(note).toContainText('OPENAI_API_KEY not set');
  await expect(page.getByTestId('start-button')).toBeDisabled();
  await page.getByTestId('start-gate').click({ position: { x: 12, y: 12 } });
  await page.locator('body').focus();
  await page.keyboard.press('Space');
  await sleep(300);
  expect(await engine.state(page)).toBe('waiting');
  expect(await engine.drawn(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('criterion 16b: a degraded scene is marked in the sidebar and transcript and counted in the end summary', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-degrade-flow', { group: 'degrade' });
  lesson.writeOutline();
  lesson.writeScene('s001');
  lesson.writeScene('s003');
  // first attempt → rejected; the "rewrite" is still invalid → the server degrades it (drops `bad`)
  lesson.writeScene('s002');
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'rejected', s003: 'ready' });
  await expect(page.getByTestId('sidebar-item-s002')).toHaveAttribute('data-status', 'rejected');
  lesson.writeScene('s002', (s) => ({ ...s, narration: s.narration + ' Rewritten once more.' }));
  await engine.waitForStatuses(page, { s002: 'ready' });
  const entry = (await engine.playlist(page)).entries.find((e) => e.sceneId === 's002');
  expect(entry.degraded).toBe(true);
  expect(entry.droppedElementIds).toEqual(['bad']);
  await expect(page.getByTestId('sidebar-item-s002')).toHaveAttribute('data-degraded', 'true');
  await expect(page.getByTestId('sidebar-item-s002')).toContainText('degraded');
  await page.getByTestId('start-button').click();
  await engine.waitForScene(page, 's002', 30_000);
  await expect(page.getByTestId('transcript-degraded')).toBeVisible();
  await expect(page.getByTestId('transcript-degraded')).toContainText('1 element dropped');
  await page.waitForFunction(() => window.__khan.engine.drawnElementIds().length >= 2);
  expect(await engine.drawn(page)).not.toContain('bad');
  await engine.waitForState(page, 'ended', 40_000);
  await expect(page.getByTestId('summary')).toHaveAttribute('data-degraded', '1');
  await expect(page.getByTestId('summary')).toHaveAttribute('data-scenes', '3');
  await expect(page.getByTestId('summary-degraded')).toHaveText('1');
  await expect(page.getByTestId('transcript-degraded')).toBeHidden(); // s003 is fine
  expect(errors).toEqual([]);
});
