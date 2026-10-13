# change-khan-feel

**Lane:** change
**Requested:** 2026-10-13, by the human: "Do more research to optimize how the video works. Watch a bunch of Khan Academy videos, identify different components to replicate ... style of the font, style of pictures, general movement, when something is drawn or instantly generated ... note down ways to improve the video generation software to make it more similar to Khan Academy. Then implement it."
**Status:** research in progress (design/02-khan-video-study.md); build approved in advance by the human ("Then implement it"); proposal deltas to be filled from the study before builders start

## Why
The look (black board, palette, cursor, voice) is done; the *feel* of how things appear over time, the handwriting, the math, and the pacing have not been compared against real Sal Khan videos.

## What changes
To be filled from the study.

## Spec deltas
To be filled.

## Unchanged behavior
- Scene-script contract (khan-scene/1), element vocabulary and validator caps unchanged unless a delta says otherwise.
- Audio clock remains the only clock; yield-to-pen rule unchanged.
- Token names unchanged.

## Risk
low–medium: visual timing and rendering changes; covered by the harness screenshots, timing e2e tests and a human viewing.

## Design assets
none
