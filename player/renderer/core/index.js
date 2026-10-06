// player/renderer/core/index.js — SLICE 02: registers the eight "writing" drawables
// (text, list, code, table, math, box, arrow, highlight) with the foundation registry and
// exposes test hooks under window.__khan.rendererCore (browser only). Pure and DOM-free
// apart from Drawable.paint; importable from Node tests.
import { registry } from '../../registry.js';
import { prepareText } from './text.js';
import { prepareList } from './list.js';
import { prepareCode } from './code.js';
import { prepareTable } from './table.js';
import { prepareMath } from './math.js';
import { prepareBox } from './box.js';
import { prepareArrow } from './arrow.js';
import { prepareHighlight } from './highlight.js';
import * as mathCompile from './math-compile.js';

export const CORE_TYPES = Object.freeze(['text', 'list', 'code', 'table', 'math', 'box', 'arrow', 'highlight']);

export const prepares = Object.freeze({
  text: prepareText,
  list: prepareList,
  code: prepareCode,
  table: prepareTable,
  math: prepareMath,
  box: prepareBox,
  arrow: prepareArrow,
  highlight: prepareHighlight,
});

/** Register all eight types (idempotent). */
export function registerCore(reg = registry) {
  for (const type of CORE_TYPES) reg.register(type, prepares[type]);
  return CORE_TYPES.slice();
}

/** Compile every math element of the given scene(s) so `prepare` never returns a pending math drawable. */
export const warm = mathCompile.warm;
/** Resolves once MathJax is initialised (math prepares are synchronous afterwards). */
export const ready = mathCompile.ready;

registerCore(registry);

if (typeof window !== 'undefined') {
  window.__khan = window.__khan || {};
  const readyPromise = mathCompile.ready().catch((e) => { console.error('renderer-core: MathJax failed to initialise', e); return null; });
  window.__khan.rendererCore = {
    version: 1,
    types: CORE_TYPES.slice(),
    prepares,
    warm,
    ready: readyPromise,
    mathReady: () => mathCompile.isReady(),
    mathCacheSize: () => mathCompile.cacheSize(),
  };
}

export { prepareText, prepareList, prepareCode, prepareTable, prepareMath, prepareBox, prepareArrow, prepareHighlight };
