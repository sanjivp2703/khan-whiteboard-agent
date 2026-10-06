// player/renderer/pictures/diagram.js — `diagram` drawable: Mermaid flowchart subset AST →
// deterministic layered layout (diagram-layout.js) → rough nodes, rough edges with arrowheads,
// hand-written labels. Parts: nodes (source order) then edges (source order).
import { parse as parseMermaid } from '../../../shared/mermaid-subset.js';
import { layout } from './diagram-layout.js';
import {
  pictureRects, roughFor, tokenColor, roughStrokes, fitText, writeLines, buildDrawable, STROKE_WIDTH,
} from './common.js';

const PAD = Object.freeze({ body: { x: 16, y: 9 }, note: { x: 12, y: 7 } });
const ARROW_LEN = 13;
const ARROW_ANGLE = (28 * Math.PI) / 180;
const EDGE_LABEL_OFFSET = 13;
const PARALLEL_OFFSET = 11;
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
  const r = roughFor(ctx, element);
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
  const lay = layout(tree, sizes, safe);
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
      const dx = cb[0] - ca[0], dy = cb[1] - ca[1], len = Math.hypot(dx, dy) || 1;
      const off = (j - (group.length - 1) / 2) * PARALLEL_OFFSET;
      const nx = (-dy / len) * off, ny = (dx / len) * off;
      ca = [ca[0] + nx, ca[1] + ny]; cb = [cb[0] + nx, cb[1] + ny];
    }
    const others = tree.nodes.filter((n) => n.id !== e.from && n.id !== e.to).map((n) => expand(nodeInfo.get(n.id).rect, 3));
    const crossings = (segs) => segs.reduce((acc, [p, q]) => acc + others.filter((o) => segmentHitsRect(p, q, o)).length, 0);
    // straight
    const sp = exitPoint(a.polygon, ca, cb), tp = exitPoint(b.polygon, cb, ca);
    let candidates = [{ points: [sp, tp], crossings: crossings([[sp, tp]]) }];
    if (candidates[0].crossings > 0) {
      for (const c of [[ca[0], cb[1]], [cb[0], ca[1]]]) {
        if (pointInRect(c, a.rect) || pointInRect(c, b.rect) || others.some((o) => pointInRect(c, o))) continue;
        const p0 = exitPoint(a.polygon, ca, c), p1 = exitPoint(b.polygon, cb, c);
        candidates.push({ points: [p0, c, p1], crossings: crossings([[p0, c], [c, p1]]) });
      }
    }
    candidates = candidates.map((c, idx) => ({ ...c, idx })).sort((x, y) => x.crossings - y.crossings || x.idx - y.idx);
    const route = candidates[0].points;
    const width = e.style === 'thick' ? THICK_WIDTH : STROKE_WIDTH;
    const dash = e.style === 'dotted' ? DASH_DOTTED : null;
    const strokes = roughStrokes(route.length === 2 ? r.line(route[0][0], route[0][1], route[1][0], route[1][1]) : r.linearPath(route), chalk, { width, dash });
    // arrowhead
    const tip = route[route.length - 1], prev = route[route.length - 2];
    if (e.style !== 'line') {
      const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
      const len = e.style === 'thick' ? ARROW_LEN + 2 : ARROW_LEN;
      const l = [tip[0] - len * Math.cos(ang - ARROW_ANGLE), tip[1] - len * Math.sin(ang - ARROW_ANGLE)];
      const rr = [tip[0] - len * Math.cos(ang + ARROW_ANGLE), tip[1] - len * Math.sin(ang + ARROW_ANGLE)];
      strokes.push(...roughStrokes(r.linearPath([l, tip, rr]), chalk, { width }));
    }
    // label at the midpoint of the longest segment, offset perpendicular, clamped into the safe rect
    let labelBox = null;
    if (e.label) {
      let seg = [route[0], route[1]];
      for (let k = 1; k + 1 < route.length; k++) if (dist(route[k], route[k + 1]) > dist(seg[0], seg[1])) seg = [route[k], route[k + 1]];
      const mx = (seg[0][0] + seg[1][0]) / 2, my = (seg[0][1] + seg[1][1]) / 2;
      const dx = seg[1][0] - seg[0][0], dy = seg[1][1] - seg[0][1], len = Math.hypot(dx, dy) || 1;
      const fit = fitText(e.label, Math.max(40, safe.w * 0.3), { styles: ['note'], maxLines: 2 });
      const lw = fit.width * s, lh = fit.height * s;
      let lx = mx - dy / len * EDGE_LABEL_OFFSET - lw / 2;
      let ly = my + dx / len * EDGE_LABEL_OFFSET - lh / 2;
      lx = Math.max(safe.x, Math.min(lx, safe.x + safe.w - lw));
      ly = Math.max(safe.y, Math.min(ly, safe.y + safe.h - lh));
      const written = writeLines(fit.lines, 'note', lx, ly, lw, chalk, { align: 'center', scale: s });
      strokes.push(...written.strokes);
      labelBox = written.box;
    }
    const info = { from: e.from, to: e.to, style: e.style, label: e.label || '', points: route, labelBox, index: i };
    edgeInfos.push(info);
    parts.push({ kind: 'edge', strokes, meta: info });
  });

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
      slotRect: outer,
      safeRect: safe,
    },
  });
}
