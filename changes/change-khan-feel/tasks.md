# Tasks — change-khan-feel

Baseline (recorded once before any edit): `npm test && npm run test:e2e && npm run check` → unit 302 tests: 299 passed, 1 skipped (live TTS), 2 failed only while a khan server is up on port 7777 (environmental, backlog #8); e2e 56 passed; check clean. On 2026-10-13 at main $(git rev-parse --short HEAD). Runtime: unit ≈ 20 s, e2e ≈ 2 m 20 s.
Fast tier: `npm test` plus the builder's own e2e files.   Bootstrap: none yet (`npm install` per worktree; backlog #11).

- [x] 1. Video study → design/02-khan-video-study.md
- [x] 2. Fill proposal deltas; human sees findings (2026-10-13)
- [ ] 3. Build (worktree builders by area)
- [ ] 4. Change-scoped QA
- [ ] 5. Ratchet check and status update (always last)
