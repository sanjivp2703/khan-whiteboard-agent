// server/watcher.js — watches the lessons dir for outline.json and scenes/*.json.
// Polling scan (every intervalMs) is the backbone; fs.watch only triggers an early scan.
// A file is ingested once its size+mtime have been stable for stableMs AND it parses as JSON;
// a file that does not parse is retried until parseGraceMs, then reported as BAD_JSON.
// *.tmp files and names that do not match the id regexes are ignored.
import { promises as fs, watch as fsWatch } from 'node:fs';
import { join } from 'node:path';
import { REGEX } from '../shared/layout-core/constants.js';

export function createWatcher({ lessonsDir, onOutline, onScene, intervalMs = 300, stableMs = 250, parseGraceMs = 10000, log = () => {} }) {
  const seen = new Map(); // path → {size, mtimeMs, changedAt, pending, ingested:{size,mtimeMs}}
  const fsWatchers = new Map();
  let timer = null;
  let scanning = false;
  let stopped = false;
  let kick = null;

  async function listDir(dir) {
    try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  }

  function ensureFsWatch(dir) {
    if (fsWatchers.has(dir)) return;
    try {
      const w = fsWatch(dir, { persistent: false }, () => scheduleSoon());
      w.on('error', () => {});
      fsWatchers.set(dir, w);
    } catch { /* polling covers it */ }
  }

  function scheduleSoon() {
    if (stopped || kick) return;
    kick = setTimeout(() => { kick = null; scan(); }, 50);
  }

  async function consider(path, now, emit) {
    let st;
    try { st = await fs.stat(path); } catch { seen.delete(path); return; }
    const rec = seen.get(path) || { size: -1, mtimeMs: -1, changedAt: now, pending: true, ingested: null };
    if (st.size !== rec.size || st.mtimeMs !== rec.mtimeMs) {
      rec.size = st.size; rec.mtimeMs = st.mtimeMs; rec.changedAt = now; rec.pending = true;
      seen.set(path, rec);
      return;
    }
    seen.set(path, rec);
    if (!rec.pending) return;
    if (now - rec.changedAt < stableMs) return;
    if (rec.ingested && rec.ingested.size === st.size && rec.ingested.mtimeMs === st.mtimeMs) { rec.pending = false; return; }
    let text;
    try { text = await fs.readFile(path, 'utf8'); } catch { return; }
    let json;
    try { json = JSON.parse(text); } catch (e) {
      if (now - rec.changedAt < parseGraceMs) return; // still being written
      rec.pending = false; rec.ingested = { size: st.size, mtimeMs: st.mtimeMs };
      emit(null, `not valid JSON: ${e.message}`);
      return;
    }
    rec.pending = false; rec.ingested = { size: st.size, mtimeMs: st.mtimeMs };
    emit(json, null);
  }

  async function scan() {
    if (scanning || stopped) return;
    scanning = true;
    try {
      const now = Date.now();
      ensureFsWatch(lessonsDir);
      for (const d of await listDir(lessonsDir)) {
        if (!d.isDirectory() || !REGEX.lessonId.test(d.name)) continue;
        const lessonId = d.name;
        const dir = join(lessonsDir, lessonId);
        ensureFsWatch(dir);
        await consider(join(dir, 'outline.json'), now, (json, error) => onOutline(lessonId, json, error));
        const scenesDir = join(dir, 'scenes');
        ensureFsWatch(scenesDir);
        for (const f of await listDir(scenesDir)) {
          if (!f.isFile()) continue;
          const m = /^(s\d{3}|q\d{3}-a\d{2})\.json$/.exec(f.name);
          if (!m) continue; // ignores *.tmp and anything else
          const sceneId = m[1];
          await consider(join(scenesDir, f.name), now, (json, error) => onScene(lessonId, sceneId, json, error));
        }
      }
    } catch (e) {
      log('watcher scan error', e);
    } finally {
      scanning = false;
    }
  }

  function start() {
    stopped = false;
    scan();
    timer = setInterval(scan, intervalMs);
    return api;
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    if (kick) clearTimeout(kick);
    timer = null; kick = null;
    for (const w of fsWatchers.values()) { try { w.close(); } catch { /* ignore */ } }
    fsWatchers.clear();
  }

  const api = { start, stop, scanNow: scan, seen };
  return api;
}
