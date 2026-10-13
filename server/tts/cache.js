// server/tts/cache.js — audio cache keyed by sha256(provider|voice|model|sha256(instructions)|text).
// <dir>/<key>.<ext> holds the bytes; <dir>/<key>.json holds {durationMs, mime, ext, provider, voice, model, instructionsHash}.
// A hit never calls synthesize; rewinds, replays and voice switches re-use what exists. Changing the
// voice, the model or the delivery instructions changes the key, so each re-voices on the next
// ingest; files written under an older key format simply go unused (harmless, delete at will).
//
// Concurrency (backlog #26, 2026-10-13):
// - Identical text in flight at the same time is voiced once per process (a map of pending promises).
// - Every writer uses its own temp name (<key>.<ext>.<pid>.<random>.tmp), so two writers of the same
//   key — two scenes with identical narration whose voicings overlap, or two servers over one cache
//   dir — never rename the same .tmp; a rename that still loses (the final file appeared meanwhile)
//   is treated as the hit it is, never as an error.
// - At most `concurrency` provider calls run at once (default 3): a restart that re-voices several
//   lessons at once queues the rest instead of opening dozens of 30-second requests. Cache hits and
//   shared in-flight requests never wait for a slot.
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Provider calls allowed in flight at once per cache (env KHAN_TTS_CONCURRENCY in server/index.js). */
export const DEFAULT_CONCURRENCY = 3;

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

const exists = (path) => fs.access(path).then(() => true, () => false);

/**
 * Write `data` to `path` through a temp file unique to this writer. If the rename loses to another
 * writer of the same path (same content by construction: the path is the content's hash), the file
 * that won is accepted instead of raising.
 */
async function atomicWrite(path, data) {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    if (await exists(path)) return; // another writer finished first: a hit
    throw e;
  }
}

/**
 * @param {object} o
 * @param {string} o.dir
 * @param {number} [o.concurrency] provider calls allowed at once (default DEFAULT_CONCURRENCY)
 */
export function createTtsCache({ dir, concurrency = DEFAULT_CONCURRENCY }) {
  const inflight = new Map();
  let ensured = false;
  const ensureDir = async () => { if (!ensured) { await fs.mkdir(dir, { recursive: true }); ensured = true; } };

  // a tiny semaphore around provider.synthesize
  const limit = Math.max(1, Math.floor(Number(concurrency)) || DEFAULT_CONCURRENCY);
  let active = 0;
  const waiting = [];
  const acquire = () => new Promise((resolve) => { if (active < limit) { active++; resolve(); } else waiting.push(resolve); });
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

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
    await atomicWrite(path, bytes);
    const meta = { durationMs, mime, ext, provider, voice: voice ?? null, model: model ?? null, instructionsHash: instructionsHash(instructions) || null };
    await atomicWrite(join(dir, `${key}.json`), JSON.stringify(meta));
    return { key, path, ...meta, cached: false };
  }

  /** Resolve from the cache or synthesize once (concurrent identical requests share one call; at most `concurrency` calls run at once). */
  async function getOrSynthesize(provider, text) {
    const key = cacheKeyFor(provider, text);
    const hit = await lookup(key);
    if (hit) return hit;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        await acquire();
        let out;
        try {
          out = await provider.synthesize({ text });
        } finally {
          release();
        }
        return await store(key, { ...out, provider: provider.name, voice: provider.voice, model: provider.model ?? null, instructions: provider.instructions ?? null });
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return { dir, concurrency: limit, cacheKey, cacheKeyFor, lookup, store, getOrSynthesize };
}
