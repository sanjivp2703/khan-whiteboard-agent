// player/engine/ui.js — the lesson page's chrome, mounted inside #engine-root (brief 04 items
// 1, 2, 12–14, 16). Pure DOM building and updating; no playback logic. Every control is a real
// <button> with an accessible name; the frozen data-testids are listed in briefs/04-player-engine.md.
// Colors and fonts come from the --khan-* custom properties (tokens), never hard-coded here.

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

export const STATE_LABELS = Object.freeze({
  waiting: 'waiting', armed: 'ready to start', playing: 'playing', paused: 'paused',
  stalled: 'waiting for the next scene', thinking: 'thinking', ended: 'ended',
});

/**
 * @param {HTMLElement} root  #engine-root
 * @param {{onStart, onPause, onAsk, onJump, onCancelAsk, onSubmitAsk, onToggleSidebar, onToggleTranscript}} handlers
 */
export function buildUi(root, handlers) {
  root.classList.add('eng');
  root.dataset.state = 'waiting';

  // --- top bar -------------------------------------------------------------
  const title = el('span', { class: 'eng-title', 'data-testid': 'lesson-title', text: '' });
  const state = el('span', { class: 'eng-state', 'data-testid': 'state', text: 'waiting', role: 'status', 'aria-live': 'off' });
  const stateLabel = el('span', { class: 'eng-state-label', 'data-testid': 'state-label', text: STATE_LABELS.waiting, 'aria-hidden': 'true' });
  const pauseBtn = el('button', { type: 'button', class: 'eng-btn', 'data-testid': 'pause-button', 'aria-label': 'Pause', 'aria-keyshortcuts': 'Space', text: 'Pause', onclick: () => handlers.onPause() });
  const askBtn = el('button', { type: 'button', class: 'eng-btn', 'data-testid': 'ask-button', 'aria-label': 'Ask a question', 'aria-keyshortcuts': 'Shift+?', text: 'Ask', onclick: () => handlers.onAsk() });
  const sideBtn = el('button', { type: 'button', class: 'eng-btn eng-btn-quiet', 'data-testid': 'sidebar-toggle', 'aria-label': 'Pin or unpin the scene list', 'aria-pressed': 'false', 'aria-keyshortcuts': 's', text: 'Scenes', onclick: () => handlers.onToggleSidebar() });
  const transcriptBtn = el('button', { type: 'button', class: 'eng-btn eng-btn-quiet', 'data-testid': 'transcript-toggle', 'aria-label': 'Show or hide the transcript', 'aria-pressed': 'true', 'aria-keyshortcuts': 't', text: 'Transcript', onclick: () => handlers.onToggleTranscript() });
  const answering = el('span', { class: 'eng-answering', 'data-testid': 'answering-badge', text: 'answering your question', hidden: true });
  const top = el('div', { class: 'eng-top', role: 'toolbar', 'aria-label': 'Playback controls' }, [
    el('div', { class: 'eng-top-left' }, [sideBtn, title]),
    el('div', { class: 'eng-top-mid' }, [state, stateLabel, answering]),
    el('div', { class: 'eng-top-right' }, [pauseBtn, askBtn, transcriptBtn]),
  ]);

  // --- sidebar -------------------------------------------------------------
  const list = el('ol', { class: 'eng-side-list' });
  const side = el('nav', { class: 'eng-side', 'data-testid': 'sidebar', 'aria-label': 'Scenes', 'data-expanded': 'true', 'data-pinned': 'false' }, [
    el('div', { class: 'eng-side-head', text: 'Scenes' }),
    list,
  ]);

  // --- start gate ----------------------------------------------------------
  const startBtn = el('button', { type: 'button', class: 'eng-start-btn', 'data-testid': 'start-button', 'aria-label': 'Start the lesson', text: 'Start', onclick: () => handlers.onStart() });
  const startHint = el('p', { class: 'eng-start-hint', 'data-testid': 'start-hint', text: 'Click to start. Playback begins as soon as the first scene is ready.' });
  const ttsNote = el('div', { class: 'eng-tts-note', 'data-testid': 'tts-missing-note', role: 'alert', hidden: true });
  const gate = el('div', { class: 'eng-gate', 'data-testid': 'start-gate' }, [el('div', { class: 'eng-gate-card' }, [ttsNote, startBtn, startHint])]);

  // --- caption, transcript, notes -----------------------------------------
  const caption = el('div', { class: 'eng-caption', 'data-testid': 'caption', role: 'status', 'aria-live': 'polite', text: '' });
  const transcript = el('p', { class: 'eng-transcript-text', 'data-testid': 'transcript', 'aria-live': 'polite', 'aria-atomic': 'true', text: '' });
  const transcriptMeta = el('div', { class: 'eng-transcript-meta' }, [
    el('span', { class: 'eng-transcript-scene', 'data-testid': 'transcript-scene', text: '' }),
    el('span', { class: 'eng-degraded', 'data-testid': 'transcript-degraded', hidden: true }),
  ]);
  const notes = el('ul', { class: 'eng-notes', 'data-testid': 'notes', 'aria-label': 'Playback notes' });
  const bottom = el('div', { class: 'eng-bottom', 'data-testid': 'transcript-panel', 'data-visible': 'true' }, [transcriptMeta, transcript, notes]);

  // --- question field ------------------------------------------------------
  const input = el('input', { type: 'text', class: 'eng-ask-input', 'data-testid': 'question-input', 'aria-label': 'Your question', placeholder: 'Ask khan a question…', autocomplete: 'off', maxlength: '500' });
  const askHint = el('span', { class: 'eng-ask-hint', text: 'Enter to ask · Esc to go back' });
  const askCancel = el('button', { type: 'button', class: 'eng-btn eng-btn-quiet', 'data-testid': 'question-cancel', 'aria-label': 'Cancel the question', text: 'Cancel', onclick: () => handlers.onCancelAsk() });
  const askForm = el('form', { class: 'eng-ask', 'data-testid': 'question-form', hidden: true, 'aria-label': 'Ask a question' }, [input, askCancel, askHint]);
  askForm.addEventListener('submit', (ev) => { ev.preventDefault(); handlers.onSubmitAsk(input.value); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); handlers.onCancelAsk(); } });

  // --- end summary ---------------------------------------------------------
  const sum = {
    scenes: el('dd', { 'data-testid': 'summary-scenes', text: '0' }),
    degraded: el('dd', { 'data-testid': 'summary-degraded', text: '0' }),
    svg: el('dd', { 'data-testid': 'summary-svg', text: '0' }),
    questions: el('dd', { 'data-testid': 'summary-questions', text: '0' }),
  };
  const summary = el('section', { class: 'eng-summary', 'data-testid': 'summary', hidden: true, 'aria-label': 'Lesson summary' }, [
    el('h2', { text: 'Lesson complete' }),
    el('dl', {}, [
      el('dt', { text: 'scenes played' }), sum.scenes,
      el('dt', { text: 'degraded scenes' }), sum.degraded,
      el('dt', { text: 'svg elements' }), sum.svg,
      el('dt', { text: 'questions answered' }), sum.questions,
    ]),
    el('p', { class: 'eng-summary-hint', text: 'You can still ask a question (?) or jump to any scene.' }),
  ]);

  root.replaceChildren(top, side, gate, caption, askForm, summary, bottom);

  // ---------------------------------------------------------------------------
  const api = {
    root, top, title, state, stateLabel, pauseBtn, askBtn, sideBtn, transcriptBtn, answering, side, list, gate, startBtn, startHint, ttsNote,
    caption, transcript, transcriptMeta, notes, bottom, askForm, input, summary, sum,

    setTitle(text) { title.textContent = text || ''; },

    setState(name, { canAsk = false, paused = false, questionOpen = false, answering: isAnswering = false, ttsReady = true } = {}) {
      root.dataset.state = name;
      state.textContent = name;
      stateLabel.textContent = STATE_LABELS[name] || name;
      gate.hidden = !(name === 'waiting' || name === 'armed');
      startBtn.disabled = !ttsReady || name !== 'waiting';
      startHint.textContent = !ttsReady ? 'Playback is unavailable until a key is configured.'
        : name === 'armed' ? 'Waiting for the first scene…' : 'Click to start. Playback begins as soon as the first scene is ready.';
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      pauseBtn.disabled = !(name === 'playing' || name === 'paused');
      askBtn.disabled = !canAsk;
      askBtn.setAttribute('aria-disabled', String(!canAsk));
      askForm.hidden = !questionOpen;
      answering.hidden = !isAnswering;
      summary.hidden = name !== 'ended';
      api.setSidebarExpanded(side.dataset.pinned === 'true' || name !== 'playing');
    },

    setTtsMissing(reason) {
      if (reason === null) { ttsNote.hidden = true; ttsNote.textContent = ''; return; }
      ttsNote.hidden = false;
      ttsNote.replaceChildren(el('strong', { text: 'OpenAI key required' }), el('span', { text: ` — ${reason}` }));
    },

    setCaption(text) { if (caption.textContent !== text) caption.textContent = text; },

    setTranscript({ sceneId, title: sceneTitle, narration, degraded, droppedCount }) {
      transcript.textContent = narration || '';
      transcriptMeta.firstChild.textContent = sceneId ? `${sceneId}${sceneTitle ? ' · ' + sceneTitle : ''}` : '';
      const d = transcriptMeta.lastChild;
      d.hidden = !degraded;
      d.textContent = degraded ? `degraded${droppedCount ? ` · ${droppedCount} element${droppedCount === 1 ? '' : 's'} dropped` : ''}` : '';
    },

    addNote(testid, text) {
      const li = el('li', { class: 'eng-note', 'data-testid': testid, role: 'status', text });
      notes.append(li);
      while (notes.children.length > 6) notes.firstChild.remove();
      return li;
    },

    setSidebarExpanded(expanded) { side.dataset.expanded = String(!!expanded); },
    setSidebarPinned(pinned) { side.dataset.pinned = String(!!pinned); sideBtn.setAttribute('aria-pressed', String(!!pinned)); },
    isSidebarPinned() { return side.dataset.pinned === 'true'; },
    setTranscriptVisible(visible) { bottom.dataset.visible = String(!!visible); transcriptBtn.setAttribute('aria-pressed', String(!!visible)); },
    isTranscriptVisible() { return bottom.dataset.visible === 'true'; },

    /**
     * @param {Array<{sceneId, title, status, kind, degraded, ready, planned, noAudio, final}>} items
     * @param {string|null} currentId
     */
    renderSidebar(items, currentId) {
      const existing = new Map([...list.children].map((li) => [li.dataset.sceneId, li]));
      const next = [];
      for (const it of items) {
        let li = existing.get(it.sceneId);
        if (!li) {
          const btn = el('button', { type: 'button', class: 'eng-side-item', 'data-testid': `sidebar-item-${it.sceneId}`, onclick: () => handlers.onJump(it.sceneId) }, [
            el('span', { class: 'eng-side-dot', 'aria-hidden': 'true' }),
            el('span', { class: 'eng-side-id', text: it.sceneId }),
            el('span', { class: 'eng-side-title' }),
            el('span', { class: 'eng-side-badge' }),
          ]);
          li = el('li', { class: 'eng-side-row', dataset: { sceneId: it.sceneId } }, [btn]);
        }
        const btn = li.firstChild;
        li.dataset.status = it.status;
        li.dataset.kind = it.kind;
        li.dataset.degraded = String(!!it.degraded);
        li.dataset.ready = String(!!it.ready);
        li.dataset.current = String(it.sceneId === currentId);
        btn.dataset.status = it.status;
        btn.dataset.degraded = String(!!it.degraded);
        btn.dataset.ready = String(!!it.ready);
        btn.setAttribute('aria-disabled', String(!it.ready));
        if (it.sceneId === currentId) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current');
        const badge = it.noAudio ? 'no audio' : it.degraded ? `${it.status} · degraded` : it.status;
        btn.children[2].textContent = it.title || '';
        btn.children[3].textContent = badge;
        btn.setAttribute('aria-label', `${it.kind === 'answer' ? 'Answer scene ' : 'Scene '}${it.sceneId}${it.title ? ', ' + it.title : ''}, ${badge}${it.ready ? '' : ', not ready'}`);
        btn.title = `${it.sceneId}${it.title ? ' — ' + it.title : ''} (${badge})`;
        next.push(li);
      }
      list.replaceChildren(...next);
    },

    setSummary({ scenes, degraded, svg, questions }) {
      sum.scenes.textContent = String(scenes);
      sum.degraded.textContent = String(degraded);
      sum.svg.textContent = String(svg);
      sum.questions.textContent = String(questions);
      summary.dataset.scenes = String(scenes);
      summary.dataset.degraded = String(degraded);
      summary.dataset.svg = String(svg);
      summary.dataset.questions = String(questions);
    },

    focusQuestion() { input.value = ''; try { input.focus({ preventScroll: true }); } catch { input.focus(); } },
  };
  return api;
}
