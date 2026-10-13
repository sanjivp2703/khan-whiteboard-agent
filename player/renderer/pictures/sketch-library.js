// player/renderer/pictures/sketch-library.js — the authored sketch library (spec §4.4 `sketch`).
// THE single place to add a shape: add an entry here and its name to SKETCH_SHAPES in
// shared/layout-core/constants.js (the enum); nothing else changes.
//
// Every shape is authored in a unit box (0..1 × 0..1) that is scaled to `aspect` (w:h) and fitted
// into the slot. Primitive kinds (normalized coordinates):
//   { k:'ellipse', cx, cy, rx, ry, fill? }          { k:'rect', x, y, w, h, fill? }
//   { k:'line', x1, y1, x2, y2 }                    { k:'poly', pts:[[x,y],…], closed?, fill? }
//   { k:'path', d }   (SVG path data in unit coordinates; arcs allowed)
//   { k:'arc', cx, cy, rx, ry, start, stop }        (radians, as rough.arc: 0 = +x, π/2 = +y/down)
// Shapes are drawn at doodle scale (sketch.js DOODLE_HEIGHT) and labelled beside or beneath; the
// 2026-10-13 Sal-style pass added rock, ground, smiley, zigzag and curve (study §2.6).

export const SKETCH_LIBRARY = Object.freeze({
  circle: {
    aspect: 1,
    primitives: [{ k: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 }],
  },

  cloud: {
    aspect: 1.6,
    primitives: [
      { k: 'path', d: 'M0.22 0.82 L0.78 0.82 A0.14 0.2 0 0 0 0.86 0.46 A0.17 0.26 0 0 0 0.62 0.22 A0.2 0.3 0 0 0 0.34 0.26 A0.16 0.24 0 0 0 0.12 0.5 A0.13 0.19 0 0 0 0.22 0.82 Z' },
    ],
  },

  database: {
    aspect: 0.72,
    primitives: [
      { k: 'ellipse', cx: 0.5, cy: 0.14, rx: 0.5, ry: 0.14 },
      { k: 'line', x1: 0, y1: 0.14, x2: 0, y2: 0.86 },
      { k: 'line', x1: 1, y1: 0.14, x2: 1, y2: 0.86 },
      { k: 'arc', cx: 0.5, cy: 0.86, rx: 0.5, ry: 0.14, start: 0, stop: Math.PI },
      { k: 'arc', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.14, start: 0, stop: Math.PI },
    ],
  },

  server: {
    aspect: 0.78,
    primitives: [
      { k: 'rect', x: 0, y: 0, w: 1, h: 1 },
      { k: 'line', x1: 0.04, y1: 0.33, x2: 0.96, y2: 0.33 },
      { k: 'line', x1: 0.04, y1: 0.66, x2: 0.96, y2: 0.66 },
      { k: 'ellipse', cx: 0.16, cy: 0.165, rx: 0.05, ry: 0.04 },
      { k: 'ellipse', cx: 0.16, cy: 0.495, rx: 0.05, ry: 0.04 },
      { k: 'line', x1: 0.4, y1: 0.165, x2: 0.86, y2: 0.165 },
      { k: 'line', x1: 0.4, y1: 0.495, x2: 0.86, y2: 0.495 },
    ],
  },

  document: {
    aspect: 0.76,
    primitives: [
      { k: 'poly', pts: [[0, 0], [0.72, 0], [1, 0.22], [1, 1], [0, 1]], closed: true },
      { k: 'poly', pts: [[0.72, 0], [0.72, 0.22], [1, 0.22]], closed: false },
      { k: 'line', x1: 0.15, y1: 0.42, x2: 0.85, y2: 0.42 },
      { k: 'line', x1: 0.15, y1: 0.58, x2: 0.85, y2: 0.58 },
      { k: 'line', x1: 0.15, y1: 0.74, x2: 0.65, y2: 0.74 },
    ],
  },

  stack: {
    aspect: 1.1,
    primitives: [
      { k: 'rect', x: 0.08, y: 0.7, w: 0.84, h: 0.24 },
      { k: 'rect', x: 0.08, y: 0.38, w: 0.84, h: 0.24 },
      { k: 'rect', x: 0.08, y: 0.06, w: 0.84, h: 0.24 },
    ],
  },

  person: {
    aspect: 0.5,
    primitives: [
      { k: 'ellipse', cx: 0.5, cy: 0.16, rx: 0.3, ry: 0.15 },
      { k: 'line', x1: 0.5, y1: 0.31, x2: 0.5, y2: 0.64 },
      { k: 'poly', pts: [[0.08, 0.48], [0.5, 0.36], [0.92, 0.48]], closed: false },
      { k: 'line', x1: 0.5, y1: 0.64, x2: 0.16, y2: 0.98 },
      { k: 'line', x1: 0.5, y1: 0.64, x2: 0.84, y2: 0.98 },
    ],
  },

  numberline: {
    aspect: 2.6,
    primitives: [
      { k: 'line', x1: 0.02, y1: 0.5, x2: 0.98, y2: 0.5 },
      { k: 'poly', pts: [[0.08, 0.3], [0.02, 0.5], [0.08, 0.7]], closed: false },
      { k: 'poly', pts: [[0.92, 0.3], [0.98, 0.5], [0.92, 0.7]], closed: false },
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ k: 'line', x1: 0.14 + (0.72 * i) / 6, y1: 0.36, x2: 0.14 + (0.72 * i) / 6, y2: 0.64 })),
    ],
  },

  axes: {
    aspect: 1,
    primitives: [
      { k: 'line', x1: 0.1, y1: 0.98, x2: 0.1, y2: 0.02 },
      { k: 'poly', pts: [[0.05, 0.1], [0.1, 0.02], [0.15, 0.1]], closed: false },
      { k: 'line', x1: 0.02, y1: 0.9, x2: 0.98, y2: 0.9 },
      { k: 'poly', pts: [[0.9, 0.85], [0.98, 0.9], [0.9, 0.95]], closed: false },
      ...[1, 2, 3].map((i) => ({ k: 'line', x1: 0.1 + 0.2 * i, y1: 0.87, x2: 0.1 + 0.2 * i, y2: 0.93 })),
      ...[1, 2, 3].map((i) => ({ k: 'line', x1: 0.07, y1: 0.9 - 0.2 * i, x2: 0.13, y2: 0.9 - 0.2 * i })),
    ],
  },

  grid: {
    aspect: 1.3,
    primitives: [
      { k: 'rect', x: 0, y: 0, w: 1, h: 1 },
      { k: 'line', x1: 0.25, y1: 0, x2: 0.25, y2: 1 },
      { k: 'line', x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
      { k: 'line', x1: 0.75, y1: 0, x2: 0.75, y2: 1 },
      { k: 'line', x1: 0, y1: 1 / 3, x2: 1, y2: 1 / 3 },
      { k: 'line', x1: 0, y1: 2 / 3, x2: 1, y2: 2 / 3 },
    ],
  },
  // ---- Sal's doodles (study §2.6) ----

  /** A lumpy circle with a squiggle: a rock (or any blob with texture). */
  rock: {
    aspect: 1.25,
    primitives: [
      { k: 'path', d: 'M0.1 0.75 C0.05 0.45 0.25 0.1 0.55 0.12 C0.85 0.15 1 0.45 0.92 0.72 C0.85 0.98 0.2 1 0.1 0.75 Z' },
      { k: 'path', d: 'M0.3 0.55 C0.38 0.4 0.46 0.7 0.54 0.52 C0.6 0.4 0.66 0.62 0.72 0.5' },
    ],
  },

  /** A line with hatching below: the ground, a table, a surface. */
  ground: {
    aspect: 3.2,
    primitives: [
      { k: 'line', x1: 0.02, y1: 0.3, x2: 0.98, y2: 0.3 },
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ k: 'line', x1: 0.14 + 0.13 * i, y1: 0.3, x2: 0.06 + 0.13 * i, y2: 0.92 })),
    ],
  },

  /** A circle with a face: a thing with a mood. */
  smiley: {
    aspect: 1,
    primitives: [
      { k: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5 },
      { k: 'ellipse', cx: 0.36, cy: 0.4, rx: 0.04, ry: 0.05 },
      { k: 'ellipse', cx: 0.64, cy: 0.4, rx: 0.04, ry: 0.05 },
      { k: 'arc', cx: 0.5, cy: 0.55, rx: 0.26, ry: 0.22, start: Math.PI * 0.15, stop: Math.PI * 0.85 },
    ],
  },

  /** A zigzag path: a bouncing particle, a jagged edge, a signal. */
  zigzag: {
    aspect: 2.2,
    primitives: [
      { k: 'poly', pts: [[0.02, 0.75], [0.18, 0.2], [0.34, 0.75], [0.5, 0.2], [0.66, 0.75], [0.82, 0.2], [0.98, 0.75]], closed: false },
    ],
  },

  /** A smooth rising arc with an arrowhead: growth, a trajectory, "approaches". */
  curve: {
    aspect: 1.4,
    primitives: [
      { k: 'path', d: 'M0.04 0.9 C0.25 0.9 0.55 0.6 0.92 0.14' },
      { k: 'poly', pts: [[0.891, 0.272], [0.92, 0.14], [0.797, 0.196]], closed: false },
    ],
  },
});

export const LIBRARY_SHAPES = Object.freeze(Object.keys(SKETCH_LIBRARY));
