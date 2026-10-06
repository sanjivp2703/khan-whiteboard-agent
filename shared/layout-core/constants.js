// shared/layout-core/constants.js
// THE one constants file (spec §4.4 last paragraph). Every numeric cap, the grid,
// fonts, line heights, pen speed and slot padding live here. The validator (server)
// and the renderer (player) both import this module, so "validator says fits"
// implies "renderer fits". Names are frozen; values may be tuned (record in README).
// Environment-agnostic: no Node or DOM APIs.

// ---- Grid (spec §4.4; brief 00 C1) ----
export const CANVAS_W = 1600;
export const CANVAS_H = 900;
export const MARGIN = 50;
export const COLS = 6;
export const ROWS = 4;
export const CELL_W = 250;
export const CELL_H = 200;
export const COL_LETTERS = 'ABCDEF';
/** Content inset applied uniformly by measurement and drawables (px). */
export const SLOT_PAD = 12;

// ---- Typography (fixed styles; no other sizes exist) ----
export const FONT_SIZES = Object.freeze({ title: 44, body: 28, note: 22, code: 20 });
export const LINE_HEIGHTS = Object.freeze({ title: 54, body: 36, note: 28, code: 24 });
/** `code` is drawn with the handwriting font at a fixed per-character advance (px). */
export const CODE_CHAR_ADVANCE = 10;
export const TEXT_STYLES = Object.freeze(['title', 'body', 'note']);
export const DEFAULT_TEXT_STYLE = 'body';

// ---- Pen / strokes ----
/** Pen speed used by strokes.naturalMs: total path length / PEN_PX_PER_S. */
export const PEN_PX_PER_S = 1500;
export const ROUGH_OPTIONS = Object.freeze({ roughness: 1.2, bowing: 1, strokeWidth: 2.5, fillStyle: 'hachure', hachureGap: 8 });

// ---- Element vocabulary ----
export const ELEMENT_TYPES = Object.freeze([
  'text', 'list', 'math', 'code', 'table', 'box', 'arrow', 'highlight', 'sketch', 'diagram', 'plot', 'svg',
]);
/** Types that occupy a slot (everything except arrow and highlight). */
export const SLOTTED_TYPES = Object.freeze(ELEMENT_TYPES.filter((t) => t !== 'arrow' && t !== 'highlight'));
export const HIGHLIGHT_STYLES = Object.freeze(['circle', 'underline', 'strike', 'pointer']);
export const DEFAULT_HIGHLIGHT_STYLE = 'circle';
/** Sketch library enum (extendable without a contract change). */
export const SKETCH_SHAPES = Object.freeze([
  'circle', 'cloud', 'database', 'server', 'document', 'stack', 'person', 'numberline', 'axes', 'grid',
]);
export const BOARD_MODES = Object.freeze(['wipe', 'region']);

// ---- Caps (spec §4.4 table, §4.3) ----
export const CAPS = Object.freeze({
  elementsMin: 1,
  elementsMax: 8,
  narrationMinWords: 15,
  narrationMaxWords: 90,
  outlineScenesMin: 3,
  outlineScenesMax: 12,
  idMaxLen: 24,

  textWordsPerCell: 10,
  textWordsMax: 40,
  titleWordsMax: 8,
  titleMinColSpan: 2,

  listItemsMin: 2,
  listItemsMax: 6,
  listItemWordsMax: 8,
  listItemsPerRow: 3, // rowSpan >= ceil(items / listItemsPerRow)

  mathLinesMin: 1,
  mathLinesMax: 5,
  mathLineChars: 60,

  codeLinesPerRow: 7,
  codeLinesMax: 14,
  codeCharsPerCol: 22,

  tableColsMax: 6,
  tableRowsMax: 6,
  tableCellWords: 3,
  tableCellChars: 12,
  tableColsPerColSpan: 3, // colSpan >= ceil(cols / 3)
  tableRowsPerRowSpan: 4, // rowSpan >= ceil(rows / 4)

  boxLabelWords: 6,
  arrowLabelWords: 4,
  sketchLabelWords: 4,

  diagramNodesMax: 8,
  diagramEdgesMax: 12,
  diagramNodeLabelWords: 4,
  diagramEdgeLabelWords: 3,
  diagramMinSpan: 2, // slot >= 2x2 cells

  plotSeriesMax: 3,
  plotPointsMax: 50,
  plotSamples: 50,
  plotMinFinitePoints: 2,
  plotMinSpan: 2, // slot >= 2x2 cells

  svgMaxBytes: 4096,
  svgShapesMax: 40,
  svgTextWords: 6,
});

// ---- Timing (spec §4.4 common fields, brief 00 C1) ----
export const TIMING = Object.freeze({
  atMax: 0.9,
  defaultSpan: 0.85, // omitted `at` values are spaced evenly across [0, 0.85]
  lastWindowEnd: 0.95,
});

// ---- Narration / audio ----
export const NARRATION = Object.freeze({
  wpm: 150,
  minAudioMs: 1500,
});

// ---- Measurement details ----
export const LIST_LAYOUT = Object.freeze({ bulletIndent: 34, itemGap: 6, style: 'body' });
export const TABLE_LAYOUT = Object.freeze({ cellPad: 6, style: 'note', maxCellLines: 2 });
export const MATH_LAYOUT = Object.freeze({ fontPx: 28, lineGap: 10, exPx: 8 });
export const BOX_LAYOUT = Object.freeze({ labelStyle: 'note', labelPad: 6 });

// ---- Identifiers (spec §4.1, §4.4) ----
export const REGEX = Object.freeze({
  lessonId: /^[a-z0-9-]{8,64}$/,
  lessonSceneId: /^s\d{3}$/,
  answerSceneId: /^q\d{3}-a\d{2}$/,
  sceneId: /^(?:s\d{3}|q\d{3}-a\d{2})$/,
  questionId: /^q\d{3}$/,
  elementId: /^[a-z][a-z0-9_]{0,23}$/,
  mermaidNodeId: /^[A-Za-z][A-Za-z0-9_]*$/,
  slot: /^([A-F])([1-4])(?::([A-F])([1-4]))?$/,
});

export const SCHEMA_SCENE = 'khan-scene/1';
export const SCHEMA_OUTLINE = 'khan-outline/1';
export const SCHEMA_INBOX = 'khan-inbox/1';
