// Harness page (brief 00 C5, criteria 5, 6, 17): fallback drawables, measurement and math agreement with Node.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFont, measure, wrap } from '../shared/handwriting.js';
import { texToSvg } from '../shared/math.js';
import { slotRect } from '../shared/layout-core/grid.js';
import { SNAPSHOT_STRINGS, STYLES } from '../test/foundation/fixtures/measurement-snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function openHarness(page, path) {
  await page.goto(path);
  await page.waitForFunction(() => window.__khan && window.__khan.harness, null, { timeout: 20_000 });
  await page.evaluate(() => window.__khan.harness.ready);
}

test('harness: fx-full-tour s001 draws every element with the fallback; bounds equal slot rects (criterion 17)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-full-tour?scene=s001&u=1');
  const scene = JSON.parse(readFileSync(join(root, 'fixtures', 'lessons', 'fx-full-tour', 'scenes', 's001.json'), 'utf8'));
  const drawn = await page.evaluate(() => window.__khan.harness.drawnIds());
  expect(drawn).toEqual(scene.elements.map((e) => e.id));
  for (const el of scene.elements) {
    const bounds = await page.evaluate((id) => window.__khan.harness.boundsOf(id), el.id);
    expect(bounds).toEqual(slotRect(el.slot));
    const d = await page.evaluate((id) => { const x = window.__khan.harness.drawableOf(id); return { id: x.id, type: x.type, parts: x.parts, partStarts: x.partStarts, naturalMs: x.naturalMs, paths: x.paths.length }; }, el.id);
    expect(d.id).toBe(el.id);
    expect(d.type).toBe(el.type);
    expect(d.parts).toBe(1);
    expect(d.partStarts).toEqual([0]);
    expect(d.naturalMs).toBeGreaterThan(0);
    expect(d.paths).toBe(1);
  }
  expect(await page.evaluate(() => window.__khan.harness.nonBackgroundPixelCount())).toBeGreaterThan(1000);
  // a region scene shows the earlier board too; an arrow spans its endpoints
  const ids = await page.evaluate(() => window.__khan.harness.drawSceneAt('s002', 1));
  expect(ids).toEqual(['title', 'problem', 'aside', 'store', 'client', 'ask']);
  const arrow = await page.evaluate(() => window.__khan.harness.boundsOf('ask'));
  expect(arrow.x).toBe(slotRect('D3:E4').x);
  expect(arrow.w).toBe(slotRect('D3:F4').w);
  // answer scenes draw on their own track
  await page.goto('/harness/fx-answer-insert?scene=q001-a02&u=0.5');
  await page.waitForFunction(() => window.__khan && window.__khan.harness);
  await page.evaluate(() => window.__khan.harness.ready);
  expect(await page.evaluate(() => window.__khan.harness.drawnIds())).toEqual(['a1', 'a2']);
  expect(errors).toEqual([]);
});

test('measurement agreement: shared/handwriting.js produces identical numbers in Node and the browser (criterion 5)', async ({ page }) => {
  const errors = collectErrors(page);
  await loadFont();
  const nodeSnap = {};
  for (const style of STYLES) {
    nodeSnap[style] = {};
    for (const s of SNAPSHOT_STRINGS) nodeSnap[style][s] = { measure: measure(s, style), wrap226: wrap(s, style, 226), wrap476: wrap(s, style, 476) };
  }
  await openHarness(page, '/harness/fx-type-text?scene=s001&u=1');
  const browserSnap = await page.evaluate(([strings, styles]) => {
    const hw = window.__khan.harness.modules.handwriting;
    const out = {};
    for (const style of styles) {
      out[style] = {};
      for (const s of strings) out[style][s] = { measure: hw.measure(s, style), wrap226: hw.wrap(s, style, 226), wrap476: hw.wrap(s, style, 476) };
    }
    return out;
  }, [SNAPSHOT_STRINGS, STYLES]);
  expect(browserSnap).toEqual(nodeSnap);
  // committed snapshot file agrees too
  const committed = JSON.parse(readFileSync(join(root, 'test', 'foundation', 'fixtures', 'measurement-snapshot.json'), 'utf8'));
  for (const style of STYLES) for (const s of SNAPSHOT_STRINGS) expect(browserSnap[style][s].measure).toEqual(committed[style][s]);
  expect(errors).toEqual([]);
});

test('math agreement: texToSvg output is identical in Node and the browser for every fx-type-math line; eqX present (criterion 6)', async ({ page }) => {
  const errors = collectErrors(page);
  const dir = join(root, 'fixtures', 'lessons', 'fx-type-math', 'scenes');
  const lines = [];
  for (const f of readdirSync(dir).sort()) for (const el of JSON.parse(readFileSync(join(dir, f), 'utf8')).elements) if (el.type === 'math') lines.push(...el.lines);
  expect(lines.length).toBeGreaterThanOrEqual(10);
  const nodeOut = await texToSvg(lines);
  await openHarness(page, '/harness/fx-type-math?scene=s001&u=1');
  const browserOut = await page.evaluate((ls) => window.__khan.harness.modules.math.texToSvg(ls), lines);
  expect(browserOut.length).toBe(nodeOut.length);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < lines.length; i++) {
    expect(norm(browserOut[i].svg), `svg for ${lines[i]}`).toBe(norm(nodeOut[i].svg));
    expect(browserOut[i].width).toBeCloseTo(nodeOut[i].width, 9);
    expect(browserOut[i].height).toBeCloseTo(nodeOut[i].height, 9);
    if (lines[i].includes('=')) {
      expect(nodeOut[i].eqX, `eqX for ${lines[i]}`).not.toBeNull();
      expect(browserOut[i].eqX).toBeCloseTo(nodeOut[i].eqX, 9);
    }
  }
  expect(errors).toEqual([]);
});
