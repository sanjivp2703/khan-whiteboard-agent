# change-player-ui

**Lane:** change
**Requested:** 2026-10-13, by the human: "look at other similar video viewing sites/platforms. Take inspiration of them, and update the UI to make it more visually pleasing, modern, and intuitive. Also, only include the information that is needed and useful for the user, not a developer."
**Status:** approved in advance by the human (2026-10-13); study and mockup done (design/03-player-ui-study.md, design/mockups/player-ui.html, published to the human); build started 2026-10-13

## Why
The player chrome was built by the engine slice for testability: status pills, scene ids, ready/planned badges, degraded and svg counts, error codes. A viewer needs none of that.

## What changes
The chrome becomes a viewer's video player (design/03-player-ui-study.md §3–§7): a 44 px top bar (khan mark, lesson title, shortcuts, chapters toggle); the board; directly under it a control bar with a chaptered progress bar (one segment per scene, dotted when not ready, click jumps to that scene), a 48 px row (play/pause, elapsed / total, "Chapter N of M · title", "Ask khan" pill, transcript toggle); a 2-line caption strip that expands to the full transcript; a "Chapters" panel beside the board (number · title · duration; no ids or badges; not-ready dimmed "soon"; answer scenes italic with "?"); a start gate with the title and an 88 px circular play; a thinking pill with pulsing dots; an end card "Lesson complete · <title> · N chapters [· you asked N questions]" with Replay and Ask khan. Developer details (state names, scene ids, ready/planned/degraded/svg counts, error codes) are removed from view; a missing or rejected key becomes one plain sentence. The control bar dims to 0.72 after 3 s idle while playing; nothing covers the board except pen, corner pill and modal moments. Phone width stacks into one column.

## Spec deltas

### ADDED
- Under "6. Live playback model": "**Player chrome (viewer-facing).** Chrome shows only what a viewer needs: lesson title, play/pause, a chaptered progress bar (one segment per scene; not-ready scenes dotted; click jumps to a scene), elapsed/total time, current chapter title, Ask khan, transcript toggle, a Chapters panel (titles and durations, no ids or statuses), a start gate, a thinking indicator, and an end card with Replay and Ask. Internal state names, scene ids, ready/degraded/svg counts and provider error text are never displayed (they remain in the DOM for tests as visually hidden text). A missing or rejected voice key is one plain sentence."

### MODIFIED
- Under "10. Non-functional constraints": replace "a live transcript of the current narration is visible under the board" with "a live caption of the current narration (two lines, expandable to the full transcript) is visible under the board's control bar".

### REMOVED
- none

## Unchanged behavior
- All frozen data-testids and keyboard shortcuts keep working (the `state` testid may be visually hidden).
- Chrome never covers the board during playback except pen, corner caption, and modal moments.
- Engine state machine, scheduler, questions and resume unchanged.

## Risk
low: presentation only; e2e tests cover the testids and layout containment.

## Design assets
none (mockup is HTML, approved by the human before build)
