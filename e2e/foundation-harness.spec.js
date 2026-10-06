// Harness page (brief 00 C5, criteria 5, 6, 17): drawable containment with the real renderers, the
// fallback drawable for unregistered types, measurement and math agreement with Node.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFont, measure, wrap } from '../shared/handwriting.js';
import { texToSvg } from '../shared/math.js';
import { slotRect, rectContainsRect, BOARD_RECT } from '../shared/layout-core/grid.js';
import { SLOTTED_TYPES } from '../shared/layout-core/constants.js';
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

const readScene = (lessonId, sceneId) => JSON.parse(readFileSync(join(root, 'fixtures', 'lessons', lessonId, 'scenes', `${sceneId}.json`), 'utf8'));

/** Drawable summary from the harness for one element id. */
const drawableInfo = (page, id) => page.evaluate((elId) => {
  const x = window.__khan.harness.drawableOf(elId);
  return x && { id: x.id, type: x.type, bounds: { ...x.bounds }, parts: x.parts, partStarts: x.partStarts, naturalMs: x.naturalMs, paths: x.paths.length };
}, id);

test('harness: fx-full-tour draws every element through the registered renderers; every drawable is contained in its slot (criterion 17)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-full-tour?scene=s001&u=1');
  // the real renderers are registered for every element type the fixture uses
  const registered = await page.evaluate(() => window.__khan.harness.modules.registry.types());
  expect(registered).toEqual(expect.arrayContaining(['text', 'list', 'math', 'code', 'table', 'box', 'arrow', 'highlight', 'sketch', 'diagram', 'plot', 'svg']));
  const s001 = readScene('fx-full-tour', 's001');
  const drawn = await page.evaluate(() => window.__khan.harness.drawnIds());
  expect(drawn).toEqual(s001.elements.map((e) => e.id));
  for (const el of s001.elements) {
    const d = await drawableInfo(page, el.id);
    expect(d.id).toBe(el.id);
    expect(d.type).toBe(el.type);
    // containment, not equality: a real drawable sits inside its slot rect (and is not the whole slot)
    const slot = slotRect(el.slot);
    expect(rectContainsRect(slot, d.bounds), `${el.id} bounds ${JSON.stringify(d.bounds)} inside ${el.slot}`).toBe(true);
    expect(d.bounds.w).toBeGreaterThan(0);
    expect(d.bounds.h).toBeGreaterThan(0);
    expect(d.bounds).not.toEqual(slot);
    expect(d.parts).toBeGreaterThanOrEqual(1);
    expect(d.partStarts.length).toBe(d.parts);
    expect(d.partStarts[0]).toBe(0);
    expect(d.naturalMs).toBeGreaterThan(0);
    expect(d.paths).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => window.__khan.harness.nonBackgroundPixelCount())).toBeGreaterThan(1000);

  // every scene of the tour (all twelve types): slotted drawables inside their slot, arrows and
  // highlights inside the board; a region scene shows the earlier board too
  const scenes = readdirSync(join(root, 'fixtures', 'lessons', 'fx-full-tour', 'scenes')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  expect(scenes.length).toBe(10);
  const typesSeen = new Set();
  for (const sceneId of scenes) {
    const scene = readScene('fx-full-tour', sceneId);
    const ids = await page.evaluate((id) => window.__khan.harness.drawSceneAt(id, 1), sceneId);
    for (const el of scene.elements) expect(ids, `${sceneId} draws ${el.id}`).toContain(el.id);
    if (scene.board.mode === 'region') expect(ids.length).toBeGreaterThan(scene.elements.length);
    for (const el of scene.elements) {
      typesSeen.add(el.type);
      const d = await drawableInfo(page, el.id);
      expect(d.type).toBe(el.type);
      const outer = SLOTTED_TYPES.includes(el.type) ? slotRect(el.slot) : BOARD_RECT;
      expect(rectContainsRect(outer, d.bounds), `${sceneId}/${el.id} (${el.type}) bounds ${JSON.stringify(d.bounds)} inside ${JSON.stringify(outer)}`).toBe(true);
      if (el.type !== 'highlight') expect(d.paths, `${sceneId}/${el.id} has strokes`).toBeGreaterThan(0);
    }
  }
  expect([...typesSeen].sort()).toEqual(['arrow', 'box', 'code', 'diagram', 'highlight', 'list', 'math', 'plot', 'sketch', 'svg', 'table', 'text']);
  // s002 is a region scene: the earlier board (s001) is drawn first, then its own elements
  const s002Ids = await page.evaluate(() => window.__khan.harness.drawSceneAt('s002', 1));
  expect(s002Ids).toEqual(['title', 'problem', 'aside', 'store', 'client', 'ask']);
  const ask = await drawableInfo(page, 'ask');
  expect(ask.type).toBe('arrow');
  expect(rectContainsRect(BOARD_RECT, ask.bounds)).toBe(true);
  expect(ask.bounds.w + ask.bounds.h).toBeGreaterThan(0);

  // answer scenes draw on their own track
  await page.goto('/harness/fx-answer-insert?scene=q001-a02&u=0.5');
  await page.waitForFunction(() => window.__khan && window.__khan.harness);
  await page.evaluate(() => window.__khan.harness.ready);
  expect(await page.evaluate(() => window.__khan.harness.drawnIds())).toEqual(['a1', 'a2']);
  expect(errors).toEqual([]);
});

test('harness: the fallback drawable still serves an element type with no registered renderer (criterion 17, fallback half)', async ({ page }) => {
  const errors = collectErrors(page);
  await openHarness(page, '/harness/fx-full-tour?scene=s001&u=1');
  const s001 = readScene('fx-full-tour', 's001');
  expect(s001.elements.every((e) => e.type === 'text')).toBe(true);
  // the registry hands out the fallback for a type it does not know, without registering anything
  const probe = await page.evaluate(() => {
    const r = window.__khan.harness.modules.registry;
    return { has: r.has('hologram'), isFallback: r.get('hologram') === r.fallback, types: r.types() };
  });
  expect(probe.has).toBe(false);
  expect(probe.isFallback).toBe(true);
  expect(probe.types).toContain('text');
  // take the real text renderer away for this page only (test-only hook; nothing in production
  // changes) and redraw: every text element now comes from the fallback — dashed slot rect + label
  const after = await page.evaluate(async () => {
    const r = window.__khan.harness.modules.registry;
    r.unregister('text');
    const ids = await window.__khan.harness.drawSceneAt('s001', 1);
    return { ids, hasText: r.has('text'), isFallback: r.get('text') === r.fallback, pixels: window.__khan.harness.nonBackgroundPixelCount() };
  });
  expect(after.hasText).toBe(false);
  expect(after.isFallback).toBe(true);
  expect(after.ids).toEqual(s001.elements.map((e) => e.id));
  expect(after.pixels).toBeGreaterThan(1000);
  for (const el of s001.elements) {
    const d = await drawableInfo(page, el.id);
    expect(d.id).toBe(el.id);
    expect(d.type).toBe(el.type);
    expect(d.bounds).toEqual(slotRect(el.slot)); // the fallback's bounds ARE the slot rect
    expect(d.parts).toBe(1);
    expect(d.partStarts).toEqual([0]);
    expect(d.naturalMs).toBeGreaterThanOrEqual(300);
    expect(d.paths).toBe(1);
  }
  // partial progress paints without errors too
  await page.evaluate(() => window.__khan.harness.drawSceneAt('s001', 0.3));
  expect(await page.evaluate(() => window.__khan.harness.nonBackgroundPixelCount())).toBeGreaterThan(100);
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
