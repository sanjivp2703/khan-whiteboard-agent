// server/sse.js — Server-Sent Events: `playlist` snapshot on connect and on every change, `heartbeat` every 15 s.
export function createSse({ store, heartbeatMs = 15000, onConnect = () => {}, onDisconnect = () => {} }) {
  const clients = new Map(); // lessonId → Set<res>
  let heartbeat = null;

  function send(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }

  function add(lesson, req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
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
    if (!heartbeat) heartbeat = setInterval(() => { for (const set of clients.values()) for (const r of set) send(r, 'heartbeat', { at: new Date().toISOString() }); }, heartbeatMs);
  }

  function broadcast(lesson) {
    const set = clients.get(lesson.lessonId);
    if (!set || set.size === 0) return;
    const snap = store.snapshot(lesson);
    for (const res of set) send(res, 'playlist', snap);
  }

  function count(lessonId) {
    const set = clients.get(lessonId);
    return set ? set.size : 0;
  }

  function closeAll() {
    for (const set of clients.values()) for (const res of set) { try { res.end(); } catch { /* ignore */ } }
    clients.clear();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  return { add, broadcast, count, closeAll };
}
