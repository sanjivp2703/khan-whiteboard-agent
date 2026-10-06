// server/sse.js — Server-Sent Events: `playlist` snapshot on connect and on every change, `heartbeat` every 15 s.
// A well-formed lessonId the server has not ingested yet is accepted too (`addPending`): the
// stream opens with a `waiting` event and switches to `playlist` snapshots the moment the lesson
// appears (QA finding 7 — a browser opened before `outline.json` lands no longer sees a 404).
export function createSse({ store, heartbeatMs = 15000, onConnect = () => {}, onDisconnect = () => {} }) {
  const clients = new Map(); // lessonId → Set<res>
  const pending = new Map(); // lessonId → Set<{req, res}> waiting for the lesson to be ingested
  let heartbeat = null;

  function send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  function openStream(res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
  }

  function ensureHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      const beat = { at: new Date().toISOString() };
      for (const set of clients.values()) for (const r of set) send(r, 'heartbeat', beat);
      for (const set of pending.values()) for (const p of set) send(p.res, 'heartbeat', beat);
    }, heartbeatMs);
  }

  /** Register an open stream as a client of `lesson` and send the current snapshot. */
  function attach(lesson, req, res) {
    if (!clients.has(lesson.lessonId)) clients.set(lesson.lessonId, new Set());
    const set = clients.get(lesson.lessonId);
    set.add(res);
    lesson.player.clients = set.size;
    lesson.player.connected = true;
    lesson.player.everConnected = true;
    onConnect(lesson);
    send(res, 'playlist', store.snapshot(lesson));
    const cleanup = () => {
      if (!set.has(res)) return;
      set.delete(res);
      lesson.player.clients = set.size;
      if (set.size === 0) { lesson.player.connected = false; lesson.player.lastDisconnectAt = Date.now(); }
      onDisconnect(lesson);
      for (const w of lesson.waiters) w.check();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    ensureHeartbeat();
  }

  function add(lesson, req, res) {
    openStream(res);
    attach(lesson, req, res);
  }

  /** Lesson not ingested yet: hold the stream open with a `waiting` event; `broadcast` attaches it later. */
  function addPending(lessonId, req, res) {
    openStream(res);
    if (!pending.has(lessonId)) pending.set(lessonId, new Set());
    const set = pending.get(lessonId);
    const entry = { req, res };
    set.add(entry);
    send(res, 'waiting', { lessonId, reason: 'lesson not ingested yet' });
    const cleanup = () => { set.delete(entry); if (set.size === 0) pending.delete(lessonId); };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    ensureHeartbeat();
  }

  /** Move the streams waiting for `lesson` to its client set (each gets the snapshot on attach). */
  function attachPending(lesson) {
    const set = pending.get(lesson.lessonId);
    if (!set) return;
    pending.delete(lesson.lessonId);
    for (const { req, res } of set) {
      if (res.destroyed || res.writableEnded) continue;
      attach(lesson, req, res);
    }
  }

  function broadcast(lesson) {
    attachPending(lesson);
    const set = clients.get(lesson.lessonId);
    if (!set || set.size === 0) return;
    const snap = store.snapshot(lesson);
    for (const res of set) send(res, 'playlist', snap);
  }

  function count(lessonId) {
    const set = clients.get(lessonId);
    return set ? set.size : 0;
  }

  function pendingCount(lessonId) {
    const set = pending.get(lessonId);
    return set ? set.size : 0;
  }

  function closeAll() {
    for (const set of clients.values()) for (const res of set) { try { res.end(); } catch { /* ignore */ } }
    for (const set of pending.values()) for (const { res } of set) { try { res.end(); } catch { /* ignore */ } }
    clients.clear();
    pending.clear();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  return { add, addPending, broadcast, count, pendingCount, closeAll };
}
