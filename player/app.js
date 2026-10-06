// player/app.js — shell entry (FOUNDATION ONLY). Applies tokens to :root, creates the shared
// test-hook namespace, imports the three slice entry points and starts the engine.
// Slices never edit this file; they add files inside their own directories.
import { tokens, cssVars } from '../shared/layout-core/tokens.js';
import * as constants from '../shared/layout-core/constants.js';
import { registry, boardRectsFor } from './registry.js';
import './renderer/core/index.js';      // slice 02 registers text, list, code, table, math, box, arrow, highlight
import './renderer/pictures/index.js';  // slice 03 registers sketch, diagram, plot, svg
import { start as startEngine } from './engine/index.js'; // slice 04

window.__khan = window.__khan || {};

/** Write every token as a CSS custom property on :root (JS is the single source of truth). */
export function applyTokens(target = document.documentElement) {
  for (const [name, value] of Object.entries(cssVars(tokens))) target.style.setProperty(name, value);
}

applyTokens();

const lessonId = decodeURIComponent(location.pathname.split('/')[2] || '');
const params = new URLSearchParams(location.search);
const debug = params.get('debug') === '1';
const debugPanel = document.getElementById('debug');
if (debug && debugPanel) debugPanel.hidden = false;

const board = document.getElementById('board');
const ctx = board.getContext('2d');
ctx.fillStyle = tokens.boardBg;
ctx.fillRect(0, 0, board.width, board.height);

Object.assign(window.__khan, { lessonId, tokens, constants, registry, boardRectsFor, debug });

startEngine({
  lessonId,
  debug,
  debugPanel,
  root: document.getElementById('engine-root'),
  board,
  pen: document.getElementById('pen'),
  registry,
  boardRectsFor,
  tokens,
  constants,
});
