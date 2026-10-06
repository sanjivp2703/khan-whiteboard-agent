// Test helper (slice 01): a recording fetch mock for the OpenAI speech endpoint.
// Calls to other URLs (the in-process khan server in integration tests) pass through to the real fetch.
import { readFileSync } from 'node:fs';
import { OPENAI_SPEECH_URL } from '../../../server/tts/openai.js';

export const FIXTURE_MP3 = new URL('../../../fixtures/audio/short.mp3', import.meta.url).pathname;
export const FIXTURE_MP3_META = JSON.parse(readFileSync(new URL('../../../fixtures/audio/short.json', import.meta.url), 'utf8'));
export const FIXTURE_VBR_MP3 = new URL('../../../fixtures/audio/short-vbr.mp3', import.meta.url).pathname;
export const FIXTURE_VBR_META = JSON.parse(readFileSync(new URL('../../../fixtures/audio/short-vbr.json', import.meta.url), 'utf8'));

export function fixtureBytes() { return new Uint8Array(readFileSync(FIXTURE_MP3)); }

/** A Response-like object (real Response where possible). */
export function audioResponse(bytes = fixtureBytes(), { status = 200, contentType = 'audio/mpeg' } = {}) {
  return new Response(bytes, { status, headers: contentType ? { 'content-type': contentType } : {} });
}

export function errorResponse(status, message = `error ${status}`) {
  return new Response(JSON.stringify({ error: { message, type: 'test' } }), { status, headers: { 'content-type': 'application/json' } });
}

/** Never resolves until aborted; rejects with an AbortError when the signal fires. */
export function hangingResponse(init) {
  return new Promise((_, reject) => {
    const signal = init && init.signal;
    if (signal) {
      if (signal.aborted) reject(abortError());
      else signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }
  });
}

export function abortError() {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

export function networkError(message = 'fetch failed') {
  const e = new TypeError(message);
  e.cause = new Error('ECONNRESET');
  return e;
}

/**
 * Build a recording mock. `script` is a list of responders consumed in order (the last one repeats),
 * each either a Response, a Promise, an Error (thrown), or a function (url, init, call) → any of those.
 * @returns {{fetch: function, calls: Array<{url, init, body, headers}>, reset(script), install(), uninstall()}}
 */
export function createMockFetch(script = []) {
  let queue = [...script];
  const calls = [];
  const real = globalThis.fetch;
  async function mockFetch(url, init = {}) {
    const u = String(url);
    if (u !== OPENAI_SPEECH_URL) {
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)) throw new Error(`unexpected fetch to ${u}`);
      return real(url, init);
    }
    const headers = {};
    const h = init.headers || {};
    for (const [k, v] of (h instanceof Headers ? h.entries() : Object.entries(h))) headers[k.toLowerCase()] = v;
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body; }
    const call = { url: u, init, body, headers, signal: init.signal };
    calls.push(call);
    let responder = queue.length > 1 ? queue.shift() : queue[0];
    if (responder === undefined) throw new Error('mock fetch: no responder scripted');
    if (typeof responder === 'function') responder = responder(u, init, call);
    if (responder instanceof Error) throw responder;
    return responder;
  }
  const api = {
    fetch: mockFetch,
    calls,
    reset(next = []) { queue = [...next]; calls.length = 0; },
    install() { globalThis.fetch = mockFetch; return api; },
    uninstall() { globalThis.fetch = real; },
    get openaiCalls() { return calls.length; },
  };
  return api;
}

/** Capture console.error/log/warn output during fn; returns {result, lines}. */
export async function captureConsole(fn) {
  const lines = [];
  const orig = { error: console.error, log: console.log, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  try {
    const result = await fn(lines);
    return { result, lines };
  } finally {
    Object.assign(console, orig);
  }
}
