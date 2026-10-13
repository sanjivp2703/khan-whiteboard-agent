// khan audition [--text "..."] [--voices ash,echo,onyx,cedar] [--out DIR] [--no-play]
//
// Hear the candidate voices before adopting one (design cycle 1, decisions.md "Approved
// 2026-10-12"). Synthesizes one fixed teacher-style paragraph in each requested voice through the
// very same provider code path the server uses (server/tts/openai.js: current model and delivery
// instructions, retries, key hygiene), writes <out>/<voice>.mp3, prints one JSON line listing the
// files, their durations and the exact env var that adopts each voice, then on macOS plays the
// files one after another with `afplay` (spawned with an argv array, never a shell string) unless
// --no-play. A voice the API rejects (e.g. an org-gated one) is reported per voice; the rest go on.
//
// This command talks to OpenAI directly: it needs OPENAI_API_KEY (same ready() path as the server;
// exit 1 with the usual reason otherwise) and ignores KHAN_TTS=silent. No server is involved.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { emit, CliError, EXIT } from '../output.js';
import { khanHome, readConfig } from '../paths.js';
import { createOpenAIProvider } from '../../server/tts/openai.js';

export const DEFAULT_VOICES = Object.freeze(['ash', 'echo', 'onyx', 'cedar']);

/** About forty words of ordinary teaching, read the same way in every voice. Names nobody. */
export const AUDITION_TEXT = 'So let\'s think about what a cache actually does. When a request comes in, we hash it into a short key and look that key up. If it\'s there, we\'re done, we just hand back the stored answer, and notice that we never touched the database.';

const VOICE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** "ash, Echo,,onyx" → ['ash', 'echo', 'onyx']; invalid names (they become file names) are a usage error. */
export function parseVoices(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return [...DEFAULT_VOICES];
  const out = [];
  for (const part of String(raw).split(',')) {
    const v = part.trim().toLowerCase();
    if (!v) continue;
    if (!VOICE_RE.test(v)) throw new CliError('USAGE', `--voices: "${part.trim()}" is not a voice name (letters, digits, - and _ only)`);
    if (!out.includes(v)) out.push(v);
  }
  if (!out.length) throw new CliError('USAGE', '--voices: give at least one voice name, e.g. --voices ash,echo');
  return out;
}

/** --out DIR > <KHAN_HOME>/audition */
export function auditionDir(env = process.env, flags = {}) {
  return flags.out ? resolve(String(flags.out)) : join(khanHome(env), 'audition');
}

/** Where the instructions actually came from, for the JSON line (never the text itself). */
export function instructionsSource(env = {}, config = {}) {
  if (typeof env.KHAN_TTS_INSTRUCTIONS === 'string' && env.KHAN_TTS_INSTRUCTIONS.trim()) return 'env:KHAN_TTS_INSTRUCTIONS';
  if (config && config.tts && typeof config.tts.instructions === 'string' && config.tts.instructions.trim()) return 'config:tts.instructions';
  return 'default';
}

/**
 * Play one file to completion. macOS only (`afplay`); elsewhere resolves {played:false} with a note.
 * The player binary is spawned with an argv array so a path can never be interpreted by a shell.
 * @returns {Promise<{played: boolean, note?: string}>}
 */
export function playFile(file, { spawn: spawnImpl = spawn, platform = process.platform } = {}) {
  if (platform !== 'darwin') return Promise.resolve({ played: false, note: 'automatic playback is macOS only (afplay); open the file yourself' });
  return new Promise((resolveP) => {
    let child;
    try {
      child = spawnImpl('afplay', [file], { stdio: 'ignore', shell: false });
    } catch (e) {
      resolveP({ played: false, note: `afplay could not start: ${e && e.message ? e.message : String(e)}` });
      return;
    }
    child.on('error', (e) => resolveP({ played: false, note: `afplay could not start: ${e && e.message ? e.message : String(e)}` }));
    child.on('close', (code) => resolveP(code === 0 ? { played: true } : { played: false, note: `afplay exited with code ${code}` }));
  });
}

async function writeAtomic(path, bytes) {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, path);
}

/**
 * @param {object} o
 * @param {object} o.flags           {text, voices, out, 'no-play'}
 * @param {boolean} o.pretty
 * @param {object} [o.env]
 * @param {object} [o.deps]          test seams: fetch (injected into the provider), play(file) → {played, note}, backoffMs, timeoutMs
 */
export async function audition({ flags = {}, pretty = false, env = process.env, deps = {}, stdout } = {}) {
  const config = readConfig(env);
  const providerFor = (voice) => createOpenAIProvider({
    env,
    config,
    voice,
    fetch: deps.fetch,
    backoffMs: deps.backoffMs,
    timeoutMs: deps.timeoutMs,
  });
  const probe = providerFor(null);
  const r = probe.ready();
  if (!r.ok) throw new CliError('TTS_NOT_READY', r.reason, { details: { hint: 'export OPENAI_API_KEY in this shell and run khan audition again' } });

  const voices = parseVoices(flags.voices);
  const text = typeof flags.text === 'string' && flags.text.trim() ? flags.text.trim() : AUDITION_TEXT;
  const out = auditionDir(env, flags);
  await fs.mkdir(out, { recursive: true });
  const noPlay = !!flags['no-play'] || env.KHAN_NO_PLAY === '1';
  const play = typeof deps.play === 'function' ? deps.play : (file) => playFile(file);

  const results = [];
  let authFailed = null;
  for (const voice of voices) {
    const adopt = `KHAN_TTS_VOICE=${voice}`;
    if (authFailed) { results.push({ voice, ok: false, code: authFailed.code, message: 'skipped: the API key was rejected on an earlier voice', adopt }); continue; }
    const provider = providerFor(voice);
    try {
      const o = await provider.synthesize({ text });
      const file = join(out, `${voice}.${o.ext}`);
      await writeAtomic(file, o.bytes);
      results.push({ voice, ok: true, file, durationMs: Math.round(o.durationMs), bytes: o.bytes.length, adopt });
    } catch (e) {
      const code = e && e.code ? e.code : 'TTS_FAILED';
      results.push({ voice, ok: false, code, message: e && e.message ? e.message : String(e), adopt });
      if (code === 'TTS_AUTH') authFailed = { code };
    }
  }

  let played = false;
  if (!noPlay) {
    for (const res of results) {
      if (!res.ok) continue;
      const p = await play(res.file);
      res.played = !!p.played;
      if (p.note) res.playNote = p.note;
      played = played || res.played;
    }
  }

  const okCount = results.filter((x) => x.ok).length;
  const summary = {
    ok: okCount > 0,
    ...(okCount === 0 ? { code: 'AUDITION_FAILED', message: 'no voice could be synthesized; see voices[]' } : {}),
    model: probe.model,
    instructions: { source: instructionsSource(env, config), sent: probe.instructions !== null, chars: probe.instructions ? probe.instructions.length : 0 },
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    out,
    play: noPlay ? 'skipped' : (played ? 'afplay' : 'unavailable'),
    voices: results,
    adopt: 'export KHAN_TTS_VOICE=<voice> in the environment the server starts from (or set tts.voice in .khan/config.json), then restart the server: kill <pid> from "khan serve", then "khan serve" again. KHAN_TTS_INSTRUCTIONS overrides the delivery style the same way.',
  };
  emit(summary, pretty, stdout);
  return okCount > 0 ? EXIT.OK : EXIT.ERROR;
}
