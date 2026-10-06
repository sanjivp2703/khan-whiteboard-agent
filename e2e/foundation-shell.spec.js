// Shell page: loads for fx-full-tour with zero console errors; the debug panel lists every scene `ready`.
import { test, expect } from '@playwright/test';

function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
  return errors;
}

test('shell loads fx-full-tour, zero console errors, debug panel shows all 10 scenes ready', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/lesson/fx-full-tour?debug=1');
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#debug')).toBeVisible();
  await expect(page.locator('#debug-playlist li')).toHaveCount(10);
  await expect.poll(async () => page.locator('#debug-playlist li[data-status="ready"]').count(), { timeout: 20_000 }).toBe(10);
  const ids = await page.locator('#debug-playlist li').evaluateAll((els) => els.map((e) => e.dataset.sceneId));
  expect(ids).toEqual(['s001', 's002', 's003', 's004', 's005', 's006', 's007', 's008', 's009', 's010']);
  const meta = await page.locator('#debug-meta').textContent();
  expect(meta).toContain('How the response cache works');
  // tokens applied to :root from JS, canvases sized to the board contract
  const vars = await page.evaluate(() => ({
    bg: getComputedStyle(document.documentElement).getPropertyValue('--khan-board-bg').trim(),
    accent1: getComputedStyle(document.documentElement).getPropertyValue('--khan-accent1').trim(),
    board: [document.getElementById('board').width, document.getElementById('board').height],
    pen: [document.getElementById('pen').width, document.getElementById('pen').height],
    hooks: Object.keys(window.__khan).sort(),
    engineStub: window.__khan.engine && window.__khan.engine.stub === true,
  }));
  expect(vars.bg).toMatch(/^#[0-9a-f]{6}$/i);
  expect(vars.accent1).toMatch(/^#[0-9a-f]{6}$/i);
  expect(vars.board).toEqual([1600, 900]);
  expect(vars.pen).toEqual([1600, 900]);
  expect(vars.hooks).toEqual(expect.arrayContaining(['engine', 'registry', 'tokens', 'constants', 'lessonId']));
  expect(vars.engineStub).toBe(false); // slice 04 replaced the foundation stub (hooks keep `playlist` and the debug panel)
  expect(errors).toEqual([]);
});

test('shell without ?debug keeps the panel hidden and the engine root present', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/lesson/fx-type-text');
  await expect(page.locator('#debug')).toBeHidden();
  await expect(page.locator('#engine-root')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => (window.__khan.engine.playlist || { entries: [] }).entries.length)).toBe(3);
  expect(errors).toEqual([]);
});
