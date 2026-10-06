// player/registry.js — element drawable registry, fallback drawable, and board-rect helper
// (brief 00 C4). Pure and DOM-free except Drawable.paint, so slices can unit-test prepare()
// in Node. Slices 02/03 call registry.register(type, prepare) at import time.
import { slotRect, rectUnion, rectCenter, BOARD_RECT } from '../shared/layout-core/grid.js';
import { SLOTTED_TYPES } from '../shared/layout-core/constants.js';
import { tokens as defaultTokens, colorOf } from '../shared/layout-core/tokens.js';
import * as constants from '../shared/layout-core/constants.js';
import { seedFor, naturalMs, pointAt } from '../shared/strokes.js';

/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect
 *
 * @typedef {object} DrawCtx
 * @property {(slot:string) => Rect} slotRect
 * @property {Map<string, Rect>} boardRects   every slotted element on the board since the last wipe, incl. earlier elements of this scene
 * @property {Map<string, object>} elementsById
 * @property {object} tokens
 * @property {object} constants
 * @property {object|null} font               loaded handwriting font (shared/handwriting.js)
 * @property {(elementId:string) => number} seed
 *
 * @typedef {object} Drawable
 * @property {string} id
 * @property {string} type
 * @property {Rect} bounds             in board px; for slotted elements MUST lie inside slotRect(slot)
 * @property {number} parts            ≥ 1 (list items, math lines, table cells, diagram nodes+edges, plot series…)
 * @property {number[]} partStarts     normalized [0,1) start of each part within the element's draw window
 * @property {number} naturalMs        minimum believable draw time = strokes.naturalMs(paths)
 * @property {string[]} paths          SVG path strings in draw order (retrace/idle); may be empty for pointer highlights
 * @property {(ctx2d:CanvasRenderingContext2D, u:number) => void} paint   draw the state at progress u ∈ [0,1]; u=1 is final and deterministic
 * @property {(u:number) => {x:number, y:number}|null} tipAt            pen tip position at progress u
 *
 * @typedef {(element:object, ctx:DrawCtx) => Drawable} Prepare
 */

const prepares = new Map();

export const registry = {
  /** @param {string} type @param {Prepare} prepare */
  register(type, prepare) {
    if (typeof type !== 'string' || typeof prepare !== 'function') throw new TypeError('registry.register(type, prepare)');
    prepares.set(type, prepare);
  },
  /** @returns {Prepare} the registered prepare or the fallback */
  get(type) {
    return prepares.get(type) || registry.fallback;
  },
  has(type) { return prepares.has(type); },
  types() { return [...prepares.keys()]; },
  unregister(type) { prepares.delete(type); },
  /** @type {Prepare} dashed slot rect + id/type label in plain canvas text */
  fallback: prepareFallback,
};

const rectPath = (r) => `M${r.x} ${r.y} H${r.x + r.w} V${r.y + r.h} H${r.x} Z`;
const linePath = (a, b) => `M${a.x} ${a.y} L${b.x} ${b.y}`;

/** Fallback drawable: dashed rectangle (or dashed line for arrows) plus "id · type" label. */
export function prepareFallback(element, ctx) {
  const type = element.type;
  let bounds;
  let paths;
  let line = null;
  if (SLOTTED_TYPES.includes(type) && typeof element.slot === 'string') {
    bounds = ctx.slotRect(element.slot);
    paths = [rectPath(bounds)];
  } else if (type === 'arrow') {
    const from = ctx.boardRects.get(element.from);
    const to = ctx.boardRects.get(element.to);
    if (from && to) {
      line = [rectCenter(from), rectCenter(to)];
      bounds = rectUnion(from, to);
      paths = [linePath(line[0], line[1])];
    } else {
      bounds = { ...BOARD_RECT };
      paths = [];
    }
  } else if (type === 'highlight') {
    const target = ctx.boardRects.get(element.target);
    bounds = target ? { ...target } : { ...BOARD_RECT };
    paths = element.style === 'pointer' ? [] : [rectPath(bounds)];
  } else {
    bounds = { ...BOARD_RECT };
    paths = [];
  }
  const color = colorOf(element.color);
  const label = `${element.id} · ${type}`;
  const tokens = ctx.tokens || defaultTokens;
  return {
    id: element.id,
    type,
    bounds,
    parts: 1,
    partStarts: [0],
    naturalMs: Math.max(300, naturalMs(paths)),
    paths,
    paint(ctx2d, u) {
      const p = Math.max(0, Math.min(1, u));
      ctx2d.save();
      ctx2d.globalAlpha = 0.35 + 0.65 * p;
      ctx2d.strokeStyle = color;
      ctx2d.fillStyle = color;
      ctx2d.lineWidth = 2;
      ctx2d.setLineDash([10, 8]);
      if (line) {
        const ex = line[0].x + (line[1].x - line[0].x) * p;
        const ey = line[0].y + (line[1].y - line[0].y) * p;
        ctx2d.beginPath(); ctx2d.moveTo(line[0].x, line[0].y); ctx2d.lineTo(ex, ey); ctx2d.stroke();
      } else if (paths.length) {
        const inset = 4;
        ctx2d.strokeRect(bounds.x + inset, bounds.y + inset, Math.max(0, bounds.w - 2 * inset) * (type === 'highlight' ? 1 : 1), Math.max(0, bounds.h - 2 * inset));
      }
      ctx2d.setLineDash([]);
      ctx2d.font = `16px ${tokens.fontHand || 'sans-serif'}, sans-serif`;
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(label, bounds.x + 10, bounds.y + 8);
      ctx2d.restore();
    },
    tipAt(u) {
      if (!paths.length) return null;
      return pointAt(paths[0], Math.max(0, Math.min(1, u)));
    },
  };
}

/**
 * Board rects for every slotted element on the board after scenes[0..upToIndex] (inclusive),
 * honouring wipes. Arrows/highlights contribute no rect.
 * @param {object[]} scenes effective scenes in playback order
 * @param {number} [upToIndex] defaults to the last scene
 * @returns {Map<string, Rect>}
 */
export function boardRectsFor(scenes, upToIndex = scenes.length - 1) {
  let rects = new Map();
  for (let i = 0; i <= upToIndex && i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene) continue;
    if (scene.board && scene.board.mode === 'wipe') rects = new Map();
    for (const el of scene.elements || []) {
      if (SLOTTED_TYPES.includes(el.type) && typeof el.slot === 'string') {
        try { rects.set(el.id, slotRect(el.slot)); } catch { /* validated upstream */ }
      }
    }
  }
  return rects;
}

/** Build a DrawCtx for scene `index` of `scenes` (board rects include this scene's own slotted elements). */
export function makeDrawCtx(scenes, index, { font = null, tokens = defaultTokens } = {}) {
  const boardRects = boardRectsFor(scenes, index);
  const elementsById = new Map();
  let start = 0;
  for (let i = index; i >= 0; i--) if (scenes[i] && scenes[i].board && scenes[i].board.mode === 'wipe') { start = i; break; }
  for (let i = start; i <= index; i++) for (const el of (scenes[i] && scenes[i].elements) || []) elementsById.set(el.id, el);
  return { slotRect, boardRects, elementsById, tokens, constants, font, seed: seedFor };
}
