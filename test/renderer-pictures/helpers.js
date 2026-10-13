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

// ---------- label-placement geometry (backlog #21) ----------

/** Liang–Barsky: does segment a–b pass through (or touch) rect r? */
export function segmentHitsRect(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a[0] - r.x) && clip(dx, r.x + r.w - a[0]) && clip(-dy, a[1] - r.y) && clip(dy, r.y + r.h - a[1]);
}

/** Euclidean distance between two rects (0 when they overlap or touch). */
export function rectsDistance(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

function pointToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Euclidean distance between segment a–b and rect r (0 when the segment touches or crosses it). */
export function segmentRectDistance(a, b, r) {
  if (segmentHitsRect(a, b, r)) return 0;
  const c = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const p = c[i], q = c[(i + 1) % 4];
    best = Math.min(best, pointToSegment(a, p, q), pointToSegment(b, p, q), pointToSegment(p, a, b), pointToSegment(q, a, b));
  }
  return best;
}

/** Distance between a node outline polygon and a rect (0 when they overlap or the rect sits inside). */
export function polygonRectDistance(poly, r) {
  if (pointInPolygon([r.x + r.w / 2, r.y + r.h / 2], poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentRectDistance(poly[i], poly[(i + 1) % poly.length], r));
  return best;
}

/**
 * Collisions of a diagram's edge labels, from the drawable's `picture` metadata (independent oracle
 * for backlog #21). A label box must stay at least `edgeGap` px from every edge shaft segment and
 * arrowhead wing (its own edge included), `nodeGap` px from every node outline (the drawn polygon:
 * the rect itself for rect/round nodes, the diamond/circle/stadium outline otherwise) and `labelGap`
 * px from every other label. True Euclidean distances, so diagonal shafts are judged exactly.
 * @returns {string[]} human-readable collision descriptions (empty when clean)
 */
export function diagramLabelCollisions(picture, { edgeGap = 4, nodeGap = 2, labelGap = 2 } = {}) {
  const out = [];
  const segments = [];
  for (const e of picture.edges) {
    for (let i = 0; i + 1 < e.points.length; i++) segments.push({ tag: `edge ${e.from}->${e.to} segment ${i}`, a: e.points[i], b: e.points[i + 1] });
    if (e.arrow) for (let i = 0; i + 1 < e.arrow.length; i++) segments.push({ tag: `arrowhead ${e.from}->${e.to}`, a: e.arrow[i], b: e.arrow[i + 1] });
  }
  const labelled = picture.edges.filter((e) => e.labelBox);
  for (const e of labelled) {
    const who = `label "${e.label}" (${e.from}->${e.to})`;
    for (const s of segments) {
      const dd = segmentRectDistance(s.a, s.b, e.labelBox);
      if (dd < edgeGap) out.push(`${who} is ${dd.toFixed(1)} px from ${s.tag}`);
    }
    for (const n of picture.nodes) if (polygonRectDistance(n.polygon, e.labelBox) < nodeGap) out.push(`${who} overlaps node ${n.id}`);
    for (const o of labelled) if (o.index < e.index && rectsDistance(e.labelBox, o.labelBox) < labelGap) out.push(`${who} overlaps label "${o.label}" (${o.from}->${o.to})`);
  }
  return out;
}
