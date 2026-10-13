// Design tokens (design cycle 1, the Khan Academy look): the eight approved board values are
// pinned so a later "design pass" cannot drift them silently; the CSS mirror must equal the JS
// source of truth; and every board colour must stay visible on the board (a contract, not a value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokens, COLOR_TOKENS, colorOf, cssVars, cssVarName } from '../../shared/layout-core/tokens.js';

const APPROVED = { // decisions.md "Approved 2026-10-12 (design cycle 1)"
  boardBg: '#000000',
  chalk: '#ffffff',
  accent1: '#ffe066', // KA yellow
  accent2: '#65d0fa', // KA light blue
  accent3: '#ff8d71', // KA coral
  accent4: '#59f3ce', // KA teal
  accent5: '#fb73be', // KA pink
  muted: '#717378',   // KA gray
};

const HEX6 = /^#[0-9a-f]{6}$/i;

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

test('the eight approved Khan-look board values are exactly what the human approved (design cycle 1)', () => {
  for (const [name, hex] of Object.entries(APPROVED)) {
    assert.match(tokens[name], HEX6, `${name} must be a 6-digit hex`);
    assert.equal(tokens[name].toLowerCase(), hex, `${name} drifted from the approved value ${hex}`);
  }
});

test('token NAMES are frozen: the element colour vocabulary and the chrome/font keys are unchanged', () => {
  assert.deepEqual([...COLOR_TOKENS], ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'muted']);
  assert.deepEqual(Object.keys(tokens).sort(), [
    'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'boardBg', 'chalk', 'fontHand', 'fontHandFallback', 'fontHandFile',
    'muted', 'pageBg', 'panelBg', 'panelMuted', 'panelText',
  ]);
  assert.ok(Object.isFrozen(tokens));
  for (const name of COLOR_TOKENS) assert.equal(colorOf(name), tokens[name]);
  assert.equal(colorOf(undefined), tokens.chalk);
  assert.equal(colorOf('boardBg'), tokens.chalk, 'boardBg is not element-selectable');
});

test('player/tokens.css mirrors every JS token value exactly (JS is the source of truth)', () => {
  const css = readFileSync(new URL('../../player/tokens.css', import.meta.url), 'utf8');
  const root = /:root\s*\{([\s\S]*?)\}/.exec(css);
  assert.ok(root, 'tokens.css has a :root block');
  const inCss = {};
  for (const m of root[1].matchAll(/(--khan-[a-z0-9-]+)\s*:\s*([^;]+);/g)) inCss[m[1]] = m[2].trim();
  assert.deepEqual(inCss, cssVars(tokens));
  assert.equal(cssVarName('boardBg'), '--khan-board-bg');
});

test('contract: nothing drawn with a board colour is invisible on the board; chrome text is legible on the panel', () => {
  assert.match(tokens.boardBg, HEX6);
  for (const name of ['chalk', ...COLOR_TOKENS]) {
    assert.match(tokens[name], HEX6);
    assert.ok(contrast(tokens[name], tokens.boardBg) >= 3, `${name} ${tokens[name]} has < 3:1 contrast on the board ${tokens.boardBg}`);
  }
  for (const name of ['panelText', 'panelMuted']) {
    assert.ok(contrast(tokens[name], tokens.panelBg) >= 4.5, `${name} ${tokens[name]} has < 4.5:1 contrast on panelBg ${tokens.panelBg}`);
    assert.ok(contrast(tokens[name], tokens.pageBg) >= 4.5, `${name} ${tokens[name]} has < 4.5:1 contrast on pageBg ${tokens.pageBg}`);
  }
  // the five accents stay mutually distinguishable (no two collapse to the same hue/value)
  const accents = COLOR_TOKENS.filter((t) => t.startsWith('accent')).map((t) => tokens[t].toLowerCase());
  assert.equal(new Set(accents).size, accents.length);
});
