// server/http.js — REST + static routes (brief 00 C3). Host 127.0.0.1 only. Every :lessonId /
// :sceneId is regex-checked before touching the filesystem; a foreign Origin header → 403.
import { promises as fs, createReadStream } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { REGEX } from '../shared/layout-core/constants.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const MAX_BODY = 64 * 1024;

export function createHttpHandler({ store, ingest, sse, wait, repoRoot, port, host, lessonsDir, provider, log = () => {} }) {
  const allowedOrigins = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://${host}:${port}`]);
  const ttsStatusOf = () => { const r = provider.ready(); return { provider: provider.name, voice: provider.voice ?? null, ready: !!r.ok, reason: r.ok ? null : r.reason }; };

  const json = (res, status, body, extraHeaders = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', ...extraHeaders });
    res.end(text);
  };
  const error = (res, status, message) => json(res, status, { error: message });

  async function serveFile(res, path, { cache = 'no-cache' } = {}) {
    let st;
    try { st = await fs.stat(path); } catch { return error(res, 404, 'not found'); }
    if (!st.isFile()) return error(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    createReadStream(path).pipe(res);
    return undefined;
  }

  function readBody(req) {
    return new Promise((resolvePromise, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolvePromise({});
        try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('body is not JSON')); }
      });
      req.on('error', reject);
    });
  }

  function staticPath(prefix, rest) {
    const root = resolve(repoRoot, prefix);
    const target = resolve(root, normalize(decodeURIComponent(rest)).replace(/^(\.\.(\/|\\|$))+/, ''));
    if (!target.startsWith(root + '/') && target !== root) return null;
    return target;
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      const origin = req.headers.origin;
      if (origin && !allowedOrigins().has(origin)) return error(res, 403, 'forbidden origin');
      const path = url.pathname;
      const method = req.method;

      if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (path === '/api/health') return json(res, 200, { ok: true, port, host, lessonsDir, tts: ttsStatusOf() });
      if (path === '/' ) { res.writeHead(302, { Location: '/api/health' }); return res.end(); }

      // static
      for (const prefix of ['player', 'shared', 'vendor']) {
        if (path.startsWith(`/${prefix}/`)) {
          if (method !== 'GET' && method !== 'HEAD') return error(res, 405, 'method not allowed');
          const target = staticPath(prefix, path.slice(prefix.length + 2));
          if (!target) return error(res, 400, 'bad path');
          return serveFile(res, target);
        }
      }

      // pages
      let m = /^\/(lesson|harness)\/([^/]+)\/?$/.exec(path);
      if (m) {
        if (!REGEX.lessonId.test(m[2])) return error(res, 400, 'bad lessonId');
        return serveFile(res, join(repoRoot, 'player', m[1] === 'lesson' ? 'index.html' : 'harness.html'));
      }

      // api
      m = /^\/api\/lesson\/([^/]+)\/([a-z]+)(?:\/([^/]+))?\/?$/.exec(path);
      if (!m) return error(res, 404, 'not found');
      const [, lessonId, action, param] = m;
      if (!REGEX.lessonId.test(lessonId)) return error(res, 400, 'bad lessonId');
      const lesson = store.get(lessonId);

      switch (action) {
        case 'outline': {
          if (method !== 'GET') return error(res, 405, 'method not allowed');
          if (!lesson || !lesson.outline) return error(res, 404, 'no outline');
          return json(res, 200, lesson.outline);
        }
        case 'playlist': {
          if (method !== 'GET') return error(res, 405, 'method not allowed');
          if (!lesson) return error(res, 404, 'unknown lesson');
          return json(res, 200, store.snapshot(lesson));
        }
        case 'status': {
          if (method !== 'GET') return error(res, 405, 'method not allowed');
          if (!lesson) return error(res, 404, 'unknown lesson');
          return json(res, 200, store.status(lesson));
        }
        case 'scene': {
          if (method !== 'GET') return error(res, 405, 'method not allowed');
          if (!param || !REGEX.sceneId.test(param)) return error(res, 400, 'bad sceneId');
          const e = lesson && lesson.scenes.get(param);
          if (!e || !e.effective) return error(res, 404, 'scene not available');
          return json(res, 200, e.effective);
        }
        case 'audio': {
          if (method !== 'GET' && method !== 'HEAD') return error(res, 405, 'method not allowed');
          if (!param || !REGEX.sceneId.test(param)) return error(res, 400, 'bad sceneId');
          const e = lesson && lesson.scenes.get(param);
          if (!e || !e.audio) return error(res, 404, 'no audio');
          return serveFile(res, e.audio.path, { cache: 'public, max-age=3600' });
        }
        case 'events': {
          if (method !== 'GET') return error(res, 405, 'method not allowed');
          if (!lesson) return error(res, 404, 'unknown lesson');
          return sse.add(lesson, req, res);
        }
        case 'position': {
          if (method !== 'POST') return error(res, 405, 'method not allowed');
          if (!lesson) return error(res, 404, 'unknown lesson');
          const body = await readBody(req);
          if (typeof body.sceneId !== 'string' || !REGEX.sceneId.test(body.sceneId) || (body.event !== 'start' && body.event !== 'end')) return error(res, 400, 'position needs sceneId and event start|end');
          ingest.reportPosition(lesson, { sceneId: body.sceneId, event: body.event, t: typeof body.t === 'number' ? body.t : undefined });
          res.writeHead(204); return res.end();
        }
        case 'question': {
          if (method !== 'POST') return error(res, 405, 'method not allowed');
          if (!lesson) return error(res, 404, 'unknown lesson');
          const body = await readBody(req);
          const text = typeof body.text === 'string' ? body.text.trim() : '';
          if (text.length < 1 || text.length > 500) return error(res, 400, 'text must be 1–500 characters');
          if (body.atSceneId !== undefined && body.atSceneId !== null && !(typeof body.atSceneId === 'string' && REGEX.sceneId.test(body.atSceneId))) return error(res, 400, 'bad atSceneId');
          const q = ingest.addQuestion(lesson, { text, atSceneId: body.atSceneId ?? null, atTime: typeof body.atTime === 'number' ? body.atTime : null });
          return json(res, 200, { qId: q.qId });
        }
        case 'wait': {
          if (method !== 'GET') return error(res, 405, 'method not allowed');
          const target = lesson || store.ensure(lessonId);
          const timeout = Math.min(600, Math.max(0, Number(url.searchParams.get('timeout') ?? 30) || 0));
          const ev = await wait.wait(target, timeout);
          return json(res, 200, ev);
        }
        default:
          return error(res, 404, 'not found');
      }
    } catch (e) {
      log('http error', e);
      if (!res.headersSent) return error(res, e && /body/.test(e.message) ? 400 : 500, e && e.message ? e.message : 'error');
      try { res.end(); } catch { /* ignore */ }
      return undefined;
    }
  };
}
