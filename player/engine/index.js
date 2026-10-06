// player/engine/index.js — SLICE 04 owns this directory.
// Foundation stub: connects to the lesson's SSE stream and logs the playlist to the debug panel.
// Nothing else (no audio, no drawing, no controls). Slice 04 replaces this file with the real
// engine, mounting its UI inside #engine-root and attaching hooks only under window.__khan.engine.

/**
 * @param {{lessonId:string, debug:boolean, debugPanel:HTMLElement|null, root:HTMLElement, board:HTMLCanvasElement,
 *          pen:HTMLCanvasElement, registry:object, boardRectsFor:Function, tokens:object, constants:object}} opts
 */
export function start(opts) {
  const { lessonId, debugPanel } = opts;
  window.__khan = window.__khan || {};
  const hooks = { stub: true, lessonId, playlist: null, events: [] };
  window.__khan.engine = hooks;
  if (!lessonId) return hooks;

  const list = debugPanel ? debugPanel.querySelector('#debug-playlist') : null;
  const meta = debugPanel ? debugPanel.querySelector('#debug-meta') : null;
  const log = debugPanel ? debugPanel.querySelector('#debug-log') : null;

  const render = (snapshot) => {
    hooks.playlist = snapshot;
    if (meta) meta.textContent = `${snapshot.title || lessonId} — ${snapshot.entries.length} scenes, tts ${snapshot.tts.provider}${snapshot.tts.ready ? '' : ` (not ready: ${snapshot.tts.reason})`}${snapshot.ended ? ', ended' : ''}`;
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
  };

  const source = new EventSource(`/api/lesson/${lessonId}/events`);
  source.addEventListener('playlist', (ev) => {
    try { render(JSON.parse(ev.data)); } catch (e) { if (log) log.textContent += `bad playlist event: ${e.message}\n`; }
    hooks.events.push('playlist');
  });
  source.addEventListener('heartbeat', () => { hooks.events.push('heartbeat'); });
  source.onerror = () => { if (log) log.textContent += `sse: connection lost at ${new Date().toISOString()}\n`; };
  hooks.source = source;
  return hooks;
}
