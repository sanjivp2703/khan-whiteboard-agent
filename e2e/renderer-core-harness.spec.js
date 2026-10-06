// Renderer core (slice 02) in Chromium through the foundation harness (brief 02 criteria 12–14,
// plus the list reveal order): every fixture scene of the eight core types paints with zero
// console errors, u=0 paints nothing for a single text element, no SVG ever reaches the DOM,
// paint stays fast, and screenshots land in test-results/renderer-core/ for a human to eyeball.
import { test, expect } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shotDir = join(root, 'test-results', 'renderer-core');
mkdirSync(shotDir, { recursive: true });

const CORE_TYPES = ['text', 'list', 'code', 'table', 'math', 'box', 'arrow', 'highlight'];
const LESSONS = ['fx-type-text', 'fx-type-list', 'fx-type-code', 'fx-type-table', 'fx-type-math', 'fx-type-box', 'fx-type-arrow', 'fx-type-highlight', 'fx-core-dense', 'fx-core-arrows'];

function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

function sceneIds(lessonId) {
  return readdirSync(join(root, 'fixtures', 'lessons', lessonId, 'scenes')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}

function scene(lessonId, sceneId) {
  return JSON.parse(readFileSync(join(root, 'fixtures', 'lessons', lessonId, 'scenes', `${sceneId}.json`), 'utf8'));
}

async function openHarness(page, path) {
  await page.goto(path);
  await page.waitForFunction(() => window.__khan && window.__khan.harness && window.__khan.rendererCore, null, { timeout: 20_000 });
  await page.evaluate(() => window.__khan.harness.ready);
  // MathJax initialises lazily; once it is ready every math prepare is synchronous
  await page.evaluate(() => window.__khan.rendererCore.ready);
}

/** Draw a scene at u, redrawing once if any math drawable was still pending. */
async function draw(page, sceneId, u) {
  await page.evaluate(([id, uu]) => window.__khan.harness.drawSceneAt(id, uu), [sceneId, u]);
  const pending = await page.evaluate(() => [...window.__khan.harness.state.drawables.values()].some((d) => d.pending));
  if (pending) {
    await page.evaluate(() => window.__khan.rendererCore.warm([...window.__khan.harness.state.scenes.values()]));
    await page.evaluate(([id, uu]) => window.__khan.harness.drawSceneAt(id, uu), [sceneId, u]);
  }
  return page.evaluate(() => ({
    drawn: window.__khan.harness.drawnIds(),
    pixels: window.__khan.harness.nonBackgroundPixelCount(),
    pending: [...window.__khan.harness.state.drawables.values()].filter((d) => d.pending).map((d) => d.id),
    registered: window.__khan.harness.modules.registry.types().sort(),
  }));
}

test('registry: exactly the eight core types are registered by the core renderer (criterion 1)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-type-text?scene=s001&u=1');
  const hooks = await page.evaluate(() => ({
    types: window.__khan.rendererCore.types,
    prepares: Object.keys(window.__khan.rendererCore.prepares).filter((t) => typeof window.__khan.rendererCore.prepares[t] === 'function'),
    registered: window.__khan.harness.modules.registry.types(),
    mathReady: window.__khan.rendererCore.mathReady(),
  }));
  expect(hooks.types).toEqual(CORE_TYPES);
  expect(hooks.prepares).toEqual(CORE_TYPES);
  for (const t of CORE_TYPES) expect(hooks.registered).toContain(t);
  // nothing outside the eight is registered by this slice (pictures may add its own four)
  const extra = hooks.registered.filter((t) => !CORE_TYPES.includes(t) && !['sketch', 'diagram', 'plot', 'svg'].includes(t));
  expect(extra).toEqual([]);
  expect(hooks.mathReady).toBe(true);
  expect(errors).toEqual([]);
});

for (const lessonId of LESSONS) {
  test(`harness smoke: every scene of ${lessonId} paints at u=1 with zero console errors; screenshots saved (criterion 12)`, async ({ page }) => {
    const errors = collectErrors(page);
    const ids = sceneIds(lessonId);
    await openHarness(page, `/harness/${lessonId}?scene=${ids[0]}&u=1`);
    for (const sceneId of ids) {
      const r = await draw(page, sceneId, 1);
      const sc = scene(lessonId, sceneId);
      for (const el of sc.elements) expect(r.drawn, `${lessonId}/${sceneId}`).toContain(el.id);
      expect(r.pending, `${lessonId}/${sceneId} pending math`).toEqual([]);
      expect(r.pixels, `${lessonId}/${sceneId} pixels`).toBeGreaterThan(0);
      // every core drawable of this scene has the C4 shape
      for (const el of sc.elements.filter((e) => CORE_TYPES.includes(e.type))) {
        const d = await page.evaluate((id) => {
          const x = window.__khan.harness.drawableOf(id);
          return { id: x.id, type: x.type, parts: x.parts, partStarts: x.partStarts, naturalMs: x.naturalMs, paths: x.paths.length, bounds: x.bounds, tip: x.tipAt(0.5) };
        }, el.id);
        expect(d.type).toBe(el.type);
        expect(d.parts).toBeGreaterThanOrEqual(1);
        expect(d.partStarts.length).toBe(d.parts);
        expect(d.bounds.x).toBeGreaterThanOrEqual(0);
        expect(d.bounds.y).toBeGreaterThanOrEqual(0);
        expect(d.bounds.x + d.bounds.w).toBeLessThanOrEqual(1600);
        expect(d.bounds.y + d.bounds.h).toBeLessThanOrEqual(900);
        if (el.type === 'highlight' && el.style === 'pointer') { expect(d.paths).toBe(0); expect(d.naturalMs).toBe(0); expect(d.tip).not.toBeNull(); }
        else { expect(d.paths).toBeGreaterThan(0); expect(d.naturalMs).toBeGreaterThan(0); }
      }
      await page.locator('#board').screenshot({ path: join(shotDir, `${lessonId}-${sceneId}.png`) });
    }
    expect(errors).toEqual([]);
  });
}

test('u=0 paints nothing for a single text element and u=1 paints it (criterion 12)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-long-stroke?scene=s002&u=0');
  const at0 = await draw(page, 's002', 0);
  expect(at0.drawn).toEqual(['mid']);
  expect(at0.pixels).toBe(0);
  const at1 = await draw(page, 's002', 1);
  expect(at1.pixels).toBeGreaterThan(200);
  // reveal grows monotonically with u
  let last = 0;
  for (const u of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
    const r = await draw(page, 's002', u);
    expect(r.pixels, `u=${u}`).toBeGreaterThanOrEqual(last);
    last = r.pixels;
  }
  expect(errors).toEqual([]);
});

test('math fixtures paint without inserting SVG into the document; paint never uses measureText (criterion 13)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-type-math?scene=s001&u=1');
  await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    window.__measureTextCalls = 0;
    const orig = proto.measureText;
    proto.measureText = function (...args) { window.__measureTextCalls++; return orig.apply(this, args); };
  });
  for (const sceneId of sceneIds('fx-type-math')) {
    const r = await draw(page, sceneId, 1);
    expect(r.pending).toEqual([]);
    expect(r.pixels).toBeGreaterThan(0);
  }
  await draw(page, 's003', 0.5);
  const probe = await page.evaluate(() => ({ svgs: document.querySelectorAll('svg').length, measureText: window.__measureTextCalls }));
  expect(probe.svgs).toBe(0);
  expect(probe.measureText).toBe(0);
  expect(errors).toEqual([]);
});

test('list reveal: dragging u across 0→1 on fx-type-list s002 shows items in order exactly at partStarts (criterion 5)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-type-list?scene=s002&u=0');
  const info = await page.evaluate(async () => {
    await window.__khan.harness.drawSceneAt('s002', 0);
    const d = window.__khan.harness.drawableOf('six');
    return { parts: d.parts, partStarts: d.partStarts };
  });
  expect(info.parts).toBe(6);
  expect(info.partStarts[0]).toBe(0);
  for (let k = 1; k < 6; k++) expect(info.partStarts[k]).toBeGreaterThan(info.partStarts[k - 1]);
  let lastVisible = -1;
  let lastPixels = 0;
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const r = await page.evaluate(async (uu) => {
      await window.__khan.harness.drawSceneAt('s002', uu);
      const d = window.__khan.harness.drawableOf('six');
      const p = d.progress(uu);
      return { part: p.part, pixels: window.__khan.harness.nonBackgroundPixelCount() };
    }, u);
    // the active item is the last part whose start has been crossed; at u=0 nothing is drawn yet
    let expected = -1;
    if (u > 0) for (let k = 0; k < 6; k++) if (info.partStarts[k] <= u + 1e-9) expected = k;
    if (u >= 1) expected = 5;
    expect(r.part, `u=${u}`).toBe(expected);
    expect(r.part).toBeGreaterThanOrEqual(lastVisible);
    expect(r.pixels, `u=${u}`).toBeGreaterThanOrEqual(lastPixels);
    lastVisible = r.part;
    lastPixels = r.pixels;
  }
  await page.locator('#board').screenshot({ path: join(shotDir, 'fx-type-list-s002-u1.png') });
  expect(errors).toEqual([]);
});

test('paint(ctx, 1) for the densest core scene stays fast in Chromium (criterion 14, ×3 margin)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-core-dense?scene=s002&u=1');
  await draw(page, 's002', 1);
  const ms = await page.evaluate(() => {
    const ctx2d = document.getElementById('board').getContext('2d');
    const ds = [...window.__khan.harness.state.drawables.values()];
    for (const d of ds) d.paint(ctx2d, 1); // warm
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      for (const d of ds) d.paint(ctx2d, 1);
      runs.push(performance.now() - t0);
    }
    return Math.min(...runs);
  });
  expect(ms).toBeLessThan(150);
  expect(errors).toEqual([]);
});
