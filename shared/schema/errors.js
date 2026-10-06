// shared/schema/errors.js — stable validator error codes (spec §5, brief 00 C1).
export const ERROR_CODES = Object.freeze([
  'BAD_JSON', 'BAD_SCHEMA', 'MISSING_FIELD', 'BAD_FIELD', 'BAD_LESSON_ID', 'BAD_SCENE_ID', 'BAD_ID', 'DUP_ID', 'BAD_ENUM',
  'BAD_BOARD', 'BAD_NARRATION', 'CAP_COUNT', 'CAP_WORDS', 'CAP_CHARS', 'CAP_LINES', 'BAD_AT', 'BAD_SLOT', 'SLOT_TOO_SMALL',
  'OVERFLOW', 'OVERLAP', 'OUT_OF_REGION', 'REGION_OCCUPIED', 'BAD_REF', 'SELF_REF', 'BAD_LINE', 'BAD_MATH', 'BAD_MERMAID',
  'BAD_EXPR', 'BAD_SVG', 'TTS_FAILED',
]);

/** Codes that always describe the scene as a whole (elementId is null). */
export const SCENE_LEVEL_CODES = Object.freeze(['BAD_JSON', 'BAD_SCHEMA', 'BAD_LESSON_ID', 'BAD_SCENE_ID', 'BAD_BOARD', 'BAD_NARRATION', 'REGION_OCCUPIED']);

/** Build one error entry: { elementId: string|null, code, message }. */
export function err(elementId, code, message) {
  if (!ERROR_CODES.includes(code)) throw new Error(`unknown error code ${code}`);
  return { elementId: elementId === undefined ? null : elementId, code, message: String(message) };
}

/** Unique codes present in an error list. */
export function codesOf(errors) {
  return [...new Set(errors.map((e) => e.code))].sort();
}

/** Element ids that have at least one element-level error. */
export function badElementIds(errors) {
  return [...new Set(errors.filter((e) => e.elementId !== null && e.elementId !== undefined).map((e) => e.elementId))];
}
