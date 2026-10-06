// shared/schema/layout.js — stage 3 of validation: slots, minimum sizes, region containment,
// occupancy intersection, element overlap (box containment exempt), measured fit, and
// arrow/highlight reference resolution (spec §5, brief 00 C1).
import { CAPS, SLOTTED_TYPES } from '../layout-core/constants.js';
import { parseSlot, slotRect, slotCells, slotSpan, slotContains, slotsIntersect } from '../layout-core/grid.js';
import { intersectCells } from '../layout-core/occupancy.js';
import { measureTextElement, measureList, measureCode, measureTable, measureMath, textWordCap, countWords } from '../layout-core/measure.js';
import { err } from './errors.js';

/**
 * @param {object} scene shape-checked scene
 * @param {import('../layout-core/occupancy.js').Occupancy} occupancy board state since the last wipe
 * @param {Set<string>} skipIds element ids that failed earlier stages
 * @param {Map<string, any>} artifacts from the content stage
 * @returns {{errors: Array}}
 */
export function checkLayout(scene, occupancy, skipIds = new Set(), artifacts = new Map()) {
  const errors = [];
  const E = (id, code, msg) => errors.push(err(id, code, msg));
  const elements = scene.elements.filter((el, i) => el && typeof el === 'object' && !skipIds.has(el.id) && !skipIds.has(`#${i}`));
  const isRegion = scene.board && scene.board.mode === 'region';
  const region = isRegion ? scene.board.slots : null;
  let regionBounds = null;
  if (isRegion) {
    try { regionBounds = parseSlot(region); } catch { regionBounds = null; }
    if (regionBounds) {
      const clash = intersectCells(occupancy, slotCells(regionBounds));
      if (clash.length) E(null, 'REGION_OCCUPIED', `region ${region} intersects occupied cells ${clash.join(', ')}`);
    }
  }

  // ids already on the board may not repeat since the last wipe
  for (const el of elements) {
    if (!isRegion) break; // a wipe clears the board
    if (occupancy.elements.has(el.id)) E(el.id, 'DUP_ID', `element id "${el.id}" is already on the board since the last wipe`);
  }

  // per-element slot checks and fit
  const slotted = [];
  for (const el of elements) {
    if (!SLOTTED_TYPES.includes(el.type)) continue;
    let bounds;
    try { bounds = parseSlot(el.slot); } catch { continue; } // BAD_SLOT already reported by shape
    const span = slotSpan(bounds);
    const rect = slotRect(bounds);
    slotted.push({ el, bounds, span });
    if (isRegion && regionBounds && !slotContains(regionBounds, bounds)) {
      E(el.id, 'OUT_OF_REGION', `slot ${el.slot} is not inside the region ${region}`);
    }
    switch (el.type) {
      case 'text': {
        const cap = textWordCap(bounds);
        const n = countWords(el.text);
        if (n > cap) E(el.id, 'CAP_WORDS', `text has ${n} words; cap for ${el.slot} is ${cap} (10 × ${span.cells} cells, max ${CAPS.textWordsMax})`);
        if (el.style === 'title' && span.cols < CAPS.titleMinColSpan) E(el.id, 'SLOT_TOO_SMALL', `title needs colSpan ≥ ${CAPS.titleMinColSpan}, slot ${el.slot} has ${span.cols}`);
        else if (n <= cap) {
          const m = measureTextElement(el, rect);
          for (const r of m.reasons) E(el.id, r.code, r.message);
        }
        break;
      }
      case 'list': {
        const need = Math.ceil(el.items.length / CAPS.listItemsPerRow);
        if (span.rows < need) E(el.id, 'SLOT_TOO_SMALL', `list of ${el.items.length} items needs rowSpan ≥ ${need}, slot ${el.slot} has ${span.rows}`);
        else {
          const m = measureList(el, rect);
          for (const r of m.reasons) E(el.id, r.code, r.message);
        }
        break;
      }
      case 'code': {
        const m = measureCode(el, rect);
        for (const r of m.reasons) E(el.id, r.code, r.message);
        break;
      }
      case 'table': {
        const cols = el.rows[0].length;
        const rows = el.rows.length;
        const needC = Math.ceil(cols / CAPS.tableColsPerColSpan);
        const needR = Math.ceil(rows / CAPS.tableRowsPerRowSpan);
        if (span.cols < needC) E(el.id, 'SLOT_TOO_SMALL', `table with ${cols} columns needs colSpan ≥ ${needC}, slot ${el.slot} has ${span.cols}`);
        if (span.rows < needR) E(el.id, 'SLOT_TOO_SMALL', `table with ${rows} rows needs rowSpan ≥ ${needR}, slot ${el.slot} has ${span.rows}`);
        if (span.cols >= needC && span.rows >= needR) {
          const m = measureTable(el, rect);
          for (const r of m.reasons) E(el.id, r.code, r.message);
        }
        break;
      }
      case 'math': {
        const art = artifacts.get(el.id);
        if (art && art.math) {
          const m = measureMath(art.math, rect);
          for (const r of m.reasons) E(el.id, r.code, r.message);
        }
        break;
      }
      case 'diagram': {
        if (span.cols < CAPS.diagramMinSpan || span.rows < CAPS.diagramMinSpan) E(el.id, 'SLOT_TOO_SMALL', `diagram needs a slot of at least ${CAPS.diagramMinSpan}×${CAPS.diagramMinSpan} cells, got ${el.slot}`);
        break;
      }
      case 'plot': {
        if (span.cols < CAPS.plotMinSpan || span.rows < CAPS.plotMinSpan) E(el.id, 'SLOT_TOO_SMALL', `plot needs a slot of at least ${CAPS.plotMinSpan}×${CAPS.plotMinSpan} cells, got ${el.slot}`);
        break;
      }
      default: break; // box, sketch, svg: any slot
    }
  }

  // overlap within the scene (box containment exempt)
  for (let i = 0; i < slotted.length; i++) {
    for (let j = i + 1; j < slotted.length; j++) {
      const a = slotted[i], b = slotted[j];
      if (!slotsIntersect(a.bounds, b.bounds)) continue;
      const aBoxContainsB = a.el.type === 'box' && slotContains(a.bounds, b.bounds);
      const bBoxContainsA = b.el.type === 'box' && slotContains(b.bounds, a.bounds);
      if (aBoxContainsB || bBoxContainsA) continue;
      E(b.el.id, 'OVERLAP', `slot ${b.el.slot} overlaps "${a.el.id}" (${a.el.slot})`);
    }
  }

  // references: arrows and highlights resolve against the board (occupancy ∪ earlier slotted elements of this scene)
  const onBoard = new Map();
  if (isRegion) for (const [id, rec] of occupancy.elements) if (rec.slot) onBoard.set(id, rec);
  for (const el of elements) {
    if (SLOTTED_TYPES.includes(el.type)) {
      if (typeof el.slot === 'string') onBoard.set(el.id, { type: el.type, slot: el.slot, lineCount: el.type === 'code' && Array.isArray(el.lines) ? el.lines.length : undefined });
      continue;
    }
    if (el.type === 'arrow') {
      if (el.from === el.to) { E(el.id, 'SELF_REF', `arrow "${el.id}" points from "${el.from}" to itself`); continue; }
      for (const k of ['from', 'to']) {
        if (!onBoard.has(el[k])) E(el.id, 'BAD_REF', `arrow.${k} "${el[k]}" is not a slotted element on the board`);
      }
    } else if (el.type === 'highlight') {
      const target = onBoard.get(el.target);
      if (!target) { E(el.id, 'BAD_REF', `highlight.target "${el.target}" is not a slotted element on the board`); continue; }
      if (el.line !== undefined) {
        if (target.type !== 'code') E(el.id, 'BAD_LINE', `highlight.line is only allowed when the target is a code element ("${el.target}" is ${target.type})`);
        else if (!(Number.isInteger(el.line) && el.line >= 1 && el.line <= (target.lineCount || 0))) E(el.id, 'BAD_LINE', `highlight.line ${el.line} is outside 1..${target.lineCount || 0} of "${el.target}"`);
      }
    }
  }

  return { errors };
}
