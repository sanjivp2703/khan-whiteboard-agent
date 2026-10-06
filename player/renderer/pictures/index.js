// player/renderer/pictures/index.js — SLICE 03 entry point. Registers exactly the four picture
// drawables (sketch, diagram, plot, svg) with the foundation registry at import time and exposes
// test hooks only under window.__khan.rendererPictures (browser only).
import { registry } from '../../registry.js';
import { SKETCH_SHAPES } from '../../../shared/layout-core/constants.js';
import { prepareSketch } from './sketch.js';
import { prepareDiagram } from './diagram.js';
import { preparePlot } from './plot.js';
import { prepareSvg, prepareSvgAst } from './svg.js';
import { LIBRARY_SHAPES } from './sketch-library.js';

export const PICTURE_TYPES = Object.freeze(['sketch', 'diagram', 'plot', 'svg']);

const hook = typeof window !== 'undefined'
  ? (window.__khan = window.__khan || {}, window.__khan.rendererPictures = window.__khan.rendererPictures || {
    version: 1,
    types: [...PICTURE_TYPES],
    sketchShapes: [...SKETCH_SHAPES],
    libraryShapes: [...LIBRARY_SHAPES],
    ignored: [],          // {elementId, tag} for every non-allowlisted svg tag seen (never drawn)
    skipped: [],          // {elementId, tag, reason} degenerate svg shapes (zero-size…)
    prepared: 0,
    lastPrepareMs: 0,
    totalPrepareMs: 0,
    byType: { sketch: 0, diagram: 0, plot: 0, svg: 0 },
    modules: { prepareSketch, prepareDiagram, preparePlot, prepareSvg, prepareSvgAst },
  })
  : null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function instrument(type, prepare) {
  return (element, ctx) => {
    const t0 = now();
    const drawable = prepare(element, ctx);
    if (hook) {
      const ms = now() - t0;
      hook.prepared++;
      hook.byType[type]++;
      hook.lastPrepareMs = ms;
      hook.totalPrepareMs += ms;
      if (type === 'svg' && drawable.picture) {
        for (const tag of drawable.picture.ignored) hook.ignored.push({ elementId: element.id, tag });
        for (const s of drawable.picture.skipped) hook.skipped.push({ elementId: element.id, ...s });
      }
    }
    return drawable;
  };
}

registry.register('sketch', instrument('sketch', prepareSketch));
registry.register('diagram', instrument('diagram', prepareDiagram));
registry.register('plot', instrument('plot', preparePlot));
registry.register('svg', instrument('svg', prepareSvg));

export { prepareSketch, prepareDiagram, preparePlot, prepareSvg, prepareSvgAst };
