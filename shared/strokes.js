// shared/strokes.js — path sampling, partial drawing, seeded rough.js wrapper, natural draw time.
// Environment-agnostic (Node + browser). Only drawPartial touches a 2D context.
import rough from '../vendor/rough/rough.esm.js';
import { PEN_PX_PER_S, ROUGH_OPTIONS } from './layout-core/constants.js';

const CURVE_STEPS = 12; // fixed subdivision → deterministic lengths

// ---------- path parsing ----------

const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/** Tokenize an SVG path `d` into {cmd, args} in source order. Throws on garbage. */
export function tokenizePath(d) {
  const out = [];
  let cur = null;
  let m;
  CMD_RE.lastIndex = 0;
  const cleaned = String(d);
  // reject anything that is not a command letter, number, separator
  if (/[^MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]/.test(cleaned)) throw new Error('path: illegal character');
  while ((m = CMD_RE.exec(cleaned)) !== null) {
    if (m[1]) { cur = { cmd: m[1], args: [] }; out.push(cur); }
    else {
      if (!cur) throw new Error('path: number before any command');
      cur.args.push(Number(m[2]));
    }
  }
  return out;
}

const ARGC = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Parse `d` into absolute segments: {type:'M'|'L'|'C'|'Q'|'Z', pts:[x,y,...]} where arcs are
 * converted to cubic curves and H/V/S/T are expanded.
 */
export function parsePath(d) {
  const segs = [];
  let x = 0, y = 0, sx = 0, sy = 0; // current point, subpath start
  let lastCtrl = null; // for S/T reflection
  let lastCmd = '';
  for (const tok of tokenizePath(d)) {
    const C = tok.cmd.toUpperCase();
    const rel = tok.cmd !== C;
    const n = ARGC[C];
    if (C === 'Z') {
      segs.push({ type: 'Z', pts: [] });
      x = sx; y = sy; lastCtrl = null; lastCmd = C;
      continue;
    }
    if (tok.args.length === 0 || tok.args.length % n !== 0) throw new Error(`path: wrong argument count for ${tok.cmd}`);
    for (let i = 0; i < tok.args.length; i += n) {
      const a = tok.args.slice(i, i + n);
      const implicitLine = C === 'M' && i > 0;
      const cmd = implicitLine ? 'L' : C;
      switch (cmd) {
        case 'M': {
          x = rel ? x + a[0] : a[0]; y = rel ? y + a[1] : a[1];
          sx = x; sy = y;
          segs.push({ type: 'M', pts: [x, y] });
          lastCtrl = null;
          break;
        }
        case 'L': {
          x = rel ? x + a[0] : a[0]; y = rel ? y + a[1] : a[1];
          segs.push({ type: 'L', pts: [x, y] });
          lastCtrl = null;
          break;
        }
        case 'H': {
          x = rel ? x + a[0] : a[0];
          segs.push({ type: 'L', pts: [x, y] });
          lastCtrl = null;
          break;
        }
        case 'V': {
          y = rel ? y + a[0] : a[0];
          segs.push({ type: 'L', pts: [x, y] });
          lastCtrl = null;
          break;
        }
        case 'C': {
          const p = rel ? [x + a[0], y + a[1], x + a[2], y + a[3], x + a[4], y + a[5]] : a.slice();
          segs.push({ type: 'C', pts: p });
          lastCtrl = [p[2], p[3]];
          x = p[4]; y = p[5];
          break;
        }
        case 'S': {
          const c1 = lastCtrl && (lastCmd === 'C' || lastCmd === 'S') ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
          const p = rel ? [c1[0], c1[1], x + a[0], y + a[1], x + a[2], y + a[3]] : [c1[0], c1[1], a[0], a[1], a[2], a[3]];
          segs.push({ type: 'C', pts: p });
          lastCtrl = [p[2], p[3]];
          x = p[4]; y = p[5];
          break;
        }
        case 'Q': {
          const p = rel ? [x + a[0], y + a[1], x + a[2], y + a[3]] : a.slice();
          segs.push({ type: 'Q', pts: p });
          lastCtrl = [p[0], p[1]];
          x = p[2]; y = p[3];
          break;
        }
        case 'T': {
          const c1 = lastCtrl && (lastCmd === 'Q' || lastCmd === 'T') ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
          const p = rel ? [c1[0], c1[1], x + a[0], y + a[1]] : [c1[0], c1[1], a[0], a[1]];
          segs.push({ type: 'Q', pts: p });
          lastCtrl = [p[0], p[1]];
          x = p[2]; y = p[3];
          break;
        }
        case 'A': {
          const ex = rel ? x + a[5] : a[5];
          const ey = rel ? y + a[6] : a[6];
          for (const cubic of arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey)) segs.push({ type: 'C', pts: cubic });
          x = ex; y = ey;
          lastCtrl = null;
          break;
        }
        default:
          throw new Error(`path: unsupported command ${cmd}`);
      }
      lastCmd = cmd;
    }
  }
  return segs;
}

/** Convert an SVG arc to one or more cubic bezier segments (standard F.6.5 algorithm). */
function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  let th = theta1;
  for (let i = 0; i < segments; i++) {
    const c1 = Math.cos(th), s1 = Math.sin(th);
    const th2 = th + delta;
    const c2 = Math.cos(th2), s2 = Math.sin(th2);
    const p1 = [c1 - t * s1, s1 + t * c1];
    const p2 = [c2 + t * s2, s2 - t * c2];
    const p3 = [c2, s2];
    const map = ([px, py]) => [cx + rx * px * cos - ry * py * sin, cy + rx * px * sin + ry * py * cos];
    const a = map(p1), b = map(p2), e = map(p3);
    out.push([a[0], a[1], b[0], b[1], e[0], e[1]]);
    th = th2;
  }
  return out;
}

/** Every point of the path incl. bezier control points (conservative bounds). */
export function pathPoints(d) {
  const pts = [];
  for (const s of parsePath(d)) for (let i = 0; i < s.pts.length; i += 2) pts.push([s.pts[i], s.pts[i + 1]]);
  return pts;
}

/** Bounding box of all points (incl. control points): {x,y,w,h} or null for an empty path. */
export function pathBounds(d) {
  const pts = pathPoints(d);
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- flattening and sampling ----------

/**
 * Flatten to polylines: [{points:[[x,y],...], lengths:[cumulative...], length}] one per subpath.
 */
export function flatten(d) {
  const subpaths = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  const start = (px, py) => { cur = { points: [[px, py]], lengths: [0], length: 0 }; subpaths.push(cur); };
  const add = (px, py) => {
    if (!cur) start(x, y);
    const [lx, ly] = cur.points[cur.points.length - 1];
    const seg = Math.hypot(px - lx, py - ly);
    cur.length += seg;
    cur.points.push([px, py]);
    cur.lengths.push(cur.length);
  };
  for (const s of parsePath(d)) {
    switch (s.type) {
      case 'M': x = s.pts[0]; y = s.pts[1]; sx = x; sy = y; start(x, y); break;
      case 'L': x = s.pts[0]; y = s.pts[1]; add(x, y); break;
      case 'C': {
        const [c1x, c1y, c2x, c2y, ex, ey] = s.pts;
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS, mt = 1 - t;
          add(mt * mt * mt * x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex,
            mt * mt * mt * y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey);
        }
        x = ex; y = ey;
        break;
      }
      case 'Q': {
        const [cx, cy, ex, ey] = s.pts;
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS, mt = 1 - t;
          add(mt * mt * x + 2 * mt * t * cx + t * t * ex, mt * mt * y + 2 * mt * t * cy + t * t * ey);
        }
        x = ex; y = ey;
        break;
      }
      case 'Z': if (cur && (x !== sx || y !== sy)) add(sx, sy); x = sx; y = sy; break;
      default: break;
    }
  }
  return subpaths.filter((sp) => sp.points.length > 0);
}

/** Total length of a path (flattened). */
export function pathLength(d) {
  return flatten(d).reduce((s, sp) => s + sp.length, 0);
}

/** Point at `fraction` ∈ [0,1] of the total length: {x, y}; null for an empty path. */
export function pointAt(d, fraction) {
  const subs = flatten(d);
  if (subs.length === 0) return null;
  const total = subs.reduce((s, sp) => s + sp.length, 0);
  if (total === 0) { const p = subs[0].points[0]; return { x: p[0], y: p[1] }; }
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (const sp of subs) {
    if (target > sp.length + 1e-9) { target -= sp.length; continue; }
    const pts = sp.points, lens = sp.lengths;
    for (let i = 1; i < pts.length; i++) {
      if (lens[i] >= target - 1e-9) {
        const segLen = lens[i] - lens[i - 1];
        const t = segLen === 0 ? 0 : (target - lens[i - 1]) / segLen;
        return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t };
      }
    }
    const last = pts[pts.length - 1];
    return { x: last[0], y: last[1] };
  }
  const lastSp = subs[subs.length - 1];
  const last = lastSp.points[lastSp.points.length - 1];
  return { x: last[0], y: last[1] };
}

const fmt = (v) => Math.round(v * 100) / 100;

/** Path data for the first `fraction` of the path's length (polyline approximation). */
export function partialPath(d, fraction) {
  const subs = flatten(d);
  const total = subs.reduce((s, sp) => s + sp.length, 0);
  let budget = Math.max(0, Math.min(1, fraction)) * total;
  const parts = [];
  for (const sp of subs) {
    if (budget <= 0 && parts.length) break;
    const pts = sp.points, lens = sp.lengths;
    let str = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      if (lens[i] <= budget + 1e-9) { str += ` L${fmt(pts[i][0])} ${fmt(pts[i][1])}`; continue; }
      const segLen = lens[i] - lens[i - 1];
      const t = segLen === 0 ? 0 : (budget - lens[i - 1]) / segLen;
      if (t > 0) str += ` L${fmt(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t)} ${fmt(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t)}`;
      budget = 0;
      parts.push(str);
      str = null;
      break;
    }
    if (str !== null) { parts.push(str); budget -= sp.length; }
  }
  return parts.join(' ');
}

/** Stroke the first `fraction` of path `d` on a 2D context (uses the context's current style). */
export function drawPartial(ctx2d, d, fraction) {
  const subs = flatten(d);
  const total = subs.reduce((s, sp) => s + sp.length, 0);
  let budget = Math.max(0, Math.min(1, fraction)) * total;
  ctx2d.beginPath();
  for (const sp of subs) {
    if (budget <= 0) break;
    const pts = sp.points, lens = sp.lengths;
    ctx2d.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      if (lens[i] <= budget + 1e-9) { ctx2d.lineTo(pts[i][0], pts[i][1]); continue; }
      const segLen = lens[i] - lens[i - 1];
      const t = segLen === 0 ? 0 : (budget - lens[i - 1]) / segLen;
      ctx2d.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
      budget = 0;
      break;
    }
    if (budget > 0) budget -= sp.length;
  }
  ctx2d.stroke();
}

// ---------- rough.js wrapper ----------

/** Deterministic positive 31-bit seed from an element id (FNV-1a). */
export function seedFor(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 2147483646) + 1;
}

const generator = rough.generator();

/**
 * Seeded rough wrapper. Every method returns SVG path strings (stroke paths; with
 * `opts.fill` set, hachure fill paths follow the stroke paths). Fixed look from ROUGH_OPTIONS.
 */
export function rough_(seed) {
  const base = typeof seed === 'number' ? seed : seedFor(seed);
  const opts = (extra = {}) => ({ ...ROUGH_OPTIONS, seed: base, ...extra });
  const toPaths = (drawable, extra) => {
    const paths = generator.toPaths(drawable);
    const strokes = paths.filter((p) => p.stroke !== 'none' && p.stroke !== undefined && p.strokeWidth !== '0' && p.strokeWidth !== 0).map((p) => p.d);
    const fills = extra && extra.fill ? paths.filter((p) => !strokes.includes(p.d)).map((p) => p.d) : [];
    return [...strokes, ...fills];
  };
  return {
    seed: base,
    rectangle: (x, y, w, h, extra) => toPaths(generator.rectangle(x, y, w, h, opts(extra)), extra),
    line: (x1, y1, x2, y2, extra) => toPaths(generator.line(x1, y1, x2, y2, opts(extra)), extra),
    ellipse: (cx, cy, w, h, extra) => toPaths(generator.ellipse(cx, cy, w, h, opts(extra)), extra),
    circle: (cx, cy, dia, extra) => toPaths(generator.circle(cx, cy, dia, opts(extra)), extra),
    polygon: (points, extra) => toPaths(generator.polygon(points, opts(extra)), extra),
    linearPath: (points, extra) => toPaths(generator.linearPath(points, opts(extra)), extra),
    curve: (points, extra) => toPaths(generator.curve(points, opts(extra)), extra),
    path: (d, extra) => toPaths(generator.path(d, opts(extra)), extra),
    arc: (cx, cy, w, h, start, stop, closed = false, extra) => toPaths(generator.arc(cx, cy, w, h, start, stop, closed, opts(extra)), extra),
  };
}
export { rough_ as rough };

/** Minimum believable draw time for a set of paths: total length / PEN_PX_PER_S, in ms. */
export function naturalMs(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  let total = 0;
  for (const d of list) if (d) total += pathLength(d);
  return (total / PEN_PX_PER_S) * 1000;
}
