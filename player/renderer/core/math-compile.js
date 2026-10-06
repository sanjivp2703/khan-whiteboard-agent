// player/renderer/core/math-compile.js — compiled LaTeX for `math` drawables. shared/math.js
// `texToSvg` is async (MathJax initialises lazily) while `prepare` is synchronous, so results
// are cached per line set. Once MathJax is initialised (`ready()`), lines are compiled
// synchronously on demand with the very same configuration and canonicalisation as texToSvg
// (a unit test asserts byte equality), so a prepared scene never waits on a Promise.
import { ready as mathReady, texToSvg, normalizeSvg, findEqX, bannedMacro, MathError } from '../../../shared/math.js';

const cache = new Map();   // key → compiled[] ({svg, width, height, eqX, viewBox}) or Error
const inflight = new Map();
let instance = null;
let readyPromise = null;
const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions && !!process.versions.node;

export function cacheKey(lines) {
  return JSON.stringify(Array.isArray(lines) ? lines : [lines]);
}

/** Initialise MathJax (shared instance); afterwards compileSync works. */
export function ready() {
  if (!readyPromise) readyPromise = mathReady().then((inst) => { instance = inst; return inst; });
  return readyPromise;
}

export function isReady() { return instance !== null; }

export function compiledFor(lines) {
  const v = cache.get(cacheKey(lines));
  return v && !(v instanceof Error) ? v : null;
}

export function compileErrorFor(lines) {
  const v = cache.get(cacheKey(lines));
  return v instanceof Error ? v : null;
}

/** Compile and cache through shared texToSvg. Returns the compiled lines (throws MathError on bad input). */
export async function warmLines(lines) {
  const key = cacheKey(lines);
  const hit = cache.get(key);
  if (hit) { if (hit instanceof Error) throw hit; return hit; }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      await ready();
      const out = await texToSvg(lines, { restricted: true });
      cache.set(key, out);
      return out;
    } catch (e) {
      cache.set(key, e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Warm every math element of a scene (or array of scenes / elements). Never rejects; returns the number compiled. */
export async function warm(input) {
  const elements = [];
  const visit = (x) => {
    if (!x) return;
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (Array.isArray(x.elements)) { x.elements.forEach(visit); return; }
    if (x.type === 'math' && Array.isArray(x.lines)) elements.push(x);
  };
  visit(input);
  let n = 0;
  await ready().catch(() => null);
  for (const el of elements) {
    try { await warmLines(el.lines); n++; } catch { /* recorded in cache as an Error */ }
  }
  return n;
}

function parseViewBox(svg) {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (!m) return { x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = m[1].trim().split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

function containerToSvgString(container) {
  if (isNode) {
    const adaptor = instance.startup.adaptor;
    return adaptor.outerHTML(adaptor.firstChild(container));
  }
  return container.querySelector('svg').outerHTML;
}

/**
 * Synchronous compile (requires `ready()` to have resolved). Mirrors texToSvg exactly:
 * banned macros → MathError; compile error → MathError. Returns null when MathJax is not ready.
 */
export function compileSync(lines) {
  const key = cacheKey(lines);
  const hit = cache.get(key);
  if (hit) { if (hit instanceof Error) throw hit; return hit; }
  if (!instance) return null;
  const list = Array.isArray(lines) ? lines : [lines];
  const out = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const line = list[i];
      if (typeof line !== 'string') throw new MathError(`lines[${i}] must be a string`, i);
      const banned = bannedMacro(line);
      if (banned) throw new MathError(`\\${banned} is not allowed`, i);
      let container;
      try {
        container = instance.tex2svg(line, { display: true });
      } catch (e) {
        throw new MathError(`line ${i + 1} does not compile: ${e && e.message ? e.message : String(e)}`, i);
      }
      const raw = containerToSvgString(container);
      if (/data-mjx-error|merror/.test(raw)) throw new MathError(`line ${i + 1} does not compile`, i);
      const svg = normalizeSvg(raw);
      const vb = parseViewBox(svg);
      const eq = line.includes('=') ? findEqX(svg) : null;
      out.push({ svg, width: vb.w / 1000, height: vb.h / 1000, eqX: eq === null ? null : (eq - vb.x) / 1000, viewBox: vb });
      if (!isNode && instance.startup && instance.startup.document) instance.startup.document.clear();
    }
  } catch (e) {
    cache.set(key, e instanceof Error ? e : new Error(String(e)));
    throw e;
  }
  cache.set(key, out);
  return out;
}

export function cacheSize() { return cache.size; }
export function clearCache() { cache.clear(); }
