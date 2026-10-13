// player/renderer/pictures/diagram.js — `diagram` drawable: Mermaid flowchart subset AST →
// deterministic layered layout (diagram-layout.js) → rough nodes, rough edges with arrowheads,
// hand-written labels. Parts: nodes (source order) then edges (source order).
import { parse as parseMermaid } from '../../../shared/mermaid-subset.js';
import { layout, LAYOUT } from './diagram-layout.js';
import {
  pictureRects, roughFor, tokenColor, roughStrokes, fitText, writeLines, buildDrawable, STROKE_WIDTH,
} from './common.js';

const PAD = Object.freeze({ body: { x: 16, y: 9 }, note: { x: 12, y: 7 } });
const ARROW_LEN = 13;
const ARROW_ANGLE = (28 * Math.PI) / 180;
const PARALLEL_OFFSET = 11;
// Edge-label placement (backlog #21): minimum clearances of a label box from the other geometry.
export const LABEL_GAP = 6;         // ↔ any edge shaft or arrowhead, its own edge included
export const LABEL_NODE_GAP = 4;    // ↔ any node outline (rect, or the diamond/circle/stadium polygon)
export const LABEL_LABEL_GAP = 4;   // ↔ another edge label
const LABEL_SLIDE_STEPS = 6;        // slides tried toward the source (then toward the target) per side
const LABEL_PROBE_DEPTH = 64;       // px probed along the normal to judge which side has more room
const DASH_DOTTED = [7, 6];
const THICK_WIDTH = 4.2;

// ---------- geometry ----------

/** Convex outline polygon of a node box for its shape (used for edge clipping). */
export function nodePolygon(shape, b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  switch (shape) {
    case 'diamond': return [[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]];
    case 'circle': {
      const r = Math.min(b.w, b.h) / 2;
      return Array.from({ length: 36 }, (_, i) => { const a = (i / 36) * 2 * Math.PI; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    }
    case 'stadium': {
      const r = b.h / 2;
      const pts = [];
      for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push([b.x + b.w - r + r * Math.cos(a), cy + r * Math.sin(a)]); }
      for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + (i / 12) * Math.PI; pts.push([b.x + r + r * Math.cos(a), cy + r * Math.sin(a)]); }
      return pts;
    }
    default: return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  }
}

function segIntersect(p, p2, q, q2) {
  const r = [p2[0] - p[0], p2[1] - p[1]], s = [q2[0] - q[0], q2[1] - q[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const qp = [q[0] - p[0], q[1] - p[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

/** Point where the segment from `inside` (a point within the polygon) towards `outside` leaves the polygon. */
export function exitPoint(polygon, inside, outside) {
  let best = null;
  for (let i = 0; i < polygon.length; i++) {
    const t = segIntersect(inside, outside, polygon[i], polygon[(i + 1) % polygon.length]);
    if (t !== null && (best === null || t > best)) best = t; // the farthest crossing is the exit
  }
  if (best === null) return [...inside];
  return [inside[0] + (outside[0] - inside[0]) * best, inside[1] + (outside[1] - inside[1]) * best];
}

/** Liang–Barsky: does segment a–b pass through rect r? */
function segmentHitsRect(a, b, r) {
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

const pointInRect = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
const expand = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DETOUR_GAP = 24;

// ---------- label geometry ----------

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsDistance(a, b, c, d) {
  if (segIntersect(a, b, c, d) !== null) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Euclidean distance between segment a–b and rect r (0 when they touch or cross). */
export function segmentRectDistance(a, b, r) {
  if (segmentHitsRect(a, b, r)) return 0;
  const c = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  let best = Infinity;
  for (let i = 0; i < 4; i++) best = Math.min(best, segmentsDistance(a, b, c[i], c[(i + 1) % 4]));
  return best;
}

/** Euclidean distance between two rects (0 when they overlap or touch). */
export function rectsDistance(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Euclidean distance between a closed polygon (a node outline) and rect r (0 when they overlap or touch). */
export function polygonRectDistance(poly, r) {
  if (pointInPolygon([r.x + r.w / 2, r.y + r.h / 2], poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, segmentRectDistance(poly[i], poly[(i + 1) % poly.length], r));
    if (best === 0) break;
  }
  return best;
}

const polylineLength = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

/** Point at arc length `s` along a polyline and the unit direction of the segment it lies on. */
function pointAlong(pts, s) {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const L = dist(pts[i], pts[i + 1]);
    if (s <= acc + L || i + 2 === pts.length) {
      const t = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      const d = L ? [(pts[i + 1][0] - pts[i][0]) / L, (pts[i + 1][1] - pts[i][1]) / L] : [1, 0];
      return { p: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t], d };
    }
    acc += L;
  }
  return { p: [...pts[0]], d: [1, 0] };
}

/**
 * Place a lw×lh label box beside `route` (backlog #21). The anchor starts at the midpoint of the
 * route's longest segment; the box is pushed off the shaft along the segment normal so that its
 * nearest point clears the line by LABEL_GAP (centre ≥ half the label height + LABEL_GAP away).
 * The side with more free room wins (ties → right-hand normal). If the box then touches any edge
 * shaft or arrowhead (`segments`), any node outline (`nodePolygons`), or an already placed label,
 * the anchor slides toward the source in steps, then the other side is tried, then both sides
 * toward the target, and finally the box is pushed farther from the shaft (up to 24 px more) at
 * the default anchor. Every candidate is clamped into `safe` first, so a label never leaves the
 * slot. When nothing is clear, the least bad candidate wins — node overlaps count worst, then
 * labels, then edges — and `clear` is false so the caller can count it. Deterministic: candidates
 * are enumerated in a fixed order and the first clear (else best) one is taken.
 * @returns {{box:{x,y,w,h}, clear:boolean, side:1|-1}}
 */
export function placeEdgeLabel(route, lw, lh, { segments, nodePolygons, labelBoxes }, safe) {
  const total = polylineLength(route);
  let longest = -1, s0 = total / 2, acc = 0;
  for (let i = 0; i + 1 < route.length; i++) {
    const L = dist(route[i], route[i + 1]);
    if (L > longest) { longest = L; s0 = acc + L / 2; }
    acc += L;
  }
  const step = Math.max(10, total * 0.08);
  const sMin = Math.min(s0, total * 0.12), sMax = Math.max(s0, total * 0.88);
  const clampBox = (b) => ({
    x: Math.max(safe.x, Math.min(b.x, safe.x + safe.w - lw)),
    y: Math.max(safe.y, Math.min(b.y, safe.y + safe.h - lh)),
    w: lw, h: lh,
  });
  const rawBoxAt = (s, side, extra = 0) => {
    const { p, d } = pointAlong(route, s);
    const n = [-d[1] * side, d[0] * side];
    const support = Math.abs(n[0]) * (lw / 2) + Math.abs(n[1]) * (lh / 2);
    const off = Math.max(lh / 2, support) + LABEL_GAP + extra;
    return { x: p[0] + n[0] * off - lw / 2, y: p[1] + n[1] * off - lh / 2, w: lw, h: lh };
  };
  const hits = (box) => {
    let edges = 0, nodes = 0, labels = 0;
    for (const sg of segments) if (segmentRectDistance(sg[0], sg[1], box) < LABEL_GAP - 0.5) edges++;
    for (const poly of nodePolygons) if (polygonRectDistance(poly, box) < LABEL_NODE_GAP - 0.5) nodes++;
    for (const r of labelBoxes) if (rectsDistance(box, r) < LABEL_LABEL_GAP - 0.5) labels++;
    return { edges, nodes, labels, total: edges + nodes + labels };
  };
  const inside = (b) => b.x >= safe.x - 1e-6 && b.y >= safe.y - 1e-6 && b.x + b.w <= safe.x + safe.w + 1e-6 && b.y + b.h <= safe.y + safe.h + 1e-6;
  // free room on each side of the default anchor: how deep along the normal the box stays clear and inside the slot
  const room = (side) => {
    let depth = 0;
    for (let extra = 0; extra <= LABEL_PROBE_DEPTH; extra += 8) {
      const raw = rawBoxAt(s0, side, extra);
      if (!inside(raw) || hits(raw).total > 0) break;
      depth = extra + 8;
    }
    return depth;
  };
  const sides = room(-1) > room(1) ? [-1, 1] : [1, -1];
  const positions = [];
  for (let k = 0; k <= LABEL_SLIDE_STEPS; k++) positions.push(Math.max(sMin, s0 - k * step)); // toward the source
  const towardTarget = [];
  for (let k = 1; k <= LABEL_SLIDE_STEPS; k++) towardTarget.push(Math.min(sMax, s0 + k * step));
  const seen = new Set();
  const candidates = [];
  const add = (s, side, extra = 0) => {
    const key = `${side}:${s.toFixed(3)}:${extra}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ box: clampBox(rawBoxAt(s, side, extra)), side });
  };
  for (const side of sides) for (const s of positions) add(s, side);
  for (const side of sides) for (const s of towardTarget) add(s, side);
  for (const extra of [8, 16, 24]) for (const side of sides) add(s0, side, extra);
  let best = null;
  for (const c of candidates) {
    const h = hits(c.box);
    if (h.total === 0) return { box: c.box, clear: true, side: c.side };
    const rank = h.nodes * 1e6 + h.labels * 1e3 + h.edges;
    if (!best || rank < best.rank) best = { ...c, rank };
  }
  return { box: best.box, clear: false, side: best.side };
}

/**
 * Route an edge from node `a` to node `b` (virtual centres ca/cb may be offset for parallel edges).
 * Candidates in preference order: straight; single elbow (two corners); a detour around the outside
 * of the other nodes (three segments) — used only when everything simpler crosses another node.
 * The route with the fewest node crossings wins; ties keep the simpler route. Deterministic.
 * @returns {number[][]} polyline points, first on a's boundary, last on b's boundary
 */
export function routeEdge(a, b, ca, cb, others, safe, td) {
  const crossings = (pts) => { let n = 0; for (let i = 0; i + 1 < pts.length; i++) n += others.filter((o) => segmentHitsRect(pts[i], pts[i + 1], o)).length; return n; };
  const blocked = (c) => pointInRect(c, a.rect) || pointInRect(c, b.rect) || others.some((o) => pointInRect(c, o));
  const candidates = [];
  const sp = exitPoint(a.polygon, ca, cb), tp = exitPoint(b.polygon, cb, ca);
  candidates.push([sp, tp]);
  if (crossings(candidates[0]) > 0) {
    for (const c of [[ca[0], cb[1]], [cb[0], ca[1]]]) {
      if (blocked(c)) continue;
      candidates.push([exitPoint(a.polygon, ca, c), c, exitPoint(b.polygon, cb, c)]);
    }
    // detours: TD → go sideways (left/right of every node), LR → go above/below
    const all = [a.rect, b.rect, ...others];
    if (td) {
      const left = Math.min(...all.map((r) => r.x)) - DETOUR_GAP, right = Math.max(...all.map((r) => r.x + r.w)) + DETOUR_GAP;
      for (const x of [Math.max(safe.x + 2, left), Math.min(safe.x + safe.w - 2, right)]) {
        const c1 = [x, ca[1]], c2 = [x, cb[1]];
        candidates.push([exitPoint(a.polygon, ca, c1), c1, c2, exitPoint(b.polygon, cb, c2)]);
      }
    } else {
      const top = Math.min(...all.map((r) => r.y)) - DETOUR_GAP, bottom = Math.max(...all.map((r) => r.y + r.h)) + DETOUR_GAP;
      for (const y of [Math.max(safe.y + 2, top), Math.min(safe.y + safe.h - 2, bottom)]) {
        const c1 = [ca[0], y], c2 = [cb[0], y];
        candidates.push([exitPoint(a.polygon, ca, c1), c1, c2, exitPoint(b.polygon, cb, c2)]);
      }
    }
  }
  const scored = candidates.map((points, idx) => ({ points, idx, crossings: crossings(points), length: points.reduce((s, p, i) => (i ? s + dist(points[i - 1], p) : 0), 0) }));
  scored.sort((x, y) => x.crossings - y.crossings || (x.points.length - y.points.length) || x.length - y.length || x.idx - y.idx);
  return scored[0].points;
}

// ---------- node shapes ----------

function roundedRectPath(b, rr) {
  const r = Math.min(rr, b.w / 2, b.h / 2);
  const x2 = b.x + b.w, y2 = b.y + b.h;
  return `M${b.x + r} ${b.y} L${x2 - r} ${b.y} A${r} ${r} 0 0 1 ${x2} ${b.y + r} L${x2} ${y2 - r} A${r} ${r} 0 0 1 ${x2 - r} ${y2} ` +
    `L${b.x + r} ${y2} A${r} ${r} 0 0 1 ${b.x} ${y2 - r} L${b.x} ${b.y + r} A${r} ${r} 0 0 1 ${b.x + r} ${b.y} Z`;
}

function nodeStrokes(shape, b, r, color) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  switch (shape) {
    case 'round': return roughStrokes(r.path(roundedRectPath(b, 12)), color);
    case 'stadium': return roughStrokes(r.path(roundedRectPath(b, b.h / 2)), color);
    case 'diamond': return roughStrokes(r.polygon([[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]]), color);
    case 'circle': return roughStrokes(r.circle(cx, cy, Math.min(b.w, b.h)), color);
    default: return roughStrokes(r.rectangle(b.x, b.y, b.w, b.h), color);
  }
}

/** Natural node box for a label block of w×h at the given style. */
export function nodeBoxSize(shape, labelW, labelH, style) {
  const p = PAD[style] || PAD.note;
  switch (shape) {
    case 'diamond': return { w: 1.6 * labelW + 2 * p.x, h: 3 * labelH + 2 * p.y };
    case 'circle': { const d = Math.hypot(labelW, labelH) + 2 * p.x; return { w: d, h: d }; }
    case 'stadium': return { w: labelW + labelH + 2 * p.x, h: labelH + 2 * p.y };
    default: return { w: labelW + 2 * p.x, h: labelH + 2 * p.y };
  }
}

// ---------- prepare ----------

/** prepare(element, ctx) for `diagram`; `ast` may be passed to skip re-parsing. */
export function prepareDiagram(element, ctx, ast = null) {
  const tree = ast || parseMermaid(element.mermaid);
  const { inner, safe, outer } = pictureRects(element.slot);
  const chalk = tokenColor('chalk');
  const style = tree.nodes.length > 4 ? 'note' : 'body';
  const maxLabelW = Math.max(60, safe.w * 0.45);

  // labels and natural sizes
  const labels = new Map();
  const sizes = new Map();
  for (const n of tree.nodes) {
    const fit = fitText(n.label || n.id, maxLabelW, { styles: style === 'body' ? ['body', 'note'] : ['note'], maxLines: 2 });
    labels.set(n.id, fit);
    sizes.set(n.id, nodeBoxSize(n.shape, fit.width, fit.height, fit.style));
  }
  // Pass 1 lays out with the normal gaps. When a label cannot be placed clear of everything (backlog
  // #21) — typically a cramped slot whose rank gap is shorter than a label — pass 2 keeps the gaps at
  // their defaults and scales the whole diagram down instead; it is kept only when it does better.
  let built = build({});
  if (built.labelCollisions > 0) {
    const roomy = build({ rankGapMin: LAYOUT.rankGap, nodeGapMin: LAYOUT.nodeGap });
    if (roomy.labelCollisions < built.labelCollisions) built = roomy;
  }
  const { lay, s, parts, nodeInfo, edgeInfos, labelCollisions } = built;

  return buildDrawable({
    id: element.id,
    type: 'diagram',
    parts,
    fallbackRect: inner,
    picture: {
      kind: 'diagram',
      direction: tree.direction,
      style,
      scale: s,
      textScale: s,
      ranks: lay.ranks,
      reversedEdges: [...lay.reversed],
      nodes: tree.nodes.map((n) => nodeInfo.get(n.id)),
      edges: edgeInfos,
      /** Number of edge labels for which no position clear of every shaft, node and label existed (backlog #21). */
      labelCollisions,
      /** True when the roomy second layout pass was needed to place the labels. */
      relaidForLabels: built.roomy,
      slotRect: outer,
      safeRect: safe,
    },
  });

  /** Nodes, edges and labels for one layout; a fresh seeded rough generator keeps each pass deterministic. */
  function build(layoutOpts) {
    const r = roughFor(ctx, element);
    const lay = layout(tree, sizes, safe, layoutOpts);
    const s = lay.scale;

    // nodes
    const nodeInfo = new Map();
    const parts = [];
    for (const n of tree.nodes) {
      const box = lay.nodes.get(n.id);
      const rect = { x: box.x, y: box.y, w: box.w, h: box.h };
      const fit = labels.get(n.id);
      const strokes = nodeStrokes(n.shape, rect, r, chalk);
      const lw = fit.width * s, lh = fit.height * s;
      const written = writeLines(fit.lines, fit.style, rect.x + (rect.w - lw) / 2, rect.y + (rect.h - lh) / 2, lw, chalk, { align: 'center', scale: s });
      strokes.push(...written.strokes);
      const info = { id: n.id, shape: n.shape, rect, center: [rect.x + rect.w / 2, rect.y + rect.h / 2], polygon: nodePolygon(n.shape, rect), label: { text: n.label, style: fit.style, lines: fit.lines, box: written.box }, rank: box.rank, order: box.order };
      nodeInfo.set(n.id, info);
      parts.push({ kind: 'node', strokes, meta: info });
    }

    // edges
    const groups = new Map();
    tree.edges.forEach((e, i) => { const k = [e.from, e.to].sort().join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    const edgeInfos = [];
    tree.edges.forEach((e, i) => {
      const a = nodeInfo.get(e.from), b = nodeInfo.get(e.to);
      if (!a || !b) return;
      const group = groups.get([e.from, e.to].sort().join('|'));
      const j = group.indexOf(i);
      let ca = a.center.slice(), cb = b.center.slice();
      if (group.length > 1) {
        // perpendicular taken from the canonical (sorted) direction so an edge and its reverse get distinct offsets
        const [lo, hi] = [a, b].sort((p, q) => (p.id < q.id ? -1 : 1));
        const dx = hi.center[0] - lo.center[0], dy = hi.center[1] - lo.center[1], len = Math.hypot(dx, dy) || 1;
        const off = (j - (group.length - 1) / 2) * PARALLEL_OFFSET;
        const nx = (-dy / len) * off, ny = (dx / len) * off;
        ca = [ca[0] + nx, ca[1] + ny]; cb = [cb[0] + nx, cb[1] + ny];
      }
      const others = tree.nodes.filter((n) => n.id !== e.from && n.id !== e.to).map((n) => expand(nodeInfo.get(n.id).rect, 3));
      const route = routeEdge(a, b, ca, cb, others, safe, tree.direction !== 'LR');
      const width = e.style === 'thick' ? THICK_WIDTH : STROKE_WIDTH;
      const dash = e.style === 'dotted' ? DASH_DOTTED : null;
      const strokes = roughStrokes(route.length === 2 ? r.line(route[0][0], route[0][1], route[1][0], route[1][1]) : r.linearPath(route), chalk, { width, dash });
      // arrowhead
      const tip = route[route.length - 1], prev = route[route.length - 2];
      let arrow = null;
      if (e.style !== 'line') {
        const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
        const len = e.style === 'thick' ? ARROW_LEN + 2 : ARROW_LEN;
        const l = [tip[0] - len * Math.cos(ang - ARROW_ANGLE), tip[1] - len * Math.sin(ang - ARROW_ANGLE)];
        const rr = [tip[0] - len * Math.cos(ang + ARROW_ANGLE), tip[1] - len * Math.sin(ang + ARROW_ANGLE)];
        arrow = [l, tip, rr];
        strokes.push(...roughStrokes(r.linearPath(arrow), chalk, { width }));
      }
      const info = { from: e.from, to: e.to, style: e.style, label: e.label || '', points: route, arrow, labelBox: null, labelClear: true, index: i };
      edgeInfos.push(info);
      parts.push({ kind: 'edge', strokes, meta: info });
    });

    // edge labels, placed after every edge is routed so each one can avoid all shafts and arrowheads
    // (backlog #21): in source order, each label also avoids the labels placed before it.
    const segments = [];
    for (const info of edgeInfos) {
      for (let k = 0; k + 1 < info.points.length; k++) segments.push([info.points[k], info.points[k + 1]]);
      if (info.arrow) segments.push([info.arrow[0], info.arrow[1]], [info.arrow[1], info.arrow[2]]);
    }
    const nodePolygons = tree.nodes.map((n) => nodeInfo.get(n.id).polygon);
    const placedBoxes = [];
    let labelCollisions = 0;
    edgeInfos.forEach((info, k) => {
      if (!info.label) return;
      const fit = fitText(info.label, Math.max(40, safe.w * 0.3), { styles: ['note'], maxLines: 2 });
      const lw = fit.width * s, lh = fit.height * s;
      const placed = placeEdgeLabel(info.points, lw, lh, { segments, nodePolygons, labelBoxes: placedBoxes }, safe);
      const written = writeLines(fit.lines, 'note', placed.box.x, placed.box.y, lw, chalk, { align: 'center', scale: s });
      parts[tree.nodes.length + k].strokes.push(...written.strokes);
      info.labelBox = written.box;
      info.labelClear = placed.clear;
      info.labelSide = placed.side;
      placedBoxes.push(written.box);
      if (!placed.clear) labelCollisions++;
    });

    return { lay, s, parts, nodeInfo, edgeInfos, labelCollisions, roomy: Object.keys(layoutOpts).length > 0 };
  }
}
