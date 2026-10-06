// shared/layout-core/occupancy.js — the set of cells and element ids present on the
// board since the last wipe (spec §5, §9). Validator input/output; recomputed by the
// player renderer. Serializable (toJSON/fromJSON) for sidecars and the playlist state.
import { slotCells, ALL_CELLS } from './grid.js';
import { SLOTTED_TYPES } from './constants.js';

/**
 * @typedef {{cells: Set<string>, elements: Map<string, {type:string, slot?:string, lineCount?:number}>}} Occupancy
 */

/** @returns {Occupancy} */
export function createOccupancy() {
  return { cells: new Set(), elements: new Map() };
}

export function cloneOccupancy(occ) {
  return { cells: new Set(occ.cells), elements: new Map([...occ.elements].map(([k, v]) => [k, { ...v }])) };
}

/** Plain-JSON form: { cells: [...sorted], elements: { id: {type, slot?, lineCount?} } } */
export function toJSON(occ) {
  const elements = {};
  for (const [id, rec] of occ.elements) elements[id] = { ...rec };
  return { cells: [...occ.cells].sort(), elements };
}

export function fromJSON(json) {
  const occ = createOccupancy();
  if (!json || typeof json !== 'object') return occ;
  for (const c of json.cells || []) occ.cells.add(String(c));
  for (const [id, rec] of Object.entries(json.elements || {})) occ.elements.set(id, { ...rec });
  return occ;
}

/** Minimal record kept per element (what later scenes need to resolve references). */
export function elementRecord(el) {
  const rec = { type: el.type };
  if (SLOTTED_TYPES.includes(el.type) && typeof el.slot === 'string') rec.slot = el.slot;
  if (el.type === 'code' && Array.isArray(el.lines)) rec.lineCount = el.lines.length;
  return rec;
}

/** Cells of `cells` (array of names) that are already occupied. */
export function intersectCells(occ, cells) {
  return cells.filter((c) => occ.cells.has(c));
}

export function hasId(occ, id) {
  return occ.elements.has(id);
}

/** Cells not occupied, row-major. */
export function freeCells(occ) {
  return ALL_CELLS.filter((c) => !occ.cells.has(c));
}

/**
 * Apply a (validated or effective) scene: wipe → cells+ids of this scene only; region → union.
 * Never mutates its input. Arrows/highlights contribute ids but no cells.
 * @returns {Occupancy}
 */
export function applyScene(occ, scene) {
  const mode = scene && scene.board && scene.board.mode;
  const next = mode === 'wipe' ? createOccupancy() : cloneOccupancy(occ);
  for (const el of (scene && scene.elements) || []) {
    if (!el || typeof el.id !== 'string') continue;
    next.elements.set(el.id, elementRecord(el));
    if (SLOTTED_TYPES.includes(el.type) && typeof el.slot === 'string') {
      let cells;
      try { cells = slotCells(el.slot); } catch { cells = []; }
      for (const c of cells) next.cells.add(c);
    }
  }
  return next;
}

/** Shallow equality of two occupancies (for determinism tests). */
export function occupancyEquals(a, b) {
  if (a.cells.size !== b.cells.size || a.elements.size !== b.elements.size) return false;
  for (const c of a.cells) if (!b.cells.has(c)) return false;
  for (const [id, rec] of a.elements) {
    const other = b.elements.get(id);
    if (!other || JSON.stringify(rec) !== JSON.stringify(other)) return false;
  }
  return true;
}
