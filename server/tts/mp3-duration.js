// server/tts/mp3-duration.js — duration of an MP3 from its bytes, no external tools (brief 01).
//
// Handles: ID3v2 tag (with footer), ID3v1 "TAG" trailer, MPEG 1 / 2 / 2.5, layers I–III, CBR and
// VBR (per-frame walk), Xing/Info header (frame count; "Info" marks CBR), LAME/Lavc gapless tag
// (encoder delay + padding are subtracted, which is what gapless-aware decoders report), junk
// between frames (resync), and a truncated final frame (ignored; the duration stays finite).
// Garbage that contains no plausible frame → Mp3Error (code BAD_MP3).

export class Mp3Error extends Error {
  constructor(message) {
    super(message);
    this.name = 'Mp3Error';
    this.code = 'BAD_MP3';
  }
}

// bitrate tables in kbps, index 1..14 (0 = free format, 15 = reserved) — [version][layer]
const BITRATES = {
  1: { // MPEG-1
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  2: { // MPEG-2 and 2.5 share the tables
    1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

/**
 * Parse the 4-byte frame header at `off`. Returns null when it is not a usable header.
 * @returns {null | {version: 1|2|25, layer: 1|2|3, bitrate: number, sampleRate: number, padding: 0|1,
 *   channels: 1|2, samplesPerFrame: number, frameLength: number, sideInfoLength: number}}
 */
export function parseFrameHeader(bytes, off) {
  if (off + 4 > bytes.length) return null;
  const b1 = bytes[off], b2 = bytes[off + 1], b3 = bytes[off + 2], b4 = bytes[off + 3];
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const versionBits = (b2 >> 3) & 0x3; // 00 = 2.5, 01 = reserved, 10 = 2, 11 = 1
  if (versionBits === 1) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const layerBits = (b2 >> 1) & 0x3; // 01 = III, 10 = II, 11 = I
  if (layerBits === 0) return null;
  const layer = 4 - layerBits;
  const bitrateIndex = (b3 >> 4) & 0xf;
  if (bitrateIndex === 0 || bitrateIndex === 15) return null; // free format unsupported, 15 reserved
  const srIndex = (b3 >> 2) & 0x3;
  if (srIndex === 3) return null;
  const padding = (b3 >> 1) & 0x1;
  const channelMode = (b4 >> 6) & 0x3; // 3 = mono
  const channels = channelMode === 3 ? 1 : 2;
  const bitrate = BITRATES[version === 1 ? 1 : 2][layer][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIndex];
  let samplesPerFrame, frameLength;
  if (layer === 1) {
    samplesPerFrame = 384;
    frameLength = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  } else if (layer === 2) {
    samplesPerFrame = 1152;
    frameLength = Math.floor((144 * bitrate) / sampleRate) + padding;
  } else {
    samplesPerFrame = version === 1 ? 1152 : 576;
    frameLength = Math.floor(((version === 1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  }
  let sideInfoLength = 0;
  if (layer === 3) sideInfoLength = version === 1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
  return { version, layer, bitrate, sampleRate, padding, channels, samplesPerFrame, frameLength, sideInfoLength };
}

/** Size of an ID3v2 tag at offset 0 (0 when absent). */
export function id3v2Length(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  if (bytes[3] === 0xff || bytes[4] === 0xff) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const footer = (bytes[5] & 0x10) ? 10 : 0;
  return 10 + size + footer;
}

/** End of the audio data: strips an ID3v1 trailer ("TAG" + 125 bytes). */
function audioEnd(bytes) {
  const n = bytes.length;
  if (n >= 128 && bytes[n - 128] === 0x54 && bytes[n - 127] === 0x41 && bytes[n - 126] === 0x47) return n - 128;
  return n;
}

/** Find the first offset ≥ `from` that holds a header confirmed by a second header where the frame ends (or the file ends). */
function findFirstFrame(bytes, from, end) {
  for (let off = from; off + 4 <= end; off++) {
    if (bytes[off] !== 0xff) continue;
    const h = parseFrameHeader(bytes, off);
    if (!h) continue;
    const next = off + h.frameLength;
    if (next >= end) return off; // single (possibly truncated) frame at the end
    const h2 = parseFrameHeader(bytes, next);
    if (h2 && h2.version === h.version && h2.layer === h.layer && h2.sampleRate === h.sampleRate) return off;
  }
  return -1;
}

const ascii = (bytes, off, n) => String.fromCharCode(...bytes.subarray(off, off + n));
const u32 = (bytes, off) => ((bytes[off] << 24) >>> 0) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3];

/**
 * Read a Xing/Info header (and LAME tag) inside the frame at `off`.
 * @returns {null | {kind: 'Xing'|'Info', frames: number|null, bytes: number|null, encoderDelay: number, encoderPadding: number, encoder: string|null}}
 */
export function parseXing(bytes, off, header) {
  const x = off + 4 + header.sideInfoLength;
  if (x + 8 > bytes.length) return null;
  const tag = ascii(bytes, x, 4);
  if (tag !== 'Xing' && tag !== 'Info') return null;
  const flags = u32(bytes, x + 4);
  let p = x + 8;
  let frames = null, byteCount = null;
  if (flags & 0x1) { if (p + 4 > bytes.length) return null; frames = u32(bytes, p); p += 4; }
  if (flags & 0x2) { if (p + 4 > bytes.length) return null; byteCount = u32(bytes, p); p += 4; }
  if (flags & 0x4) p += 100; // TOC
  if (flags & 0x8) p += 4;   // quality
  let encoderDelay = 0, encoderPadding = 0, encoder = null;
  // LAME-style extension: 9-byte encoder string, then 12 bytes, then 3 bytes of 12-bit delay/padding
  if (p + 24 <= bytes.length) {
    const enc = ascii(bytes, p, 4);
    if (enc === 'LAME' || enc === 'Lavc' || enc === 'Lavf') {
      encoder = ascii(bytes, p, 9).replace(/\0+$/, '');
      const d = p + 21;
      encoderDelay = (bytes[d] << 4) | (bytes[d + 1] >> 4);
      encoderPadding = ((bytes[d + 1] & 0x0f) << 8) | bytes[d + 2];
    }
  }
  return { kind: tag, frames, bytes: byteCount, encoderDelay, encoderPadding, encoder };
}

/**
 * Walk frames from `off` to `end`; returns {frames, samples, bytes, truncated}.
 * Frames of differing bitrates (VBR) are summed individually; junk is skipped by resyncing.
 */
function walkFrames(bytes, off, end) {
  let frames = 0, samples = 0, truncated = false;
  let p = off;
  while (p + 4 <= end) {
    const h = parseFrameHeader(bytes, p);
    if (!h) { // junk between frames: resync
      const next = findFirstFrame(bytes, p + 1, end);
      if (next < 0) break;
      p = next;
      continue;
    }
    if (p + h.frameLength > end) { truncated = true; break; } // partial final frame: not counted
    frames++;
    samples += h.samplesPerFrame;
    p += h.frameLength;
  }
  return { frames, samples, bytes: p - off, truncated };
}

/**
 * Detailed analysis of an MP3 byte array.
 * @param {Uint8Array} input
 * @returns {{durationMs:number, frames:number, sampleRate:number, channels:number, version:number, layer:number,
 *   vbr:boolean, xing:object|null, id3v2Bytes:number, truncated:boolean, bitrate:number}}
 */
export function analyzeMp3(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes || bytes.length < 4) throw new Mp3Error('not an MP3: too short');
  const id3 = id3v2Length(bytes);
  const end = audioEnd(bytes);
  const first = findFirstFrame(bytes, Math.min(id3, end), end);
  if (first < 0) throw new Mp3Error('not an MP3: no frame sync found');
  const h0 = parseFrameHeader(bytes, first);
  const xing = parseXing(bytes, first, h0);
  let dataStart = first;
  if (xing) dataStart = first + h0.frameLength; // the Xing/Info frame carries no audio

  const walked = walkFrames(bytes, dataStart, end);
  let frames = walked.frames;
  let samples = walked.samples;
  let vbr = false;
  // VBR detection: any frame with a different bitrate than the first audio frame
  {
    let p = dataStart;
    const hA = parseFrameHeader(bytes, p);
    if (hA) {
      for (let i = 0; i < walked.frames && p + 4 <= end; i++) {
        const h = parseFrameHeader(bytes, p);
        if (!h) break;
        if (h.bitrate !== hA.bitrate) { vbr = true; break; }
        p += h.frameLength;
      }
    }
  }
  if (xing && xing.frames !== null && xing.frames > 0) {
    // Trust the header's frame count unless the file is visibly shorter than it claims
    const claimedBytes = xing.bytes;
    const fileLooksComplete = claimedBytes === null || claimedBytes <= (end - first) + h0.frameLength;
    if (fileLooksComplete && !walked.truncated && xing.frames >= frames) {
      frames = xing.frames;
      samples = xing.frames * h0.samplesPerFrame;
    }
    if (xing.kind === 'Xing') vbr = true;
  }
  if (frames === 0) throw new Mp3Error('not an MP3: no complete audio frame');
  let effectiveSamples = samples;
  if (xing && (xing.encoderDelay || xing.encoderPadding)) {
    const trim = xing.encoderDelay + xing.encoderPadding;
    if (trim > 0 && trim < samples) effectiveSamples = samples - trim;
  }
  const durationMs = (effectiveSamples / h0.sampleRate) * 1000;
  if (!Number.isFinite(durationMs)) throw new Mp3Error('not an MP3: non-finite duration');
  return {
    durationMs, frames, samples: effectiveSamples, sampleRate: h0.sampleRate, channels: h0.channels, version: h0.version, layer: h0.layer,
    vbr, xing, id3v2Bytes: id3, truncated: walked.truncated, bitrate: h0.bitrate,
  };
}

/** Duration in milliseconds (float). Throws Mp3Error on anything that is not an MP3. */
export function mp3DurationMs(bytes) {
  return analyzeMp3(bytes).durationMs;
}
