// shared/layout-core/tokens.js
// Design tokens. The NAMES are a frozen interface (CLAUDE.md contract-first rule):
// element `color` accepts exactly COLOR_TOKENS; drawables and the player chrome read
// everything through `tokens`. The VALUES are placeholders until a design pass
// (pipeline-status row `design-tokens`); changing a value must never require a
// code change anywhere else. One source of truth is this file; player/tokens.css
// mirrors the names and player/app.js writes these values onto :root at load.

/** Token names a scene element may use as `color`. */
export const COLOR_TOKENS = Object.freeze(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'muted']);

export const tokens = Object.freeze({
  // board
  boardBg: '#1e272d',   // dark slate board
  chalk: '#f3efe4',     // default stroke / text (off-white chalk)
  muted: '#8e9aa0',     // scaffolding grey
  // five distinguishable chalk-like accents
  accent1: '#ffd166',   // warm yellow
  accent2: '#7fd1e8',   // sky blue
  accent3: '#f28b82',   // coral red
  accent4: '#9be39f',   // mint green
  accent5: '#d3b4f0',   // lavender
  // player chrome (not element-selectable)
  pageBg: '#121a1f',
  panelBg: '#17222a',
  panelText: '#e6e2d8',
  panelMuted: '#8e9aa0',
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

/** { '--khan-board-bg': '#1e272d', ... } for every token. */
export function cssVars(t = tokens) {
  const out = {};
  for (const [k, v] of Object.entries(t)) out[cssVarName(k)] = String(v);
  return out;
}
