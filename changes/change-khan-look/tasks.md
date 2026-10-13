# Tasks — change-khan-look

Baseline (recorded once before any edit): `npm test && npm run test:e2e && npm run check` → unit 273 tests: 272 passed, 1 skipped (live TTS), 0 failed; e2e 51 passed, 0 failed; check clean. On 2026-10-12 at main 3543afc (code identical to v0.1.0 tag 1ac1cd7). Runtime: unit ≈ 20 s, e2e ≈ 2 m 10 s.
Fast tier: `npm test` (≈ 20 s) plus the e2e spec files for the builder's own area (`npx playwright test e2e/<area>-*.spec.js`).   Bootstrap: none yet (`npm install` per worktree; a `scripts/bootstrap.sh` is backlog #11).

- [x] 1. Research the Khan Academy look and voice candidates with sources → design/01-khan-look-research.md (2026-10-12)
- [x] 2. Human approval of token values and voice plan (checkpoints.md, Checkpoint 2)
- [x] 3. Voice half: provider model/voice/instructions, cache key, `khan audition`, SKILL.md color + narration rules, README (branch worktree-agent-a619af890bcc355de, merged to main)
- [ ] 4. Look half: token values, chrome tokens, arrow cursor, stroke width/pressure, token-pin test, screenshot inspection (branch worktree-agent-af5571e187f9007ee, building)
- [ ] 5. Merge look half; full tier; change-scoped qa-tester run against "Unchanged behavior"
- [ ] 6. Ratchet check and status update (always last): passing count ≥ 272 (+ new tests), skipped ≤ 1, no test weakened; merge deltas into spec.md; archive folder; design-tokens row → done; release v0.2.0 as pre-release pending the human audition and first real lesson
