// Slice 01 — mp3-duration: CBR fixture, VBR fixture, ID3v2 prefix, truncated file, garbage, Xing/LAME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mp3DurationMs, analyzeMp3, Mp3Error, parseFrameHeader, id3v2Length } from '../../server/tts/mp3-duration.js';
import { FIXTURE_MP3, FIXTURE_MP3_META, FIXTURE_VBR_MP3, FIXTURE_VBR_META } from './helpers/mock-fetch.js';
import { cbrStream, cbrWithInfo, vbrStream, withId3v2, withId3v1, concat, frame, exactMs, infoFrame } from './helpers/mp3-frames.js';

const TOL = 50;
const close = (a, b, what) => assert.ok(Math.abs(a - b) <= TOL, `${what}: ${a} vs ${b} (tolerance ${TOL} ms)`);

test('CBR fixture short.mp3: duration within ±50 ms of its recorded true value (criterion 4)', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE_MP3));
  assert.equal(bytes.length, FIXTURE_MP3_META.bytes, 'fixture bytes match the sidecar');
  const a = analyzeMp3(bytes);
  close(a.durationMs, FIXTURE_MP3_META.durationMs, 'short.mp3');
  assert.ok(a.durationMs >= 1000 && a.durationMs <= 3000, 'fixture is 1–3 s');
  assert.equal(a.sampleRate, 44100);
  assert.equal(a.frames, FIXTURE_MP3_META.frames);
  assert.equal(a.vbr, false);
  assert.equal(a.truncated, false);
  assert.equal(a.id3v2Bytes, 0);
  assert.equal(mp3DurationMs(bytes), a.durationMs);
  // Node Buffer input is accepted too
  close(mp3DurationMs(readFileSync(FIXTURE_MP3)), FIXTURE_MP3_META.durationMs, 'Buffer input');
});

test('VBR fixture short-vbr.mp3 (Xing header): within tolerance; Xing frame not counted as audio', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE_VBR_MP3));
  const a = analyzeMp3(bytes);
  close(a.durationMs, FIXTURE_VBR_META.durationMs, 'short-vbr.mp3');
  assert.equal(a.vbr, true);
  assert.equal(a.xing && a.xing.kind, 'Xing');
  assert.equal(a.xing.frames, FIXTURE_VBR_META.frames);
  assert.equal(a.frames, FIXTURE_VBR_META.frames);
});

test('ID3v2-prefixed copy of the fixture yields the same duration (with and without footer; large tag)', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE_MP3));
  const base = mp3DurationMs(bytes);
  for (const opts of [{ payload: 2000 }, { payload: 2000, footer: true }, { payload: 70000 }, { payload: 0 }]) {
    const tagged = withId3v2(bytes, opts);
    assert.equal(id3v2Length(tagged), 10 + opts.payload + (opts.footer ? 10 : 0));
    assert.equal(mp3DurationMs(tagged), base, `ID3v2 ${JSON.stringify(opts)}`);
    assert.equal(analyzeMp3(tagged).id3v2Bytes, 10 + opts.payload + (opts.footer ? 10 : 0));
  }
  // ID3v1 trailer is ignored too
  assert.equal(mp3DurationMs(withId3v1(bytes)), base);
  assert.equal(mp3DurationMs(withId3v1(withId3v2(bytes))), base);
});

test('truncated file (last frame partial) → finite duration one frame short; Xing count not trusted when the file is short', () => {
  const full = cbrStream({ count: 40 });
  const cut = full.subarray(0, full.length - 100); // last frame missing 100 of its 417/418 bytes
  const a = analyzeMp3(cut);
  assert.ok(Number.isFinite(a.durationMs));
  assert.equal(a.truncated, true);
  assert.equal(a.frames, 39);
  close(a.durationMs, exactMs(39), 'truncated CBR');
  // a VBR file whose Xing header claims 60 frames but which was cut after ~30 → walk wins
  const vbr = vbrStream({ count: 60 });
  const half = vbr.subarray(0, Math.floor(vbr.length / 2));
  const b = analyzeMp3(half);
  assert.ok(Number.isFinite(b.durationMs));
  assert.ok(b.frames < 60 && b.frames > 20, `walked frames ${b.frames}`);
  assert.ok(b.durationMs < exactMs(60) - 100, 'does not report the claimed full length');
  // a single frame, header only (4 bytes of a 418-byte frame) → no complete frame → BAD_MP3
  assert.throws(() => mp3DurationMs(frame().subarray(0, 4)), (e) => e instanceof Mp3Error && e.code === 'BAD_MP3');
});

test('garbage bytes → Mp3Error with code BAD_MP3', () => {
  const cases = {
    empty: new Uint8Array(0),
    short: new Uint8Array([0xff, 0xfb]),
    zeros: new Uint8Array(5000),
    text: new TextEncoder().encode('{"error":{"message":"Incorrect API key provided"}}'),
    html: new TextEncoder().encode('<!doctype html><html><body>502 Bad Gateway</body></html>'),
    wav: concat([new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '), new Uint8Array(400)]),
    random: Uint8Array.from({ length: 4000 }, (_, i) => (i * 2654435761) >>> 24),
    id3Only: withId3v2(new Uint8Array(0), { payload: 500 }),
    // sync-looking bytes with a reserved version / free-format bitrate, never confirmed by a next frame
    fakeSync: Uint8Array.from({ length: 3000 }, (_, i) => (i % 4 === 0 ? 0xff : i % 4 === 1 ? 0xeb : 0x00)),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    assert.throws(() => mp3DurationMs(bytes), (e) => e instanceof Mp3Error && e.code === 'BAD_MP3' && e.name === 'Mp3Error', `garbage case ${name}`);
  }
});

test('VBR with Xing header: frame count from the header; per-frame walk agrees; LAME gapless tag trims delay + padding', () => {
  const vbr = vbrStream({ count: 120, kbpsList: [48, 96, 160, 256, 320] });
  const a = analyzeMp3(vbr);
  assert.equal(a.vbr, true);
  assert.equal(a.frames, 120);
  close(a.durationMs, exactMs(120), 'VBR 120 frames');
  // without the Xing frame the walk alone gives the same answer
  const first = parseFrameHeader(vbr, 0);
  const noXing = vbr.subarray(first.frameLength);
  const b = analyzeMp3(noXing);
  assert.equal(b.xing, null);
  assert.equal(b.frames, 120);
  assert.equal(b.vbr, true, 'bitrate changes detected without a header');
  close(b.durationMs, exactMs(120), 'VBR walk');
  // Info frame (CBR written by LAME) is not counted as audio
  const info = analyzeMp3(cbrWithInfo({ count: 77 }));
  assert.equal(info.xing.kind, 'Info');
  assert.equal(info.vbr, false);
  assert.equal(info.frames, 77);
  close(info.durationMs, exactMs(77), 'CBR + Info');
  // LAME gapless: delay 576 + padding 1152 samples = 1728 samples = 39.18 ms trimmed
  const lame = analyzeMp3(cbrWithInfo({ count: 77, lame: { encoderDelay: 576, encoderPadding: 1152 } }));
  assert.equal(lame.xing.encoder, 'LAME3.100');
  assert.equal(lame.xing.encoderDelay, 576);
  assert.equal(lame.xing.encoderPadding, 1152);
  assert.ok(Math.abs(lame.durationMs - (exactMs(77) - (1728 / 44100) * 1000)) < 0.01, `gapless ${lame.durationMs}`);
  // Xing header that claims fewer frames than present is ignored in favour of the walk
  const under = concat([infoFrame({ kind: 'Xing', frames: 10, bytes: 999999 }), cbrStream({ count: 30 })]);
  assert.equal(analyzeMp3(under).frames, 30);
});

test('MPEG-2 (22.05 kHz, 576 samples/frame), stereo, junk between frames, and ID3v2 + leading junk all resolve', () => {
  const m2 = cbrStream({ count: 100, version: 2, kbps: 32, sampleRate: 22050 });
  const a = analyzeMp3(m2);
  assert.equal(a.version, 2);
  assert.equal(a.sampleRate, 22050);
  close(a.durationMs, exactMs(100, 22050, 576), 'MPEG-2 LIII');
  const st = analyzeMp3(cbrStream({ count: 50, mono: false }));
  assert.equal(st.channels, 2);
  close(st.durationMs, exactMs(50), 'stereo');
  // junk between two runs of frames → resync, both runs counted
  const junk = new TextEncoder().encode('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  const spliced = concat([cbrStream({ count: 20 }), junk, cbrStream({ count: 20 })]);
  const j = analyzeMp3(spliced);
  assert.equal(j.frames, 40);
  // leading junk before the first frame (no ID3)
  const lead = concat([junk, cbrStream({ count: 20 })]);
  assert.equal(analyzeMp3(lead).frames, 20);
  // padding bit alternation (417/418-byte frames) is honoured
  const padded = concat(Array.from({ length: 30 }, (_, i) => frame({ padding: i % 2 })));
  assert.equal(analyzeMp3(padded).frames, 30);
  // layer I / II headers parse with their own frame sizes
  const hdrL1 = parseFrameHeader(new Uint8Array([0xff, 0xff, 0x40, 0xc0]), 0); // MPEG-1 layer I, bitrate index 4 = 128 kbps, 44.1k mono
  assert.equal(hdrL1.layer, 1);
  assert.equal(hdrL1.samplesPerFrame, 384);
  assert.equal(hdrL1.frameLength, (Math.floor((12 * 128000) / 44100) + 0) * 4);
  const hdrL2 = parseFrameHeader(new Uint8Array([0xff, 0xfd, 0x90, 0xc0]), 0);
  assert.equal(hdrL2.layer, 2);
  assert.equal(hdrL2.samplesPerFrame, 1152);
  // invalid headers
  assert.equal(parseFrameHeader(new Uint8Array([0xff, 0xeb, 0x90, 0xc0]), 0), null, 'reserved version');
  assert.equal(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0x00, 0xc0]), 0), null, 'free-format bitrate');
  assert.equal(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0xf0, 0xc0]), 0), null, 'bad bitrate index');
  assert.equal(parseFrameHeader(new Uint8Array([0xff, 0xfb, 0x9c, 0xc0]), 0), null, 'reserved sample rate');
  assert.equal(parseFrameHeader(new Uint8Array([0xff, 0xf9, 0x90, 0xc0]), 0), null, 'reserved layer');
});
