// shared/handwriting.js — the vendored handwriting font as metrics and glyph outlines.
// Environment-agnostic: runs unchanged in Node and the browser (same numbers in both;
// the only difference is how the font bytes are obtained).
//
//   await loadFont(source)       Node: file path string | Buffer | Uint8Array; browser: ArrayBuffer
//   measure(text, style)          → {width, ascent, descent, lineHeight}
//   wrap(text, style, maxWidth)   → lines[] (never splits a word unless it is wider than the line)
//   glyphPaths(text, style, x, y) → [{char, d, advance, x}] ordered SVG path strings per glyph
//
// `code` style uses a fixed per-character advance (CODE_CHAR_ADVANCE) so its measurement is trivial.
import * as opentype from '../vendor/opentype/opentype.mjs';
import { FONT_SIZES, LINE_HEIGHTS, CODE_CHAR_ADVANCE } from './layout-core/constants.js';
import { tokens } from './layout-core/tokens.js';

let font = null;
let fontSource = null;

const ROUND = 1000; // widths are rounded to 1/1000 px so Node and browser numbers compare exactly

function toArrayBuffer(source) {
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  throw new TypeError('loadFont: unsupported source type');
}

/** Default font location: Node → absolute path next to this module; browser → the served URL. */
export function defaultFontSource() {
  if (typeof window === 'undefined' && typeof process !== 'undefined') {
    return new URL('../vendor/fonts/PatrickHand-Regular.ttf', import.meta.url).pathname;
  }
  return tokens.fontHandFile;
}

/**
 * Load the handwriting font. A string is a file path (Node only); otherwise bytes.
 * Passing nothing loads the default vendored font (Node: from disk; browser: via fetch).
 */
export async function loadFont(source = defaultFontSource()) {
  let ab;
  if (typeof source === 'string') {
    const isNode = typeof process !== 'undefined' && typeof window === 'undefined';
    if (isNode) {
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(source);
      ab = toArrayBuffer(buf);
    } else {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`loadFont: fetch ${source} failed with ${res.status}`);
      ab = await res.arrayBuffer();
    }
  } else {
    ab = toArrayBuffer(source);
  }
  font = opentype.parse(ab);
  fontSource = typeof source === 'string' ? source : '[bytes]';
  return font;
}

/** Synchronous variant for callers that already hold the bytes (Node tests, harness). */
export function loadFontFromBytes(bytes) {
  font = opentype.parse(toArrayBuffer(bytes));
  fontSource = '[bytes]';
  return font;
}

export function isFontLoaded() { return font !== null; }
export function getFont() { return font; }
export function getFontSource() { return fontSource; }

function requireFont() {
  if (!font) throw new Error('handwriting: font not loaded — call loadFont() first');
  return font;
}

export function fontSize(style) {
  const s = FONT_SIZES[style];
  if (s === undefined) throw new Error(`handwriting: unknown style "${style}"`);
  return s;
}

export function lineHeight(style) {
  const s = LINE_HEIGHTS[style];
  if (s === undefined) throw new Error(`handwriting: unknown style "${style}"`);
  return s;
}

function round(v) { return Math.round(v * ROUND) / ROUND; }

/** Advance width of `text` in px for a style (kerning on), rounded to 1/1000 px. */
export function textWidth(text, style) {
  const chars = [...String(text)];
  if (style === 'code') return round(chars.length * CODE_CHAR_ADVANCE);
  const f = requireFont();
  const scale = fontSize(style) / f.unitsPerEm;
  return round(advanceUnits(f, chars) * scale);
}

/** Sum of glyph advances + pair kerning in font units, one glyph per character (no ligatures). */
function advanceUnits(f, chars) {
  let total = 0;
  let prev = null;
  for (const ch of chars) {
    const g = f.charToGlyph(ch);
    if (prev) total += f.getKerningValue(prev, g) || 0;
    total += g.advanceWidth || 0;
    prev = g;
  }
  return total;
}

/** {width, ascent, descent, lineHeight} for a single line of text. */
export function measure(text, style) {
  const f = requireFont();
  const size = fontSize(style);
  const scale = size / f.unitsPerEm;
  return {
    width: textWidth(String(text), style),
    ascent: round(f.ascender * scale),
    descent: round(Math.abs(f.descender) * scale),
    lineHeight: lineHeight(style),
  };
}

/**
 * Greedy word wrap. Returns {lines, hardSplit}. A word wider than maxWidth is hard-split
 * into character chunks (hardSplit=true so measurement can surface OVERFLOW). Explicit
 * newlines start new lines.
 */
export function wrapDetailed(text, style, maxWidth) {
  const lines = [];
  let hardSplit = false;
  const paragraphs = String(text).split('\n');
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) { lines.push(''); continue; }
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (textWidth(candidate, style) <= maxWidth) { current = candidate; continue; }
      if (current) { lines.push(current); current = ''; }
      if (textWidth(word, style) <= maxWidth) { current = word; continue; }
      // word alone is too wide: hard-split by characters
      hardSplit = true;
      let chunk = '';
      for (const ch of word) {
        if (chunk && textWidth(chunk + ch, style) > maxWidth) { lines.push(chunk); chunk = ''; }
        chunk += ch;
      }
      current = chunk;
    }
    lines.push(current);
  }
  return { lines, hardSplit };
}

export function wrap(text, style, maxWidth) {
  return wrapDetailed(text, style, maxWidth).lines;
}

/**
 * Ordered glyph outlines for a line of text with its baseline at (x, y).
 * @returns {Array<{char:string, d:string, advance:number, x:number}>}
 */
export function glyphPaths(text, style, x, y) {
  const f = requireFont();
  const size = fontSize(style);
  const scale = size / f.unitsPerEm;
  const out = [];
  const chars = [...String(text)];
  if (style === 'code') {
    let cx = x;
    for (const ch of chars) {
      const glyph = f.charToGlyph(ch);
      const natural = (glyph.advanceWidth || 0) * scale;
      const offset = Math.max(0, (CODE_CHAR_ADVANCE - natural) / 2); // centre glyph in its fixed cell
      const d = ch.trim() === '' ? '' : glyph.getPath(cx + offset, y, size).toPathData(2);
      out.push({ char: ch, d, advance: CODE_CHAR_ADVANCE, x: round(cx) });
      cx += CODE_CHAR_ADVANCE;
    }
    return out;
  }
  const glyphs = chars.map((ch) => f.charToGlyph(ch));
  let cx = x;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    let advance = (glyph.advanceWidth || 0) * scale;
    if (i + 1 < glyphs.length) {
      const k = f.getKerningValue(glyph, glyphs[i + 1]);
      advance += (k || 0) * scale;
    }
    const ch = chars[i] ?? '';
    const d = ch.trim() === '' ? '' : glyph.getPath(cx, y, size).toPathData(2);
    out.push({ char: ch, d, advance: round(advance), x: round(cx) });
    cx += advance;
  }
  return out;
}
