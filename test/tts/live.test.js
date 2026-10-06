// Slice 01 — live smoke test against the real OpenAI API. Skipped unless KHAN_LIVE_TTS=1 and a key is set:
//   KHAN_LIVE_TTS=1 OPENAI_API_KEY=sk-... node --test test/tts/live.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIProvider } from '../../server/tts/openai.js';
import { analyzeMp3 } from '../../server/tts/mp3-duration.js';

const live = process.env.KHAN_LIVE_TTS === '1';
const hasKey = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0;

test('live: synthesize one 20-word sentence → MP3 magic bytes, 2–15 s', { skip: !live ? 'set KHAN_LIVE_TTS=1 (and OPENAI_API_KEY) to run' : (!hasKey ? 'OPENAI_API_KEY not set' : false) }, async () => {
  const provider = createOpenAIProvider({ env: process.env, log: (l) => console.error(`[live] ${l}`) });
  assert.deepEqual(provider.ready(), { ok: true, reason: null });
  const text = 'The cache stores each response under a hash of its request, so a repeated question is answered instantly without recomputation.';
  assert.equal(text.split(/\s+/).length, 20);
  const out = await provider.synthesize({ text });
  assert.equal(out.mime, 'audio/mpeg');
  assert.equal(out.ext, 'mp3');
  assert.ok(out.bytes.length > 1000, `bytes ${out.bytes.length}`);
  const b0 = out.bytes[0], b1 = out.bytes[1], b2 = out.bytes[2];
  const isId3 = b0 === 0x49 && b1 === 0x44 && b2 === 0x33;
  const isSync = b0 === 0xff && (b1 & 0xe0) === 0xe0;
  assert.ok(isId3 || isSync, `MP3 magic bytes (ID3 or frame sync), got ${b0.toString(16)} ${b1.toString(16)} ${b2.toString(16)}`);
  assert.ok(out.durationMs >= 2000 && out.durationMs <= 15000, `durationMs ${out.durationMs}`);
  const a = analyzeMp3(out.bytes);
  console.error(`[live] ${a.frames} frames, ${a.sampleRate} Hz, ${a.channels} ch, vbr=${a.vbr}, xing=${a.xing ? a.xing.kind : 'none'}, encoder=${a.xing && a.xing.encoder}, ${Math.round(a.durationMs)} ms`);
});
