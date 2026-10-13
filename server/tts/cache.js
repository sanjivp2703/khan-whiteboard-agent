// server/tts/cache.js — audio cache keyed by sha256(provider|voice|model|sha256(instructions)|text).
// <dir>/<key>.<ext> holds the bytes; <dir>/<key>.json holds {durationMs, mime, ext, provider, voice, model, instructionsHash}.
// A hit never calls synthesize; rewinds, replays and voice switches re-use what exists. Changing the
// voice, the model or the delivery instructions changes the key, so each re-voices on the next
// ingest; files written under an older key format simply go unused (harmless, delete at will).
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Hash of the instructions text, '' when there are none (null/undefined/empty). */
export function instructionsHash(instructions) {
  return typeof instructions === 'string' && instructions.length ? sha256(instructions) : '';
}

/**
 * @param {string} provider
 * @param {string|null} voice
 * @param {string} text
 * @param {string|null} [model]        provider.model (silent has none)
 * @param {string|null} [instructions] provider.instructions (the text actually sent, or null)
 */
export function cacheKey(provider, voice, text, model = null, instructions = null) {
  return sha256(`${provider}|${voice ?? ''}|${model ?? ''}|${instructionsHash(instructions)}|${text}`);
}

/** The key the cache uses for this provider and text. */
export function cacheKeyFor(provider, text) {
  return cacheKey(provider.name, provider.voice, text, provider.model ?? null, provider.instructions ?? null);
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

  async function store(key, { bytes, mime, ext, durationMs, provider, voice, model, instructions }) {
    await ensureDir();
    const path = join(dir, `${key}.${ext}`);
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, path);
    const meta = { durationMs, mime, ext, provider, voice: voice ?? null, model: model ?? null, instructionsHash: instructionsHash(instructions) || null };
    const metaTmp = join(dir, `${key}.json.tmp`);
    await fs.writeFile(metaTmp, JSON.stringify(meta));
    await fs.rename(metaTmp, join(dir, `${key}.json`));
    return { key, path, ...meta, cached: false };
  }

  /** Resolve from the cache or synthesize once (concurrent identical requests share one call). */
  async function getOrSynthesize(provider, text) {
    const key = cacheKeyFor(provider, text);
    const hit = await lookup(key);
    if (hit) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const out = await provider.synthesize({ text });
        return await store(key, { ...out, provider: provider.name, voice: provider.voice, model: provider.model ?? null, instructions: provider.instructions ?? null });
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { dir, cacheKey, cacheKeyFor, lookup, store, getOrSynthesize };
}
