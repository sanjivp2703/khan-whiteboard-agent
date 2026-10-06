# fixtures/audio — provenance and true durations

Both files are owned by slice 01 (OpenAI TTS). They are **synthesized, not recorded**: no third-party
audio, no encoder, no license obligations. They are released into the public domain (CC0) as part of
this repo.

## Provenance

No MP3 encoder (ffmpeg, lame, sox) exists on the build machine and macOS `afconvert` cannot write
MP3, so the fixtures were produced by `test/tts/helpers/mp3-frames.js` — a generator of
spec-conformant MPEG-1 Layer III frames (correct sync word, version/layer/bitrate/sample-rate
fields, padding bit, side-info length) whose main data is all zeros. Layer III decoders render
zero main data as digital silence, so the files are real, playable MP3s. Each file's exact
duration therefore follows from the frame math, with no encoder delay or padding involved.

| file | content | frames | sample rate | bytes | sha256 |
|---|---|---|---|---|---|
| `short.mp3` | CBR 128 kbps mono, no Xing/Info frame | 77 | 44100 Hz | 32109 | `542fc545…d4695d` |
| `short-vbr.mp3` | VBR (64/128/192/320 kbps cycling) mono with a `Xing` header frame (frames + bytes + TOC + quality) | 77 audio + 1 Xing | 44100 Hz | 44230 | `e2f69025…705d25` |

The machine-readable sidecars `short.json` / `short-vbr.json` carry the same numbers; the tests read
the expected `durationMs` from them, so a replacement fixture (e.g. a real recording once an encoder
is available) only needs its sidecar updated.

## True duration and how it was measured

Duration = frames × samplesPerFrame / sampleRate = 77 × 1152 / 44100 = **2011.43 ms** for both
files (the Xing frame carries no audio and is not counted).

Independent check with macOS `afinfo` (CoreAudio), 2026-10-06, macOS 13:

```
$ afinfo fixtures/audio/short.mp3
Data format:     1 ch,  44100 Hz, .mp3 ... 1152 frames/packet
estimated duration: 2.006813 sec        # CoreAudio's CBR estimate = bytes × 8 / bitrate; 4.6 ms under the frame count
$ afinfo fixtures/audio/short-vbr.mp3
Data format:     1 ch,  44100 Hz, .mp3 ... 1152 frames/packet
estimated duration: 2.011429 sec        # from the Xing frame count; matches exactly
```

`server/tts/mp3-duration.js` reports 2011.43 ms for both (test tolerance ±50 ms; actual error
0 ms vs frame math, 4.6 ms vs afinfo's CBR estimate).

Note on gapless metadata: when a file carries a LAME/Lavc tag, `mp3-duration.js` subtracts encoder
delay + padding (what gapless-aware decoders such as Chromium, Safari and ffmpeg play). Neither
fixture has such a tag, so no ambiguity applies to the numbers above.
