// shared/svg-subset.js — strict tokenizer/parser for the allowlisted SVG subset (spec §4.4 `svg`,
// brief 00 C1). Never uses DOMParser or creates live DOM; runs in Node and the browser.
//
//   parse(svgText, opts?) → { viewBox:{x,y,w,h}, shapes:[{tag, attrs, children?, text?}], shapeCount, bytes }
//   throws SvgError (code BAD_SVG) on anything outside the subset.
import { pathPoints } from './strokes.js';
import { CAPS } from './layout-core/constants.js';
import { COLOR_TOKENS } from './layout-core/tokens.js';

export class SvgError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SvgError';
    this.code = 'BAD_SVG';
  }
}

export const ALLOWED_TAGS = Object.freeze(['svg', 'g', 'path', 'line', 'circle', 'ellipse', 'rect', 'polyline', 'polygon', 'text']);
export const SHAPE_TAGS = Object.freeze(['path', 'line', 'circle', 'ellipse', 'rect', 'polyline', 'polygon', 'text']);
const GEOMETRY_ATTRS = ['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'viewBox', 'transform'];
const STYLE_ATTRS = ['stroke', 'stroke-width', 'fill', 'font-size', 'text-anchor'];
export const ALLOWED_ATTRS = Object.freeze([...GEOMETRY_ATTRS, ...STYLE_ATTRS, 'xmlns']);
const NUMERIC_ATTRS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'font-size']);
const COLOR_VALUES = new Set([...COLOR_TOKENS, 'chalk', 'none']);
const TEXT_ANCHORS = new Set(['start', 'middle', 'end']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function byteLength(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  return Buffer.byteLength(str, 'utf8');
}

function decodeEntities(s) {
  return s.replace(/&(#?[A-Za-z0-9]+);|&/g, (m, name) => {
    if (name === undefined) throw new SvgError('bare "&" is not allowed');
    if (name in ENTITIES && Object.prototype.hasOwnProperty.call(ENTITIES, name)) return ENTITIES[name];
    throw new SvgError(`entity &${name}; is not allowed`);
  });
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
const NUM_RE = new RegExp(`^${NUM}$`);

function num(value, what) {
  if (!NUM_RE.test(String(value).trim())) throw new SvgError(`${what} must be a plain number, got "${value}"`);
  const v = Number(value);
  if (!Number.isFinite(v)) throw new SvgError(`${what} is not finite`);
  return v;
}

function numberList(value, what) {
  const parts = String(value).trim().split(/[\s,]+/).filter((p) => p.length);
  return parts.map((p) => num(p, what));
}

/** Parse a transform attribute (translate/scale/rotate only) into a list of ops. */
export function parseTransform(value) {
  const ops = [];
  const re = /\s*(translate|scale|rotate)\s*\(([^()]*)\)\s*,?/gy;
  let pos = 0;
  const s = String(value).trim();
  while (pos < s.length) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m || m.index !== pos) throw new SvgError(`transform "${value}" is not translate/scale/rotate`);
    const args = numberList(m[2], 'transform argument');
    const kind = m[1];
    if (kind === 'translate') {
      if (args.length < 1 || args.length > 2) throw new SvgError('translate takes 1 or 2 numbers');
      ops.push({ kind, tx: args[0], ty: args[1] ?? 0 });
    } else if (kind === 'scale') {
      if (args.length < 1 || args.length > 2) throw new SvgError('scale takes 1 or 2 numbers');
      ops.push({ kind, sx: args[0], sy: args[1] ?? args[0] });
    } else {
      if (args.length !== 1 && args.length !== 3) throw new SvgError('rotate takes 1 or 3 numbers');
      ops.push({ kind, angle: args[0], cx: args[1] ?? 0, cy: args[2] ?? 0 });
    }
    pos = re.lastIndex;
  }
  return ops;
}

/** Apply transform ops (in order, as SVG does: rightmost applied first to the point) to a point. */
export function applyTransforms(ops, [x, y]) {
  let px = x, py = y;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.kind === 'translate') { px += op.tx; py += op.ty; }
    else if (op.kind === 'scale') { px *= op.sx; py *= op.sy; }
    else {
      const a = (op.angle * Math.PI) / 180;
      const dx = px - op.cx, dy = py - op.cy;
      px = op.cx + dx * Math.cos(a) - dy * Math.sin(a);
      py = op.cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
  }
  return [px, py];
}

// ---------- tokenizer ----------

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === '<') {
      if (src.startsWith('<!', i) || src.startsWith('<?', i)) throw new SvgError('comments, DOCTYPE, CDATA and processing instructions are not allowed');
      const close = src[i + 1] === '/';
      let j = i + (close ? 2 : 1);
      const nameMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(src.slice(j));
      if (!nameMatch) {
        if (/^[A-Za-z0-9_]*:/.test(src.slice(j))) throw new SvgError('namespace prefixes are not allowed');
        throw new SvgError(`malformed tag at ${i}`);
      }
      const name = nameMatch[0];
      j += name.length;
      if (src[j] === ':') throw new SvgError('namespace prefixes are not allowed');
      const attrs = {};
      let selfClosing = false;
      // attributes
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++;
        if (j >= n) throw new SvgError('unterminated tag');
        if (src[j] === '>') { j++; break; }
        if (src[j] === '/' && src[j + 1] === '>') { selfClosing = true; j += 2; break; }
        if (close) throw new SvgError('attributes on a closing tag');
        const am = /^([A-Za-z_][A-Za-z0-9_:.-]*)/.exec(src.slice(j));
        if (!am) throw new SvgError(`malformed attribute at ${j}`);
        const aname = am[1];
        j += aname.length;
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] !== '=') throw new SvgError(`attribute ${aname} needs a quoted value`);
        j++;
        while (j < n && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q !== '"' && q !== "'") throw new SvgError(`attribute ${aname} value must be quoted`);
        const end = src.indexOf(q, j + 1);
        if (end < 0) throw new SvgError(`unterminated value for ${aname}`);
        const raw = src.slice(j + 1, end);
        if (raw.includes('<')) throw new SvgError(`"<" in attribute ${aname}`);
        if (Object.prototype.hasOwnProperty.call(attrs, aname)) throw new SvgError(`duplicate attribute ${aname}`);
        attrs[aname] = decodeEntities(raw);
        j = end + 1;
      }
      tokens.push(close ? { type: 'close', name } : { type: 'open', name, attrs, selfClosing });
      i = j;
    } else {
      let j = src.indexOf('<', i);
      if (j < 0) j = n;
      tokens.push({ type: 'text', value: src.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

// ---------- validation ----------

function checkAttrs(tag, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) throw new SvgError(`event handler attribute ${name} is not allowed`);
    if (name.includes(':')) throw new SvgError(`namespaced attribute ${name} is not allowed`);
    if (lower === 'href' || lower === 'style' || lower === 'class' || lower === 'id') throw new SvgError(`attribute ${name} is not allowed`);
    if (!ALLOWED_ATTRS.includes(name)) throw new SvgError(`attribute ${name} is not allowed`);
    if (name === 'xmlns') {
      if (tag !== 'svg' || value !== 'http://www.w3.org/2000/svg') throw new SvgError('xmlns is only allowed on <svg> with the SVG namespace');
      continue;
    }
    if (name === 'viewBox' && tag !== 'svg') throw new SvgError('viewBox is only allowed on <svg>');
    if (NUMERIC_ATTRS.has(name)) num(value, name);
    if (name === 'stroke' || name === 'fill') {
      if (!COLOR_VALUES.has(value)) throw new SvgError(`${name}="${value}" must be a color token name, chalk or none`);
    }
    if (name === 'text-anchor' && !TEXT_ANCHORS.has(value)) throw new SvgError(`text-anchor="${value}" is invalid`);
    if (name === 'transform') parseTransform(value);
    if (name === 'points') {
      const list = numberList(value, 'points');
      if (list.length < 4 || list.length % 2 !== 0) throw new SvgError('points needs an even number of at least 4 numbers');
    }
    if (name === 'd') {
      try { pathPoints(value); } catch (e) { throw new SvgError(`path d is invalid: ${e.message}`); }
    }
  }
}

/** Points (untransformed) that bound a shape, from its geometry. */
function shapePoints(node) {
  const a = node.attrs;
  const g = (k, dflt = 0) => (a[k] === undefined ? dflt : Number(a[k]));
  switch (node.tag) {
    case 'rect': {
      const x = g('x'), y = g('y'), w = g('width'), h = g('height');
      if (w < 0 || h < 0) throw new SvgError('rect width/height must be >= 0');
      return [[x, y], [x + w, y + h]];
    }
    case 'circle': {
      const cx = g('cx'), cy = g('cy'), r = g('r');
      if (r < 0) throw new SvgError('circle r must be >= 0');
      return [[cx - r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx + r, cy - r]];
    }
    case 'ellipse': {
      const cx = g('cx'), cy = g('cy'), rx = g('rx'), ry = g('ry');
      if (rx < 0 || ry < 0) throw new SvgError('ellipse radii must be >= 0');
      return [[cx - rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry], [cx + rx, cy - ry]];
    }
    case 'line': return [[g('x1'), g('y1')], [g('x2'), g('y2')]];
    case 'polyline':
    case 'polygon': {
      if (a.points === undefined) throw new SvgError(`${node.tag} needs points`);
      const list = numberList(a.points, 'points');
      const pts = [];
      for (let i = 0; i < list.length; i += 2) pts.push([list[i], list[i + 1]]);
      return pts;
    }
    case 'path': {
      if (a.d === undefined) throw new SvgError('path needs d');
      return pathPoints(a.d);
    }
    case 'text': {
      const x = g('x'), y = g('y');
      const size = g('font-size', 16);
      return [[x, y], [x, y - size]];
    }
    default: return [];
  }
}

function requiredAttrs(node) {
  const a = node.attrs;
  const need = (k) => { if (a[k] === undefined) throw new SvgError(`<${node.tag}> needs ${k}`); };
  switch (node.tag) {
    case 'rect': need('width'); need('height'); break;
    case 'circle': need('r'); break;
    case 'ellipse': need('rx'); need('ry'); break;
    case 'line': need('x1'); need('y1'); need('x2'); need('y2'); break;
    default: break;
  }
}

/**
 * Parse and validate an SVG string against the subset.
 * @param {string} svgText
 * @param {{maxBytes?:number, maxShapes?:number, maxTextWords?:number}} [opts]
 */
export function parse(svgText, opts = {}) {
  const maxBytes = opts.maxBytes ?? CAPS.svgMaxBytes;
  const maxShapes = opts.maxShapes ?? CAPS.svgShapesMax;
  const maxTextWords = opts.maxTextWords ?? CAPS.svgTextWords;
  if (typeof svgText !== 'string') throw new SvgError('svg must be a string');
  const bytes = byteLength(svgText);
  if (bytes > maxBytes) throw new SvgError(`svg is ${bytes} bytes, cap is ${maxBytes}`);
  const tokens = tokenize(svgText);

  const stack = [];
  let root = null;
  let shapeCount = 0;
  for (const tok of tokens) {
    if (tok.type === 'text') {
      if (tok.value.trim() === '') continue;
      const parent = stack[stack.length - 1];
      if (!parent || parent.tag !== 'text') throw new SvgError('text content is only allowed inside <text>');
      parent.text = (parent.text || '') + decodeEntities(tok.value);
      continue;
    }
    if (tok.type === 'open') {
      const tag = tok.name;
      if (!ALLOWED_TAGS.includes(tag)) throw new SvgError(`<${tag}> is not allowed`);
      checkAttrs(tag, tok.attrs);
      const node = { tag, attrs: tok.attrs };
      if (tag === 'svg') {
        if (root || stack.length) throw new SvgError('<svg> must be the single root element');
        if (tok.attrs.viewBox === undefined) throw new SvgError('<svg> must declare viewBox');
        const vb = numberList(tok.attrs.viewBox, 'viewBox');
        if (vb.length !== 4 || vb[2] <= 0 || vb[3] <= 0) throw new SvgError('viewBox must be "x y w h" with w,h > 0');
        node.viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
        node.children = [];
        root = node;
      } else {
        if (!root || stack.length === 0) throw new SvgError('elements must be inside <svg>');
        const parent = stack[stack.length - 1];
        if (parent.tag !== 'svg' && parent.tag !== 'g') throw new SvgError(`<${tag}> cannot be nested inside <${parent.tag}>`);
        if (tag === 'g') node.children = [];
        if (SHAPE_TAGS.includes(tag)) {
          shapeCount++;
          if (shapeCount > maxShapes) throw new SvgError(`more than ${maxShapes} shapes`);
          requiredAttrs(node);
        }
        parent.children.push(node);
      }
      if (!tok.selfClosing) stack.push(node);
      continue;
    }
    // close
    const open = stack.pop();
    if (!open || open.tag !== tok.name) throw new SvgError(`mismatched closing tag </${tok.name}>`);
  }
  if (stack.length) throw new SvgError(`unclosed <${stack[stack.length - 1].tag}>`);
  if (!root) throw new SvgError('no <svg> root');

  // bounds + text caps, with accumulated transforms
  const vb = root.viewBox;
  const eps = 1e-6;
  const inside = ([x, y]) => x >= vb.x - eps && y >= vb.y - eps && x <= vb.x + vb.w + eps && y <= vb.y + vb.h + eps;
  const walk = (node, ops) => {
    const own = node.attrs.transform ? parseTransform(node.attrs.transform) : [];
    const all = [...ops, ...own];
    if (node.tag === 'g') { for (const c of node.children) walk(c, all); return; }
    if (node.tag === 'svg') { for (const c of node.children) walk(c, []); return; }
    if (node.tag === 'text') {
      const words = (node.text || '').split(/\s+/).filter((w) => w.length).length;
      if (words > maxTextWords) throw new SvgError(`<text> has ${words} words, cap is ${maxTextWords}`);
    }
    for (const p of shapePoints(node)) {
      if (!inside(applyTransforms(all, p))) throw new SvgError(`<${node.tag}> extends outside the viewBox`);
    }
  };
  walk(root, []);

  return { viewBox: vb, shapes: root.children, shapeCount, bytes };
}

/** True when the text parses; never throws. */
export function isValid(svgText, opts) {
  try { parse(svgText, opts); return true; } catch (e) { if (e instanceof SvgError) return false; throw e; }
}
