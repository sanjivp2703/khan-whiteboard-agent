// Slice 03 — browser smoke for the picture drawables through the harness (brief 03 criteria 9, 11, 12
// and the reload-determinism test). Screenshots land in test-results/renderer-pictures/ for a human.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(root, 'test-results', 'renderer-pictures');
const PICTURE_TYPES = ['sketch', 'diagram', 'plot', 'svg'];
const LESSONS = ['fx-type-sketch', 'fx-type-diagram', 'fx-type-plot', 'fx-type-svg', 'fx-pic-dense', 'fx-pic-shapes'];

function scenesOf(lessonId) {
  const dir = join(root, 'fixtures', 'lessons', lessonId, 'scenes');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function openHarness(page, lessonId, sceneId, u = 1) {
  await page.goto(`/harness/${lessonId}?scene=${sceneId}&u=${u}`);
  await page.waitForFunction(() => window.__khan && window.__khan.harness, null, { timeout: 20_000 });
  await page.evaluate(() => window.__khan.harness.ready);
}

for (const lessonId of LESSONS) {
  test(`harness: every scene of ${lessonId} paints with zero console errors, no DOM, pixels at u=1; screenshots saved`, async ({ page }) => {
    const errors = collectErrors(page);
    const scenes = scenesOf(lessonId);
    await openHarness(page, lessonId, scenes[0].sceneId, 1);
    const hook = await page.evaluate(() => ({ types: window.__khan.rendererPictures.types, registered: window.__khan.harness.modules.registry.types() }));
    expect(hook.types).toEqual(PICTURE_TYPES);
    for (const t of PICTURE_TYPES) expect(hook.registered).toContain(t);
    for (const scene of scenes) {
      const drawn = await page.evaluate((id) => window.__khan.harness.drawSceneAt(id, 1), scene.sceneId);
      for (const el of scene.elements) expect(drawn).toContain(el.id);
      for (const el of scene.elements.filter((e) => PICTURE_TYPES.includes(e.type))) {
        const d = await page.evaluate((id) => { const x = window.__khan.harness.drawableOf(id); return x && { type: x.type, parts: x.parts, paths: x.paths.length, kind: x.picture && x.picture.kind, bounds: x.bounds }; }, el.id);
        expect(d, `${scene.sceneId}/${el.id}`).not.toBeNull();
        expect(d.type).toBe(el.type);
        expect(d.kind).toBe(el.type);
        expect(d.parts).toBeGreaterThanOrEqual(1);
        expect(d.paths).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => window.__khan.harness.nonBackgroundPixelCount()), `${scene.sceneId} pixels at u=1`).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.querySelectorAll('svg, img, foreignObject, image, use').length)).toBe(0);
      await page.locator('#board-wrap').screenshot({ path: join(SHOTS, `${lessonId}-${scene.sceneId}.png`) });
    }
    // partial reveal draws fewer pixels than the full board (first scene, u = 0.3)
    const full = await page.evaluate((id) => window.__khan.harness.drawSceneAt(id, 1).then(() => window.__khan.harness.nonBackgroundPixelCount()), scenes[0].sceneId);
    const partial = await page.evaluate((id) => window.__khan.harness.drawSceneAt(id, 0.3).then(() => window.__khan.harness.nonBackgroundPixelCount()), scenes[0].sceneId);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
    await page.locator('#board-wrap').screenshot({ path: join(SHOTS, `${lessonId}-${scenes[0].sceneId}-u030.png`) });
    const ignored = await page.evaluate(() => window.__khan.rendererPictures.ignored.length);
    expect(ignored).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('determinism across reloads: fx-type-diagram s002 (8 nodes / 12 edges) yields string-equal paths three times', async ({ page }) => {
  const errors = collectErrors(page);
  const runs = [];
  for (let i = 0; i < 3; i++) {
    await openHarness(page, 'fx-type-diagram', 's002', 1);
    runs.push(await page.evaluate(() => { const d = window.__khan.harness.drawableOf('max'); return { paths: d.paths.join('|'), bounds: JSON.stringify(d.bounds), parts: d.parts }; }));
  }
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[2]).toEqual(runs[0]);
  expect(runs[0].parts).toBe(20);
  expect(errors).toEqual([]);
});

test('performance: paint(ctx, 1) of the dense scene (all four types) is fast in Chromium; prepare under the budget', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, 'fx-pic-dense', 's001', 1);
  const timing = await page.evaluate(() => {
    const ids = window.__khan.harness.drawnIds();
    const drawables = ids.map((id) => window.__khan.harness.drawableOf(id));
    const canvas = document.createElement('canvas');
    canvas.width = 1600; canvas.height = 900;
    const ctx = canvas.getContext('2d');
    for (const d of drawables) d.paint(ctx, 1); // warm Path2D caches
    const t0 = performance.now();
    for (const d of drawables) d.paint(ctx, 1);
    const paintMs = performance.now() - t0;
    return { paintMs, count: drawables.length, lastPrepareMs: window.__khan.rendererPictures.lastPrepareMs, prepared: window.__khan.rendererPictures.prepared };
  });
  expect(timing.count).toBe(4);
  expect(timing.paintMs).toBeLessThan(150); // 50 ms budget × 3 margin
  expect(timing.prepared).toBeGreaterThanOrEqual(4);
  expect(timing.lastPrepareMs).toBeLessThan(450);
  expect(errors).toEqual([]);
});

test('reveal at u=0 paints nothing for a lone sketch scene; u=1 paints it', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, 'fx-type-sketch', 's003', 0);
  expect(await page.evaluate(() => window.__khan.harness.nonBackgroundPixelCount())).toBe(0);
  await page.evaluate(() => window.__khan.harness.drawSceneAt('s003', 1));
  expect(await page.evaluate(() => window.__khan.harness.nonBackgroundPixelCount())).toBeGreaterThan(500);
  expect(errors).toEqual([]);
});
