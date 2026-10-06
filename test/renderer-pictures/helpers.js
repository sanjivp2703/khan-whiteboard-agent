// Shared helpers for the slice 03 (renderer-pictures) unit tests.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFont, isFontLoaded } from '../../shared/handwriting.js';
import { makeDrawCtx } from '../../player/registry.js';
import { slotRect } from '../../shared/layout-core/grid.js';

export const REPO_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
export const PICTURES_DIR = join(REPO_ROOT, 'player', 'renderer', 'pictures');
export const PICTURE_TYPES = ['sketch', 'diagram', 'plot', 'svg'];

export async function ensureFont() {
  if (!isFontLoaded()) await loadFont();
}

/** A DrawCtx for a single wipe scene holding `elements`. */
export function ctxFor(elements) {
  const scenes = [{ sceneId: 's001', board: { mode: 'wipe' }, elements }];
  return makeDrawCtx(scenes, 0);
}

export function rectInside(outer, inner, eps = 0.001) {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}

export function insideSlot(drawable, slot, eps = 0.001) {
  return rectInside(slotRect(slot), drawable.bounds, eps);
}

/** Every .js file of the pictures directory as {name, source}. */
export function pictureSources() {
  return readdirSync(PICTURES_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.css')).map((f) => ({ name: f, source: readFileSync(join(PICTURES_DIR, f), 'utf8') }));
}

/** Strip line and block comments (good enough for our own sources). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * A fake CanvasRenderingContext2D that records calls. Path2D is undefined in Node, so paint
 * falls back to strokes.drawPartial, which issues beginPath/moveTo/lineTo/stroke per path.
 */
export function fakeCtx2d() {
  const calls = { stroke: 0, fill: 0, beginPath: 0, save: 0, restore: 0, setLineDash: 0, other: 0 };
  const ctx = new Proxy({}, {
    get(_, key) {
      if (typeof key !== 'string') return undefined;
      return (...args) => { if (key in calls) calls[key]++; else calls.other++; return undefined; };
    },
    set() { return true; },
  });
  return { ctx, calls };
}

/** Deterministic signature of a drawable's geometry. */
export function signature(d) {
  return JSON.stringify({ paths: d.paths, bounds: d.bounds, partStarts: d.partStarts, naturalMs: d.naturalMs, parts: d.parts });
}

/** Distance from a point to a polygon's boundary (segments). */
export function distToPolygon(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

/** Ray-casting point-in-polygon (strict interior for points not on the boundary). */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
