// server/tts/index.js — provider selection and the provider interface (brief 00 C3).
//
// Provider shape: { name, voice, ready() → {ok, reason}, synthesize({text}) → Promise<{bytes, mime, ext, durationMs}> }
//
// Selection: KHAN_TTS=silent → silent (tests/fixtures only). Otherwise `openai`, implemented by
// slice 01 in server/tts/openai.js, which must export
//   createOpenAIProvider({ apiKey, voice, env }) → provider
// and whose ready() returns {ok:false, reason:"OPENAI_API_KEY not set"} without a key. Until that
// file exists, a stub provider with the same ready() semantics is returned so the server still
// starts and reports tts.ready=false with a reason.
import { createSilentProvider } from './silent.js';

export const DEFAULT_VOICE = null; // null = the provider's own default

export function resolveVoice(env = {}, config = {}) {
  if (env.KHAN_TTS_VOICE) return env.KHAN_TTS_VOICE;
  if (config && config.tts && config.tts.voice) return config.tts.voice;
  return DEFAULT_VOICE;
}

function notReadyProvider(name, voice, reason) {
  return {
    name,
    voice,
    ready() { return { ok: false, reason }; },
    async synthesize() { const e = new Error(reason); e.code = 'TTS_FAILED'; throw e; },
  };
}

/** @returns {Promise<object>} provider */
export async function selectProvider(env = process.env, config = {}) {
  if (env.KHAN_TTS === 'silent') return createSilentProvider();
  const voice = resolveVoice(env, config);
  const apiKey = env.OPENAI_API_KEY;
  let mod = null;
  try {
    mod = await import('./openai.js');
  } catch (e) {
    if (!(e && (e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module/.test(String(e.message))))) throw e;
  }
  if (mod && typeof mod.createOpenAIProvider === 'function') return mod.createOpenAIProvider({ apiKey, voice, env });
  if (!apiKey) return notReadyProvider('openai', voice, 'OPENAI_API_KEY not set');
  return notReadyProvider('openai', voice, 'openai provider not installed (server/tts/openai.js missing)');
}

/** Status object carried by playlist/status/inbox. */
export function ttsStatus(provider) {
  const r = provider.ready();
  return { provider: provider.name, voice: provider.voice ?? null, ready: !!r.ok, reason: r.ok ? null : r.reason || 'not ready' };
}
