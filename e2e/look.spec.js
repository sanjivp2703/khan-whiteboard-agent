// Design cycle 1 — the Khan Academy look in the real player: the board is painted in the boardBg
// token (pure black), the pen overlay shows the white arrow pointer with its tip at the engine's
// point, and a screenshot of the playing shell lands in test-results/look/ for a human to eyeball.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeLesson, openLesson, collectErrors, engine, ROOT } from './engine-helpers.js';

const SHOTS = join(ROOT, 'test-results', 'look');

test('look: black board from the token, white arrow cursor at the pen tip, screenshot of the playing shell', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-full-tour');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId);
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'playing');
  // let the first scene get some ink on the board, then catch the pen mid-stroke
  await engine.waitForSceneTime(page, 's001', 1.5);
  await page.waitForFunction(() => { const p = window.__khan.engine.pen; return p.mode === 'draw' && p.tip !== null; }, null, { timeout: 20_000, polling: 15 });
  await page.keyboard.press('Space'); // park the pen so the sample below is stable
  await expect(page.getByTestId('state')).toHaveText('paused');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const sample = await page.evaluate(() => {
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const tokens = window.__khan.tokens;
    const board = document.getElementById('board').getContext('2d');
    const pen = document.getElementById('pen').getContext('2d');
    const tip = window.__khan.engine.pen.tip;
    const px = (ctx, x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    // inside the arrow body (just below-right of the tip), and just left of its vertical edge
    return {
      mode: window.__khan.engine.pen.mode,
      tip,
      boardBg: hex(tokens.boardBg),
      corner: px(board, 2, 2),
      inside: px(pen, tip.x + 3, tip.y + 8),
      outside: px(pen, tip.x - 6, tip.y + 8), // beyond the outline and its 3 px shadow blur
    };
  });
  expect(sample.mode).toBe('park');
  expect(sample.boardBg).toEqual([0, 0, 0]);
  expect(sample.corner.slice(0, 3)).toEqual(sample.boardBg); // the board is painted in boardBg (pure black)
  const [r, g, b, a] = sample.inside;
  expect(a, `arrow body alpha at tip+(3,8) ${sample.inside} (tip ${JSON.stringify(sample.tip)})`).toBeGreaterThan(150);
  expect(Math.min(r, g, b), `arrow body is white ${sample.inside}`).toBeGreaterThan(200);
  expect(sample.outside[3], `left of the arrow's edge is (near) empty ${sample.outside}`).toBeLessThan(8);

  await page.locator('#board-wrap').screenshot({ path: join(SHOTS, 'shell-paused-s001.png') });
  await page.keyboard.press('Space');
  await engine.waitForScene(page, 's002');
  await engine.waitForSceneTime(page, 's002', 2);
  await page.locator('#board-wrap').screenshot({ path: join(SHOTS, 'shell-playing-s002.png') });
  expect(errors).toEqual([]);
});
