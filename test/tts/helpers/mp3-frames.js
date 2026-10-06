// Test helper (slice 01): build valid MPEG audio frame streams in memory — CBR, VBR with a Xing
// header, ID3v2 / ID3v1 wrapping. Frames carry all-zero main data, which Layer III decoders render
// as digital silence, so the output is a real, playable MP3 whose duration is known exactly:
// frames × samplesPerFrame / sampleRate.
import { parseFrameHeader } from '../../../server/tts/mp3-duration.js';

const BITRATE_INDEX = {
  // MPEG-1 Layer III
  '1:3': { 32: 1, 40: 2, 48: 3, 56: 4, 64: 5, 80: 6, 96: 7, 112: 8, 128: 9, 160: 10, 192: 11, 224: 12, 256: 13, 320: 14 },
  // MPEG-2 Layer III
  '2:3': { 8: 1, 16: 2, 24: 3, 32: 4, 40: 5, 48: 6, 56: 7, 64: 8, 80: 9, 96: 10, 112: 11, 128: 12, 144: 13, 160: 14 },
};
const SR_INDEX = { 44100: 0, 48000: 1, 32000: 2, 22050: 0, 24000: 1, 16000: 2 };

/** One MPEG Layer III frame with zero main data. */
export function frame({ version = 1, kbps = 128, sampleRate = 44100, mono = true, padding = 0 } = {}) {
  const b1 = 0xff;
  const versionBits = version === 1 ? 0b11 : 0b10;
  const layerBits = 0b01; // Layer III
  const protection = 1; // no CRC
  const b2 = 0xe0 | (versionBits << 3) | (layerBits << 1) | protection;
  const br = BITRATE_INDEX[`${version}:3`][kbps];
  if (br === undefined) throw new Error(`unsupported kbps ${kbps} for MPEG-${version}`);
  const sr = SR_INDEX[sampleRate];
  if (sr === undefined) throw new Error(`unsupported sample rate ${sampleRate}`);
  const b3 = (br << 4) | (sr << 2) | (padding << 1);
  const channelMode = mono ? 0b11 : 0b00;
  const b4 = (channelMode << 6) | 0b1100; // original + copyright bits set, no emphasis
  const header = new Uint8Array([b1, b2, b3, b4]);
  const h = parseFrameHeader(header, 0);
  if (!h) throw new Error('generated an unparsable header');
  const out = new Uint8Array(h.frameLength);
  out.set(header, 0);
  return out;
}

export function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Constant bitrate stream of `count` frames (no Xing/Info header). */
export function cbrStream({ count, ...opts }) {
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(frame(opts));
  return concat(parts);
}

/**
 * Build a Xing (VBR) or Info (CBR) frame for the given audio frames.
 * @param {object} o
 * @param {'Xing'|'Info'} o.kind
 * @param {number} o.frames  number of audio frames that follow
 * @param {number} o.bytes   total stream size in bytes (including this frame)
 * @param {object} [o.lame]  {encoderDelay, encoderPadding} → appends a LAME-style tag
 */
export function infoFrame({ kind = 'Xing', frames, bytes, lame = null, headerOpts = {} }) {
  const f = frame({ kbps: 128, ...headerOpts });
  const h = parseFrameHeader(f, 0);
  let p = 4 + h.sideInfoLength;
  const write = (s) => { for (let i = 0; i < s.length; i++) f[p++] = s.charCodeAt(i); };
  const u32 = (v) => { f[p++] = (v >>> 24) & 0xff; f[p++] = (v >>> 16) & 0xff; f[p++] = (v >>> 8) & 0xff; f[p++] = v & 0xff; };
  write(kind);
  u32(0x0f); // frames + bytes + TOC + quality
  u32(frames);
  u32(bytes);
  for (let i = 0; i < 100; i++) f[p++] = Math.round((i / 100) * 255); // TOC
  u32(50); // quality
  if (lame) {
    write('LAME3.100'); // 9 bytes encoder string
    f[p++] = 0x00; // info tag revision + VBR method
    f[p++] = 0x00; // lowpass
    p += 8;        // replay gain
    f[p++] = 0x00; // encoding flags
    f[p++] = 0x00; // ABR/minimal bitrate
    const d = lame.encoderDelay ?? 0, pad = lame.encoderPadding ?? 0;
    f[p++] = (d >> 4) & 0xff;
    f[p++] = ((d & 0x0f) << 4) | ((pad >> 8) & 0x0f);
    f[p++] = pad & 0xff;
  }
  if (p > f.length) throw new Error('info frame overflow');
  return f;
}

/**
 * VBR stream: frames cycle through `kbpsList`, preceded by a Xing frame with the correct frame and byte counts.
 */
export function vbrStream({ count, kbpsList = [64, 128, 192, 320], sampleRate = 44100, mono = true, lame = null }) {
  const audio = [];
  for (let i = 0; i < count; i++) audio.push(frame({ kbps: kbpsList[i % kbpsList.length], sampleRate, mono }));
  const audioBytes = audio.reduce((s, f) => s + f.length, 0);
  const info = infoFrame({ kind: 'Xing', frames: count, bytes: 0, lame, headerOpts: { sampleRate, mono } });
  const total = info.length + audioBytes;
  const fixed = infoFrame({ kind: 'Xing', frames: count, bytes: total, lame, headerOpts: { sampleRate, mono } });
  return concat([fixed, ...audio]);
}

/** CBR stream with an "Info" header frame (what LAME writes for CBR files). */
export function cbrWithInfo({ count, kbps = 128, sampleRate = 44100, mono = true, lame = null }) {
  const audio = cbrStream({ count, kbps, sampleRate, mono });
  const probe = infoFrame({ kind: 'Info', frames: count, bytes: 0, lame, headerOpts: { kbps, sampleRate, mono } });
  const info = infoFrame({ kind: 'Info', frames: count, bytes: probe.length + audio.length, lame, headerOpts: { kbps, sampleRate, mono } });
  return concat([info, audio]);
}

/** Wrap bytes in an ID3v2.4 tag of `payload` bytes (plus a footer when asked). */
export function withId3v2(bytes, { payload = 2000, footer = false } = {}) {
  const tag = new Uint8Array(10 + payload + (footer ? 10 : 0));
  tag.set([0x49, 0x44, 0x33, 0x04, 0x00, footer ? 0x10 : 0x00], 0); // "ID3", v2.4.0, flags
  tag[6] = (payload >> 21) & 0x7f; tag[7] = (payload >> 14) & 0x7f; tag[8] = (payload >> 7) & 0x7f; tag[9] = payload & 0x7f;
  // a TIT2 frame holding a title (when the payload has room), rest zero padding
  const title = 'khan fixture';
  const frameSize = 1 + title.length;
  let p = 10;
  if (payload < 10 + frameSize) {
    if (footer) tag.set([0x33, 0x44, 0x49, 0x04, 0x00, 0x10, tag[6], tag[7], tag[8], tag[9]], 10 + payload);
    return concat([tag, bytes]);
  }
  tag.set([0x54, 0x49, 0x54, 0x32], p); p += 4; // TIT2
  tag[p++] = (frameSize >> 21) & 0x7f; tag[p++] = (frameSize >> 14) & 0x7f; tag[p++] = (frameSize >> 7) & 0x7f; tag[p++] = frameSize & 0x7f;
  tag[p++] = 0; tag[p++] = 0; // flags
  tag[p++] = 0x03; // UTF-8
  for (let i = 0; i < title.length; i++) tag[p++] = title.charCodeAt(i);
  if (footer) tag.set([0x33, 0x44, 0x49, 0x04, 0x00, 0x10, tag[6], tag[7], tag[8], tag[9]], 10 + payload); // "3DI"
  return concat([tag, bytes]);
}

/** Append an ID3v1 trailer. */
export function withId3v1(bytes) {
  const t = new Uint8Array(128);
  t.set([0x54, 0x41, 0x47], 0); // "TAG"
  return concat([bytes, t]);
}

export const SAMPLES_PER_FRAME_MPEG1_L3 = 1152;
export const SAMPLES_PER_FRAME_MPEG2_L3 = 576;

/** Exact duration in ms of `frames` MPEG-1 Layer III frames at `sampleRate`. */
export function exactMs(frames, sampleRate = 44100, spf = SAMPLES_PER_FRAME_MPEG1_L3) {
  return (frames * spf / sampleRate) * 1000;
}
