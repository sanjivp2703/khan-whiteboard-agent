// Slice 04 fix lane — backlog #19 (chrome outside the board) and #20 (notes unique per scene).
//
// Spec §10: "a live transcript of the current narration is visible under the board"; chrome never
// hides board content. The human's first real lesson showed the expanded scene rail covering the
// left ~390 px of the board while `stalled`, and the transcript bar overlaying its bottom edge.
// These tests pin the layout contract: while `stalled` or `paused` with the rail expanded, no
// element of the board plan lies under the rail, the transcript sits outside the board canvas,
// and the only things stacked over the board are the pen canvas and the engine's overlay layer
// (start gate, caption, question form, summary).
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeLesson, openLesson, collectErrors, engine, routeSse, waitForLessonKnown, ROOT } from './engine-helpers.js';

const SHOTS = join(ROOT, 'test-results', 'look');
const BOARD_W = 1600;
const BOARD_H = 900;

/** Wait for the rail's width transition (and any other CSS animation) to finish, then two frames. */
async function settled(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), null, { timeout: 5_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const intersects = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const fmt = (r) => (r ? `[${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}]` : 'null');

/** Board-plan element bounds (board px, from the engine's drawables) mapped to viewport px through the board's CSS scale. */
async function elementRects(page) {
  const board = await page.locator('#board').boundingBox();
  const bounds = await page.evaluate(() => {
    const cur = window.__khan.engine.current;
    if (!cur) return [];
    return [...cur.drawables].map(([id, d]) => ({ id, ...d.bounds }));
  });
  const sx = board.width / BOARD_W;
  const sy = board.height / BOARD_H;
  return { board, elements: bounds.map((b) => ({ id: b.id, x: board.x + b.x * sx, y: board.y + b.y * sy, width: b.w * sx, height: b.h * sy })) };
}

/**
 * Every element stacked above the board canvas at a 9×5 grid of points must be the pen canvas or
 * part of the engine's overlay layer (gate / caption / question form / summary). Returns offenders.
 */
async function strangersOverBoard(page) {
  return page.evaluate(() => {
    const board = document.getElementById('board');
    const r = board.getBoundingClientRect();
    const bad = new Set();
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 5; j++) {
        const x = r.x + ((i + 0.5) / 9) * r.width;
        const y = r.y + ((j + 0.5) / 5) * r.height;
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === board) break;
          if (el.id === 'pen' || el.closest('.eng-overlay')) continue;
          bad.add(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''}`);
        }
      }
    }
    return [...bad];
  });
}

async function assertChromeOutsideBoard(page, label) {
  await settled(page);
  const { board, elements } = await elementRects(page);
  expect(elements.length, `${label}: the board plan has elements`).toBeGreaterThan(0);
  const rail = await page.getByTestId('sidebar').boundingBox();
  const transcript = await page.getByTestId('transcript').boundingBox();
  const panel = await page.getByTestId('transcript-panel').boundingBox();
  const toolbar = await page.locator('.eng-top').boundingBox();
  expect(rail, `${label}: rail visible`).not.toBeNull();
  expect(await page.getByTestId('sidebar').getAttribute('data-expanded'), `${label}: rail expanded`).toBe('true');
  for (const el of elements) {
    expect(intersects(el, rail), `${label}: element ${el.id} ${fmt(el)} lies under the rail ${fmt(rail)}`).toBe(false);
    expect(intersects(el, panel), `${label}: element ${el.id} ${fmt(el)} lies under the transcript panel ${fmt(panel)}`).toBe(false);
    expect(intersects(el, toolbar), `${label}: element ${el.id} ${fmt(el)} lies under the toolbar ${fmt(toolbar)}`).toBe(false);
  }
  expect(intersects(rail, board), `${label}: rail ${fmt(rail)} intersects the board ${fmt(board)}`).toBe(false);
  expect(intersects(transcript, board), `${label}: transcript ${fmt(transcript)} intersects the board ${fmt(board)}`).toBe(false);
  expect(intersects(panel, board), `${label}: transcript panel ${fmt(panel)} intersects the board ${fmt(board)}`).toBe(false);
  expect(intersects(toolbar, board), `${label}: toolbar ${fmt(toolbar)} intersects the board ${fmt(board)}`).toBe(false);
  // the transcript is UNDER the board (spec §10), the toolbar above it, the rail to its left
  expect(transcript.y, `${label}: transcript below the board`).toBeGreaterThanOrEqual(board.y + board.height - 0.5);
  expect(toolbar.y + toolbar.height, `${label}: toolbar above the board`).toBeLessThanOrEqual(board.y + 0.5);
  // the rail is beside the board (change-player-ui: the Chapters panel sits to its RIGHT) or, on a
  // phone, stacked under it as a list — entirely on one side, never over it
  const railLeft = rail.x + rail.width <= board.x + 0.5;
  const railRight = rail.x >= board.x + board.width - 0.5;
  const railAbove = rail.y + rail.height <= board.y + 0.5;
  const railBelow = rail.y >= board.y + board.height - 0.5;
  expect(railLeft || railRight || railAbove || railBelow, `${label}: rail ${fmt(rail)} is entirely beside, above or below the board ${fmt(board)}`).toBe(true);
  expect(await strangersOverBoard(page), `${label}: only the pen and the overlay layer may stack over the board`).toEqual([]);
  // the board is still a 16:9 canvas with no horizontal page scroll
  expect(Math.abs(board.width / board.height - 16 / 9), `${label}: board aspect`).toBeLessThan(0.02);
  const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(scroll.doc, `${label}: no horizontal scroll`).toBeLessThanOrEqual(scroll.win);
}

test('backlog #19: while stalled or paused with the rail expanded, no board element lies under the rail; transcript and toolbar sit outside the board; only the pen and overlay stack over it', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-build-region');
  lesson.writeOutline();
  lesson.writeScene('s001'); // title in A1:C1 and a box in B2:C3 — exactly what the rail covered in the human's screenshot
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4, stallCaptionMs: 300, stuckCaptionMs: 60_000 } });
  await engine.waitForStatuses(page, { s001: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'stalled', 30_000);
  await expect(page.getByTestId('caption')).toHaveText('khan is thinking…', { timeout: 5_000 });
  await assertChromeOutsideBoard(page, 'stalled 1280×720');
  // the caption is small, translucent, in the board's bottom-right corner, and does not cover any element
  const caption = await page.getByTestId('caption').boundingBox();
  const { board, elements } = await elementRects(page);
  expect(caption).not.toBeNull();
  expect(caption.x + caption.width).toBeLessThanOrEqual(board.x + board.width + 0.5);
  expect(caption.y + caption.height).toBeLessThanOrEqual(board.y + board.height + 0.5);
  expect(caption.x).toBeGreaterThan(board.x + board.width / 2);
  expect(caption.y).toBeGreaterThan(board.y + board.height * 0.7);
  for (const el of elements) expect(intersects(el, caption), `caption ${fmt(caption)} covers ${el.id} ${fmt(el)}`).toBe(false);
  await page.screenshot({ path: join(SHOTS, 'layout-stalled-1280x720.png') });

  // the producer catches up; pause mid-s002 → the rail expands again (not playing) and must still stay off the board
  lesson.writeScene('s002');
  await engine.waitForSceneTime(page, 's002', 0.5, 30_000);
  await page.locator('body').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('state')).toHaveText('paused');
  const drawnBefore = await engine.drawn(page);
  await assertChromeOutsideBoard(page, 'paused 1280×720');

  // hovering the rail expands it in place: the board re-letterboxes instead of being covered
  const collapsedBoard = await page.locator('#board').boundingBox();
  await page.getByTestId('sidebar-toggle').click(); // pin
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'true');
  const rail = await page.getByTestId('sidebar').boundingBox();
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
  await assertChromeOutsideBoard(page, 'paused + pinned + hovered 1280×720');
  await page.getByTestId('sidebar-toggle').click(); // unpin (still expanded: paused)
  await page.mouse.move(5, 5);

  // extreme viewports: phone portrait and a very wide, short window
  for (const [w, h] of [[320, 640], [3000, 400]]) {
    await page.setViewportSize({ width: w, height: h });
    await assertChromeOutsideBoard(page, `paused ${w}×${h}`);
    await page.screenshot({ path: join(SHOTS, `layout-paused-${w}x${h}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await settled(page);
  await page.screenshot({ path: join(SHOTS, 'layout-paused-1280x720.png') });
  // drawing state survived every re-letterbox (no reload): the drawn set is unchanged and still paused
  expect(await engine.drawn(page)).toEqual(drawnBefore);
  expect(await engine.state(page)).toBe('paused');
  expect(collapsedBoard.width).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('backlog #19: collapsing and expanding the rail re-letterboxes the board inside the board area while playing', async ({ page }) => {
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  // change-player-ui: 1280×1000, not ×720 — the viewer chrome (gutter, progress bar, 48 px row, two
  // caption lines) leaves a 720 px window height-bound in BOTH rail states, so the board could not
  // grow on unpin; a taller window keeps the board width-bound and every assertion below meaningful
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 1 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 0.3);
  await page.mouse.move(640, 980); // away from the rail
  // playing, unpinned → collapsed strip (~24 px); the board fills the rest of the area
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-expanded', 'false');
  await settled(page);
  const area0 = await page.getByTestId('board-area').boundingBox();
  const rail0 = await page.getByTestId('sidebar').boundingBox();
  const board0 = await page.locator('#board').boundingBox();
  expect(rail0.width).toBeGreaterThanOrEqual(16);
  expect(rail0.width).toBeLessThanOrEqual(40);
  expect(intersects(rail0, board0)).toBe(false);
  // pinning (key `s`) expands the rail to ~300 px and the board shrinks to the largest 16:9 box in the smaller area
  await page.locator('body').focus();
  await page.keyboard.press('s');
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-pinned', 'true');
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-expanded', 'true');
  await expect.poll(async () => (await page.getByTestId('sidebar').boundingBox()).width, { timeout: 5_000 }).toBeGreaterThan(200);
  await settled(page);
  const rail1 = await page.getByTestId('sidebar').boundingBox();
  const area1 = await page.getByTestId('board-area').boundingBox();
  const board1 = await page.locator('#board').boundingBox();
  expect(rail1.width).toBeLessThanOrEqual(340);
  expect(intersects(rail1, board1)).toBe(false);
  expect(area1.width).toBeLessThan(area0.width);
  expect(Math.abs(area1.width - (area0.width - (rail1.width - rail0.width)))).toBeLessThanOrEqual(2);
  for (const [label, area, board] of [['collapsed', area0, board0], ['expanded', area1, board1]]) {
    const fitW = Math.min(area.width, (area.height * 16) / 9);
    expect(Math.abs(board.width - fitW), `${label}: largest 16:9 box in ${fmt(area)} is ${Math.round(fitW)} wide, board is ${fmt(board)}`).toBeLessThanOrEqual(2);
    expect(Math.abs(board.height - (fitW * 9) / 16), `${label}: board height`).toBeLessThanOrEqual(2);
    expect(Math.abs(board.x + board.width / 2 - (area.x + area.width / 2)), `${label}: centred horizontally`).toBeLessThanOrEqual(2);
    expect(Math.abs(board.y + board.height / 2 - (area.y + area.height / 2)), `${label}: centred vertically`).toBeLessThanOrEqual(2);
  }
  // still playing, same scene, drawing continued (no reload)
  expect(await engine.state(page)).toBe('playing');
  expect((await engine.position(page)).sceneId).toBe('s001');
  await page.keyboard.press('s'); // unpin → collapses again while playing
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-expanded', 'false');
  await expect.poll(async () => (await page.locator('#board').boundingBox()).width, { timeout: 5_000 }).toBeGreaterThan(board1.width);
  expect(errors).toEqual([]);
});

test('backlog #20: a scene skipped for missing audio gets ONE note per scene, even after a rewind replays it', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-skip');
  lesson.writeAll();
  await waitForLessonKnown(page, lesson.lessonId);
  await expect.poll(async () => {
    const pl = await (await page.request.get(`/api/lesson/${lesson.lessonId}/playlist`)).json();
    return pl.entries.every((e) => e.status === 'ready');
  }, { timeout: 20_000 }).toBe(true);
  await routeSse(page, lesson.lessonId, (snap) => ({
    ...snap,
    entries: snap.entries.map((e) => (e.sceneId === 's002' ? { ...e, audioUrl: null, errors: [...e.errors, { elementId: null, code: 'TTS_FAILED', message: 'simulated TTS failure' }] } : e)),
  }));
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await page.getByTestId('start-button').click();
  await engine.waitForScene(page, 's003', 40_000);
  await expect(page.getByTestId('scene-skipped-note')).toHaveCount(1);
  await expect(page.getByTestId('scene-skipped-note')).toHaveText('Skipped one chapter that had no voice.'); // change-player-ui wording: no scene id
  // rewind to s001: a second pass over s002 skips it again...
  await page.getByTestId('sidebar-item-s001').click();
  await page.waitForFunction(() => window.__khan.engine.events.filter((e) => e.type === 'scene-skipped' && e.sceneId === 's002').length >= 2, null, { timeout: 40_000 });
  await engine.waitForScene(page, 's003', 40_000);
  // ...but the note is not duplicated: notes are unique per (sceneId, kind)
  await expect(page.getByTestId('scene-skipped-note')).toHaveCount(1);
  await expect(page.getByTestId('scene-skipped-note')).toHaveText('Skipped one chapter that had no voice.');
  // a third pass via ← ← from s003 also adds nothing
  await page.locator('body').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => window.__khan.engine.events.filter((e) => e.type === 'scene-skipped' && e.sceneId === 's002').length >= 3, null, { timeout: 40_000 });
  await expect(page.getByTestId('scene-skipped-note')).toHaveCount(1);
  expect(errors).toEqual([]);
});
