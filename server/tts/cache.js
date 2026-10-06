// server/tts/cache.js — audio cache keyed by sha256(provider|voice|text).
// <dir>/<key>.<ext> holds the bytes; <dir>/<key>.json holds {durationMs, mime, ext, provider, voice}.
// A hit never calls synthesize; rewinds, replays and voice switches re-use what exists.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export function cacheKey(provider, voice, text) {
  return createHash('sha256').update(`${provider}|${voice ?? ''}|${text}`).digest('hex');
}

export function createTtsCache({ dir }) {
  const inflight = new Map();
  let ensured = false;
  const ensureDir = async () => { if (!ensured) { await fs.mkdir(dir, { recursive: true }); ensured = true; } };

  async function lookup(key) {
    try {
      const meta = JSON.parse(await fs.readFile(join(dir, `${key}.json`), 'utf8'));
      const path = join(dir, `${key}.${meta.ext}`);
      await fs.access(path);
      return { key, path, ...meta, cached: true };
    } catch {
      return null;
    }
  }

  async function store(key, { bytes, mime, ext, durationMs, provider, voice }) {
    await ensureDir();
    const path = join(dir, `${key}.${ext}`);
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, path);
    const meta = { durationMs, mime, ext, provider, voice: voice ?? null };
    const metaTmp = join(dir, `${key}.json.tmp`);
    await fs.writeFile(metaTmp, JSON.stringify(meta));
    await fs.rename(metaTmp, join(dir, `${key}.json`));
    return { key, path, ...meta, cached: false };
  }

  /** Resolve from the cache or synthesize once (concurrent identical requests share one call). */
  async function getOrSynthesize(provider, text) {
    const key = cacheKey(provider.name, provider.voice, text);
    const hit = await lookup(key);
    if (hit) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const out = await provider.synthesize({ text });
        return await store(key, { ...out, provider: provider.name, voice: provider.voice });
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { dir, cacheKey, lookup, store, getOrSynthesize };
}
