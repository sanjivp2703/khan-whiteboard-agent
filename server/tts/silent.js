// server/tts/silent.js — the test-only provider: writes a real silent WAV whose duration is the
// 150-wpm estimate (min 1.5 s), so the player's <audio> element stays the only clock in tests.
import { NARRATION } from '../../shared/layout-core/constants.js';

export const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS = 16;

/** Words / 150 wpm in ms, at least NARRATION.minAudioMs. */
export function estimateDurationMs(text) {
  const words = String(text || '').split(/\s+/).filter((w) => w.length).length;
  return Math.max(NARRATION.minAudioMs, Math.round((words / NARRATION.wpm) * 60 * 1000));
}

/** PCM 16-bit mono 8 kHz silence of the given duration. */
export function silentWav(durationMs) {
  const frames = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const dataBytes = frames * CHANNELS * (BITS / 8);
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * (BITS / 8), true);
  view.setUint16(32, CHANNELS * (BITS / 8), true);
  view.setUint16(34, BITS, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buf); // samples are already zero
}

/** Duration in ms parsed from a WAV header (RIFF/PCM); throws on anything else. */
export function wavDurationMs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (off) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= view.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(off + 16, true);
    if (id === 'data') {
      if (!byteRate) throw new Error('WAV data before fmt');
      return (size / byteRate) * 1000;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Provider shape (brief 00 C3): { name, voice, ready(), synthesize({text}) }. */
export function createSilentProvider() {
  return {
    name: 'silent',
    voice: null,
    ready() { return { ok: true, reason: null }; },
    async synthesize({ text }) {
      const durationMs = estimateDurationMs(text);
      return { bytes: silentWav(durationMs), mime: 'audio/wav', ext: 'wav', durationMs };
    },
  };
}
