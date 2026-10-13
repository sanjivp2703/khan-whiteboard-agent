# Khan look research — background, palette, pen, handwriting, voice, timing

Research only (2026-10-12). Every factual bullet carries a source URL; items that could not be
confirmed are marked **unverified**. Two primary sources outweigh everything else here:

- **KA-A** — Khan Academy help center, "How do I recreate Khan Academy videos?" (official, updated 2026-09-01):
  https://support.khanacademy.org/hc/en-us/articles/226885367 (readable via the Zendesk API at
  https://support.khanacademy.org/api/v2/help_center/en-us/articles/226885367.json). It embeds the official
  palette image https://support.khanacademy.org/hc/article_attachments/360007188711 and links three Google Docs:
- **KA-B** — "Tips for Blackboard Style Videos": https://docs.google.com/document/d/1GZhcZrbpJiKlc__ofExEZbHn8jVr2l6u85TA8oT8GxY/export?format=txt
- **KA-C** — "Getting started as a video (re)creator": https://docs.google.com/document/d/1sEmYmuu-mlSq9X57y18759900vHzWVtKSbMsrmrncGw/export?format=txt
- **KA-D** — dubbing/recreation team doc with the palette table: https://docs.google.com/document/d/135WWQcAHeF0vMjRjF-5WkJua7qMf8uHCBp-hVZggLm0/export?format=txt
- **Frames** — two Sal videos inspected directly in a browser during this research: "Basic addition" (2006 era,
  960x720) https://www.youtube.com/watch?v=AuX7nPBqDts and "Introduction to limits" (1080p, SmoothDraw era)
  https://www.youtube.com/watch?v=riXcZT2ICjA. Pixel values could not be sampled (cross-origin video), so anything
  read off a frame is an **estimate**.

## 1. Background

- KA's official recreation instructions: "always set your background screen to black" (KA-A) and "Set your background
  layer to black – when you are in the background layer, select the flood fill bucket with black ink and fill the entire
  canvas" (KA-B). Flood-filling with default black ink gives #000000; the official palette image's "On black" panel is
  also #000000 (pixel-counted from the attachment, KA-A).
- Both inspected frames show a flat black board with only compression noise, no visible tint (Frames). After YouTube
  encoding the measured value in a frame would be near-black rather than exactly 0, but the *source* is pure black.
- Third-party description: "Almost always black, sometimes deep navy ... The dark background makes colored pen strokes
  pop and reduces glare" — https://video.golpoai.com/guide/khan-academy-vs-after-skool-video-style
- Software history: started with "Microsoft Paint (as the digital whiteboard) and Screen Video Recorder", then
  "Wacom Bamboo Tablet with Smooth Draw ... recorded ... using Camtasia Studio on a Windows PC" —
  https://labnol.org/internet/khan-academy-style-videos/19875 ; 2010 press: "a $200 Camtasia Recorder, $80 Wacom
  Bamboo Tablet and a free copy of SmoothDraw3 on a home PC" (San Jose Mercury News, mirrored at
  https://mailman.anu.edu.au/pipermail/link/2010-June/020833.html). KA help center (title) confirms the
  SmoothDraw3/Camtasia/Bamboo kit: https://support.khanacademy.org/hc/nl/articles/202483430
- Later tool: "Sal Khan uses Sketchbook (which is free)" (KA-C); KA-B lists "Sketchbook Express or Adobe Photoshop for
  Mac, SmoothDraw for PC, GIMP for all". So the colours come from a hand-set palette, not a SmoothDraw default:
  "The most important window is the color palette so that you can make quick color changes" (KA-B).
- SmoothDraw's default palette documentation: **unverified** (no official doc found; vendor pages list only brushes,
  layers, tablet support: https://www.snapfiles.com/get/smoothdraw.html).

## 2. Color palette

Official KA "On black" palette (KA-A image; identical hex list in KA-D "Color Palette" section) — **verified**:

| Name | Hex | | Name | Hex |
|---|---|---|---|---|
| White | #FFFFFF | | Teal | #59F3CE |
| Pink | #FB73BE | | Light blue | #65D0FA |
| Coral | #FF8D71 | | Blue | #4984F2 |
| Yellow | #FFE066 | | Purple | #A87DFF |

- "We use light blue, pink, coral, yellow, and teal as our drawing colors (don't use the red - there should never be
  red in Khan videos!)" (KA-C). "Try to use pastel colors that mimic blackboard chalks -- e.g, bright red ink on a
  black background can come across as too garish ... but a pastel red would be okay" (KA-B).
- The palette "meets the contrast standards necessary to be accessible" (KA-D). KA-C warns that thin pink "shows up
  poorly on a black background" on small screens.
- The same eight values are reproduced by https://www.videoproc.com/video-editor/how-to-make-khan-academy-videos.htm
- Caveat: this palette is KA's current *recreation* standard. Sal's own SmoothDraw-era videos use more saturated
  picks. Read off the "Introduction to limits" frame (Frames, **estimates**): green ~#2ECC71-#1FAB54, yellow
  ~#E6E600, pink/magenta ~#FF7FBF, coral-red ~#FF6B6B, lavender/pink axes ~#D9A0D9. The 2006 "Basic addition" frame
  is a single pale green ~#9ACD9A on black (**estimate**).
- KA's exercise colour vocabulary (for white backgrounds; useful only as naming reference): KaTeX "Custom Khan
  Academy colors" — blueD #11accd, tealD #01a995, greenD #1fab54, goldD #e07d10, redD #e84d39, maroonD #ca337c,
  purpleC #aa87ff, grayI #21242c — https://raw.githubusercontent.com/KaTeX/KaTeX/v0.16.11/src/macros.js
- KA brand colours (#14BF96 green, #0A2A66 blue — https://www.brandcolorcode.com/khan-academy) are site branding,
  not board colours; do not use them on the board.

## 3. Color conventions

- Khan's own tip: "Use visuals and colors—but not too fancy", hand-drawn diagrams —
  https://tagteam.harvard.edu/hub_feeds/2018/feed_items/147789 (mirror of Fast Company's "4 Tips").
- "Salman Khan color codes his concepts" — https://lsc-pagepro.mydigitalpublication.com/article/Color+Class/2680384/373722/article.html
- "Each color usually carries a job—one for the concept, another for the example, a third for the answer" and viewers
  "start reading the color code within about ninety seconds" — golpoai guide (URL in §1).
- MOOC-production guidance modelled on Khan style: "use each different color and each different stroke width to have
  a specific meaning" throughout a course — https://course.oeru.org/moocs4all/?p=4150
- Observed (Frames, "Introduction to limits"): function definition in green, its graph in yellow, axes in
  pink/lavender, the limit expression in coral-red, a point of interest circled in the curve's own colour. One colour
  per mathematical object, kept consistent across the board; a new colour arrives with each new idea.
- White usage: the official palette lists white first, but KA-C names only "light blue, pink, coral, yellow, and
  teal as our drawing colors". In the two inspected frames white is not used for body writing at all (Frames).
  Quantified frequency of white vs colour across his catalogue: **unverified**.
- Specific recurring habits (e.g. a fixed colour for the unknown or for the final answer): **unverified** — no source
  documents a fixed mapping; sources describe consistency *within* a video, not across videos.

## 4. Pen and cursor

- Pressure: KA requires "pressure-sensitive interactions with your tablet" and "adjustable brush/drawing tool size"
  (KA-C); "Remember to check that the pressure sensitivity works! ... the pencil tool works well" (KA-B).
- Stroke weight: "When you write, make it thick / Bolder strokes should do the trick ... Skinny writing reads poorly on
  small screens", but "there is no official stroke-width recommendation" because width "is often a function of pen
  pressure" (KA-C).
- Observed: 2006 frame — thin (~2 px at 960x720), visibly aliased strokes, matching Bidoun's "jagged, aliased line —
  the hasty chicken scratch of a Microsoft Paint scribble" https://next.bidoun.org/articles/the-math-of-khan ;
  2012 frame — smooth anti-aliased strokes ~3-4 px at 1080p with mild thick/thin variation (Frames, **estimates**).
- Cursor: "We use our mouse cursor to point to things as we talk. If our cursor isn't visible, students have a hard
  time understanding ... increase your cursor size a bit" (KA-C). In both inspected frames the in-video cursor is the
  standard OS white arrow pointer with a dark outline, not a crosshair or dot (Frames). Whether SmoothDraw ever
  showed a brush-outline cursor in his recordings: **unverified**.

## 5. Handwriting

- KA guidance: "Your handwriting should be legible, fairly large, and seem like a real person is writing on the screen
  with a pencil, not with a mouse" ... "switching to all-caps handwriting" helps; "Rule of Four": no more than ~4
  stacked words per screen quadrant (KA-C).
- Descriptions of Sal's hand: "the scrawls of equations or bad drawings that Mr. Khan writes on his digital sketchpad"
  (Chronicle of Higher Education, 2010, mirrored at
  https://joshblackman.com/blog/2010/06/08/a-self-appointed-teacher-runs-a-one-man-academy-on-youtube/);
  "rudimentary" drawings, "chicken scratch" (Bidoun, URL in §4). Observed: quick upright-to-slightly-slanted print,
  mixed case, variable size, lowercase cursive-ish "g" and "lim" (Frames).
- Fonts people use for this look (all SIL OFL 1.1 via Google Fonts; none is a documented match for Sal's hand — that
  claim is **unverified** for every font):
  - Patrick Hand (current choice): "based on the designer's own handwriting", (c) 2010-2012 Patrick Wagesreiter, OFL 1.1 —
    https://raw.githubusercontent.com/google/fonts/main/ofl/patrickhand/DESCRIPTION.en_us.html ,
    https://raw.githubusercontent.com/google/fonts/main/ofl/patrickhand/OFL.txt
  - Kalam: "very steep slant", "thin felt-tip pen, or a ball-point pen", rapid personal writing; 3 weights —
    https://raw.githubusercontent.com/google/fonts/main/ofl/kalam/DESCRIPTION.en_us.html (closest to a quick slanted print)
  - Caveat: "short annotations and body text", contextual alternates, Regular + Bold —
    https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/DESCRIPTION.en_us.html (looser, more cursive)
  - Comparison blurbs (Patrick Hand "neat everyday handwriting", Kalam "slightly forward lean", Caveat "felt-tip
    marker"): https://madegooddesigns.com/handwriting-fonts/

## 6. Narration style

- Khan's own rules: "keep instruction simple, conversational and brief"; "emotionless is bad"; don't talk over heads
  or down ("Not even a 6-year-old likes to be talked to like a 6-year-old"); "Prepare carefully, then speak from your
  heart" (writes a script, then throws it away) — Fast Company mirror https://tagteam.harvard.edu/hub_feeds/2018/feed_items/147789
- Thinking aloud: "If you're watching a guy do a problem (while) thinking out loud, I think people find that more
  valuable and not as daunting"; he "improvises his script, humming and hawing his way through examples he makes up on
  the spot", includes asides like "let me erase this here, or make this bigger"; errors left in —
  https://clubtroppo.com.au/2010/04/26/how-to-teach/index.html
- "Sometimes when it's a little rough, it's going to be a better product than when you overprepare" — https://gazette.com/?p=25143
- Framing: "like we're sitting next to each other at the kitchen table"; "a friendly, disembodied voice and an unseen
  hand writing equations"; "more human to human, even though you don't see his face" —
  https://www.gsb.stanford.edu/insights/salman-khan-keep-it-simple
- Voice quality: "jaunty, conversational, ridiculously awake", "casual", "freeform" (Bidoun); "deep, slightly nasal
  voice", deliberate enunciation (Kirkus, on his audiobook) —
  https://www.kirkusreviews.com/audiobook-reviews/salman-khan/the-one-world-schoolhouse/ ; "He's off camera and
  conversational" (Mercury News mirror, §1); "narrating his steps, explaining details and side-effects, and making
  illustrative mistakes" — https://news.ycombinator.com/item?id=1752355
- KA's house guidance for narrators: "sound like a friend or an older cousin ... explaining a concept to one student
  ... an audience of one"; "clear, friendly, and enthusiastic aspects are integral to KA style"; "a tightrope walk
  between cheerful and cloying"; "it will be best if it doesn't sound like you're reading" (KA-C).
- Signature phrases ("so", "let's see", "this right over here", "let me write this down"): widely imitated but no
  citable analysis found — **unverified** as to frequency; treat as prompt flavour, not fact.
- Introducing terms: no source describes a fixed pattern — **unverified**. Clubtroppo/HN describe him defining things
  informally mid-problem rather than up front.

## 7. Voice candidates (stock TTS only — we are NOT cloning Sal Khan's voice)

- Models: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, `gpt-4o-mini-tts-2025-12-15`. `instructions`: "Control the voice of
  your generated audio with additional instructions. Does not work with `tts-1` or `tts-1-hd`." `speed` 0.25-4.0 —
  https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
- Voices: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin, cedar (13). tts-1/tts-1-hd
  "support a smaller set: alloy, ash, coral, echo, fable, onyx, nova, sage, and shimmer". "For best quality, we
  recommend using marin or cedar." Instructions steer "Accent, Emotional range, Intonation, Impressions, Speed of
  speech, Tone, Whispering" — https://developers.openai.com/api/docs/guides/text-to-speech.md
- OpenAI publishes **no per-voice character descriptions**; demo at https://openai.fm. Third-party descriptions
  (not authoritative, and they disagree): SignalWire — alloy "Neutral, balanced", echo "Warm, expressive", fable
  "British accent, articulate", onyx "Deep, authoritative", nova "Energetic, friendly", shimmer "Soft, gentle"
  https://signalwire.com/docs/platform/voice/tts/openai.md ; Vapi — echo "Warm and engaging", marin "Professional and
  clear", cedar "Natural and conversational" https://docs.vapi.ai/openai-realtime ; community: ash "sounds male",
  onyx "would be a male voice" https://community.openai.com/t/realtime-api-no-male-voice-possible/987412
- Marin/cedar availability on the speech endpoint has been reported as org-gated ("Voice marin is not available for
  your organization") — https://community.openai.com/t/what-are-the-new-gpt-realtime-voices/1375080 ; **unverified** for this account.
- **Recommendations to audition** (ranked; all with `gpt-4o-mini-tts` so `instructions` can ask for "warm, calm,
  unhurried tutor thinking aloud, sitting next to one student"):
  1. **ash** — the voice third parties most consistently call male and calm; mid-pitched rather than booming.
  2. **echo** — described as warm/engaging and leaning male; the "friendly older cousin" register KA-C asks for.
  3. **onyx** — the clearly male, deep option; closest to Kirkus's "deep, slightly nasal"; risk of sounding
     authoritative rather than conversational, so instruct for lightness.
  Also worth one listen: **cedar** ("natural and conversational") if the account has it. Not recommended: fable
  (British), nova/shimmer/coral (read as female/energetic), ballad/verse (melodic/expressive).

## 8. Timing feel

- Length: "these lectures are short—about 10 minutes each" (Chronicle 2010 mirror, §5); Khan's tip 4 "Keep it short
  ... maximum 10 minutes", break big topics into segments (Fast Company mirror, §6); "generally seven to 14 minutes
  long" (Color Class article, §3). The two inspected videos run 7:43 and 11:31 (Frames).
- "A calm, unhurried narrator ... pauses are common ... repetition of previous steps", deliberately "slower than
  typical podcast pace"; "The frame is never cut. The pen keeps writing on the same canvas" (golpoai, §1).
- Writing vs speech: KA's editors "recommend making the writing match the speed at which you speak: if it takes 45
  seconds to write something, and 15 seconds to say it ... speed it up until it's 15 seconds long" (KA-C) — i.e. the
  target feel is handwriting that keeps pace with the voice, never a silent wait for ink.
- "Leaving in some flubs is okay—it'll make you seem relatable and human!" ... "the Khan Style is pretty lightweight
  and not super production-heavy" (KA-C).
- Measured words-per-minute for Sal: **unverified** (no study found; general lecture WPM norms only).

## Proposed token values

Names are frozen (`shared/layout-core/tokens.js`, `player/tokens.css`); only values change.

| Token | Current | Proposed | Rationale | Confidence |
|---|---|---|---|---|
| `boardBg` / `--khan-board-bg` | #1e272d | **#000000** | KA: flood-fill background black; palette image uses #000000; both frames flat black | verified |
| `chalk` / `--khan-chalk` | #f3efe4 | **#FFFFFF** | KA "On black" White; but default body text should usually be an accent, white reserved (§3) | verified |
| `accent1` (yellow) | #ffd166 | **#FFE066** | KA Yellow; Sal's most common "graph/curve" colour | verified |
| `accent2` (blue) | #7fd1e8 | **#65D0FA** | KA Light blue (one of KA-C's five drawing colours) | verified |
| `accent3` (red/coral) | #f28b82 | **#FF8D71** | KA Coral; KA forbids true red on black | verified |
| `accent4` (green) | #9be39f | **#59F3CE** | KA Teal (KA-C's fifth drawing colour); Sal's own green reads ~#2ECC71 but has no official value | verified (value) / estimate (as "green") |
| `accent5` (pink/purple) | #d3b4f0 | **#FB73BE** | KA Pink; Sal's magenta is a signature; purple #A87DFF is the verified alternate | verified |
| `muted` / `--khan-muted` | #8e9aa0 | **#717378** | KA Gray from the same palette (listed for white boards; the only official grey) | verified value / estimate for use on black |
| pen cursor (new or `panelMuted`-adjacent, not yet a token) | — | **white arrow pointer, dark outline, slightly larger than OS default** | KA: point with the mouse cursor, make it bigger; both frames show a white arrow | verified |

Secondary (player chrome, not board): keep `pageBg`/`panelBg` dark-neutral; KA's off-black #21242C is the verified
dark neutral if one is wanted. `fontHand` stays Patrick Hand (OFL) unless the human prefers Kalam's slant after a look.
