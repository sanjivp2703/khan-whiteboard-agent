// server/tts/openai.js — the one user-facing TTS provider (brief 01): OpenAI speech synthesis behind
// the foundation's provider interface (server/tts/index.js, brief 00 C3).
//
//   createOpenAIProvider({ apiKey, voice, env, config, ...testKnobs }) → provider
//   provider = { name: 'openai', voice, model, ready() → {ok, reason}, synthesize({text}) → {bytes, mime, ext, durationMs} }
//
// The foundation's selectProvider calls this with { apiKey, voice, env } where `voice` is already
// resolved (KHAN_TTS_VOICE > .khan/config.json tts.voice > null). A null voice means DEFAULT_VOICE
// here, and the provider exposes the voice it will actually send, so the cache key
// sha256(provider|voice|text) always carries the real voice.
//
// Key hygiene: the key is read from env.OPENAI_API_KEY (falling back to the apiKey argument) at
// call time, inside a closure; it is never a property of the provider object, never logged, and
// never part of any error message.
import { mp3DurationMs, Mp3Error } from './mp3-duration.js';

export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
export const DEFAULT_VOICE = 'alloy';
export const DEFAULT_MODEL = 'tts-1';
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [1000, 3000];
export const TIMEOUT_MS = 20000;
export const NO_KEY_REASON = 'OPENAI_API_KEY not set';

/** Voice precedence: KHAN_TTS_VOICE > config.tts.voice > DEFAULT_VOICE (same order as the foundation). */
export function resolveVoice(env = {}, config = {}) {
  if (env && typeof env.KHAN_TTS_VOICE === 'string' && env.KHAN_TTS_VOICE.trim()) return env.KHAN_TTS_VOICE.trim();
  if (config && config.tts && typeof config.tts.voice === 'string' && config.tts.voice.trim()) return config.tts.voice.trim();
  return DEFAULT_VOICE;
}

/** Model precedence: KHAN_TTS_MODEL > config.tts.model > DEFAULT_MODEL. */
export function resolveModel(env = {}, config = {}) {
  if (env && typeof env.KHAN_TTS_MODEL === 'string' && env.KHAN_TTS_MODEL.trim()) return env.KHAN_TTS_MODEL.trim();
  if (config && config.tts && typeof config.tts.model === 'string' && config.tts.model.trim()) return config.tts.model.trim();
  return DEFAULT_MODEL;
}

function numberList(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const xs = s.split(',').map((x) => Number(x.trim()));
  return xs.every((x) => Number.isFinite(x) && x >= 0) ? xs : null;
}

function ttsError(code, message, { cause, status, attempts } = {}) {
  const e = new Error(message);
  e.code = code;
  if (cause !== undefined) e.cause = cause;
  if (status !== undefined) e.status = status;
  if (attempts !== undefined) e.attempts = attempts;
  return e;
}

const isRetryableStatus = (s) => s === 408 || s === 429 || (s >= 500 && s <= 599);

/** Remove the API key (and anything that looks like one) from text the server sent back. */
export function redactKey(text, key) {
  let s = String(text ?? '');
  if (key) s = s.split(key).join('[redacted]');
  return s.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

async function readErrorMessage(res, key) {
  try {
    const text = (await res.text()).slice(0, 600);
    let msg = text;
    try {
      const j = JSON.parse(text);
      if (j && j.error && typeof j.error.message === 'string') msg = j.error.message;
    } catch { /* not JSON */ }
    return redactKey(msg, key).replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

/**
 * @param {object} o
 * @param {string} [o.apiKey]          fallback key when env.OPENAI_API_KEY is absent (the foundation passes env too)
 * @param {string|null} [o.voice]      resolved voice; null → resolveVoice(env, config)
 * @param {object} [o.env]             process.env by default
 * @param {object} [o.config]          .khan/config.json contents
 * @param {string} [o.model]
 * @param {function} [o.fetch]         fetch implementation; default = globalThis.fetch looked up per call (tests swap it)
 * @param {number[]} [o.backoffMs]     delays between attempts (default [1000, 3000]; env KHAN_TTS_BACKOFF_MS="a,b")
 * @param {number} [o.timeoutMs]       per-attempt timeout (default 20000; env KHAN_TTS_TIMEOUT_MS)
 * @param {number} [o.maxAttempts]
 * @param {function} [o.log]           log(line: string); default: console.error when env.KHAN_TTS_LOG is set, else silent
 * @param {function} [o.sleep]
 */
export function createOpenAIProvider({
  apiKey,
  voice = null,
  env = process.env,
  config = {},
  model,
  fetch: fetchImpl,
  backoffMs,
  timeoutMs,
  maxAttempts = MAX_ATTEMPTS,
  log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const safeEnv = env && typeof env === 'object' ? env : {};
  const resolvedVoice = typeof voice === 'string' && voice.trim() ? voice.trim() : resolveVoice(safeEnv, config);
  const resolvedModel = typeof model === 'string' && model.trim() ? model.trim() : resolveModel(safeEnv, config);
  const delays = backoffMs || numberList(safeEnv.KHAN_TTS_BACKOFF_MS) || BACKOFF_MS;
  const perAttemptTimeout = Number.isFinite(timeoutMs) ? timeoutMs : (Number(safeEnv.KHAN_TTS_TIMEOUT_MS) > 0 ? Number(safeEnv.KHAN_TTS_TIMEOUT_MS) : TIMEOUT_MS);
  const attemptsMax = Math.max(1, Number(maxAttempts) || MAX_ATTEMPTS);
  const logLine = typeof log === 'function'
    ? log
    : (safeEnv.KHAN_TTS_LOG ? (line) => console.error(`[khan tts] ${line}`) : () => {});

  // closure-held; never a property of the returned object
  const getKey = () => {
    const k = safeEnv.OPENAI_API_KEY;
    if (typeof k === 'string' && k.trim()) return k.trim();
    if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();
    return null;
  };
  const getFetch = () => fetchImpl || globalThis.fetch;

  function ready() {
    try {
      if (!getKey()) return { ok: false, reason: NO_KEY_REASON };
      if (typeof getFetch() !== 'function') return { ok: false, reason: 'fetch is not available (Node >= 20 required)' };
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: NO_KEY_REASON };
    }
  }

  async function attempt(text, key, n) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttemptTimeout);
    try {
      let res;
      try {
        res = await getFetch()(OPENAI_SPEECH_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ model: resolvedModel, voice: resolvedVoice, input: text, response_format: 'mp3' }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw ttsError('TTS_TIMEOUT', `attempt ${n}: timed out after ${perAttemptTimeout} ms`, { cause: e });
        throw ttsError('TTS_NETWORK', `attempt ${n}: network error: ${e && e.message ? e.message : String(e)}`, { cause: e });
      }
      const status = res.status;
      if (status === 401 || status === 403) {
        const msg = await readErrorMessage(res, key);
        throw ttsError('TTS_AUTH', `OpenAI rejected the API key (HTTP ${status})${msg ? `: ${msg}` : ''}`, { status, attempts: n });
      }
      if (isRetryableStatus(status)) {
        const msg = await readErrorMessage(res, key);
        throw ttsError('TTS_RETRYABLE', `attempt ${n}: HTTP ${status}${msg ? `: ${msg}` : ''}`, { status });
      }
      if (status < 200 || status >= 300) {
        const msg = await readErrorMessage(res, key);
        throw ttsError('TTS_BAD_REQUEST', `OpenAI rejected the request (HTTP ${status})${msg ? `: ${msg}` : ''}`, { status, attempts: n });
      }
      const contentType = String(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') || '' : '').toLowerCase();
      if (contentType && !/^(audio\/|application\/octet-stream)/.test(contentType)) {
        throw ttsError('TTS_BAD_RESPONSE', `unexpected content-type "${contentType.slice(0, 60)}"`, { status, attempts: n });
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0) throw ttsError('TTS_BAD_RESPONSE', 'empty audio body', { status, attempts: n });
      let durationMs;
      try {
        durationMs = mp3DurationMs(bytes);
      } catch (e) {
        if (e instanceof Mp3Error) throw ttsError('TTS_BAD_RESPONSE', `response is not a decodable MP3: ${e.message}`, { cause: e, status, attempts: n });
        throw e;
      }
      return { bytes, durationMs };
    } finally {
      clearTimeout(timer);
    }
  }

  async function synthesize({ text } = {}) {
    const r = ready();
    if (!r.ok) throw ttsError('TTS_FAILED', r.reason, { attempts: 0 });
    if (typeof text !== 'string' || !text.trim()) throw ttsError('TTS_BAD_REQUEST', 'synthesize: text must be a non-empty string', { attempts: 0 });
    const key = getKey();
    let last = null;
    for (let n = 1; n <= attemptsMax; n++) {
      try {
        const { bytes, durationMs } = await attempt(text, key, n);
        logLine(`provider=openai voice=${resolvedVoice} model=${resolvedModel} chars=${text.length} durationMs=${Math.round(durationMs)} bytes=${bytes.length} attempts=${n}`);
        return { bytes, mime: 'audio/mpeg', ext: 'mp3', durationMs };
      } catch (e) {
        last = e;
        const retryable = e && (e.code === 'TTS_RETRYABLE' || e.code === 'TTS_NETWORK' || e.code === 'TTS_TIMEOUT');
        if (!retryable) {
          // fail fast: auth / bad request / undecodable response
          logLine(`provider=openai voice=${resolvedVoice} model=${resolvedModel} chars=${text.length} failed code=${e.code} attempts=${n}`);
          e.attempts = n;
          throw e;
        }
        logLine(`provider=openai voice=${resolvedVoice} chars=${text.length} attempt=${n}/${attemptsMax} retryable failure: ${e.message}`);
        if (n < attemptsMax) await sleep(delays[Math.min(n - 1, delays.length - 1)] ?? 0);
      }
    }
    const failed = ttsError('TTS_FAILED', `openai tts failed after ${attemptsMax} attempts: ${last && last.message ? last.message : 'unknown error'}`, { cause: last, attempts: attemptsMax });
    if (last && last.status !== undefined) failed.status = last.status;
    logLine(`provider=openai voice=${resolvedVoice} model=${resolvedModel} chars=${text.length} failed code=TTS_FAILED attempts=${attemptsMax}`);
    throw failed;
  }

  return {
    name: 'openai',
    voice: resolvedVoice,
    model: resolvedModel,
    ready,
    synthesize,
  };
}
