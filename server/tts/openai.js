// server/tts/openai.js — the one user-facing TTS provider (brief 01): OpenAI speech synthesis behind
// the foundation's provider interface (server/tts/index.js, brief 00 C3).
//
//   createOpenAIProvider({ apiKey, voice, env, config, ...testKnobs }) → provider
//   provider = { name: 'openai', voice, model, instructions, ready() → {ok, reason}, synthesize({text}) → {bytes, mime, ext, durationMs} }
//
// The foundation's selectProvider calls this with { apiKey, voice, env, config } where `voice` is
// already resolved (KHAN_TTS_VOICE > .khan/config.json tts.voice > null). A null voice means
// DEFAULT_VOICE here, and the provider exposes the voice, model and instructions it will actually
// send, so the cache key sha256(provider|voice|model|hash(instructions)|text) always carries the
// real values (server/tts/cache.js).
//
// Delivery style (design cycle 1, decisions.md "Approved 2026-10-12"): the default model is
// gpt-4o-mini-tts because it accepts a free-text `instructions` field that steers tone, pacing and
// emphasis. Per the OpenAI API reference for POST /v1/audio/speech
// (https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create,
// checked 2026-10-12): "Control the voice of your generated audio with additional instructions.
// Does not work with `tts-1` or `tts-1-hd`." So `instructions` is sent only for models other than
// those two; with tts-1 / tts-1-hd the field is omitted and `provider.instructions` is null.
//
// Key hygiene: the key is read from env.OPENAI_API_KEY (falling back to the apiKey argument) at
// call time, inside a closure; it is never a property of the provider object, never logged, and
// never part of any error message.
import { mp3DurationMs, Mp3Error } from './mp3-duration.js';

export const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
export const DEFAULT_VOICE = 'ash';
export const DEFAULT_MODEL = 'gpt-4o-mini-tts';
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [1000, 3000];
/**
 * Per-attempt timeout (backlog #25, 2026-10-13). The response is one non-streamed MP3 body and
 * gpt-4o-mini-tts produces it in roughly real time or slower: in two real lessons every 80–90-word
 * scene (≈ 35–40 s of audio) was aborted by the old 20 s limit, which had been tuned for tts-1,
 * while 20–50-word scenes got through. The schema caps narration at 90 words ≈ 40 s of audio, so
 * 90 s is a little over twice the longest audio the server will ever ask for, with room for queueing
 * on OpenAI's side. `KHAN_TTS_TIMEOUT_MS` overrides it. Follow-up (not done here): the speech
 * endpoint can stream the body (`stream_format`), which would let the first bytes mark progress and
 * allow a much tighter "nothing arrived" timeout instead of one that has to cover the whole body.
 */
export const TIMEOUT_MS = 90000;
/**
 * How many of the attempts may end in a timeout before giving up. A timed-out attempt already cost
 * TIMEOUT_MS, so with MAX_ATTEMPTS timeouts the worst case would be 3 × 90 s + backoff ≈ 4.6 min
 * for one scene; two timeouts (≈ 3 min) is enough to tell a hiccup from a stuck model. Fast failures
 * (network errors, 408/429/5xx) keep all MAX_ATTEMPTS.
 */
export const MAX_TIMEOUT_ATTEMPTS = 2;
export const NO_KEY_REASON = 'OPENAI_API_KEY not set';

/**
 * Built-in delivery description (design/01-khan-look-research.md §6 and Khan Academy's own creator
 * guidance: "sound like a friend or an older cousin explaining a concept to one student", "it will
 * be best if it doesn't sound like you're reading", "emotionless is bad", a "tightrope walk between
 * cheerful and cloying"). Describes a manner of speaking, not any person's voice.
 * Override: KHAN_TTS_INSTRUCTIONS env > .khan/config.json tts.instructions > this text.
 */
export const DEFAULT_INSTRUCTIONS = [
  'Voice: a warm, friendly tutor explaining something to one person they like, sitting next to them at a kitchen table.',
  'Tone: conversational and unhurried, genuinely curious, thinking out loud as you work through the idea rather than reading from a script.',
  'Pacing: take your time; leave natural short pauses between ideas and just before the key point; slow down slightly on numbers, names and new terms.',
  'Delivery: plain and direct, as if talking to a bright younger cousin; never emotionless or flat, never salesy, never over-enthusiastic or cloying; no announcer polish.',
  'Emphasis: light, on the one word that matters in each sentence.',
].join(' ');

/** Models the API reference lists as NOT accepting `instructions` (URL in the header comment). */
export const INSTRUCTIONS_UNSUPPORTED_MODELS = Object.freeze(['tts-1', 'tts-1-hd']);

export function modelSupportsInstructions(model) {
  return typeof model === 'string' && !INSTRUCTIONS_UNSUPPORTED_MODELS.includes(model.trim());
}

/** Instructions precedence: KHAN_TTS_INSTRUCTIONS > config.tts.instructions > DEFAULT_INSTRUCTIONS. Blank values fall through. */
export function resolveInstructions(env = {}, config = {}) {
  if (env && typeof env.KHAN_TTS_INSTRUCTIONS === 'string' && env.KHAN_TTS_INSTRUCTIONS.trim()) return env.KHAN_TTS_INSTRUCTIONS.trim();
  if (config && config.tts && typeof config.tts.instructions === 'string' && config.tts.instructions.trim()) return config.tts.instructions.trim();
  return DEFAULT_INSTRUCTIONS;
}

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
 * @param {string} [o.model]           explicit model; default resolveModel(env, config)
 * @param {string} [o.instructions]    explicit delivery instructions; default resolveInstructions(env, config). Sent only when the model supports them.
 * @param {function} [o.fetch]         fetch implementation; default = globalThis.fetch looked up per call (tests swap it)
 * @param {number[]} [o.backoffMs]     delays between attempts (default [1000, 3000]; env KHAN_TTS_BACKOFF_MS="a,b")
 * @param {number} [o.timeoutMs]       per-attempt timeout (default TIMEOUT_MS = 90000; env KHAN_TTS_TIMEOUT_MS)
 * @param {number} [o.maxAttempts]     attempts in total (default 3)
 * @param {number} [o.maxTimeoutAttempts] attempts that may end in a timeout before giving up (default 2)
 * @param {function} [o.log]           log(line: string); default: console.error when env.KHAN_TTS_LOG is set, else silent
 * @param {function} [o.sleep]
 */
export function createOpenAIProvider({
  apiKey,
  voice = null,
  env = process.env,
  config = {},
  model,
  instructions,
  fetch: fetchImpl,
  backoffMs,
  timeoutMs,
  maxAttempts = MAX_ATTEMPTS,
  maxTimeoutAttempts = MAX_TIMEOUT_ATTEMPTS,
  log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const safeEnv = env && typeof env === 'object' ? env : {};
  const resolvedVoice = typeof voice === 'string' && voice.trim() ? voice.trim() : resolveVoice(safeEnv, config);
  const resolvedModel = typeof model === 'string' && model.trim() ? model.trim() : resolveModel(safeEnv, config);
  const wantedInstructions = typeof instructions === 'string' && instructions.trim() ? instructions.trim() : resolveInstructions(safeEnv, config);
  // null when the model cannot take them: nothing is sent and the cache key does not depend on them
  const resolvedInstructions = modelSupportsInstructions(resolvedModel) ? wantedInstructions : null;
  const delays = backoffMs || numberList(safeEnv.KHAN_TTS_BACKOFF_MS) || BACKOFF_MS;
  const perAttemptTimeout = Number.isFinite(timeoutMs) ? timeoutMs : (Number(safeEnv.KHAN_TTS_TIMEOUT_MS) > 0 ? Number(safeEnv.KHAN_TTS_TIMEOUT_MS) : TIMEOUT_MS);
  const attemptsMax = Math.max(1, Number(maxAttempts) || MAX_ATTEMPTS);
  const timeoutAttemptsMax = Math.max(1, Number(maxTimeoutAttempts) || MAX_TIMEOUT_ATTEMPTS);
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
    // Any failure after our own abort fired is the timeout, whatever shape fetch gives it: during the
    // request it is an AbortError; during the body read (where a slow model actually spends its time)
    // undici rejects with the signal's DOMException "This operation was aborted" (backlog #25).
    const timedOut = (e) => controller.signal.aborted || (e && e.name === 'AbortError');
    const timeoutError = (e) => ttsError('TTS_TIMEOUT', `attempt ${n}: timed out after ${perAttemptTimeout} ms`, { cause: e });
    try {
      let res;
      try {
        res = await getFetch()(OPENAI_SPEECH_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({
            model: resolvedModel,
            voice: resolvedVoice,
            input: text,
            response_format: 'mp3',
            ...(resolvedInstructions !== null ? { instructions: resolvedInstructions } : {}),
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (timedOut(e)) throw timeoutError(e);
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
      let bytes;
      try {
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        if (timedOut(e)) throw timeoutError(e);
        throw ttsError('TTS_NETWORK', `attempt ${n}: body read failed: ${e && e.message ? e.message : String(e)}`, { cause: e });
      }
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
    let timeouts = 0;
    let made = 0;
    for (let n = 1; n <= attemptsMax; n++) {
      made = n;
      try {
        const { bytes, durationMs } = await attempt(text, key, n);
        logLine(`provider=openai voice=${resolvedVoice} model=${resolvedModel} instructions=${resolvedInstructions !== null ? 'sent' : 'omitted'} chars=${text.length} durationMs=${Math.round(durationMs)} bytes=${bytes.length} attempts=${n}`);
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
        if (e.code === 'TTS_TIMEOUT') timeouts++;
        // a timed-out attempt already cost a full TIMEOUT_MS: stop after MAX_TIMEOUT_ATTEMPTS of them
        const more = n < attemptsMax && timeouts < timeoutAttemptsMax;
        logLine(`provider=openai voice=${resolvedVoice} chars=${text.length} attempt=${n}/${attemptsMax} retryable failure: ${e.message}${more ? '' : ' (giving up)'}`);
        if (!more) break;
        await sleep(delays[Math.min(n - 1, delays.length - 1)] ?? 0);
      }
    }
    const failed = ttsError('TTS_FAILED', `openai tts failed after ${made} attempts: ${last && last.message ? last.message : 'unknown error'}`, { cause: last, attempts: made });
    if (last && last.status !== undefined) failed.status = last.status;
    logLine(`provider=openai voice=${resolvedVoice} model=${resolvedModel} chars=${text.length} failed code=TTS_FAILED attempts=${made}`);
    throw failed;
  }

  return {
    name: 'openai',
    voice: resolvedVoice,
    model: resolvedModel,
    instructions: resolvedInstructions, // the text actually sent, or null when the model does not take it
    ready,
    synthesize,
  };
}
