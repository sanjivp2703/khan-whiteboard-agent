// player/engine/index.js — SLICE 04: the playback engine (spec §6, §7, §10; brief 04).
//
// Everything the user experiences besides the strokes themselves: the state machine (reducer.js),
// the audio-clock scheduler (scheduler.js), the deterministic board planner (board-plan.js), the
// resume stack (resume-stack.js), the chrome (ui.js) and the pen (pen.js). Drawing of any element
// type goes through the foundation registry (fallback dashed rectangles until slices 02/03 land).
//
// Clock rule: the current scene's <audio>.currentTime is the only clock for drawing. The only
// wall-clock inputs are the yield hold (capped), the stall captions, the 400 ms beat and the
// idle animation — none of them affects sync.
//
// Test hooks live only under window.__khan.engine (see `hooks` below).
import { tokens as defaultTokens } from '../../shared/layout-core/tokens.js';
import * as handwriting from '../../shared/handwriting.js';
import { makeDrawCtx, registry as defaultRegistry } from '../registry.js';
import { initialState, reduce, canAsk, canJump } from './reducer.js';
import { peek } from './resume-stack.js';
import { buildTimeline, progressAt, effectiveTime, isSceneComplete, activeIndex, startedIds } from './scheduler.js';
import { planBoardAt, boardHistory, countSvgElements, kindOfScene } from './board-plan.js';
import { buildUi } from './ui.js';
import { createPen } from './pen.js';

export const DEFAULT_CONFIG = Object.freeze({
  yieldCapMs: 1500,       // spec §6: hold silence for the pen up to ~1.5 s
  stallCaptionMs: 10000,  // "khan is thinking…"
  stuckCaptionMs: 60000,  // "generation seems stuck"
  readyBeatMs: 400,       // beat before playing a scene that arrived during a stall
  playbackRate: 1,        // tests speed the audio clock up; drawing follows the clock
  naturalMsScale: 1,      // tests stretch natural stroke durations to exercise the yield rule
  metadataTimeoutMs: 5000,
});

const EFFECTIVE_STATUSES = new Set(['voicing', 'ready', 'degraded']);
const MAX_EVENTS = 200;
const aNum = (id) => Number(id.slice(6));
const sNum = (id) => Number(id.slice(1));
/** 16 zero frames at 8 kHz (2 ms): a valid clip that ends on its own, used only to unlock audio on the arming gesture. */
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

/**
 * @param {{lessonId:string, debug:boolean, debugPanel:HTMLElement|null, root:HTMLElement, board:HTMLCanvasElement,
 *          pen:HTMLCanvasElement, registry:object, boardRectsFor:Function, tokens:object, constants:object}} opts
 */
export function start(opts) {
  const { lessonId, debugPanel, root, board, pen: penCanvas } = opts;
  const tokens = opts.tokens || defaultTokens;
  const registry = opts.registry || defaultRegistry;
  window.__khan = window.__khan || {};

  // ---------------------------------------------------------------------------
  // state
  let fsm = initialState();
  let playlist = null;
  const scenes = new Map();        // sceneId → effective scene
  const sceneStatus = new Map();   // sceneId → last status seen (re-validation invalidates the cache)
  const fetching = new Map();      // sceneId → Promise<scene|null>
  let current = null;              // the scene being played/shown (see playScene)
  let run = 0;                     // bumps on every scene start; stale async work checks it
  let waitingSince = null;         // performance.now() when a stall/thinking wait began
  let beatTimer = null;
  let playlistReceivedAt = 0;
  let sidebarPinned = false;
  const played = new Set();        // sceneIds with a posted `end`
  const events = [];
  const config = { ...DEFAULT_CONFIG };
  let font = null;

  const log = (type, extra = {}) => {
    events.push({ type, at: Math.round(performance.now()), state: fsm.state, ...extra });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  };

  // ---------------------------------------------------------------------------
  // DOM
  const ui = buildUi(root, {
    onStart: () => arm('start-button'),
    onPause: () => togglePause(),
    onAsk: () => openAsk(),
    onJump: (sceneId) => jump(sceneId),
    onCancelAsk: () => cancelAsk(),
    onSubmitAsk: (text) => submitAsk(text),
    onToggleSidebar: () => { sidebarPinned = !sidebarPinned; ui.setSidebarPinned(sidebarPinned); updateUi(); },
    onToggleTranscript: () => ui.setTranscriptVisible(!ui.isTranscriptVisible()),
  });
  const boardCtx = board.getContext('2d');
  const bg = document.createElement('canvas');
  bg.width = board.width; bg.height = board.height;
  const bgCtx = bg.getContext('2d');
  const pen = createPen(penCanvas, tokens);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('aria-hidden', 'true');

  audio.addEventListener('ended', () => { if (current && !current.skipped) { current.audioEnded = true; log('audio-ended', { sceneId: current.entry.sceneId }); } });
  audio.addEventListener('error', () => {
    if (!current || current.skipped || current.static) return;
    log('audio-error', { sceneId: current.entry.sceneId, code: audio.error && audio.error.code });
    skipCurrent('audio error');
  });

  // ---------------------------------------------------------------------------
  // helpers
  const entries = () => (playlist && playlist.entries) || [];
  const entryOf = (sceneId) => entries().find((e) => e.sceneId === sceneId) || null;
  const ttsReady = () => !playlist || !playlist.tts || playlist.tts.ready !== false;
  const isReady = (e) => !!e && e.status === 'ready';
  const nowMs = () => performance.now();
  // the scene clock in seconds: the audio element's currentTime, except while a new scene's audio
  // is still loading (the element then still carries the previous scene's time) or after `ended`
  const audioTimeS = () => (current && (current.static || current.loading) ? current.staticT : audio.currentTime) || 0;

  function dispatch(action) {
    const r = reduce(fsm, action);
    if (r.ok) {
      const from = fsm.state;
      fsm = r.state;
      if (from !== fsm.state) log('transition', { from, to: fsm.state, action: action.type });
      updateUi();
    } else {
      log('refused', { action: action.type, reason: r.reason });
    }
    return r;
  }

  function updateUi() {
    ui.setState(fsm.state, {
      canAsk: canAsk(fsm) && !!current,
      paused: fsm.state === 'paused',
      questionOpen: fsm.questionOpen,
      answering: fsm.stack.length > 0 && !fsm.questionOpen,
      ttsReady: ttsReady(),
    });
    renderSidebar();
    if (fsm.state === 'ended') ui.setSummary(summaryCounts());
    if (fsm.state !== 'stalled' && fsm.state !== 'thinking' && fsm.state !== 'armed') ui.setCaption('');
  }

  async function postPosition(sceneId, event, t = audioTimeS()) {
    log('position', { sceneId, event, t });
    try {
      await fetch(`/api/lesson/${lessonId}/position`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId, event, t }) });
    } catch (e) { log('position-failed', { sceneId, event, error: String(e && e.message) }); }
  }

  // ---------------------------------------------------------------------------
  // playlist (SSE)
  function onPlaylist(snapshot) {
    playlist = snapshot;
    playlistReceivedAt = nowMs();
    log('playlist', { ready: snapshot.entries.filter((e) => e.status === 'ready').map((e) => e.sceneId), ended: !!snapshot.ended });
    for (const e of snapshot.entries) {
      const prev = sceneStatus.get(e.sceneId);
      if (prev && prev !== e.status && !EFFECTIVE_STATUSES.has(e.status)) { scenes.delete(e.sceneId); fetching.delete(e.sceneId); }
      sceneStatus.set(e.sceneId, e.status);
      if (EFFECTIVE_STATUSES.has(e.status) && !scenes.has(e.sceneId)) ensureScene(e.sceneId).catch(() => {});
    }
    ui.setTitle(snapshot.title || lessonId);
    ui.setTtsMissing(ttsReady() ? null : (snapshot.tts && snapshot.tts.reason) || 'TTS provider not ready');
    renderDebug(snapshot);
    updateUi();
    checkAdvance();
  }

  function ensureScene(sceneId) {
    if (scenes.has(sceneId)) return Promise.resolve(scenes.get(sceneId));
    if (fetching.has(sceneId)) return fetching.get(sceneId);
    const e = entryOf(sceneId);
    if (!e || !EFFECTIVE_STATUSES.has(e.status)) return Promise.resolve(null);
    const p = (async () => {
      try {
        const r = await fetch(`/api/lesson/${lessonId}/scene/${sceneId}`);
        if (!r.ok) return null;
        const scene = await r.json();
        scenes.set(sceneId, scene);
        return scene;
      } catch { return null; } finally { fetching.delete(sceneId); }
    })();
    fetching.set(sceneId, p);
    return p;
  }

  /** Outline scenes merged with playlist entries, in playlist order (planned scenes slot in by number). */
  function sidebarItems() {
    const items = entries().map((e) => ({
      sceneId: e.sceneId, title: e.title || outlineTitle(e.sceneId), status: e.status, kind: e.kind || kindOfScene(e.sceneId),
      degraded: !!e.degraded, ready: isReady(e), planned: false, final: !!e.final,
      noAudio: e.status === 'ready' && !e.audioUrl,
    }));
    const outline = playlist && playlist.outline && Array.isArray(playlist.outline.scenes) ? playlist.outline.scenes : [];
    for (const o of outline) {
      if (!o || typeof o.sceneId !== 'string' || items.some((i) => i.sceneId === o.sceneId)) continue;
      const item = { sceneId: o.sceneId, title: o.title || '', status: 'planned', kind: 'lesson', degraded: false, ready: false, planned: true, final: false, noAudio: false };
      let idx = items.findIndex((i) => i.kind === 'lesson' && sNum(i.sceneId) > sNum(o.sceneId));
      if (idx < 0) idx = items.length;
      items.splice(idx, 0, item);
    }
    return items;
  }
  function outlineTitle(sceneId) {
    const o = playlist && playlist.outline && Array.isArray(playlist.outline.scenes) ? playlist.outline.scenes.find((s) => s && s.sceneId === sceneId) : null;
    return o ? o.title || '' : '';
  }
  function renderSidebar() { ui.renderSidebar(sidebarItems(), current ? current.entry.sceneId : null); }

  function renderDebug(snapshot) {
    if (!debugPanel) return;
    const meta = debugPanel.querySelector('#debug-meta');
    const list = debugPanel.querySelector('#debug-playlist');
    if (meta) meta.textContent = `${snapshot.title || lessonId} — ${snapshot.entries.length} scenes, tts ${snapshot.tts.provider}${snapshot.tts.ready ? '' : ` (not ready: ${snapshot.tts.reason})`}${snapshot.ended ? ', ended' : ''} — player ${fsm.state}`;
    if (!list) return;
    list.replaceChildren(...snapshot.entries.map((e) => {
      const li = document.createElement('li');
      li.dataset.sceneId = e.sceneId;
      li.dataset.status = e.status;
      li.dataset.degraded = String(e.degraded);
      const left = document.createElement('span');
      left.textContent = `${e.sceneId} ${e.title ? '· ' + e.title : ''}`;
      const right = document.createElement('span');
      right.textContent = e.status + (e.durationMs ? ` ${(e.durationMs / 1000).toFixed(1)}s` : '');
      li.append(left, right);
      return li;
    }));
  }

  // ---------------------------------------------------------------------------
  // advancing
  function nextLessonEntry(afterSceneId) {
    const list = entries();
    const idx = list.findIndex((e) => e.sceneId === afterSceneId);
    return idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
  }
  function lessonIsFinal() {
    const lesson = entries().filter((e) => kindOfScene(e.sceneId) === 'lesson');
    return lesson.length > 0 && !!lesson[lesson.length - 1].final;
  }
  /** Next answer scene of the question on top of the stack, after `afterSceneId` (or its first). */
  function nextAnswerEntry(afterSceneId) {
    const top = peek(fsm.stack);
    if (!top || !top.qId) return null;
    const answers = entries().filter((e) => e.questionId === top.qId || (kindOfScene(e.sceneId) === 'answer' && e.sceneId.slice(0, 4) === top.qId));
    const afterA = afterSceneId && kindOfScene(afterSceneId) === 'answer' && afterSceneId.slice(0, 4) === top.qId ? aNum(afterSceneId) : 0;
    const later = answers.filter((e) => aNum(e.sceneId) > afterA).sort((a, b) => aNum(a.sceneId) - aNum(b.sceneId));
    return later[0] || null;
  }
  /** What the awaited scene is right now (for armed / stalled / thinking). */
  function awaited() {
    if (fsm.state === 'armed' || fsm.state === 'waiting') return entries()[0] || null;
    if (fsm.state === 'stalled') return current ? nextLessonEntry(current.entry.sceneId) : entries()[0] || null;
    if (fsm.state === 'thinking' && !fsm.questionOpen) return nextAnswerEntry(current && current.awaitAfter !== undefined ? current.awaitAfter : (current ? current.entry.sceneId : null));
    return null;
  }

  function checkAdvance() {
    if (fsm.state === 'armed') {
      const first = entries()[0];
      if (isReady(first) && ttsReady()) {
        const r = dispatch({ type: 'FIRST_READY' });
        if (r.ok) playScene(first, { t: 0 });
      }
      return;
    }
    if (fsm.state === 'stalled' || (fsm.state === 'thinking' && !fsm.questionOpen)) {
      const next = awaited();
      if (isReady(next)) scheduleBeat(next.sceneId);
    }
  }

  function scheduleBeat(sceneId) {
    if (beatTimer) return;
    const stateAtSchedule = fsm.state;
    beatTimer = setTimeout(() => {
      beatTimer = null;
      if (fsm.state !== stateAtSchedule) return;
      const next = awaited();
      if (!isReady(next) || next.sceneId !== sceneId) { checkAdvance(); return; }
      const r = dispatch({ type: 'READY' });
      if (r.ok) playScene(next, { t: 0 });
    }, Math.max(0, Number(config.readyBeatMs) || 0));
  }
  function clearBeat() { if (beatTimer) { clearTimeout(beatTimer); beatTimer = null; } }

  async function onSceneComplete() {
    if (!current || current.completed) return;
    current.completed = true;
    const entry = current.entry;
    log('scene-complete', { sceneId: entry.sceneId });
    played.add(entry.sceneId);
    await postPosition(entry.sceneId, 'end', current.durationMs / 1000);
    if (fsm.state !== 'playing' || !current || current.entry !== entry) return; // something else happened meanwhile
    const top = peek(fsm.stack);
    if (top) {
      const qId = top.qId;
      const isAnswerOfTop = qId && (entry.questionId === qId || entry.sceneId.slice(0, 4) === qId);
      if (isAnswerOfTop && entry.final) {
        const r = dispatch({ type: 'POP' });
        if (r.ok) { log('resume', { sceneId: r.entry.sceneId, t: r.entry.t, from: r.entry.from }); await resumeAt(r.entry); }
        return;
      }
      const next = nextAnswerEntry(entry.sceneId);
      if (isReady(next)) { dispatch({ type: 'COMPLETE', next: 'ready' }); playScene(next, { t: 0 }); return; }
      current.awaitAfter = entry.sceneId;
      waitingSince = nowMs();
      dispatch({ type: 'COMPLETE', next: 'missing' });
      return;
    }
    const next = nextLessonEntry(entry.sceneId);
    if (next) {
      if (isReady(next)) { dispatch({ type: 'COMPLETE', next: 'ready' }); playScene(next, { t: 0 }); return; }
      waitingSince = nowMs();
      dispatch({ type: 'COMPLETE', next: 'missing' });
      return;
    }
    if (lessonIsFinal()) { dispatch({ type: 'COMPLETE', next: 'end' }); return; }
    waitingSince = nowMs();
    dispatch({ type: 'COMPLETE', next: 'missing' });
  }

  // ---------------------------------------------------------------------------
  // scenes
  /** Load every effective scene of the target's track that is available, then build drawables. */
  async function prepareBoard(sceneId) {
    const hist = boardHistory(entries(), scenes, sceneId);
    await Promise.all(hist.trackIds.map((id) => ensureScene(id)));
    const h = boardHistory(entries(), scenes, sceneId);
    const trackScenes = h.trackIds.map((id) => scenes.get(id)).filter(Boolean);
    const targetIndex = trackScenes.findIndex((s) => s.sceneId === sceneId);
    const lastIndex = targetIndex >= 0 ? targetIndex : trackScenes.length - 1;
    let wipeIndex = 0;
    for (let i = lastIndex; i >= 0; i--) if (trackScenes[i].board && trackScenes[i].board.mode === 'wipe') { wipeIndex = i; break; }
    const historyDrawables = []; // [{sceneId, drawable}]
    let targetDrawables = new Map();
    for (let i = wipeIndex; i <= lastIndex; i++) {
      const scene = trackScenes[i];
      const ctx = makeDrawCtx(trackScenes, i, { font, tokens });
      const isTarget = scene.sceneId === sceneId;
      for (const el of scene.elements || []) {
        let drawable;
        try { drawable = registry.get(el.type)(el, ctx); } catch (e) { log('prepare-failed', { id: el.id, type: el.type, error: String(e && e.message) }); drawable = registry.fallback(el, ctx); }
        if (isTarget) targetDrawables.set(el.id, drawable); else historyDrawables.push({ sceneId: scene.sceneId, drawable });
      }
    }
    return { scene: targetIndex >= 0 ? trackScenes[targetIndex] : null, historyDrawables, targetDrawables };
  }

  function paintBackground(historyDrawables) {
    bgCtx.save();
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.fillStyle = tokens.boardBg;
    bgCtx.fillRect(0, 0, bg.width, bg.height);
    bgCtx.restore();
    for (const { drawable } of historyDrawables) { try { drawable.paint(bgCtx, 1); } catch (e) { log('paint-failed', { id: drawable.id, error: String(e && e.message) }); } }
  }

  function paintCurrent(t) {
    if (!current) return;
    boardCtx.save();
    boardCtx.setTransform(1, 0, 0, 1, 0, 0);
    boardCtx.drawImage(bg, 0, 0);
    boardCtx.restore();
    const drawn = [];
    for (const item of current.timeline) {
      const u = current.forced.has(item.id) ? 1 : progressAt(item, t);
      if (u <= 0) continue;
      const d = current.drawables.get(item.id);
      if (d) { try { d.paint(boardCtx, u); } catch (e) { log('paint-failed', { id: item.id, error: String(e && e.message) }); } }
      drawn.push(item.id);
    }
    current.drawn = drawn;
    current.lastPaintT = t;
  }

  function waitMetadata() {
    return new Promise((resolve) => {
      if (audio.readyState >= 1) return resolve(true);
      const done = (ok) => { audio.removeEventListener('loadedmetadata', onMeta); audio.removeEventListener('error', onErr); clearTimeout(timer); resolve(ok); };
      const onMeta = () => done(true);
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), Math.max(100, Number(config.metadataTimeoutMs) || 5000));
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('error', onErr);
    });
  }

  /**
   * Start (or resume) a scene: build the board history since the last wipe into the background
   * cache, build the timeline from the audio duration, post `start`, seek and play.
   * @param {object} entry playlist entry
   * @param {{t?:number, resume?:boolean}} o  t in seconds; resume = elements with start < t are complete
   */
  async function playScene(entry, { t = 0, resume = false } = {}) {
    const myRun = ++run;
    clearBeat();
    waitingSince = null;
    try { audio.pause(); } catch { /* ignore */ }
    const { scene, historyDrawables, targetDrawables } = await prepareBoard(entry.sceneId);
    if (myRun !== run) return;
    const live = entryOf(entry.sceneId) || entry;
    const durationMs = Number.isFinite(live.durationMs) && live.durationMs > 0 ? live.durationMs : 0;
    const effective = scene || { sceneId: entry.sceneId, title: live.title, narration: '', board: live.board || { mode: 'region', slots: 'A1' }, elements: [] };
    const timeline = buildTimeline(effective, durationMs, targetDrawables, { naturalMsScale: config.naturalMsScale });
    const forced = new Set();
    if (resume) for (const item of timeline) if (item.start < t * 1000) forced.add(item.id);
    paintBackground(historyDrawables);
    const bgIds = historyDrawables.map((x) => x.drawable.id);
    current = {
      entry: live, scene: effective, timeline, drawables: targetDrawables, forced, bgIds, drawn: [], durationMs,
      audioEnded: false, holdMs: 0, completed: false, skipped: false, static: fsm.state === 'ended', staticT: t, loading: true,
      lastFrame: nowMs(), lastPaintT: null, awaitAfter: undefined,
    };
    ui.setTranscript({ sceneId: effective.sceneId, title: effective.title || live.title, narration: effective.narration, degraded: !!live.degraded, droppedCount: (live.droppedElementIds || []).length });
    renderSidebar();
    updateUi();
    log('scene-start', { sceneId: entry.sceneId, t, resume });
    paintCurrent(t * 1000);
    if (!current.static) await postPosition(entry.sceneId, 'start', t);
    if (myRun !== run) return;
    if (!live.audioUrl) {
      // TTS failed for this scene (ready, audioUrl null): skip it with a visible note
      skipCurrent('audio unavailable');
      return;
    }
    if (current.static) return; // ended: show the board at t, no audio
    audio.src = live.audioUrl;
    audio.load();
    const ok = await waitMetadata();
    if (myRun !== run) return;
    if (!ok) { skipCurrent('audio unavailable'); return; }
    // load() resets playbackRate to defaultPlaybackRate, so set both after the metadata arrived
    const rate = Number(config.playbackRate) > 0 ? Number(config.playbackRate) : 1;
    try { audio.defaultPlaybackRate = rate; audio.playbackRate = rate; } catch { /* unsupported rate */ }
    if (t > 0) { try { audio.currentTime = Math.min(t, Math.max(0, (audio.duration || t) - 0.001)); } catch { /* ignore */ } }
    current.loading = false;
    if (fsm.state === 'playing') {
      audio.play().catch((e) => { if (myRun === run) log('play-rejected', { sceneId: entry.sceneId, error: String(e && e.message) }); });
    }
  }

  /** The current scene has no usable audio: note it, show its board complete, post end, move on. */
  function skipCurrent(reason) {
    if (!current || current.skipped) return;
    current.skipped = true;
    ui.addNote('scene-skipped-note', `scene ${current.entry.sceneId} skipped: ${reason}`);
    log('scene-skipped', { sceneId: current.entry.sceneId, reason });
    for (const item of current.timeline) current.forced.add(item.id);
    paintCurrent(Infinity);
    current.audioEnded = true;
    setTimeout(() => { if (current && current.skipped && !current.completed && fsm.state === 'playing') onSceneComplete(); }, 0);
  }

  async function resumeAt(entry) {
    const live = entryOf(entry.sceneId);
    if (!live) { log('resume-missing', { sceneId: entry.sceneId }); return; }
    await playScene(live, { t: entry.t, resume: true });
  }

  /** Deterministic instant render of the board at (sceneId, t); returns the plan ids. */
  async function renderBoardAt(sceneId, t = 0) {
    const { scene, historyDrawables, targetDrawables } = await prepareBoard(sceneId);
    const e = entryOf(sceneId);
    const plan = planBoardAt(entries(), scenes, sceneId, t, { durationMs: e ? e.durationMs : undefined });
    paintBackground(historyDrawables);
    boardCtx.save(); boardCtx.setTransform(1, 0, 0, 1, 0, 0); boardCtx.drawImage(bg, 0, 0); boardCtx.restore();
    if (scene) for (const p of plan.ids) { if (p.sceneId !== sceneId) continue; const d = targetDrawables.get(p.id); if (d) d.paint(boardCtx, 1); }
    return plan.ids.map(({ id, u, sceneId: sid }) => ({ id, u, sceneId: sid }));
  }

  // ---------------------------------------------------------------------------
  // user actions
  function arm(source) {
    if (fsm.state !== 'waiting' || !ttsReady()) return false;
    const r = dispatch({ type: 'ARM' });
    if (!r.ok) return false;
    log('armed', { source });
    waitingSince = nowMs();
    // unlock the audio element inside the user gesture (Safari needs the element itself to have
    // played): a 2 ms silent clip that ends on its own — never pause() it, a scene may already be playing
    const first = entries()[0];
    if (!(isReady(first) && first.audioUrl)) { try { audio.src = SILENT_WAV; audio.play().catch(() => {}); } catch { /* ignore */ } }
    checkAdvance();
    return true;
  }

  function togglePause() {
    if (fsm.state === 'playing') {
      const r = dispatch({ type: 'PAUSE' });
      if (r.ok) { try { audio.pause(); } catch { /* ignore */ } }
      return r.ok;
    }
    if (fsm.state === 'paused') {
      const r = dispatch({ type: 'RESUME' });
      if (r.ok && current && !current.skipped && !current.audioEnded) audio.play().catch(() => {});
      return r.ok;
    }
    return false;
  }

  function jump(sceneId) {
    const e = entryOf(sceneId);
    if (!e || !canJump(fsm)) { log('jump-ignored', { sceneId, reason: !e ? 'unknown scene' : `state ${fsm.state}` }); return false; }
    const r = dispatch({ type: 'JUMP', ready: isReady(e), sceneId });
    if (!r.ok) return false;
    log('jump', { sceneId });
    waitingSince = null;
    playScene(e, { t: 0 });
    return true;
  }
  function skipForward() {
    if (!current) return false;
    const next = nextLessonEntry(current.entry.sceneId);
    if (!next) { log('jump-ignored', { reason: 'no next scene' }); return false; }
    return jump(next.sceneId);
  }
  function skipBack() {
    if (!current) return false;
    const list = entries();
    const idx = list.findIndex((e) => e.sceneId === current.entry.sceneId);
    const prev = idx > 0 ? list[idx - 1] : list[idx];
    return prev ? jump(prev.sceneId) : false;
  }

  function openAsk() {
    if (!current || !canAsk(fsm)) { log('ask-ignored', { reason: !current ? 'no scene' : `state ${fsm.state} depth ${fsm.stack.length}` }); return false; }
    const t = fsm.state === 'ended' ? current.durationMs / 1000 : audioTimeS();
    const r = dispatch({ type: 'ASK', entry: { sceneId: current.entry.sceneId, t } });
    if (!r.ok) return false;
    try { audio.pause(); } catch { /* ignore */ }
    log('ask-open', { sceneId: current.entry.sceneId, t });
    ui.focusQuestion();
    return true;
  }
  function cancelAsk() {
    const r = dispatch({ type: 'CANCEL_ASK' });
    if (!r.ok) return false;
    log('ask-cancel', { sceneId: r.entry.sceneId, t: r.entry.t });
    if (fsm.state === 'playing' && current && !current.skipped && !current.audioEnded) audio.play().catch(() => {});
    if (fsm.state === 'stalled' || fsm.state === 'armed') waitingSince = nowMs();
    checkAdvance();
    return true;
  }
  async function submitAsk(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) { ui.focusQuestion(); return false; }
    const top = peek(fsm.stack);
    const r = dispatch({ type: 'SUBMIT_ASK' });
    if (!r.ok || !top) return false;
    waitingSince = nowMs();
    log('ask-submit', { sceneId: top.sceneId, t: top.t });
    try {
      const res = await fetch(`/api/lesson/${lessonId}/question`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: trimmed, atSceneId: top.sceneId, atTime: top.t }) });
      if (!res.ok) throw new Error(`question failed: ${res.status}`);
      const body = await res.json();
      if (!body || typeof body.qId !== 'string') throw new Error('question failed: no qId');
      dispatch({ type: 'SET_QID', qId: body.qId });
      log('ask-posted', { qId: body.qId });
      if (current) current.awaitAfter = null; // the first answer scene is awaited
      checkAdvance();
      return true;
    } catch (e) {
      log('ask-failed', { error: String(e && e.message) });
      ui.addNote('question-failed-note', `question could not be sent: ${e && e.message ? e.message : e}`);
      const a = dispatch({ type: 'ABORT_ASK' });
      if (a.ok && fsm.state === 'playing' && current && !current.skipped && !current.audioEnded) audio.play().catch(() => {});
      return false;
    }
  }

  // keyboard (spec §10: space, ←, →, ?, Esc)
  window.addEventListener('keydown', (ev) => {
    const target = ev.target;
    const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (ev.key === 'Escape') { if (fsm.questionOpen) { ev.preventDefault(); cancelAsk(); } return; }
    if (inField) return;
    if (ev.key === ' ' || ev.code === 'Space') {
      ev.preventDefault();
      if (fsm.state === 'waiting') arm('keyboard'); else togglePause();
    } else if (ev.key === 'ArrowRight') { ev.preventDefault(); skipForward(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); skipBack(); }
    else if (ev.key === '?') { ev.preventDefault(); openAsk(); }
    else if (ev.key === 's' && !ev.metaKey && !ev.ctrlKey) { sidebarPinned = !sidebarPinned; ui.setSidebarPinned(sidebarPinned); updateUi(); }
    else if (ev.key === 't' && !ev.metaKey && !ev.ctrlKey) { ui.setTranscriptVisible(!ui.isTranscriptVisible()); }
  });
  // clicking anywhere arms audio while waiting (the browser gesture requirement)
  document.addEventListener('pointerdown', () => { if (fsm.state === 'waiting') arm('click'); }, true);

  // ---------------------------------------------------------------------------
  // frame loop
  function frame(now) {
    try { tick(now); } catch (e) { log('frame-error', { error: String(e && e.message) }); }
    requestAnimationFrame(frame);
  }

  function tick(now) {
    if (current && !current.static) {
      const dt = now - current.lastFrame;
      current.lastFrame = now;
      // until the new audio is loaded and seeked, the element still carries the previous scene's clock
      const ended = !current.loading && (current.audioEnded || audio.ended);
      if (ended && fsm.state === 'playing' && !current.completed && !current.skipped) current.holdMs += dt;
      const eff = current.skipped ? { t: Infinity, snap: true, holding: false }
        : current.loading ? { t: current.staticT * 1000, snap: false, holding: false }
          : effectiveTime({ audioMs: audio.currentTime * 1000, audioEnded: ended, durationMs: current.durationMs || audio.duration * 1000 || 0, holdMs: current.holdMs, yieldCapMs: Number(config.yieldCapMs) });
      if (current.lastPaintT !== eff.t) paintCurrent(eff.t);
      updatePen(eff.t, now);
      if (fsm.state === 'playing' && !current.completed && !current.skipped && isSceneComplete(current.timeline, { audioEnded: ended, t: eff.t, snap: eff.snap })) onSceneComplete();
    } else if (current && current.static) {
      if (current.lastPaintT !== Infinity) paintCurrent(Infinity);
      pen.setMode('hidden');
      pen.frame(now);
    } else {
      pen.setMode('hidden');
      pen.frame(now);
    }
    updateCaption(now);
  }

  function updatePen(t, now) {
    const s = fsm.state;
    if (s === 'waiting' || s === 'armed' || s === 'ended') { pen.setMode('hidden'); pen.frame(now); return; }
    const idx = activeIndex(current.timeline, t);
    if (idx >= 0) {
      const item = current.timeline[idx];
      const d = current.drawables.get(item.id);
      const u = current.forced.has(item.id) ? 1 : progressAt(item, t);
      const el = (current.scene.elements || [])[item.index];
      let p = d && typeof d.tipAt === 'function' ? safeTip(d, u) : null;
      if (!p && el && el.type === 'highlight' && d && d.bounds) p = { x: d.bounds.x + d.bounds.w * 0.9, y: d.bounds.y + d.bounds.h * 0.5 }; // pointer: park over the target
      if (!p && d && d.bounds) p = { x: d.bounds.x + d.bounds.w, y: d.bounds.y + d.bounds.h };
      if (p) pen.setTip(p);
    }
    if (s === 'stalled' || s === 'thinking') {
      pen.setMode('idle');
      pen.setIdlePaths(...idlePaths());
    } else if (s === 'paused') pen.setMode('park');
    else pen.setMode(idx >= 0 && progressAt(current.timeline[idx], t) < 1 && !current.forced.has(current.timeline[idx].id) ? 'draw' : 'park');
    pen.frame(now);
  }
  function safeTip(d, u) { try { const p = d.tipAt(u); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; } }
  /** Paths of the last highlight or box of the current scene (for the idle re-trace), with its color. */
  function idlePaths() {
    if (!current) return [[], tokens.muted];
    const els = current.scene.elements || [];
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (el.type === 'highlight' || el.type === 'box') {
        const d = current.drawables.get(el.id);
        if (d && Array.isArray(d.paths) && d.paths.length) return [d.paths, (tokens[el.color] || tokens.muted)];
      }
    }
    return [[], tokens.muted];
  }

  function updateCaption(now) {
    const s = fsm.state;
    if (s === 'thinking') { ui.setCaption(fsm.questionOpen ? '' : 'khan is thinking…'); return; }
    if (s !== 'stalled' && s !== 'armed') return;
    if (waitingSince === null) { ui.setCaption(''); return; }
    const waited = now - waitingSince;
    if (waited >= Number(config.stuckCaptionMs)) ui.setCaption(`generation seems stuck · ${producerAge(now)}`);
    else if (waited >= Number(config.stallCaptionMs)) ui.setCaption('khan is thinking…');
    else ui.setCaption('');
  }
  function producerAge(now) {
    const p = playlist && playlist.producer;
    if (!p || !Number.isFinite(p.lastWriteAgeMs)) return 'no producer write yet';
    const age = p.lastWriteAgeMs + (now - playlistReceivedAt);
    const s = Math.round(age / 1000);
    return `last write ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`} ago`;
  }

  function summaryCounts() {
    const list = entries();
    const playedEntries = list.filter((e) => played.has(e.sceneId));
    return {
      scenes: playedEntries.length,
      degraded: playedEntries.filter((e) => e.degraded).length,
      svg: countSvgElements(playedEntries.map((e) => scenes.get(e.sceneId)).filter(Boolean)),
      questions: ((playlist && playlist.questions) || []).filter((q) => q.complete).length,
    };
  }

  // ---------------------------------------------------------------------------
  // hooks (window.__khan.engine — brief 04 item 17)
  const hooks = {
    stub: false,
    lessonId,
    config,
    events,
    get state() { return fsm.state; },
    get fsm() { return fsm; },
    get position() { return current ? { sceneId: current.entry.sceneId, t: audioTimeS() } : { sceneId: null, t: 0 }; },
    get resumeStack() { return fsm.stack.map((e) => ({ ...e })); },
    get playlist() { return playlist; },
    get scenes() { return scenes; },
    get current() { return current; },
    get timeline() { return current ? current.timeline : null; },
    get played() { return [...played]; },
    audio,
    pen,
    drawnElementIds() { return current ? [...current.bgIds, ...startedIds(current.timeline, current.lastPaintT ?? -1, { forced: current.forced })] : []; },
    renderBoardAt,
    planBoardAt: (sceneId, t) => planBoardAt(entries(), scenes, sceneId, t),
    summary: summaryCounts,
    arm: () => arm('hook'),
    togglePause, jump, skipForward, skipBack, openAsk, cancelAsk, submitAsk,
    ready: null,
  };
  window.__khan.engine = hooks;
  if (!lessonId) return hooks;

  // ---------------------------------------------------------------------------
  // boot: font, SSE, loop
  hooks.ready = (async () => {
    try { font = await handwriting.loadFont(tokens.fontHandFile); } catch (e) { log('font-failed', { error: String(e && e.message) }); font = null; }
  })();
  // SSE. The server 404s a lesson it has not ingested yet (an EventSource does not retry after a
  // 404), so a closed stream is reopened with a short backoff; the server replays a full snapshot
  // on every (re)connect, so nothing is missed.
  let sseRetryMs = 1000;
  function connectSse() {
    const source = new EventSource(`/api/lesson/${lessonId}/events`);
    source.addEventListener('playlist', (ev) => {
      sseRetryMs = 1000;
      let snap;
      try { snap = JSON.parse(ev.data); } catch (e) { log('bad-playlist', { error: String(e && e.message) }); return; }
      hooks.ready.then(() => onPlaylist(snap));
    });
    source.addEventListener('heartbeat', () => { log('heartbeat'); });
    source.onerror = () => {
      log('sse-error', { readyState: source.readyState });
      if (source.readyState === EventSource.CLOSED) {
        setTimeout(() => { if (hooks.source === source) connectSse(); }, sseRetryMs);
        sseRetryMs = Math.min(10000, sseRetryMs * 2);
      }
    };
    hooks.source = source;
    return source;
  }
  connectSse();
  updateUi();
  requestAnimationFrame(frame);
  return hooks;
}
