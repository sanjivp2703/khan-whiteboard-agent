// player/renderer/core/svg-strokes.js — MathJax SVG output → board-space path strings.
// Walks the (canonicalised) SVG text with a strict tag tokenizer, composes translate/scale/
// matrix transforms, and emits one stroke per <path>/<rect>/<line>/<circle>/<ellipse>.
// Never touches the DOM.
import { parsePath } from '../../../shared/strokes.js';
import { segmentsToPath } from './drawable.js';

const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
const ATTR_RE = /([\w:.-]+)(?:="([^"]*)")?/g;
const TRANSFORM_RE = /(translate|scale|matrix|rotate|skewX|skewY)\s*\(\s*([^)]*)\)/g;

function parseAttrs(str) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(str)) !== null) out[m[1]] = m[2] === undefined ? '' : m[2];
  return out;
}

// affine matrices as [a, b, c, d, e, f]: x' = a x + c y + e ; y' = b x + d y + f
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Parse an SVG `transform` attribute into one matrix. */
export function parseTransform(str) {
  let m = IDENTITY.slice();
  if (!str) return m;
  let t;
  TRANSFORM_RE.lastIndex = 0;
  while ((t = TRANSFORM_RE.exec(str)) !== null) {
    const args = t[2].trim().split(/[\s,]+/).filter((s) => s.length).map(Number);
    let local;
    switch (t[1]) {
      case 'translate': local = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; break;
      case 'scale': local = [args[0] ?? 1, 0, 0, args.length > 1 ? args[1] : (args[0] ?? 1), 0, 0]; break;
      case 'matrix': local = args.length === 6 ? args : IDENTITY.slice(); break;
      case 'rotate': {
        const a = ((args[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        local = [cos, sin, -sin, cos, 0, 0];
        if (args.length === 3) local = multiply(multiply([1, 0, 0, 1, args[1], args[2]], local), [1, 0, 0, 1, -args[1], -args[2]]);
        break;
      }
      case 'skewX': local = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': local = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: local = IDENTITY.slice();
    }
    m = multiply(m, local);
  }
  return m;
}

function transformSegments(d, m) {
  return parsePath(d).map((s) => {
    const pts = [];
    for (let i = 0; i < s.pts.length; i += 2) pts.push(...apply(m, s.pts[i], s.pts[i + 1]));
    return { type: s.type, pts };
  });
}

function rectPath(a, m) {
  const x = Number(a.x || 0), y = Number(a.y || 0), w = Number(a.width || 0), h = Number(a.height || 0);
  const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => apply(m, px, py));
  return { type: 'rect', segs: [{ type: 'M', pts: c[0] }, { type: 'L', pts: c[1] }, { type: 'L', pts: c[2] }, { type: 'L', pts: c[3] }, { type: 'Z', pts: [] }] };
}

function ellipsePath(cx, cy, rx, ry, m) {
  // 4 cubic arcs
  const k = 0.5522847498;
  const p = (x, y) => apply(m, x, y);
  const segs = [
    { type: 'M', pts: p(cx + rx, cy) },
    { type: 'C', pts: [...p(cx + rx, cy + k * ry), ...p(cx + k * rx, cy + ry), ...p(cx, cy + ry)] },
    { type: 'C', pts: [...p(cx - k * rx, cy + ry), ...p(cx - rx, cy + k * ry), ...p(cx - rx, cy)] },
    { type: 'C', pts: [...p(cx - rx, cy - k * ry), ...p(cx - k * rx, cy - ry), ...p(cx, cy - ry)] },
    { type: 'C', pts: [...p(cx + k * rx, cy - ry), ...p(cx + rx, cy - k * ry), ...p(cx + rx, cy)] },
    { type: 'Z', pts: [] },
  ];
  return segs;
}

/**
 * Convert an SVG string to strokes under a root matrix (which maps root SVG user units to
 * board pixels). Returns [{d, tag, dataC}] in document order.
 */
export function svgToStrokes(svg, root = IDENTITY) {
  const stack = [root.slice()];
  const out = [];
  let m;
  TAG_RE.lastIndex = 0;
  const str = String(svg);
  while ((m = TAG_RE.exec(str)) !== null) {
    const [, slash, name, attrStr, selfClose] = m;
    if (slash) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = parseAttrs(attrStr);
    const parent = stack[stack.length - 1];
    const cur = attrs.transform && name !== 'svg' ? multiply(parent, parseTransform(attrs.transform)) : parent;
    let segs = null;
    switch (name) {
      case 'path': if (attrs.d) segs = transformSegments(attrs.d, cur); break;
      case 'rect': segs = rectPath(attrs, cur).segs; break;
      case 'line': {
        const a = apply(cur, Number(attrs.x1 || 0), Number(attrs.y1 || 0));
        const b = apply(cur, Number(attrs.x2 || 0), Number(attrs.y2 || 0));
        segs = [{ type: 'M', pts: a }, { type: 'L', pts: b }];
        break;
      }
      case 'circle': segs = ellipsePath(Number(attrs.cx || 0), Number(attrs.cy || 0), Number(attrs.r || 0), Number(attrs.r || 0), cur); break;
      case 'ellipse': segs = ellipsePath(Number(attrs.cx || 0), Number(attrs.cy || 0), Number(attrs.rx || 0), Number(attrs.ry || 0), cur); break;
      default: break;
    }
    if (segs && segs.length) out.push({ d: segmentsToPath(segs), tag: name, dataC: attrs['data-c'] || null });
    if (!selfClose) stack.push(cur);
  }
  return out;
}
