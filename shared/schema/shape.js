// shared/schema/shape.js — stage 1 of validation: structural checks on the scene and every
// element (spec §4.3/§4.4/§5, brief 00 C1). Pure and synchronous. Returns
// { errors, fatal, badIds } — `fatal` means later stages cannot run at all; `badIds` are the
// element ids (or synthetic index ids) that failed and must be skipped by content/layout.
import {
  CAPS, ELEMENT_TYPES, SLOTTED_TYPES, TEXT_STYLES, HIGHLIGHT_STYLES, SKETCH_SHAPES, BOARD_MODES, REGEX, SCHEMA_SCENE,
} from '../layout-core/constants.js';
import { COLOR_TOKENS } from '../layout-core/tokens.js';
import { isValidSlot } from '../layout-core/grid.js';
import { checkTiming } from '../layout-core/timing.js';
import { countWords } from '../layout-core/measure.js';
import { checkMathCaps } from '../math.js';
import { err } from './errors.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBool = (v) => typeof v === 'boolean';

/** Markdown tokens that are never allowed in narration (spec §4.3). */
export function narrationMarkdownProblem(text) {
  if (/\*\*|__/.test(text)) return 'bold markers (** or __)';
  if (/`/.test(text)) return 'backticks';
  if (/^\s*(?:[-*+]\s|#{1,6}\s|\d+\.\s|>\s)/m.test(text)) return 'list, heading or quote markers at a line start';
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) return 'markdown links';
  if (/<\/?[a-z][^>]*>/i.test(text)) return 'HTML tags';
  return null;
}

function checkNarration(scene, errors) {
  if (!isStr(scene.narration)) { errors.push(err(null, 'MISSING_FIELD', 'narration must be a string')); return; }
  const n = countWords(scene.narration);
  if (n < CAPS.narrationMinWords || n > CAPS.narrationMaxWords) {
    errors.push(err(null, 'BAD_NARRATION', `narration has ${n} words; allowed ${CAPS.narrationMinWords}–${CAPS.narrationMaxWords}`));
  }
  const md = narrationMarkdownProblem(scene.narration);
  if (md) errors.push(err(null, 'BAD_NARRATION', `narration contains ${md}`));
}

function checkBoard(scene, errors) {
  const b = scene.board;
  if (!isObj(b)) { errors.push(err(null, 'BAD_BOARD', 'board must be an object {mode: "wipe"} or {mode: "region", slots}')); return; }
  if (!BOARD_MODES.includes(b.mode)) { errors.push(err(null, 'BAD_BOARD', `board.mode must be one of ${BOARD_MODES.join(', ')}`)); return; }
  if (b.mode === 'region') {
    if (!isStr(b.slots) || !isValidSlot(b.slots)) errors.push(err(null, 'BAD_BOARD', `board.slots must be a valid slot (e.g. "A3:F4"), got ${JSON.stringify(b.slots)}`));
  } else if (b.slots !== undefined) {
    errors.push(err(null, 'BAD_BOARD', 'board.slots is only allowed in region mode'));
  }
}

function checkIds(scene, lessonId, errors) {
  if (!isStr(scene.lessonId) || !REGEX.lessonId.test(scene.lessonId)) {
    errors.push(err(null, 'BAD_LESSON_ID', `lessonId must match ${REGEX.lessonId}`));
  } else if (lessonId && scene.lessonId !== lessonId) {
    errors.push(err(null, 'BAD_LESSON_ID', `lessonId "${scene.lessonId}" does not match the lesson folder "${lessonId}"`));
  }
  const sid = scene.sceneId;
  const isLesson = isStr(sid) && REGEX.lessonSceneId.test(sid);
  const isAnswer = isStr(sid) && REGEX.answerSceneId.test(sid);
  if (!isLesson && !isAnswer) {
    errors.push(err(null, 'BAD_SCENE_ID', `sceneId must match s\\d{3} or q\\d{3}-a\\d{2}, got ${JSON.stringify(sid)}`));
    return { isLesson: false, isAnswer: false };
  }
  if (isAnswer) {
    const q = sid.slice(0, 4);
    if (!isStr(scene.questionId)) errors.push(err(null, 'MISSING_FIELD', 'answer scenes need questionId'));
    else if (scene.questionId !== q) errors.push(err(null, 'BAD_FIELD', `questionId "${scene.questionId}" must equal the sceneId prefix "${q}"`));
    if (!isStr(scene.insertAfter)) errors.push(err(null, 'MISSING_FIELD', 'answer scenes need insertAfter'));
    else if (!REGEX.sceneId.test(scene.insertAfter)) errors.push(err(null, 'BAD_FIELD', `insertAfter "${scene.insertAfter}" is not a sceneId`));
    if (sid.endsWith('-a01') && isObj(scene.board) && scene.board.mode === 'region') {
      errors.push(err(null, 'BAD_BOARD', 'the first answer scene of a question must be a wipe'));
    }
  } else {
    if (scene.questionId !== undefined) errors.push(err(null, 'BAD_FIELD', 'questionId is only allowed on answer scenes'));
    if (scene.insertAfter !== undefined) errors.push(err(null, 'BAD_FIELD', 'insertAfter is only allowed on answer scenes'));
  }
  return { isLesson, isAnswer };
}

const wordsOver = (s, cap) => countWords(s) > cap;

/** Element-level structural checks. Pushes errors (with the element id or a synthetic id). */
function checkElement(el, idForErrors, errors) {
  const E = (code, msg) => errors.push(err(idForErrors, code, msg));
  const req = (k, pred, what) => {
    if (el[k] === undefined) { E('MISSING_FIELD', `${el.type}: missing ${k}`); return false; }
    if (!pred(el[k])) { E('BAD_FIELD', `${el.type}.${k} ${what}`); return false; }
    return true;
  };
  const opt = (k, pred, what) => {
    if (el[k] === undefined) return true;
    if (!pred(el[k])) { E('BAD_FIELD', `${el.type}.${k} ${what}`); return false; }
    return true;
  };
  if (el.color !== undefined && !COLOR_TOKENS.includes(el.color)) E('BAD_ENUM', `color must be one of ${COLOR_TOKENS.join(', ')}, got ${JSON.stringify(el.color)}`);
  if (SLOTTED_TYPES.includes(el.type)) {
    if (el.slot === undefined) E('MISSING_FIELD', `${el.type}: missing slot`);
    else if (!isStr(el.slot) || !isValidSlot(el.slot)) E('BAD_SLOT', `slot ${JSON.stringify(el.slot)} is not a valid cell or range`);
  } else if (el.slot !== undefined) {
    E('BAD_FIELD', `${el.type} has no slot (it references other elements)`);
  }
  switch (el.type) {
    case 'text': {
      req('text', (v) => isStr(v) && v.trim().length > 0, 'must be a non-empty string');
      if (el.style !== undefined && !TEXT_STYLES.includes(el.style)) E('BAD_ENUM', `text.style must be one of ${TEXT_STYLES.join(', ')}`);
      if (isStr(el.text)) {
        const n = countWords(el.text);
        if (n > CAPS.textWordsMax) E('CAP_WORDS', `text has ${n} words; cap ${CAPS.textWordsMax}`);
        if (el.style === 'title' && n > CAPS.titleWordsMax) E('CAP_WORDS', `title has ${n} words; cap ${CAPS.titleWordsMax}`);
      }
      break;
    }
    case 'list': {
      if (req('items', (v) => Array.isArray(v) && v.every((i) => isStr(i) && i.trim().length > 0), 'must be an array of non-empty strings')) {
        if (el.items.length < CAPS.listItemsMin || el.items.length > CAPS.listItemsMax) E('CAP_COUNT', `list has ${el.items.length} items; allowed ${CAPS.listItemsMin}–${CAPS.listItemsMax}`);
        el.items.forEach((it, i) => { if (wordsOver(it, CAPS.listItemWordsMax)) E('CAP_WORDS', `list item ${i + 1} has ${countWords(it)} words; cap ${CAPS.listItemWordsMax}`); });
      }
      opt('ordered', isBool, 'must be a boolean');
      if (el.itemAt !== undefined && !(Array.isArray(el.itemAt) && el.itemAt.every(isNum))) E('BAD_FIELD', 'list.itemAt must be an array of numbers');
      break;
    }
    case 'math': {
      if (req('lines', Array.isArray, 'must be an array of LaTeX strings')) {
        for (const e of checkMathCaps(el.lines)) E(e.code, e.message);
      }
      break;
    }
    case 'code': {
      if (req('lines', (v) => Array.isArray(v) && v.every(isStr), 'must be an array of strings')) {
        if (el.lines.length === 0) E('CAP_LINES', 'code needs at least one line');
        if (el.lines.length > CAPS.codeLinesMax) E('CAP_LINES', `code has ${el.lines.length} lines; cap ${CAPS.codeLinesMax}`);
        if (el.lines.some((l) => l.includes('\t'))) E('BAD_FIELD', 'code lines may not contain tabs');
        if (el.lines.some((l) => /[\r\n]/.test(l))) E('BAD_FIELD', 'code lines may not contain line breaks');
      }
      opt('lang', isStr, 'must be a string');
      break;
    }
    case 'table': {
      if (req('rows', (v) => Array.isArray(v) && v.length > 0 && v.every((r) => Array.isArray(r) && r.length > 0 && r.every(isStr)), 'must be a non-empty array of non-empty string arrays')) {
        const cols = el.rows[0].length;
        if (el.rows.some((r) => r.length !== cols)) E('BAD_FIELD', 'table rows must all have the same number of cells');
        if (cols > CAPS.tableColsMax) E('CAP_COUNT', `table has ${cols} columns; cap ${CAPS.tableColsMax}`);
        if (el.rows.length > CAPS.tableRowsMax) E('CAP_COUNT', `table has ${el.rows.length} rows; cap ${CAPS.tableRowsMax}`);
        el.rows.forEach((r, ri) => r.forEach((c, ci) => {
          if (wordsOver(c, CAPS.tableCellWords)) E('CAP_WORDS', `table cell r${ri + 1}c${ci + 1} has ${countWords(c)} words; cap ${CAPS.tableCellWords}`);
          if (c.length > CAPS.tableCellChars) E('CAP_CHARS', `table cell r${ri + 1}c${ci + 1} has ${c.length} chars; cap ${CAPS.tableCellChars}`);
        }));
      }
      opt('header', isBool, 'must be a boolean');
      break;
    }
    case 'box': {
      if (opt('label', isStr, 'must be a string') && isStr(el.label) && wordsOver(el.label, CAPS.boxLabelWords)) E('CAP_WORDS', `box label has ${countWords(el.label)} words; cap ${CAPS.boxLabelWords}`);
      break;
    }
    case 'arrow': {
      req('from', (v) => isStr(v) && REGEX.elementId.test(v), 'must be an element id');
      req('to', (v) => isStr(v) && REGEX.elementId.test(v), 'must be an element id');
      if (opt('label', isStr, 'must be a string') && isStr(el.label) && wordsOver(el.label, CAPS.arrowLabelWords)) E('CAP_WORDS', `arrow label has ${countWords(el.label)} words; cap ${CAPS.arrowLabelWords}`);
      break;
    }
    case 'highlight': {
      req('target', (v) => isStr(v) && REGEX.elementId.test(v), 'must be an element id');
      if (el.style !== undefined && !HIGHLIGHT_STYLES.includes(el.style)) E('BAD_ENUM', `highlight.style must be one of ${HIGHLIGHT_STYLES.join(', ')}`);
      if (el.line !== undefined && !(Number.isInteger(el.line) && el.line >= 1)) E('BAD_LINE', 'highlight.line must be a positive integer');
      break;
    }
    case 'sketch': {
      if (el.shape === undefined) E('MISSING_FIELD', 'sketch: missing shape');
      else if (!SKETCH_SHAPES.includes(el.shape)) E('BAD_ENUM', `sketch.shape must be one of ${SKETCH_SHAPES.join(', ')}`);
      if (opt('label', isStr, 'must be a string') && isStr(el.label) && wordsOver(el.label, CAPS.sketchLabelWords)) E('CAP_WORDS', `sketch label has ${countWords(el.label)} words; cap ${CAPS.sketchLabelWords}`);
      break;
    }
    case 'diagram': {
      req('mermaid', (v) => isStr(v) && v.trim().length > 0, 'must be a non-empty string');
      break;
    }
    case 'plot': {
      const hasFn = el.fn !== undefined;
      const hasSeries = el.series !== undefined;
      if (!hasFn && !hasSeries) E('MISSING_FIELD', 'plot needs fn or series');
      if (hasFn && !isStr(el.fn)) E('BAD_FIELD', 'plot.fn must be a string');
      let count = hasFn && isStr(el.fn) ? 1 : 0;
      if (hasSeries) {
        if (!Array.isArray(el.series)) E('BAD_FIELD', 'plot.series must be an array');
        else {
          count += el.series.length;
          el.series.forEach((s, i) => {
            if (isStr(s)) return; // an expression string is allowed as a series
            if (!Array.isArray(s) || !s.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum))) { E('BAD_FIELD', `plot.series[${i}] must be an expression string or an array of [x, y] finite numbers`); return; }
            if (s.length > CAPS.plotPointsMax) E('CAP_COUNT', `plot.series[${i}] has ${s.length} points; cap ${CAPS.plotPointsMax}`);
            if (s.length === 0) E('BAD_FIELD', `plot.series[${i}] is empty`);
          });
        }
      }
      if (count > CAPS.plotSeriesMax) E('CAP_COUNT', `plot has ${count} fns/series; cap ${CAPS.plotSeriesMax}`);
      for (const k of ['xRange', 'yRange']) {
        if (el[k] === undefined) continue;
        if (!Array.isArray(el[k]) || el[k].length !== 2 || !el[k].every(isNum) || !(el[k][0] < el[k][1])) E('BAD_FIELD', `plot.${k} must be [min, max] with finite min < max`);
      }
      opt('label', isStr, 'must be a string');
      break;
    }
    case 'svg': {
      req('svg', (v) => isStr(v) && v.trim().length > 0, 'must be a non-empty string');
      break;
    }
    default: break;
  }
}

/**
 * @param {any} scene parsed JSON
 * @param {{lessonId?: string}} [opts]
 * @returns {{errors: Array, fatal: boolean, badIds: Set<string>, isAnswer: boolean}}
 */
export function checkShape(scene, opts = {}) {
  const errors = [];
  if (!isObj(scene)) return { errors: [err(null, 'BAD_SCHEMA', 'scene must be a JSON object')], fatal: true, badIds: new Set(), isAnswer: false };
  if (scene.schema !== SCHEMA_SCENE) {
    errors.push(err(null, 'BAD_SCHEMA', `schema must be "${SCHEMA_SCENE}", got ${JSON.stringify(scene.schema)}`));
    return { errors, fatal: true, badIds: new Set(), isAnswer: false };
  }
  const { isAnswer } = checkIds(scene, opts.lessonId, errors);
  if (scene.title !== undefined && !isStr(scene.title)) errors.push(err(null, 'BAD_FIELD', 'title must be a string'));
  checkNarration(scene, errors);
  checkBoard(scene, errors);
  if (scene.final !== undefined && !isBool(scene.final)) errors.push(err(null, 'BAD_FIELD', 'final must be a boolean'));

  if (!Array.isArray(scene.elements)) {
    errors.push(err(null, 'BAD_FIELD', 'elements must be an array'));
    return { errors, fatal: true, badIds: new Set(), isAnswer };
  }
  if (scene.elements.length < CAPS.elementsMin || scene.elements.length > CAPS.elementsMax) {
    errors.push(err(null, 'CAP_COUNT', `scene has ${scene.elements.length} elements; allowed ${CAPS.elementsMin}–${CAPS.elementsMax}`));
  }

  const badIds = new Set();
  const seen = new Set();
  const before = () => errors.length;
  scene.elements.forEach((el, i) => {
    const start = before();
    const synthetic = `#${i}`;
    if (!isObj(el)) { errors.push(err(synthetic, 'BAD_FIELD', `elements[${i}] must be an object`)); badIds.add(synthetic); return; }
    let idForErrors = synthetic;
    if (el.id === undefined) errors.push(err(synthetic, 'MISSING_FIELD', `elements[${i}] is missing id`));
    else if (!isStr(el.id) || !REGEX.elementId.test(el.id)) errors.push(err(synthetic, 'BAD_ID', `elements[${i}] id ${JSON.stringify(el.id)} must match ${REGEX.elementId}`));
    else {
      idForErrors = el.id;
      if (seen.has(el.id)) errors.push(err(el.id, 'DUP_ID', `element id "${el.id}" appears more than once in the scene`));
      seen.add(el.id);
    }
    if (el.type === undefined) errors.push(err(idForErrors, 'MISSING_FIELD', `elements[${i}] is missing type`));
    else if (!ELEMENT_TYPES.includes(el.type)) errors.push(err(idForErrors, 'BAD_ENUM', `unknown element type ${JSON.stringify(el.type)}`));
    else checkElement(el, idForErrors, errors);
    if (errors.length > start) badIds.add(idForErrors);
  });

  // timing (needs the element list; skips elements already bad)
  for (const e of checkTiming(scene.elements.filter((el) => isObj(el)))) {
    errors.push(err(e.elementId ?? null, e.code, e.message));
    if (e.elementId) badIds.add(e.elementId);
  }

  return { errors, fatal: false, badIds, isAnswer };
}
