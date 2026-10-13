// player/engine/ui.js — the lesson page's chrome, mounted inside #engine-root (change-player-ui:
// design/03-player-ui-study.md as redirected by the human on 2026-10-13 — flat black chrome, one
// green accent, sharp corners). Pure DOM building and updating; no playback logic. Every control
// is a real <button> with an accessible name; the frozen data-testids and keyboard shortcuts are
// unchanged (briefs/04-player-engine.md). Colors and fonts come from --khan-* custom properties:
// the frozen board tokens plus the chrome-only --khan-chrome-* / --khan-progress-* set in
// engine.css. Never hard-coded here.
//
// Layout (spec §6 "Player chrome", §10): a 44 px top bar (khan mark, lesson title, Chapters
// toggle); below it the stage (board letterboxed in a padded area → control bar → voice banner →
// transcript strip) with the Chapters panel beside it. The foundation's #board-wrap (the
// 1600×900 canvases) is moved INTO the board area, where it letterboxes as the largest 16:9 box
// that fits (index.html's cq-unit rule). The only things stacked over the board are the pen canvas
// and the engine's overlay layer: start gate (waiting/armed), thinking caption (small, bottom-right),
// question form (over the lower part of the board while the question is open) and the end card.
//
// Nothing a viewer does not need is visible: state names, scene ids, ready/degraded/svg counts and
// provider error text stay in the DOM for the tests (visually hidden, `.eng-sr`, or `hidden`).

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
};

/** Inline icon (24-unit viewBox). Only where a word would be worse: the play triangle and pause bars. */
const icon = (paths) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">${paths}</svg>`;
  return tpl.content.firstChild;
};
const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICON_PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';

/** m:ss from milliseconds (never negative, never NaN). */
export const fmtTime = (ms) => {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const VOICE_START = 'No voice yet — add your OpenAI key to hear khan speak.';
const VOICE_MID = 'Voice unavailable right now — the board keeps going.';
const PLANNED_ESTIMATE_MS = 10_000; // a scene with no duration yet counts as 10 s for the start hint and the bar
const knownMs = (it) => (Number.isFinite(it.durationMs) && it.durationMs > 0 ? it.durationMs : 0);

/**
 * @param {HTMLElement} root  #engine-root
 * @param {{onStart, onPause, onAsk, onJump, onCancelAsk, onSubmitAsk, onToggleSidebar, onToggleTranscript, onReplay}} handlers
 * @param {{boardWrap?: HTMLElement|null}} [o]  the foundation's #board-wrap (canvases); moved into the board area
 */
export function buildUi(root, handlers, { boardWrap = null } = {}) {
  root.classList.add('eng');
  root.dataset.state = 'waiting';

  // --- top bar -------------------------------------------------------------
  const title = el('h1', { class: 'eng-title', 'data-testid': 'lesson-title', text: '' });
  const state = el('span', { class: 'eng-sr', 'data-testid': 'state', text: 'waiting', role: 'status', 'aria-live': 'off' });
  const answering = el('span', { class: 'eng-sr', 'data-testid': 'answering-badge', text: 'answering your question', hidden: true });
  const sideBtn = el('button', { type: 'button', class: 'eng-tbtn', 'data-testid': 'sidebar-toggle', 'aria-label': 'Show or hide chapters (s)', title: 'Chapters (s)', 'aria-pressed': 'false', 'aria-keyshortcuts': 's', text: 'Chapters', onclick: () => handlers.onToggleSidebar() });
  const top = el('header', { class: 'eng-top' }, [
    el('span', { class: 'eng-brand', 'aria-hidden': 'true', text: 'khan' }),
    title, state, answering,
    el('span', { class: 'eng-spacer' }),
    sideBtn,
  ]);

  // --- control bar: progress + row ------------------------------------------
  const segs = el('div', { class: 'eng-segs' });
  const tip = el('div', { class: 'eng-tip', 'aria-hidden': 'true' }, [el('b'), el('span')]);
  const progress = el('div', { class: 'eng-progress', 'data-testid': 'progress', 'aria-label': 'Lesson progress', 'data-tip': 'false' }, [segs, tip]);
  progress.addEventListener('pointerleave', () => { progress.dataset.tip = 'false'; });

  const pauseBtn = el('button', { type: 'button', class: 'eng-play', 'data-testid': 'pause-button', 'aria-label': 'Play', 'aria-keyshortcuts': 'Space', title: 'Play (space)', onclick: () => handlers.onPause() }, [
    el('span', { class: 'eng-ic-pause' }, [icon(ICON_PAUSE)]),
    el('span', { class: 'eng-ic-play' }, [icon(ICON_PLAY)]),
  ]);
  const elapsed = el('b', { 'data-testid': 'time-elapsed', text: '0:00' });
  const total = el('span', { 'data-testid': 'time-total', text: '0:00' });
  const time = el('span', { class: 'eng-time' }, [elapsed, el('span', { text: ' / ' }), total]);
  const chapterLabel = el('small', { 'data-testid': 'chapter-label', text: '' });
  const chapterTitle = el('span', { 'data-testid': 'chapter-title', text: '' });
  const scene = el('span', { class: 'eng-scene', 'data-empty': 'true' }, [chapterLabel, chapterTitle]);
  const askBtn = el('button', { type: 'button', class: 'eng-ask', 'data-testid': 'ask-button', 'aria-label': 'Ask khan a question', 'aria-keyshortcuts': 'Shift+?', title: 'Ask khan (?)', text: 'Ask khan', onclick: () => handlers.onAsk() });
  const transcriptBtn = el('button', { type: 'button', class: 'eng-tbtn', 'data-testid': 'transcript-toggle', 'aria-label': 'Show or hide the full transcript (t)', title: 'Transcript (t)', 'aria-pressed': 'false', 'aria-keyshortcuts': 't', text: 'Transcript', onclick: () => handlers.onToggleTranscript() });
  const row = el('div', { class: 'eng-row' }, [pauseBtn, time, scene, el('span', { class: 'eng-grow' }), askBtn, transcriptBtn]);
  const controls = el('div', { class: 'eng-controls', role: 'toolbar', 'aria-label': 'Playback controls' }, [progress, row]);

  // --- voice banner (one plain sentence; never the provider's error text) ----
  const ttsNote = el('div', { class: 'eng-banner', 'data-testid': 'tts-missing-note', role: 'alert', hidden: true });

  // --- transcript strip + notes --------------------------------------------
  const transcript = el('p', { class: 'eng-transcript-text', 'data-testid': 'transcript', 'aria-live': 'polite', 'aria-atomic': 'true', text: '' });
  const transcriptMeta = el('p', { class: 'eng-transcript-meta' }, [
    el('span', { class: 'eng-transcript-scene', 'data-testid': 'transcript-scene', text: '' }),
    el('span', { class: 'eng-degraded', 'data-testid': 'transcript-degraded', hidden: true, 'data-degraded': 'false' }),
  ]);
  const notes = el('ul', { class: 'eng-notes', 'data-testid': 'notes', 'aria-label': 'Playback notes' });
  const bottom = el('div', { class: 'eng-transcript', 'data-testid': 'transcript-panel', 'data-visible': 'true', 'data-expanded': 'false' }, [transcriptMeta, transcript, notes]);

  // --- chapters panel --------------------------------------------------------
  const list = el('ol', { class: 'eng-side-list' });
  const side = el('nav', { class: 'eng-side', 'data-testid': 'sidebar', 'aria-label': 'Chapters', 'data-expanded': 'true', 'data-pinned': 'false' }, [
    el('div', { class: 'eng-side-inner' }, [
      el('h2', { class: 'eng-side-head', text: 'Chapters' }),
      list,
      el('p', { class: 'eng-side-keys', 'data-testid': 'shortcut-hint', text: 'space pause · ← → chapters · ? ask' }),
    ]),
  ]);

  // --- overlays over the board (only at modal moments) ------------------------
  const gateTitle = el('div', { class: 'eng-gate-title', text: '' });
  const startBtn = el('button', { type: 'button', class: 'eng-start-btn', 'data-testid': 'start-button', 'aria-label': 'Start the lesson', title: 'Start (space)', onclick: () => handlers.onStart() }, [icon(ICON_PLAY)]);
  const startHint = el('p', { class: 'eng-start-hint', 'data-testid': 'start-hint', text: '' });
  const gate = el('div', { class: 'eng-gate', 'data-testid': 'start-gate' }, [gateTitle, startBtn, startHint]);

  const captionText = el('span', { class: 'eng-caption-text' });
  const caption = el('div', { class: 'eng-caption', 'data-testid': 'caption', role: 'status', 'aria-live': 'polite', 'data-empty': 'true' }, [captionText]);

  const input = el('input', { type: 'text', class: 'eng-ask-input', 'data-testid': 'question-input', 'aria-label': 'Your question', placeholder: 'Ask khan anything about this lesson…', autocomplete: 'off', maxlength: '500' });
  const askSend = el('button', { type: 'submit', class: 'eng-ask-send', text: 'Ask' });
  const askCancel = el('button', { type: 'button', class: 'eng-ask-cancel', 'data-testid': 'question-cancel', 'aria-label': 'Cancel the question', title: 'Cancel (Esc)', text: 'Esc', onclick: () => handlers.onCancelAsk() });
  const askForm = el('form', { class: 'eng-ask-form', 'data-testid': 'question-form', hidden: true, 'aria-label': 'Ask a question' }, [input, askSend, askCancel]);
  askForm.addEventListener('submit', (ev) => { ev.preventDefault(); handlers.onSubmitAsk(input.value); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); handlers.onCancelAsk(); } });

  const sum = {
    scenes: el('dd', { 'data-testid': 'summary-scenes', text: '0' }),
    degraded: el('dd', { 'data-testid': 'summary-degraded', text: '0' }),
    svg: el('dd', { 'data-testid': 'summary-svg', text: '0' }),
    questions: el('dd', { 'data-testid': 'summary-questions', text: '0' }),
  };
  const endSub = el('p', { class: 'eng-end-sub', 'data-testid': 'summary-line', text: '' });
  const endAsk = el('button', { type: 'button', class: 'eng-end-ask', text: 'Ask khan', onclick: () => handlers.onAsk() });
  const summary = el('section', { class: 'eng-end', 'data-testid': 'summary', hidden: true, 'aria-label': 'Lesson summary' }, [
    el('div', { class: 'eng-end-card' }, [
      el('h2', { text: 'Lesson complete' }),
      endSub,
      el('dl', { class: 'eng-sr' }, [
        el('dt', { text: 'scenes played' }), sum.scenes,
        el('dt', { text: 'degraded scenes' }), sum.degraded,
        el('dt', { text: 'svg elements' }), sum.svg,
        el('dt', { text: 'questions answered' }), sum.questions,
      ]),
      el('div', { class: 'eng-end-actions' }, [
        el('button', { type: 'button', class: 'eng-end-replay', 'data-testid': 'replay-button', text: 'Replay', onclick: () => handlers.onReplay && handlers.onReplay() }),
        endAsk,
      ]),
      el('p', { class: 'eng-end-more', text: 'or pick a chapter to watch it again' }),
    ]),
  ]);

  const overlay = el('div', { class: 'eng-overlay', 'data-testid': 'board-overlay' }, [gate, caption, askForm, summary]);
  const boardArea = el('div', { class: 'eng-board-area', 'data-testid': 'board-area' });
  if (boardWrap) { boardArea.append(boardWrap); boardWrap.append(overlay); } else boardArea.append(overlay);
  const boardPad = el('div', { class: 'eng-board-pad' }, [boardArea]);

  const stage = el('section', { class: 'eng-stage' }, [boardPad, controls, ttsNote, bottom]);
  const body = el('div', { class: 'eng-body' }, [stage, side]);
  root.replaceChildren(top, body);

  // ---------------------------------------------------------------------------
  // chrome state kept between calls
  let items = [];            // last rendered chapter list (playlist order, planned scenes slotted in)
  let currentId = null;
  let currentMs = 0;
  let lessonTitle = '';
  let lessonInfo = { chapters: 0, estimateMs: 0 };
  let ttsMissing = false;
  let summaryData = { scenes: 0, degraded: 0, svg: 0, questions: 0, chapters: 0 };

  const chapterNumber = (sceneId) => { let n = 0; for (const it of items) { if (it.kind !== 'answer') n++; if (it.sceneId === sceneId) return it.kind === 'answer' ? null : n; } return null; };
  const chapterCount = () => items.filter((it) => it.kind !== 'answer').length;
  const startMsOf = (index) => { let ms = 0; for (let i = 0; i < index; i++) ms += knownMs(items[i]); return ms; };
  const rowTitle = (it) => (it.kind === 'answer' && it.questionText ? `Your question: ${it.questionText}` : it.title || '');

  function startHintText() {
    const n = Math.max(0, lessonInfo.chapters);
    const min = Math.max(1, Math.round(lessonInfo.estimateMs / 60_000));
    startHint.replaceChildren(
      el('span', { text: `${n} chapter${n === 1 ? '' : 's'} · about ${min} min · press ` }),
      el('kbd', { class: 'eng-kbd', text: 'space' }),
      el('span', { text: ' to start' }),
    );
  }
  function refreshStartHint() {
    if (root.dataset.state === 'armed') startHint.textContent = 'Preparing the first chapter…';
    else startHintText();
  }
  function refreshBanner() {
    ttsNote.hidden = !ttsMissing;
    if (!ttsMissing) { ttsNote.textContent = ''; return; }
    const s = root.dataset.state;
    ttsNote.textContent = s === 'waiting' || s === 'armed' ? VOICE_START : VOICE_MID;
  }
  function refreshEndLine() {
    const q = summaryData.questions;
    const n = summaryData.chapters || chapterCount();
    endSub.textContent = `${lessonTitle} · ${n} chapter${n === 1 ? '' : 's'}${q > 0 ? ` · you asked ${q} question${q === 1 ? '' : 's'}` : ''}`;
  }

  /** Progress fills, time and the chapter label from `items`, `currentId`, `currentMs` and the state. */
  function paintProgress() {
    const ended = root.dataset.state === 'ended';
    const idx = items.findIndex((it) => it.sceneId === currentId);
    let done = 0;
    let totalMs = 0;
    let unknown = false;
    items.forEach((it, i) => {
      const d = knownMs(it);
      if (!d) unknown = true;
      totalMs += d;
      let p = 0;
      if (ended) p = it.ready ? 100 : 0;
      else if (i < idx) p = 100;
      else if (i === idx) p = d ? Math.max(0, Math.min(100, (currentMs / d) * 100)) : 0;
      if (i < idx) done += d; else if (i === idx) done += d ? Math.min(currentMs, d) : 0;
      const seg = segs.children[i];
      if (seg) { seg.style.setProperty('--p', `${p}%`); seg.dataset.current = String(i === idx); seg.dataset.played = String(i < idx || (ended && it.ready)); }
    });
    if (ended) done = totalMs;
    elapsed.textContent = fmtTime(done);
    total.textContent = `${unknown ? '~' : ''}${fmtTime(totalMs)}`;
    const cur = idx >= 0 ? items[idx] : null;
    if (!cur) { scene.dataset.empty = 'true'; chapterLabel.textContent = ''; chapterTitle.textContent = ''; }
    else {
      scene.dataset.empty = 'false';
      const n = chapterNumber(cur.sceneId);
      chapterLabel.textContent = n ? `Chapter ${n} of ${chapterCount()}` : 'Your question';
      chapterTitle.textContent = cur.title || '';
    }
  }

  // ---------------------------------------------------------------------------
  const api = {
    root, top, title, state, pauseBtn, askBtn, sideBtn, transcriptBtn, answering, side, list, gate, startBtn, startHint, ttsNote,
    caption, transcript, transcriptMeta, notes, bottom, askForm, input, summary, sum, boardArea, overlay, progress, segs,

    setTitle(text) { lessonTitle = text || ''; title.textContent = lessonTitle; gateTitle.textContent = lessonTitle; refreshEndLine(); },

    /** Start-gate hint inputs: chapters from the outline, minutes from known durations (10 s per unplanned scene). */
    setLessonInfo({ chapters = 0, estimateMs = 0 } = {}) { lessonInfo = { chapters, estimateMs }; refreshStartHint(); },

    setState(name, { canAsk = false, paused = false, questionOpen = false, answering: isAnswering = false, ttsReady = true } = {}) {
      root.dataset.state = name;
      state.textContent = name;
      gate.hidden = !(name === 'waiting' || name === 'armed');
      startBtn.disabled = !ttsReady || name !== 'waiting';
      refreshStartHint();
      const showPause = name === 'playing' && !paused;
      pauseBtn.dataset.playing = String(showPause);
      pauseBtn.setAttribute('aria-label', showPause ? 'Pause' : 'Play');
      pauseBtn.title = showPause ? 'Pause (space)' : 'Play (space)';
      pauseBtn.disabled = !(name === 'playing' || name === 'paused');
      askBtn.disabled = !canAsk;
      askBtn.setAttribute('aria-disabled', String(!canAsk));
      endAsk.disabled = !canAsk;
      askForm.hidden = !questionOpen;
      answering.hidden = !isAnswering;
      summary.hidden = name !== 'ended';
      refreshBanner();
      api.setSidebarExpanded(side.dataset.pinned === 'true' || name !== 'playing');
      paintProgress();
    },

    /** `reason` is kept for the engine's call shape but never shown (spec §6: one plain sentence). */
    setTtsMissing(reason) { ttsMissing = reason !== null && reason !== undefined; refreshBanner(); },

    setCaption(text) {
      if (captionText.textContent !== text) captionText.textContent = text || '';
      caption.dataset.empty = String(!text);
    },

    setTranscript({ sceneId, title: sceneTitle, narration, degraded, droppedCount }) {
      transcript.textContent = narration || '';
      transcriptMeta.firstChild.textContent = sceneId ? (sceneTitle || '') : '';
      const d = transcriptMeta.lastChild;
      d.hidden = !degraded;
      d.dataset.degraded = String(!!degraded);
      d.textContent = degraded ? `degraded${droppedCount ? ` · ${droppedCount} element${droppedCount === 1 ? '' : 's'} dropped` : ''}` : '';
    },

    /**
     * Add a playback note, unique per `key` (backlog #20). An existing note with the same key is
     * updated in place (text refreshed) and kept where it is; nothing is appended.
     * @param {string} testid  data-testid (e.g. scene-skipped-note)
     * @param {string} text
     * @param {string} [key]   identity of the note; defaults to testid + text
     */
    addNote(testid, text, key = `${testid}|${text}`) {
      const existing = [...notes.children].find((li) => li.dataset.noteKey === key);
      if (existing) { if (existing.textContent !== text) existing.textContent = text; return existing; }
      const li = el('li', { class: 'eng-note', 'data-testid': testid, role: 'status', text, dataset: { noteKey: key } });
      notes.append(li);
      while (notes.children.length > 6) notes.firstChild.remove();
      return li;
    },

    setSidebarExpanded(expanded) { side.dataset.expanded = String(!!expanded); },
    setSidebarPinned(pinned) { side.dataset.pinned = String(!!pinned); sideBtn.setAttribute('aria-pressed', String(!!pinned)); },
    isSidebarPinned() { return side.dataset.pinned === 'true'; },
    setTranscriptExpanded(expanded) { bottom.dataset.expanded = String(!!expanded); transcriptBtn.setAttribute('aria-pressed', String(!!expanded)); },
    isTranscriptExpanded() { return bottom.dataset.expanded === 'true'; },

    /**
     * Chapters panel + progress segments, one per scene in playlist order (planned scenes slotted in).
     * @param {Array<{sceneId, title, status, kind, degraded, ready, planned, noAudio, final, durationMs?, questionText?}>} nextItems
     * @param {string|null} nextCurrentId
     */
    renderSidebar(nextItems, nextCurrentId) {
      items = nextItems;
      currentId = nextCurrentId;
      const totalChapters = chapterCount();
      const known = items.map(knownMs).filter(Boolean);
      const estimate = known.length ? known.reduce((a, b) => a + b, 0) / known.length : PLANNED_ESTIMATE_MS;
      // chapters list
      const existing = new Map([...list.children].map((li) => [li.dataset.sceneId, li]));
      const nextRows = [];
      let n = 0;
      const idx = items.findIndex((it) => it.sceneId === currentId);
      items.forEach((it, i) => {
        if (it.kind !== 'answer') n++;
        let li = existing.get(it.sceneId);
        if (!li) {
          const btn = el('button', { type: 'button', class: 'eng-side-item', 'data-testid': `sidebar-item-${it.sceneId}`, onclick: () => handlers.onJump(it.sceneId) }, [
            el('span', { class: 'eng-side-n' }),
            el('span', { class: 'eng-side-title' }),
            el('span', { class: 'eng-side-d' }),
          ]);
          li = el('li', { class: 'eng-side-row', dataset: { sceneId: it.sceneId } }, [btn]);
        }
        const btn = li.firstChild;
        const isCurrent = it.sceneId === currentId;
        const d = knownMs(it);
        const rt = rowTitle(it);
        li.dataset.status = it.status;
        li.dataset.kind = it.kind;
        li.dataset.degraded = String(!!it.degraded);
        li.dataset.ready = String(!!it.ready);
        li.dataset.current = String(isCurrent);
        li.dataset.played = String(idx >= 0 && i < idx);
        btn.dataset.status = it.status;
        btn.dataset.degraded = String(!!it.degraded);
        btn.dataset.ready = String(!!it.ready);
        btn.dataset.noAudio = String(!!it.noAudio);
        btn.setAttribute('aria-disabled', String(!it.ready));
        if (isCurrent) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
        btn.children[0].textContent = it.kind === 'answer' ? '?' : String(n);
        btn.children[1].textContent = rt;
        btn.children[2].textContent = it.ready ? (d ? fmtTime(d) : '') : 'soon';
        btn.setAttribute('aria-label', `${it.kind === 'answer' ? 'Answer' : `Chapter ${n} of ${totalChapters}`}${rt ? ', ' + rt : ''}${it.ready ? (d ? `, ${fmtTime(d)}` : '') : ', not ready yet'}`);
        btn.title = rt;
        nextRows.push(li);
      });
      list.replaceChildren(...nextRows);
      // progress segments (rebuilt only when the id sequence changes)
      const ids = items.map((it) => it.sceneId);
      const same = segs.children.length === ids.length && [...segs.children].every((s, i) => s.dataset.sceneId === ids[i]);
      if (!same) {
        segs.replaceChildren(...items.map((it) => {
          const seg = el('button', { type: 'button', class: 'eng-seg', 'data-testid': `progress-segment-${it.sceneId}`, dataset: { sceneId: it.sceneId }, onclick: () => handlers.onJump(it.sceneId) }, [el('span', { class: 'eng-seg-fill' }, [el('span', { class: 'eng-seg-knob' })])]);
          seg.addEventListener('pointerenter', () => {
            const j = [...segs.children].indexOf(seg);
            tip.firstChild.textContent = fmtTime(startMsOf(j));
            tip.lastChild.textContent = rowTitle(items[j] || it);
            tip.style.left = `${seg.offsetLeft + seg.offsetWidth / 2}px`;
            progress.dataset.tip = 'true';
          });
          return seg;
        }));
      }
      items.forEach((it, i) => {
        const seg = segs.children[i];
        const d = knownMs(it);
        seg.style.setProperty('--w', String(Math.max(1, Math.round((d || estimate) / 1000))));
        seg.dataset.ready = String(!!it.ready);
        seg.dataset.kind = it.kind;
        seg.setAttribute('aria-disabled', String(!it.ready));
        const num = chapterNumber(it.sceneId);
        seg.setAttribute('aria-label', `${it.kind === 'answer' ? 'Answer' : `Chapter ${num || ''}`}${rowTitle(it) ? ': ' + rowTitle(it) : ''}${it.ready ? '' : ' (not ready yet)'}`);
      });
      paintProgress();
    },

    /** Elapsed / total and the current segment's fill; called at ~4 Hz by the engine, never per frame. */
    setProgress({ currentId: id = currentId, currentMs: ms = 0 } = {}) {
      currentId = id;
      currentMs = Math.max(0, Number(ms) || 0);
      paintProgress();
    },

    setSummary({ scenes, degraded, svg, questions, chapters = 0 }) {
      summaryData = { scenes, degraded, svg, questions, chapters };
      sum.scenes.textContent = String(scenes);
      sum.degraded.textContent = String(degraded);
      sum.svg.textContent = String(svg);
      sum.questions.textContent = String(questions);
      summary.dataset.scenes = String(scenes);
      summary.dataset.degraded = String(degraded);
      summary.dataset.svg = String(svg);
      summary.dataset.questions = String(questions);
      refreshEndLine();
    },

    focusQuestion() { input.value = ''; try { input.focus({ preventScroll: true }); } catch { input.focus(); } },
  };
  startHintText();
  return api;
}
