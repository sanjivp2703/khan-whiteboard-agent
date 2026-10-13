// shared/layout-core/tokens.js
// Design tokens. The NAMES are a frozen interface (CLAUDE.md contract-first rule):
// element `color` accepts exactly COLOR_TOKENS; drawables and the player chrome read
// everything through `tokens`. The VALUES come from design cycle 1 (the Khan Academy
// look, design/01-khan-look-research.md, approved 2026-10-12 in decisions.md): the official
// KA "On black" palette. Changing a value must never require a code change anywhere else.
// One source of truth is this file; player/tokens.css mirrors the names and player/app.js
// writes these values onto :root at load.

/** Token names a scene element may use as `color`. */
export const COLOR_TOKENS = Object.freeze(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'muted']);

export const tokens = Object.freeze({
  // board
  boardBg: '#000000',   // pure black board (KA: flood-fill the background black)
  chalk: '#FFFFFF',     // default stroke / text (KA White; reserved for neutral text)
  muted: '#717378',     // scaffolding grey (KA Gray)
  // the five KA drawing colours (light blue, pink, coral, yellow, teal)
  accent1: '#FFE066',   // KA yellow
  accent2: '#65D0FA',   // KA light blue
  accent3: '#FF8D71',   // KA coral (never true red on black)
  accent4: '#59F3CE',   // KA teal
  accent5: '#FB73BE',   // KA pink
  // player chrome (not element-selectable): neutral near-blacks that sit against a pure black
  // board without framing it; panelBg is KA's off-black (#21242C). panelMuted is lighter than
  // the board `muted` so chrome captions keep >= 4.5:1 on panelBg.
  pageBg: '#0B0C0F',
  panelBg: '#21242C',
  panelText: '#E8E9EB',
  panelMuted: '#9A9CA3',
  // handwriting font
  fontHand: 'PatrickHand',
  fontHandFile: '/vendor/fonts/PatrickHand-Regular.ttf',
  fontHandFallback: '"Comic Sans MS", "Segoe Print", cursive',
});

/** Resolve a `color` token name (or undefined) to a CSS color; unknown names fall back to chalk. */
export function colorOf(name) {
  if (name && COLOR_TOKENS.includes(name)) return tokens[name];
  return tokens.chalk;
}

/** CSS custom property name for a token key: accent1 -> --khan-accent1, boardBg -> --khan-board-bg */
export function cssVarName(key) {
  return '--khan-' + key.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
}

/** { '--khan-board-bg': '#000000', ... } for every token. */
export function cssVars(t = tokens) {
  const out = {};
  for (const [k, v] of Object.entries(t)) out[cssVarName(k)] = String(v);
  return out;
}
