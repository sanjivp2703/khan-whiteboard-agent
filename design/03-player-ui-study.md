# 03 — Player UI study: a viewer's chrome for the khan lesson player

Date: 2026-10-13. Mockup: `design/mockups/player-ui.html` (open it directly; buttons at the top switch
Start gate / Playing / Thinking / Ended and a 390 px phone frame). This is a visual target for the
builder, not working code. Scope: chrome only — the board, pen and scene content are unchanged.

## 1. What the chrome shows today (player/engine/ui.js, engine.css, test-results/look/*.png)

A developer's console wearing a viewer's clothes: a status pill (`waiting / armed / playing / paused /
stalled / thinking / ended`) plus a duplicate label, a "Scenes" rail with ids `s001…` and status badges
(`planned / ready / no audio / rejected · degraded`), a top toolbar (Scenes, Pause, Ask, Transcript),
a transcript panel headed `s003 · title` with a `degraded · 2 elements dropped` badge, a notes list
("scene s001 skipped: audio unavailable", "question could not be sent: <error>"), a start card with
"OpenAI key required — <provider reason>", a corner caption "khan is thinking…" / "generation seems
stuck · 42s", and an end summary listing scenes played, degraded scenes, svg elements, questions
answered. Mono-spaced ids and coloured dots signal "pipeline", not "lesson".

## 2. Field notes: how video platforms do it (screenshots taken 2026-10-13)

| Platform | What they do | Borrow |
|---|---|---|
| YouTube watch page | Controls overlay the bottom of the frame and auto-hide ~3 s after the pointer leaves; thin red bar that thickens on hover with a round scrubber; chapters are **gaps in the bar**, hover shows `12:39 How learning relates`; current chapter title sits next to the time (`2:07 / 18:40  Series preview ›`) and opens an "In this video" panel with Chapters / Transcript tabs (thumbnail + title + start time; transcript = timestamped lines); captions are white on a translucent black band inside the frame; buffering = thin spinning arc centred on the frame; end = autoplay-next countdown; `k`/space/←/→ shortcuts with `?` opening a shortcut sheet. | Segmented bar, chapter title beside the time, chapters-or-transcript side panel, hover thickening, arc spinner, shortcut sheet. |
| Khan Academy video page | Light page, but the player is black with a **big blue circular play button** on the poster; while playing: volume/CC/gear top-right, a big centred pause glyph on hover, time + thin bar at the bottom; captions in a black band **below** the frame; "About / Transcript" tabs under the video (timestamped lines, current line in blue); lesson list on the left with a play icon per item and the current item highlighted with a left bar; sticky "Up next: video" button bottom-right. | Big centred play, caption band under the frame (never over the drawing), left-bar highlight for the current item, "up next"-style end action. |
| Vimeo | One full-width translucent bar under the frame: play at far left, a duration chip above the bar, right-aligned icon cluster; nothing else on the frame; captions large, centred. | Extreme restraint, duration chip, icons as a right cluster. |
| Video.js / Plyr demo | Title top-left on the poster; a single 40 px control row (play, volume, `0:00 / 3:03`, bar, CC, gear, cast, PiP, fullscreen); bar hidden with controls when idle. | One-row controls, the `elapsed / total` pair in one phrase, muted total. |
| Mux Player | Brand-coloured 3 px bar above a 40 px row: pause, −10/+10, time, mute, `…`, `1x`, PiP; everything else hidden. | Bar-above-row ordering, 40–48 px row, ±skip glyphs (khan's ←/→ become "previous / next chapter"). |

Common ground: dark chrome, one control row, **time and current chapter in the same row**, the
progress bar is the chapter navigation, transcript is a panel you opt into, captions are one or two
lines, loading is a quiet spinner, nothing on screen names an internal state.

## 3. Keep / rephrase / hide / move — every current chrome item

| Current item | Decision | New treatment |
|---|---|---|
| Status pill `waiting/armed/…` (`state`) | Hide | Stays in the DOM as `.sr-only` with the same text; the play/pause glyph and the thinking indicator are the only visible state. |
| `state-label` ("ready to start", "waiting for the next scene") | Hide | Replaced by the start hint and the thinking pill. |
| Lesson title | Keep | 15 px/600 in a 44 px top bar next to a hand-written "khan" mark. |
| Pause / Resume button | Rephrase | Icon-only play/pause (40 px), `aria-label` Pause / Play, first in the control row. |
| Ask button | Rephrase | "Ask khan" pill in accent1 with a sparkle glyph; same `ask-button` testid; disabled = grey pill. |
| Scenes toggle (`sidebar-toggle`) | Move | Chapters icon-button in the top bar (and `s`). |
| Transcript toggle | Move | Icon-button at the right of the control row (and `t`); toggles the strip between 1–2 lines and full text. |
| "Scenes" rail with ids and badges (`sidebar`, `sidebar-item-*`) | Rephrase | "Chapters" panel beside the board: number · title · duration. No ids, no badges. Played = muted, current = accent1 left bar + tinted row, not-ready = dimmed with "soon" in place of the duration and `aria-disabled`. Answer scenes = `?` in accent2, italic title. |
| Coloured status dots | Hide | Colour is reserved for the current chapter. |
| Start gate card + "Click to start…" | Rephrase | Scrim over the board, lesson title, 88 px accent1 circular play, hint "6 chapters · about 9 min · press space to start". |
| `tts-missing-note` "OpenAI key required — <reason>" | Rephrase | One plain banner under the control bar, only before start: "No voice yet — add your OpenAI key to hear khan speak." A key rejected mid-lesson: "Voice unavailable right now — the board keeps going." Never the provider's error text. |
| Caption "khan is thinking…" (`caption`) | Keep | Corner pill with three pulsing dots; same text. |
| Caption "generation seems stuck · 42s" | Rephrase | Same pill, text "Still thinking… this is taking longer than usual." No ages or counts. |
| Transcript meta `s003 · title` | Rephrase | Chapter title only, and only when the transcript is expanded. |
| `degraded · N elements dropped` | Hide | Developer signal; stays in the DOM `hidden`. |
| Transcript text | Keep | 15 px/1.5 under the control bar, clamped to 2 lines; `t` expands to full text (max 30 vh, scroll). |
| Notes list `scene s001 skipped: audio unavailable` | Rephrase | One quiet line under the transcript: "Skipped one chapter that had no voice." (`scene-skipped-note`). |
| `question could not be sent: <error>` | Rephrase | "Your question didn't go through — try again." |
| `answering your question` badge | Hide | The inserted "Your question: …" chapter in the panel is the signal. |
| End summary (scenes, degraded, svg, questions) | Rephrase | Card "Lesson complete" + "<title> · 6 chapters · you asked 1 question" (questions line only when > 0) + Replay / Ask khan + "or pick a chapter to watch it again". The `<dl>` stays `.sr-only` so `summary-*` testids and `data-*` counts survive. |
| Debug aside (`#debug`) | Keep hidden | Unchanged. |

## 4. Layout and measurements (desktop ≥ 641 px)

```
┌ top bar 44 px: khan · Lesson title ……………………… [⌨] [≡ chapters] ┐
│ ┌──────────────── board, largest 16:9, 16 px gutter ───────────┐ │ chapters 280 px │
│ │            (only pen, corner pill, modal moments)            │ │ 44 px rows      │
│ └──────────────────────────────────────────────────────────────┘ │                 │
│ progress 4 px (6 px hover) in a 16 px hit zone, 3 px gaps/scene  │                 │
│ row 48 px: [▶] 3:48 / 9:20 │ CHAPTER 3 OF 6 · title …  [✦ Ask khan] [▤] │          │
│ transcript strip: 2-line caption 15 px; expands to ≤ 30 vh       │                 │
└──────────────────────────────────────────────────────────────────┴─────────────────┘
```

- Page bg `--khan-page-bg`; board `--khan-board-bg` with 10 px radius; borders `--khan-chrome-border`.
- Top bar: title 15 px/600, icon buttons 36 px (20 px glyphs, 10 px radius).
- Progress: one flex segment per scene weighted by known duration (planned scenes share an estimate);
  played fill `--khan-progress-played`; not-ready segments use a dotted `--khan-progress-pending`;
  hover tooltip "5:12  Why hits are cheap" (12 px) above the bar; 12 px knob only on the current
  segment on hover. Click/drag = jump (existing `onJump` to that scene; within-scene scrub later).
- Row: 13 px tabular time (elapsed bright, total muted; total shows "~" while scenes are unplanned),
  11 px uppercase "CHAPTER 3 OF 6" over a 14 px/500 title, Ask khan pill 36 px high.
- Transcript: 15 px/1.5, `-webkit-line-clamp: 2`; expanded shows the chapter heading (12 px muted).
- Chapters: heading 12 px/600 uppercase 0.08 em; rows 44 px, number 12 px, title 14 px, duration 12 px.
- Overlays: start scrim `--khan-overlay-scrim` + 2 px blur; play 88 px (72 px on phones); end card
  28 × 36 px padding, 16 px radius, 22 px title, 40 px pill actions; ask form 560 px wide at bottom 14 %.

Phone (≤ 640 px or the mock's frame): one scrolling column — top bar, board full width, bar + 44 px row
(chapter title and the "Ask khan" label drop; the sparkle stays), transcript, then chapters as a list.
The question form becomes a bottom sheet over the board. Nothing ever needs horizontal scroll at 320 px.

## 5. Proposed chrome-only tokens (additive; names frozen once approved)

| Token | Value | Use |
|---|---|---|
| `--khan-chrome-bg` | `#15171C` | ask form / end card surface (between page and panel) |
| `--khan-chrome-border` | `rgba(255,255,255,0.08)` | hairlines |
| `--khan-chrome-hover` | `rgba(255,255,255,0.08)` | button hover, secondary pill |
| `--khan-chrome-active` | `rgba(255,224,102,0.14)` | current chapter row, pressed toggles |
| `--khan-chrome-font` | `Inter, system-ui, …` | all chrome text (Inter via Google Fonts, optional) |
| `--khan-progress-track` / `-played` / `-pending` | `rgba(255,255,255,0.18)` / `var(--khan-accent1)` / `rgba(255,255,255,0.07)` | progress bar |
| `--khan-overlay-scrim` | `rgba(0,0,0,0.58)` | start and end scrims |
| `--khan-focus` | `var(--khan-accent2)` | focus rings |
| `--khan-radius-sm/md/lg/pill` | `6 / 10 / 16 / 999 px` | corners |
| `--khan-chrome-idle` | `0.72` | control-bar opacity when idle |
| `--khan-motion-fast/slow` | `160 / 320 ms` | transitions (all off under reduced motion) |

Contrast on `#0B0C0F`: panel-text 15.6:1, panel-muted 7.3:1, accent1 on black for the bar 15:1; black
text on the accent1 pill 15:1. All chrome text ≥ 4.5:1.

## 6. Interaction rules

- **Always visible, never over the board.** Hover-reveal exists on YouTube because controls cover the
  picture; ours sit outside the 16:9 box, so hiding would only cost discoverability. Instead the control
  bar fades to `--khan-chrome-idle` after 3 s without pointer/keyboard activity while playing and
  returns to 1 on movement, hover or focus (320 ms). The chapters panel stays as the user left it
  (`s` pins/unpins; it still auto-opens when not playing).
- Progress bar thickens 4 → 6 px on hover; the current segment grows a knob; tooltip names the chapter.
- Keyboard, unchanged: `space` start / pause / resume, `←` `→` previous / next chapter, `?` Ask,
  `Esc` cancel, `s` chapters, `t` transcript. The ⌨ button in the top bar opens a shortcut sheet.
- Thinking: pill in the board's bottom-right with pulsing dots; the question form floats over the
  lower part of the board; the play glyph shows ▶ (paused) during the wait.
- End: scrim + card; Replay restarts (existing jump to the first scene), Ask khan opens the form,
  chapters stay clickable; the end card stays until the user acts.
- Reduced motion: no pulses, no transitions.

## 7. User-visible strings

Top bar: "khan", lesson title · Start: "<title>", "6 chapters · about 9 min · press space to start",
"Preparing the first chapter…" (armed) · Voice: "No voice yet — add your OpenAI key to hear khan
speak.", "Voice unavailable right now — the board keeps going." ·
Controls: "Pause" / "Play", "3:48 / 9:20", "Chapter 3 of 6", chapter title, "Ask khan", "Transcript",
"Chapters", "Keyboard shortcuts" · Chapters panel: "Chapters", "soon", "Your question: …" ·
Thinking: "khan is thinking…", "Still thinking… this is taking longer than usual." · Ask form:
placeholder "Ask khan anything about this lesson…", "Ask", "Esc" · Notes: "Skipped one chapter that
had no voice.", "Your question didn't go through — try again." · End: "Lesson complete", "<title> ·
N chapters · you asked N question(s)", "Replay", "Ask khan", "or pick a chapter to watch it again".
