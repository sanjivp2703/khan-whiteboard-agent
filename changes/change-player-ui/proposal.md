# change-player-ui

**Lane:** change
**Requested:** 2026-10-13, by the human: "look at other similar video viewing sites/platforms. Take inspiration of them, and update the UI to make it more visually pleasing, modern, and intuitive. Also, only include the information that is needed and useful for the user, not a developer."
**Status:** research in progress (design/03-player-ui-study.md + design/mockups/player-ui.html); build approved in advance by the human; mockup to be shown to the human before builders start

## Why
The player chrome was built by the engine slice for testability: status pills, scene ids, ready/planned badges, degraded and svg counts, error codes. A viewer needs none of that.

## What changes
To be filled from the study: video-platform idiom (bottom control bar with a chaptered progress bar, chapter titles, captions, Ask khan, big centered play), developer details hidden, plain-language messages.

## Spec deltas
To be filled.

## Unchanged behavior
- All frozen data-testids and keyboard shortcuts keep working (the `state` testid may be visually hidden).
- Chrome never covers the board during playback except pen, corner caption, and modal moments.
- Engine state machine, scheduler, questions and resume unchanged.

## Risk
low: presentation only; e2e tests cover the testids and layout containment.

## Design assets
none (mockup is HTML, approved by the human before build)
