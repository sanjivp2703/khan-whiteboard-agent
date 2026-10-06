// player/harness.js — renderer test page (brief 00 C5). FOUNDATION ONLY; slices use it, never edit it.
//   /harness/<lessonId>?scene=<sceneId>&u=<0..1>
// Loads the playlist and effective scenes from the API, draws the board at the start of the named
// scene (every scene since the last wipe at u=1) then the named scene at progress u, through the
// registry (fallback for unregistered types). No audio, no SSE, no controls.
// window.__khan.harness = { ready, drawSceneAt(sceneId, u), drawnIds(), boundsOf(id), drawableOf(id),
//                           nonBackgroundPixelCount(), modules: {handwriting, math, layoutCore, strokes, registry} }
import { tokens, cssVars } from '../shared/layout-core/tokens.js';
import * as layoutCore from '../shared/layout-core/index.js';
import * as handwriting from '../shared/handwriting.js';
import * as math from '../shared/math.js';
import * as strokes from '../shared/strokes.js';
import { registry, makeDrawCtx } from './registry.js';
import './renderer/core/index.js';
import './renderer/pictures/index.js';
import { kindOfScene, trackScenes } from './harness-track.js';

window.__khan = window.__khan || {};
for (const [name, value] of Object.entries(cssVars(tokens))) document.documentElement.style.setProperty(name, value);

const params = new URLSearchParams(location.search);
const lessonId = decodeURIComponent(location.pathname.split('/')[2] || params.get('lesson') || '');
const initialScene = params.get('scene') || 's001';
const initialU = params.has('u') ? Number(params.get('u')) : 1;
const statusEl = document.getElementById('harness-status');
const board = document.getElementById('board');
const ctx2d = board.getContext('2d', { willReadFrequently: true });

const state = { playlist: null, scenes: new Map(), drawables: new Map(), drawn: [], lastScene: null, lastU: null, font: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function loadEffective(sceneId, { timeoutMs = 20000 } = {}) {
  if (state.scenes.has(sceneId)) return state.scenes.get(sceneId);
  const t0 = Date.now();
  for (;;) {
    const r = await fetch(`/api/lesson/${lessonId}/scene/${sceneId}`);
    if (r.ok) { const scene = await r.json(); state.scenes.set(sceneId, scene); return scene; }
    if (Date.now() - t0 > timeoutMs) throw new Error(`scene ${sceneId} not available`);
    await sleep(150);
  }
}

async function refreshPlaylist() {
  state.playlist = await fetchJson(`/api/lesson/${lessonId}/playlist`);
  return state.playlist;
}

function clearBoard() {
  ctx2d.save();
  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.fillStyle = tokens.boardBg;
  ctx2d.fillRect(0, 0, board.width, board.height);
  ctx2d.restore();
}

/**
 * Draw the board at the start of `sceneId` (all scenes since the last wipe on its track, u=1)
 * and then `sceneId` itself at progress u.
 */
async function drawSceneAt(sceneId, u = 1) {
  const pl = await refreshPlaylist();
  const ordered = pl.entries.map((e) => e.sceneId);
  if (!ordered.includes(sceneId)) {
    // wait until the scene shows up in the playlist
    const t0 = Date.now();
    while (!(await refreshPlaylist()).entries.some((e) => e.sceneId === sceneId)) {
      if (Date.now() - t0 > 20000) throw new Error(`scene ${sceneId} is not in the playlist`);
      await sleep(150);
    }
  }
  const track = trackScenes(state.playlist.entries, sceneId);
  const scenes = [];
  for (const id of track) scenes.push(await loadEffective(id));
  const index = scenes.length - 1;
  let start = 0;
  for (let i = index; i >= 0; i--) if (scenes[i].board && scenes[i].board.mode === 'wipe') { start = i; break; }
  clearBoard();
  state.drawables = new Map();
  state.drawn = [];
  for (let i = start; i <= index; i++) {
    const scene = scenes[i];
    const ctx = makeDrawCtx(scenes, i, { font: state.font, tokens });
    for (const el of scene.elements || []) {
      const prepare = registry.get(el.type);
      const drawable = prepare(el, ctx);
      state.drawables.set(el.id, drawable);
      const progress = i < index ? 1 : Math.max(0, Math.min(1, Number.isFinite(u) ? u : 1));
      drawable.paint(ctx2d, progress);
      state.drawn.push(el.id);
    }
  }
  state.lastScene = sceneId;
  state.lastU = u;
  statusEl.textContent = `harness: ${lessonId} ${sceneId} u=${u} — ${state.drawn.length} drawables (${registry.types().length} registered types)`;
  return state.drawn.slice();
}

function nonBackgroundPixelCount() {
  const { data } = ctx2d.getImageData(0, 0, board.width, board.height);
  const bg = hexToRgb(tokens.boardBg);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - bg[0]) > 8 || Math.abs(data[i + 1] - bg[1]) > 8 || Math.abs(data[i + 2] - bg[2]) > 8) n++;
  }
  return n;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const ready = (async () => {
  try {
    state.font = await handwriting.loadFont(tokens.fontHandFile);
    await drawSceneAt(initialScene, initialU);
  } catch (e) {
    statusEl.textContent = `harness error: ${e.message}`;
    throw e;
  }
})();

window.__khan.harness = {
  ready,
  lessonId,
  drawSceneAt,
  drawnIds: () => state.drawn.slice(),
  boundsOf: (id) => { const d = state.drawables.get(id); return d ? { ...d.bounds } : null; },
  drawableOf: (id) => state.drawables.get(id) || null,
  nonBackgroundPixelCount,
  state,
  kindOfScene,
  modules: { handwriting, math, layoutCore, strokes, registry },
};
