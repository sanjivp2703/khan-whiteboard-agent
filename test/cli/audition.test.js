// khan audition (design cycle 1): argument parsing, file naming, per-voice failure handling, the
// no-play path, playback argv hygiene, and help. No network and no key: the OpenAI endpoint is a
// recording fetch mock injected through main()'s `deps` seam; the no-key path runs the real binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgv, helpText, UsageError } from '../../cli/args.js';
import { main } from '../../cli/main.js';
import { audition, parseVoices, auditionDir, playFile, instructionsSource, AUDITION_TEXT, DEFAULT_VOICES } from '../../cli/commands/audition.js';
import { CliError } from '../../cli/output.js';
import { DEFAULT_MODEL, DEFAULT_INSTRUCTIONS, NO_KEY_REASON } from '../../server/tts/openai.js';
import { createMockFetch, audioResponse, errorResponse, fixtureBytes, FIXTURE_MP3_META } from '../tts/helpers/mock-fetch.js';
import { makeHome, runKhan } from './helpers.js';

const KEY = 'sk-test-SENTINEL-123';

/** Run main() in-process with a captured stdout. */
async function run(argv, { env, deps }) {
  let out = '';
  const stdout = { write: (s) => { out += s; } };
  const code = await main(argv, { env, stdout, deps });
  const lines = out.split('\n').filter(Boolean);
  let json = null;
  try { json = lines.length ? JSON.parse(lines[0]) : null; } catch { try { json = JSON.parse(out); } catch { json = null; } } // --pretty spans lines
  return { code, out, lines, json };
}

test('parseArgv: audition takes --text, --voices, --out, --no-play, no positionals; parseVoices normalizes and refuses junk', () => {
  const p = parseArgv(['audition', '--text', 'Hello there.', '--voices', 'ash,echo', '--out', '/tmp/x', '--no-play']);
  assert.equal(p.command, 'audition');
  assert.deepEqual(p.positionals, []);
  assert.deepEqual(p.flags, { text: 'Hello there.', voices: 'ash,echo', out: '/tmp/x', 'no-play': true });
  assert.deepEqual(parseArgv(['audition']).flags, {});
  assert.deepEqual(parseArgv(['audition', '--voices=onyx']).flags, { voices: 'onyx' });
  assert.equal(parseArgv(['--pretty', 'audition']).pretty, true);
  assert.throws(() => parseArgv(['audition', 'extra']), (e) => e instanceof UsageError && /usage: khan audition/.test(e.message));
  assert.throws(() => parseArgv(['audition', '--no-play=1']), (e) => e instanceof UsageError);
  assert.throws(() => parseArgv(['audition', '--voices']), (e) => e instanceof UsageError && /needs a value/.test(e.message));
  assert.throws(() => parseArgv(['audition', '--lessons-dir', 'x']), (e) => e instanceof UsageError && /unknown flag/.test(e.message));

  assert.deepEqual(parseVoices(undefined), ['ash', 'echo', 'onyx', 'cedar']);
  assert.deepEqual([...DEFAULT_VOICES], ['ash', 'echo', 'onyx', 'cedar']);
  assert.deepEqual(parseVoices(''), ['ash', 'echo', 'onyx', 'cedar']);
  assert.deepEqual(parseVoices(' ash, Echo,,onyx ,ash'), ['ash', 'echo', 'onyx'], 'trimmed, lower-cased, de-duplicated');
  assert.deepEqual(parseVoices('cedar'), ['cedar']);
  for (const bad of ['../etc', 'a b', 'ash;rm', '-x', 'ash,', ',']) {
    if (bad === 'ash,') { assert.deepEqual(parseVoices(bad), ['ash']); continue; }
    assert.throws(() => parseVoices(bad), (e) => e instanceof CliError && e.code === 'USAGE', `parseVoices(${JSON.stringify(bad)})`);
  }
  // the fixed paragraph: about forty words, no real person named
  const words = AUDITION_TEXT.split(/\s+/).length;
  assert.ok(words >= 30 && words <= 50, `${words} words`);
  assert.doesNotMatch(AUDITION_TEXT, /\bkhan\b|\bsal\b/i);
  // default out dir under KHAN_HOME, --out wins
  assert.equal(auditionDir({ KHAN_HOME: '/h' }, {}), '/h/audition');
  assert.equal(auditionDir({ KHAN_HOME: '/h' }, { out: '/elsewhere' }), '/elsewhere');
  assert.equal(instructionsSource({}, {}), 'default');
  assert.equal(instructionsSource({}, { tts: { instructions: 'x' } }), 'config:tts.instructions');
  assert.equal(instructionsSource({ KHAN_TTS_INSTRUCTIONS: 'y' }, { tts: { instructions: 'x' } }), 'env:KHAN_TTS_INSTRUCTIONS');
});

test('help documents audition: top-level list, per-command usage with every flag and the adoption env var', async () => {
  assert.match(helpText(), /^  audition\s+hear the candidate voices/m);
  const h = helpText('audition');
  assert.match(h, /khan audition \[--text "\.\.\."\] \[--voices ash,echo,onyx,cedar\] \[--out DIR\] \[--no-play\]/);
  for (const f of ['--text', '--voices', '--out', '--no-play', '--pretty']) assert.ok(h.includes(f), `help lacks ${f}`);
  assert.match(h, /KHAN_TTS_VOICE=<voice>/);
  assert.match(h, /OPENAI_API_KEY/);
  const home = makeHome();
  try {
    const sub = await runKhan(['audition', '--help'], { env: home.env });
    assert.equal(sub.code, 0);
    assert.match(sub.stdout, /khan audition \[--text/);
    assert.match(sub.stdout, /--no-play/);
    const top = await runKhan(['--help'], { env: home.env });
    assert.match(top.stdout, /^  audition\b/m);
  } finally {
    home.cleanup();
  }
});

test('no key: exit 1 with the usual reason, no network, no files (same ready() path as the server)', async () => {
  const home = makeHome(); // KHAN_TTS=silent in this env is deliberately ignored: audition always means the real provider
  try {
    assert.equal(home.env.OPENAI_API_KEY, undefined);
    const r = await runKhan(['audition', '--no-play'], { env: home.env });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(r.lines.length, 1, 'one JSON line');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 'TTS_NOT_READY');
    assert.equal(r.json.message, NO_KEY_REASON);
    assert.equal(existsSync(join(home.home, 'audition')), false, 'nothing written');
    // in-process too, with a fetch that must never be called
    const mock = createMockFetch([() => { throw new Error('must not be called'); }]);
    const r2 = await run(['audition'], { env: { ...home.env }, deps: { fetch: mock.fetch } });
    assert.equal(r2.code, 1);
    assert.equal(r2.json.code, 'TTS_NOT_READY');
    assert.equal(mock.calls.length, 0);
  } finally {
    home.cleanup();
  }
});

test('mocked API: one request per voice with the current model + instructions; <out>/<voice>.mp3 per success; a rejected voice is reported and the rest continue; files play in order', async () => {
  const home = makeHome();
  try {
    const env = { ...home.env, OPENAI_API_KEY: KEY, KHAN_TTS_BACKOFF_MS: '0,0', KHAN_TTS_TIMEOUT_MS: '2000' };
    const mock = createMockFetch([(_u, _i, call) => (call.body.voice === 'cedar' ? errorResponse(400, 'Voice cedar is not available for your organization') : audioResponse())]);
    const playedFiles = [];
    const play = async (file) => { playedFiles.push(file); return { played: true }; };
    const r = await run(['audition'], { env, deps: { fetch: mock.fetch, play } });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.lines.length, 1, 'exactly one JSON line');
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.model, DEFAULT_MODEL);
    assert.deepEqual(j.instructions, { source: 'default', sent: true, chars: DEFAULT_INSTRUCTIONS.length });
    assert.ok(!r.out.includes(DEFAULT_INSTRUCTIONS.slice(0, 40)), 'the JSON line does not dump the instruction text');
    assert.ok(!r.out.includes(KEY), 'never the key');
    assert.equal(j.text, AUDITION_TEXT);
    assert.equal(j.out, join(home.home, 'audition'), 'default out dir is <KHAN_HOME>/audition');
    assert.equal(j.play, 'afplay');
    assert.equal(mock.calls.length, 4, 'one request per voice');
    assert.deepEqual(mock.calls.map((c) => c.body.voice), ['ash', 'echo', 'onyx', 'cedar']);
    for (const c of mock.calls) {
      assert.equal(c.body.model, DEFAULT_MODEL);
      assert.equal(c.body.instructions, DEFAULT_INSTRUCTIONS, 'the same instructions the server would send');
      assert.equal(c.body.input, AUDITION_TEXT);
      assert.equal(c.body.response_format, 'mp3');
      assert.equal(c.headers.authorization, `Bearer ${KEY}`);
    }
    assert.deepEqual(j.voices.map((v) => v.voice), ['ash', 'echo', 'onyx', 'cedar']);
    for (const v of j.voices.slice(0, 3)) {
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.equal(v.file, join(home.home, 'audition', `${v.voice}.mp3`));
      assert.ok(existsSync(v.file), `${v.file} exists`);
      assert.equal(readFileSync(v.file).length, fixtureBytes().length);
      assert.equal(v.bytes, FIXTURE_MP3_META.bytes);
      assert.ok(Math.abs(v.durationMs - FIXTURE_MP3_META.durationMs) <= 50, `durationMs ${v.durationMs}`);
      assert.equal(v.adopt, `KHAN_TTS_VOICE=${v.voice}`);
      assert.equal(v.played, true);
    }
    const cedar = j.voices[3];
    assert.equal(cedar.ok, false);
    assert.equal(cedar.code, 'TTS_BAD_REQUEST');
    assert.match(cedar.message, /not available for your organization/);
    assert.equal(cedar.adopt, 'KHAN_TTS_VOICE=cedar');
    assert.equal(cedar.file, undefined);
    assert.equal(cedar.played, undefined, 'a failed voice is not played');
    assert.deepEqual(readdirSync(join(home.home, 'audition')).sort(), ['ash.mp3', 'echo.mp3', 'onyx.mp3'], 'no cedar file, no .tmp left behind');
    assert.deepEqual(playedFiles, j.voices.slice(0, 3).map((v) => v.file), 'played in order, successes only');
    assert.match(j.adopt, /KHAN_TTS_VOICE=<voice>/);
    assert.match(j.adopt, /KHAN_TTS_INSTRUCTIONS/);
  } finally {
    home.cleanup();
  }
});

test('--voices, --text, --out and --no-play: custom list and text reach the API, files land in --out, nothing is played; --pretty indents', async () => {
  const home = makeHome();
  const out = mkdtempSync(join(tmpdir(), 'khan-audition-out-'));
  try {
    const env = { ...home.env, OPENAI_API_KEY: KEY, KHAN_TTS_BACKOFF_MS: '0,0', KHAN_TTS_TIMEOUT_MS: '2000' };
    const mock = createMockFetch([() => audioResponse()]);
    const play = async () => { throw new Error('play must not be called with --no-play'); };
    const r = await run(['--pretty', 'audition', '--voices', 'Onyx, ash', '--text', '  A short custom line to read.  ', '--out', out, '--no-play'], { env, deps: { fetch: mock.fetch, play } });
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.split('\n').length > 5, 'pretty output is indented');
    const j = JSON.parse(r.out);
    assert.equal(j.ok, true);
    assert.equal(j.play, 'skipped');
    assert.equal(j.out, out);
    assert.equal(j.text, 'A short custom line to read.');
    assert.equal(j.words, 6);
    assert.deepEqual(mock.calls.map((c) => c.body.voice), ['onyx', 'ash']);
    assert.deepEqual(mock.calls.map((c) => c.body.input), ['A short custom line to read.', 'A short custom line to read.']);
    assert.deepEqual(j.voices.map((v) => [v.voice, v.ok, v.file, v.played]), [['onyx', true, join(out, 'onyx.mp3'), undefined], ['ash', true, join(out, 'ash.mp3'), undefined]]);
    assert.deepEqual(readdirSync(out).sort(), ['ash.mp3', 'onyx.mp3']);
    // KHAN_NO_PLAY=1 is the env form of --no-play
    const r2 = await run(['audition', '--voices', 'echo', '--out', out], { env: { ...env, KHAN_NO_PLAY: '1' }, deps: { fetch: mock.fetch, play } });
    assert.equal(r2.code, 0);
    assert.equal(r2.json.play, 'skipped');
    // env overrides reach the audition request exactly as they would the server
    const r3 = await run(['audition', '--voices', 'echo', '--out', out, '--no-play'], { env: { ...env, KHAN_TTS_INSTRUCTIONS: 'Brisk and dry.', KHAN_TTS_MODEL: 'tts-1' }, deps: { fetch: mock.fetch } });
    assert.equal(r3.code, 0);
    assert.equal(r3.json.model, 'tts-1');
    assert.deepEqual(r3.json.instructions, { source: 'env:KHAN_TTS_INSTRUCTIONS', sent: false, chars: 0 }, 'tts-1 cannot take instructions, so none are sent');
    assert.ok(!('instructions' in mock.calls.at(-1).body));
    const r4 = await run(['audition', '--voices', 'echo', '--out', out, '--no-play'], { env: { ...env, KHAN_TTS_INSTRUCTIONS: 'Brisk and dry.' }, deps: { fetch: mock.fetch } });
    assert.equal(mock.calls.at(-1).body.instructions, 'Brisk and dry.');
    assert.deepEqual(r4.json.instructions, { source: 'env:KHAN_TTS_INSTRUCTIONS', sent: true, chars: 'Brisk and dry.'.length });
    // a bad voice name is a usage error before any request
    const before = mock.calls.length;
    const r5 = await run(['audition', '--voices', '../x', '--out', out, '--no-play'], { env, deps: { fetch: mock.fetch } });
    assert.equal(r5.code, 1);
    assert.equal(r5.json.code, 'USAGE');
    assert.equal(mock.calls.length, before);
  } finally {
    rmSync(out, { recursive: true, force: true });
    home.cleanup();
  }
});

test('failure handling: every voice rejected → ok:false AUDITION_FAILED exit 1; a rejected key stops further requests; retryable errors are retried per voice; a playback failure is a note, not an error', async () => {
  const home = makeHome();
  try {
    const env = { ...home.env, OPENAI_API_KEY: KEY, KHAN_TTS_BACKOFF_MS: '0,0', KHAN_TTS_TIMEOUT_MS: '2000' };
    // all fail
    const allBad = createMockFetch([() => errorResponse(404, 'no such voice')]);
    const r = await run(['audition', '--voices', 'nope,nah', '--no-play'], { env, deps: { fetch: allBad.fetch } });
    assert.equal(r.code, 1);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 'AUDITION_FAILED');
    assert.deepEqual(r.json.voices.map((v) => [v.voice, v.ok, v.code]), [['nope', false, 'TTS_BAD_REQUEST'], ['nah', false, 'TTS_BAD_REQUEST']]);
    assert.equal(allBad.calls.length, 2);
    assert.equal(existsSync(join(home.home, 'audition')) && readdirSync(join(home.home, 'audition')).length > 0, false, 'no files');
    // auth failure: first voice TTS_AUTH, the others are skipped without requests, key redacted
    const auth = createMockFetch([() => errorResponse(401, `Incorrect API key provided: ${KEY}`)]);
    const r2 = await run(['audition', '--no-play'], { env, deps: { fetch: auth.fetch } });
    assert.equal(r2.code, 1);
    assert.equal(auth.calls.length, 1, 'no point retrying the key on the other voices');
    assert.deepEqual(r2.json.voices.map((v) => v.code), ['TTS_AUTH', 'TTS_AUTH', 'TTS_AUTH', 'TTS_AUTH']);
    assert.ok(!r2.out.includes(KEY), 'the key never appears in the output');
    assert.match(r2.json.voices[0].message, /\[redacted\]/);
    // one voice 500 ×3 → TTS_FAILED for that voice only; the next voice gets a fresh attempt budget
    const flaky = createMockFetch([(_u, _i, call) => (call.body.voice === 'echo' ? errorResponse(500, 'boom') : audioResponse())]);
    const r3 = await run(['audition', '--voices', 'echo,ash', '--no-play'], { env, deps: { fetch: flaky.fetch } });
    assert.equal(r3.code, 0);
    assert.deepEqual(r3.json.voices.map((v) => [v.voice, v.ok, v.code || null]), [['echo', false, 'TTS_FAILED'], ['ash', true, null]]);
    assert.equal(flaky.calls.filter((c) => c.body.voice === 'echo').length, 3);
    assert.equal(flaky.calls.filter((c) => c.body.voice === 'ash').length, 1);
    // a player that cannot start does not fail the command
    const ok = createMockFetch([() => audioResponse()]);
    const r4 = await run(['audition', '--voices', 'ash'], { env, deps: { fetch: ok.fetch, play: async () => ({ played: false, note: 'afplay could not start: spawn afplay ENOENT' }) } });
    assert.equal(r4.code, 0);
    assert.equal(r4.json.play, 'unavailable');
    assert.equal(r4.json.voices[0].played, false);
    assert.match(r4.json.voices[0].playNote, /ENOENT/);
  } finally {
    home.cleanup();
  }
});

test('playFile: afplay is spawned with an argv array (no shell), waits for exit; non-macOS never spawns; spawn errors become notes', async () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const handlers = {};
    const child = { on(ev, fn) { handlers[ev] = fn; return child; } };
    setTimeout(() => handlers.close(0), 5);
    return child;
  };
  const tricky = '/tmp/dir with spaces/$(touch pwned); rm -rf.mp3';
  const r = await playFile(tricky, { spawn: fakeSpawn, platform: 'darwin' });
  assert.deepEqual(r, { played: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'afplay');
  assert.deepEqual(calls[0].args, [tricky], 'the path is one argv element, untouched');
  assert.equal(calls[0].opts.shell, false);
  // non-zero exit
  const failingSpawn = () => { const h = {}; const c = { on(ev, fn) { h[ev] = fn; return c; } }; setTimeout(() => h.close(1), 5); return c; };
  assert.deepEqual(await playFile('/x.mp3', { spawn: failingSpawn, platform: 'darwin' }), { played: false, note: 'afplay exited with code 1' });
  // ENOENT-style error event
  const enoent = () => { const h = {}; const c = { on(ev, fn) { h[ev] = fn; return c; } }; setTimeout(() => h.error(Object.assign(new Error('spawn afplay ENOENT'), { code: 'ENOENT' })), 5); return c; };
  const e = await playFile('/x.mp3', { spawn: enoent, platform: 'darwin' });
  assert.equal(e.played, false);
  assert.match(e.note, /ENOENT/);
  // linux: no spawn at all
  let spawned = 0;
  const l = await playFile('/x.mp3', { spawn: () => { spawned++; }, platform: 'linux' });
  assert.equal(spawned, 0);
  assert.equal(l.played, false);
  assert.match(l.note, /macOS/);
});

test('audition() as a function: a direct call without main() still prints one line and honours deps', async () => {
  const home = makeHome();
  try {
    const env = { ...home.env, OPENAI_API_KEY: KEY, KHAN_TTS_BACKOFF_MS: '0,0' };
    const mock = createMockFetch([() => audioResponse()]);
    let out = '';
    const code = await audition({ flags: { voices: 'ash', 'no-play': true }, env, deps: { fetch: mock.fetch }, stdout: { write: (s) => { out += s; } } });
    assert.equal(code, 0);
    assert.equal(out.split('\n').filter(Boolean).length, 1);
    assert.equal(JSON.parse(out).voices[0].file, join(home.home, 'audition', 'ash.mp3'));
  } finally {
    home.cleanup();
  }
});
