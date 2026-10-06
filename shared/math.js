// shared/math.js — LaTeX → SVG via the vendored MathJax 3 with restricted macros (spec §4.4
// `math`, brief 00 C1/C4). The same MathJax configuration runs in Node (es5/node-main.js +
// liteDOM) and in the browser (es5/tex-svg.js); output strings are canonicalized so they
// compare equal across environments.
//
//   await texToSvg(lines, {restricted:true}) → [{svg, width, height, eqX|null}]
//     width/height in em (viewBox units / 1000); eqX = x (em) of the centre of the first "="
//   checkMathCaps(lines) → [{code, message}]       (1–5 lines, ≤ 60 chars, banned macros)
//   bannedMacro(line) → name|null
import { CAPS } from './layout-core/constants.js';
import { pathBounds } from './strokes.js';

export class MathError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'MathError';
    this.code = 'BAD_MATH';
    this.line = line;
  }
}

/** Macros rejected before compilation (anything that defines macros, loads packages or links). */
export const BANNED_MACROS = Object.freeze([
  'def', 'edef', 'gdef', 'xdef', 'let', 'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment',
  'input', 'include', 'includegraphics', 'href', 'url', 'require', 'unicode', 'usepackage', 'DeclareMathOperator', 'newcommand*',
  'mathchoice', 'csname', 'expandafter', 'catcode', 'uppercase', 'lowercase', 'special', 'write', 'openout', 'closeout', 'read',
  'class', 'cssId', 'style', 'html', 'data', 'begingroup', 'endgroup',
]);

/** Name of the first banned macro in a line, or null. */
export function bannedMacro(line) {
  const re = /\\([A-Za-z]+\*?)/g;
  let m;
  while ((m = re.exec(String(line))) !== null) {
    if (BANNED_MACROS.includes(m[1])) return m[1];
  }
  return null;
}

/** Shape-level checks shared by the validator: returns [{code:'CAP_LINES'|'CAP_CHARS'|'BAD_MATH'|'BAD_FIELD', message}]. */
export function checkMathCaps(lines) {
  const errors = [];
  if (!Array.isArray(lines)) return [{ code: 'BAD_FIELD', message: 'lines must be an array of strings' }];
  if (lines.length < CAPS.mathLinesMin || lines.length > CAPS.mathLinesMax) {
    errors.push({ code: 'CAP_LINES', message: `math has ${lines.length} lines; allowed ${CAPS.mathLinesMin}–${CAPS.mathLinesMax}` });
  }
  lines.forEach((l, i) => {
    if (typeof l !== 'string') { errors.push({ code: 'BAD_FIELD', message: `lines[${i}] must be a string` }); return; }
    if (l.length > CAPS.mathLineChars) errors.push({ code: 'CAP_CHARS', message: `lines[${i}] has ${l.length} chars; cap ${CAPS.mathLineChars}` });
    if (l.trim().length === 0) errors.push({ code: 'BAD_FIELD', message: `lines[${i}] is empty` });
    const banned = bannedMacro(l);
    if (banned) errors.push({ code: 'BAD_MATH', message: `lines[${i}] uses \\${banned}, which is not allowed` });
  });
  return errors;
}

// ---------- MathJax configuration (identical in Node and browser) ----------

export const MATHJAX_CONFIG = Object.freeze({
  tex: { packages: ['base', 'ams'], inlineMath: [], displayMath: [], processEscapes: false, processEnvironments: false, processRefs: false, tags: 'none' },
  svg: { fontCache: 'none', displayAlign: 'left', mtextInheritFont: false, scale: 1, minScale: 1 },
  options: { enableMenu: false, enableAssistiveMml: false },
  startup: { typeset: false },
});

const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

let mjPromise = null;
let mj = null;
let adaptor = null;

function nodeInit() {
  return (async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const es5Dir = new URL('../vendor/mathjax/es5/', import.meta.url).pathname;
    const MathJax = require(es5Dir + 'node-main.js');
    const instance = await MathJax.init({
      loader: { load: ['input/tex', 'output/svg'], paths: { mathjax: es5Dir.replace(/\/$/, '') }, require },
      tex: { ...MATHJAX_CONFIG.tex, formatError: (_jax, err) => { throw err; } },
      svg: { ...MATHJAX_CONFIG.svg },
      options: { ...MATHJAX_CONFIG.options },
      startup: { ...MATHJAX_CONFIG.startup },
    });
    adaptor = instance.startup.adaptor;
    return instance;
  })();
}

function browserInit() {
  return new Promise((resolve, reject) => {
    if (window.MathJax && window.MathJax.tex2svg) { resolve(window.MathJax); return; }
    window.MathJax = {
      loader: { load: [] },
      tex: { ...MATHJAX_CONFIG.tex, formatError: (_jax, err) => { throw err; } },
      svg: { ...MATHJAX_CONFIG.svg },
      options: { ...MATHJAX_CONFIG.options },
      startup: { ...MATHJAX_CONFIG.startup },
    };
    const script = document.createElement('script');
    script.src = '/vendor/mathjax/es5/tex-svg.js';
    script.async = true;
    script.onload = () => { window.MathJax.startup.promise.then(() => resolve(window.MathJax), reject); };
    script.onerror = () => reject(new Error('failed to load /vendor/mathjax/es5/tex-svg.js'));
    document.head.appendChild(script);
  });
}

/** Resolve once MathJax is initialised (lazy; shared). */
export function ready() {
  if (!mjPromise) {
    mjPromise = (isNode ? nodeInit() : browserInit()).then((instance) => { mj = instance; return instance; });
  }
  return mjPromise;
}

export function isReady() { return mj !== null; }

function containerToSvgString(container) {
  if (isNode) {
    const svg = adaptor.firstChild(container);
    return adaptor.outerHTML(svg);
  }
  const svg = container.querySelector('svg');
  return svg.outerHTML;
}

// ---------- canonicalization and analysis of the SVG string ----------

const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
const ATTR_RE = /([\w:.-]+)(?:="([^"]*)")?/g;

function parseAttrs(str) {
  const out = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(str)) !== null) out.push([m[1], m[2] === undefined ? '' : m[2]]);
  return out;
}

/** Canonical form: whitespace between tags removed, attributes sorted, numbers kept as emitted. */
export function normalizeSvg(svg) {
  const s = String(svg).replace(/>\s+</g, '><').trim();
  return s.replace(TAG_RE, (_m, slash, name, attrs, selfClose) => {
    if (slash) return `</${name}>`;
    const list = parseAttrs(attrs).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const body = list.map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${name}${body ? ' ' + body : ''}${selfClose ? '/' : ''}>`;
  });
}

function parseViewBox(svg) {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (!m) return null;
  const [x, y, w, h] = m[1].trim().split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

/**
 * x (viewBox units) of the centre of the first top-level "=" glyph (data-c="3D"), or null.
 * Prefers an "=" drawn at scale 1 (not inside a sub/superscript); falls back to the first found.
 */
export function findEqX(svg) {
  const stack = [];
  let m;
  let fallback = null;
  TAG_RE.lastIndex = 0;
  const str = String(svg);
  while ((m = TAG_RE.exec(str)) !== null) {
    const [, slash, , attrStr, selfClose] = m;
    if (slash) { stack.pop(); continue; }
    const attrs = Object.fromEntries(parseAttrs(attrStr));
    let tx = 0, sx = 1;
    if (attrs.transform) {
      const t = /translate\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)/.exec(attrs.transform);
      if (t) tx = Number(t[1]);
      const s = /scale\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)/.exec(attrs.transform);
      if (s) sx = Number(s[1]);
    }
    const parent = stack.length ? stack[stack.length - 1] : { x: 0, scale: 1 };
    const frame = { x: parent.x + parent.scale * tx, scale: parent.scale * sx };
    if (attrs['data-c'] === '3D') {
      let centre = 0;
      if (attrs.d) {
        const b = pathBounds(attrs.d);
        if (b) centre = b.x + b.w / 2;
      }
      const x = frame.x + frame.scale * centre;
      if (Math.abs(Math.abs(frame.scale) - 1) < 1e-6) return x;
      if (fallback === null) fallback = x;
    }
    if (!selfClose) stack.push(frame);
  }
  return fallback;
}

/**
 * Compile LaTeX lines to SVG. Rejects banned macros and compile errors with MathError.
 * @param {string[]} lines
 * @param {{restricted?:boolean, display?:boolean}} [opts]
 * @returns {Promise<Array<{svg:string, width:number, height:number, eqX:number|null, viewBox:{x,y,w,h}}>>}
 */
export async function texToSvg(lines, opts = {}) {
  const restricted = opts.restricted !== false;
  const display = opts.display !== false;
  const list = Array.isArray(lines) ? lines : [lines];
  const instance = await ready();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const line = list[i];
    if (typeof line !== 'string') throw new MathError(`lines[${i}] must be a string`, i);
    if (restricted) {
      const banned = bannedMacro(line);
      if (banned) throw new MathError(`\\${banned} is not allowed`, i);
    }
    let container;
    try {
      container = instance.tex2svg(line, { display });
    } catch (e) {
      throw new MathError(`line ${i + 1} does not compile: ${e && e.message ? e.message : String(e)}`, i);
    }
    const raw = containerToSvgString(container);
    if (/data-mjx-error|merror/.test(raw)) throw new MathError(`line ${i + 1} does not compile`, i);
    const svg = normalizeSvg(raw);
    const vb = parseViewBox(svg) || { x: 0, y: 0, w: 0, h: 0 };
    const eq = line.includes('=') ? findEqX(svg) : null;
    out.push({
      svg,
      width: vb.w / 1000,
      height: vb.h / 1000,
      eqX: eq === null ? null : (eq - vb.x) / 1000,
      viewBox: vb,
    });
    if (!isNode && instance.startup && instance.startup.document) instance.startup.document.clear();
  }
  return out;
}
