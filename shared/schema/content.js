// shared/schema/content.js — stage 2 of validation: content that must compile/parse
// (math via MathJax, mermaid subset, plot expressions, svg subset). Spec §5.
// Returns errors plus per-element artifacts the layout stage and drawables can reuse.
import { CAPS } from '../layout-core/constants.js';
import { texToSvg, MathError } from '../math.js';
import { parseStrict as parseMermaid, MermaidError } from '../mermaid-subset.js';
import { parse as parseExpr, sample, ExprError } from '../expr.js';
import { parse as parseSvg, SvgError } from '../svg-subset.js';
import { err } from './errors.js';

const DEFAULT_X_RANGE = [-10, 10];

/**
 * @param {object} scene (shape-checked)
 * @param {Set<string>} skipIds element ids that failed shape checks
 * @returns {Promise<{errors: Array, artifacts: Map<string, any>}>}
 */
export async function checkContent(scene, skipIds = new Set()) {
  const errors = [];
  const artifacts = new Map();
  for (let i = 0; i < scene.elements.length; i++) {
    const el = scene.elements[i];
    if (!el || typeof el !== 'object' || skipIds.has(el.id) || skipIds.has(`#${i}`)) continue;
    switch (el.type) {
      case 'math': {
        try {
          artifacts.set(el.id, { math: await texToSvg(el.lines, { restricted: true }) });
        } catch (e) {
          if (e instanceof MathError) errors.push(err(el.id, 'BAD_MATH', e.message));
          else throw e;
        }
        break;
      }
      case 'diagram': {
        try {
          artifacts.set(el.id, { diagram: parseMermaid(el.mermaid, CAPS) });
        } catch (e) {
          if (e instanceof MermaidError) errors.push(err(el.id, 'BAD_MERMAID', e.message));
          else throw e;
        }
        break;
      }
      case 'plot': {
        const xRange = Array.isArray(el.xRange) ? el.xRange : DEFAULT_X_RANGE;
        const exprs = [];
        if (typeof el.fn === 'string') exprs.push(el.fn);
        if (Array.isArray(el.series)) for (const s of el.series) if (typeof s === 'string') exprs.push(s);
        const compiled = [];
        for (const src of exprs) {
          try {
            const ast = parseExpr(src);
            const pts = sample(ast, xRange, CAPS.plotSamples);
            const finite = pts.filter((p) => Number.isFinite(p.y)).length;
            if (finite < CAPS.plotMinFinitePoints) {
              errors.push(err(el.id, 'BAD_EXPR', `"${src}" has only ${finite} finite values over [${xRange[0]}, ${xRange[1]}]`));
            } else compiled.push({ src, ast, points: pts });
          } catch (e) {
            if (e instanceof ExprError) errors.push(err(el.id, 'BAD_EXPR', `"${src}": ${e.message}`));
            else throw e;
          }
        }
        artifacts.set(el.id, { plot: { xRange, fns: compiled } });
        break;
      }
      case 'svg': {
        try {
          artifacts.set(el.id, { svg: parseSvg(el.svg, { maxBytes: CAPS.svgMaxBytes, maxShapes: CAPS.svgShapesMax, maxTextWords: CAPS.svgTextWords }) });
        } catch (e) {
          if (e instanceof SvgError) errors.push(err(el.id, 'BAD_SVG', e.message));
          else throw e;
        }
        break;
      }
      default: break;
    }
  }
  return { errors, artifacts };
}
