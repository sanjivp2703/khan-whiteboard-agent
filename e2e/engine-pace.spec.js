// change-khan-feel items 1, 2, 5, 6 — writing pace (spec §6 "Writing pace"): an element is written
// at handwriting speed (PEN_PX_PER_S + micro-pauses) and the pen then hovers on it for the rest of
// its window; the first element starts talk-first (≈ 0.08 of the audio); the pen travels between
// elements with a short tween; a draw is compressed to its window only as a last resort (logged).
// qa/04 finding 1 (fix): omitted-`at` windows are shared by need, and the last element is compressed
// to D + yieldCapMs when it cannot finish inside the yield hold, so nothing pops in at scene end
// (engine-clock criterion 4 still owns the hold itself).
// Real renderers, real fixtures. Measured at 550 px/s against glyph outline length: fx-long-stroke
// s001 "Pen versus voice" ≈ 2.3 s of ink in a ≈ 9.4 s window; fx-core-dense s001 code14 ≈ 25 s of
// ink in a ≈ 5.3 s window (the dense fixture is dense on purpose).
import { test, expect } from '@playwright/test';
import { makeLesson, openLesson, collectErrors, engine } from './engine-helpers.js';
import { TIMING, PEN_PX_PER_S, PEN_TRAVEL_MS } from '../shared/layout-core/constants.js';

/** The current scene's timeline items plus the audio duration. */
const timelineOf = (page) => page.evaluate(() => { const c = window.__khan.engine.current; return { D: c.durationMs, items: c.timeline.map((it) => ({ ...it })) }; });

/** Sample the audio clock and the pen every ~`everyMs` of wall time until the clock passes `untilMs` (scene ms). */
const samplePen = (page, untilMs, everyMs = 60) => page.evaluate(async ([until, every]) => {
  const out = [];
  const e = window.__khan.engine;
  for (let i = 0; i < 2000; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const t = e.audio.currentTime * 1000;
    out.push({ t, scene: e.position.sceneId, paintT: e.current ? e.current.lastPaintT : null, mode: e.pen.mode, travelling: e.pen.travelling, pos: e.pen.pos, tip: e.pen.tip, drawn: e.drawnElementIds() });
    if (t >= until || e.state !== 'playing') break;
    await new Promise((r) => setTimeout(r, every));
  }
  return out;
}, [untilMs, everyMs]);

test('natural speed then hover: fx-long-stroke s001 at playbackRate 1 — the title is written at PEN_PX_PER_S, finishes well before its window ends, the pen hovers on it afterwards; talk-first start', async ({ page }) => {
  test.setTimeout(60_000);
  expect(PEN_PX_PER_S).toBe(550);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-long-stroke');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 1 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 0.02);
  const { D, items } = await timelineOf(page);
  expect(items.map((it) => it.id)).toEqual(['intro']);
  const title = items[0];
  // talk first: the default first `at` is 0.08 of the audio, not 0
  expect(title.start).toBeCloseTo(TIMING.firstAt * D, 0);
  expect(title.start).toBeGreaterThan(500);
  // natural speed: real glyph outlines at 550 px/s plus two word gaps; not stretched to the window, not compressed
  const draw = title.drawEnd - title.start;
  const window = title.windowEnd - title.start;
  expect(title.compressed).toBe(false);
  expect(title.naturalMs).toBeGreaterThan(1000);
  expect(title.pauseMs).toBe(240); // "Pen versus voice": 3 words, 1 line → 2 word gaps × 120 ms
  expect(draw).toBeCloseTo(title.naturalMs + title.pauseMs, 3);
  expect(draw).toBeLessThan(window * 0.5);
  console.log(`[pace] fx-long-stroke/s001 intro: ink ${Math.round(draw)} ms (natural ${Math.round(title.naturalMs)} + pauses ${Math.round(title.pauseMs)}) of a ${Math.round(window)} ms window (${Math.round((100 * draw) / window)} %); starts at ${Math.round(title.start)} ms of D = ${D} ms`);
  // through the window: draw while the ink is laid down, hover afterwards; never park/idle while playing
  const samples = (await samplePen(page, title.windowEnd - 600)).filter((s) => s.scene === 's001');
  const before = samples.filter((s) => s.t < title.start - 50);
  const during = samples.filter((s) => s.t > title.start + 150 && s.t < title.drawEnd - 150);
  const after = samples.filter((s) => s.t > title.drawEnd + 100 && s.t < title.windowEnd - 600);
  expect(before.length).toBeGreaterThan(2);
  for (const s of before) { expect(s.mode, `t=${s.t}`).toBe('hover'); expect(s.drawn).toEqual([]); } // the pen waits at the first element while the voice leads
  expect(during.length).toBeGreaterThan(5);
  for (const s of during) { expect(s.mode, `t=${s.t}`).toBe('draw'); expect(s.drawn).toEqual(['intro']); }
  expect(after.length).toBeGreaterThan(10);
  for (const s of after) {
    expect(s.mode, `t=${s.t}`).toBe('hover');
    expect(s.travelling).toBe(false);
    expect(s.pos).toEqual(s.tip); // resting on the element's end point (the drift is drawn, not reported)
    expect(s.paintT, `painted clock at t=${s.t}`).toBeGreaterThanOrEqual(title.drawEnd); // the ink is complete (u = 1) while the pen hovers
  }
  // the pen tip advanced along the title while writing (it is not parked), and rests at the end afterwards
  const xs = during.map((s) => s.tip.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50);
  const rest = new Set(after.map((s) => `${Math.round(s.tip.x)},${Math.round(s.tip.y)}`));
  expect(rest.size).toBe(1);
  expect(errors).toEqual([]);
});

// MODIFIED (qa/04 finding 1a): fx-build-region s001 (a title and a 7 s box in a 10.6 s narration) has no slack
// once the windows are shared by need — the title's window is its ink time, so there is no hover to
// observe. The same travel is asserted on fx-type-sketch s003 (a small circle in A1, then a server in
// B1:F4, 1.2 s of parking between them); the assertions are unchanged.
test('travel: fx-type-sketch s003 — once the small circle is drawn the pen hovers on it, then travels (tweened, anticipating by PEN_TRAVEL_MS) to the server sketch and arrives as its ink begins', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-type-sketch');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 1 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's003', 0.02, 60_000);
  const { items } = await timelineOf(page);
  expect(items.map((it) => it.id)).toEqual(['tiny', 'big']);
  const [title, cache] = items;
  expect(title.compressed).toBe(false);
  expect(title.drawEnd).toBeLessThan(cache.start - PEN_TRAVEL_MS - 500); // room to hover, then travel
  console.log(`[pace] fx-type-sketch/s003 tiny: ink ${Math.round(title.drawEnd - title.start)} ms of a ${Math.round(title.windowEnd - title.start)} ms window; big starts at ${Math.round(cache.start)} ms`);
  const samples = (await samplePen(page, cache.start + 1200, 25)).filter((s) => s.scene === 's003');
  const hovering = samples.filter((s) => s.t > title.drawEnd + 100 && s.t < cache.start - PEN_TRAVEL_MS - 50);
  expect(hovering.length).toBeGreaterThan(5);
  for (const s of hovering) { expect(s.mode, `t=${s.t}`).toBe('hover'); expect(s.travelling).toBe(false); }
  const titleEnd = hovering[0].tip;
  // the travel window: once the title is written the pen is on its way to the box's first point before the box starts
  // (a line return inside an element may also travel; only the element-to-element trip is asserted here)
  const travelling = samples.filter((s) => s.travelling && s.t > title.drawEnd);
  expect(travelling.length).toBeGreaterThan(1);
  const first = travelling[0];
  expect(first.t).toBeGreaterThanOrEqual(cache.start - PEN_TRAVEL_MS - 120);
  expect(first.t).toBeLessThan(cache.start + 120);
  for (const s of travelling) expect(Math.hypot(s.tip.x - titleEnd.x, s.tip.y - titleEnd.y)).toBeGreaterThan(30); // the target is the server sketch, far from the circle's end
  // the arrow leaves the title's end and closes in on the target; it never jumps
  const d0 = Math.hypot(first.pos.x - first.tip.x, first.pos.y - first.tip.y);
  const dl = travelling.at(-1);
  const d1 = Math.hypot(dl.pos.x - dl.tip.x, dl.pos.y - dl.tip.y);
  expect(d0).toBeGreaterThan(d1);
  // arrived: shortly after the box starts the arrow sits on the tip and follows the ink in draw mode
  const landed = samples.filter((s) => s.t > cache.start + PEN_TRAVEL_MS + 150);
  expect(landed.length).toBeGreaterThan(3);
  for (const s of landed) { expect(s.travelling, `t=${s.t}`).toBe(false); expect(s.mode).toBe('draw'); expect(s.pos).toEqual(s.tip); expect(s.drawn).toEqual(['tiny', 'big']); }
  expect(errors).toEqual([]);
});

// MODIFIED (qa/04 finding 1b): six8, the last element, used to keep its 37 s of natural time and snap in at the
// cap; it is now compressed to D + cap like the others and logged.
test('last resort: fx-core-dense s001 — code14 cannot be written in its window at hand speed → compressed to the window and logged with its ratio; the last element is compressed to D + cap (no pop-in) and the yield rule still ends the scene', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-core-dense');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 2 } });
  await engine.waitForStatuses(page, { s001: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 0.02);
  const { D, items } = await timelineOf(page);
  expect(items.map((it) => it.id)).toEqual(['code14', 'six8']);
  const [code, list] = items;
  expect(code.compressed).toBe(true);
  expect(code.ratio).toBeGreaterThan(1.5);
  expect(code.drawEnd).toBeCloseTo(code.windowEnd, 3);
  expect(code.drawEnd).toBeLessThanOrEqual(list.start + 1e-6);
  expect(code.pauseMs).toBe(13 * 250); // 14 code lines → 13 line gaps (one part: folded into the stroke time)
  const cap = await page.evaluate(() => window.__khan.engine.config.yieldCapMs);
  console.log(`[pace] fx-core-dense/s001 code14: needs ${Math.round(code.naturalMs + code.pauseMs)} ms, window ${Math.round(code.windowEnd - code.start)} ms → compressed ×${code.ratio.toFixed(2)}; six8 needs ${Math.round(list.naturalMs + list.pauseMs)} ms for a ${Math.round(list.windowEnd - list.start)} ms window → compressed ×${list.ratio.toFixed(2)} to D + cap (${Math.round(D + cap)} ms)`);
  const ev = (await engine.events(page)).find((e) => e.type === 'compressed' && e.sceneId === 's001' && e.id === 'code14');
  expect(ev).toBeTruthy();
  expect(ev.ratio).toBeCloseTo(Math.round(code.ratio * 100) / 100, 2);
  expect(ev.windowMs).toBe(Math.round(code.windowEnd - code.start));
  // the windows are shared by need (finding 1a): the talk-first start is kept and six8 (the bigger need) starts no earlier than the even split would have put it
  expect(code.start).toBeCloseTo(TIMING.firstAt * D, 0);
  expect(list.windowEnd).toBeCloseTo(TIMING.lastWindowEnd * D, 0);
  // the last element cannot finish inside the hold (37 s of ink): compressed to D + cap, so it is complete the moment the
  // hold ends instead of 70 % of it snapping in; it still has holds between its six items
  expect(list.last).toBe(true);
  expect(list.compressed).toBe(true);
  expect(list.ratio).toBeGreaterThan(1.5);
  expect(list.drawEnd).toBeCloseTo(D + cap, 3);
  expect(list.drawEnd).toBeGreaterThan(D);
  expect(list.segs.length).toBe(6);
  for (let i = 1; i < list.segs.length; i++) expect(list.segs[i].t0).toBeGreaterThan(list.segs[i - 1].t1);
  expect((await engine.events(page)).filter((e) => e.type === 'compressed' && e.sceneId === 's001').map((e) => e.id)).toEqual(['code14', 'six8']);
  // the yield rule decides the scene end: complete no earlier than audio end, no later than audio end + cap (+ tolerance); snapped since the list is far from done
  await page.waitForFunction(() => window.__khan.engine.events.some((e) => e.type === 'scene-complete' && e.sceneId === 's001'), null, { timeout: 60_000 });
  const events = await engine.events(page);
  const endedAt = events.find((e) => e.type === 'audio-ended' && e.sceneId === 's001').at;
  const complete = events.find((e) => e.type === 'scene-complete' && e.sceneId === 's001');
  expect(complete.at).toBeGreaterThanOrEqual(endedAt);
  expect(complete.at - endedAt).toBeLessThanOrEqual(cap + 200);
  expect(complete.holdMs).toBeLessThanOrEqual(cap + 200);
  expect(complete.snap).toBe(true);
  expect(errors).toEqual([]);
});

test('micro-pauses: fx-build-region s003 — a list with itemAt reveals its items with a line-gap hold between parts (u plateaus at the part boundary)', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-build-region');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready', s004: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's003', 0.02, 60_000);
  const { items } = await timelineOf(page);
  const steps = items.find((it) => it.id === 'steps');
  expect(steps.start).toBe(0); // explicit at: 0 is honoured (no talk-first offset)
  expect(steps.compressed).toBe(false);
  expect(steps.pauseMs).toBe(1 * 120 + 2 * 250); // "hash", "look up", "serve": 4 words over 3 lines → 1 word gap, 2 line gaps
  expect(steps.segs.length).toBe(3);
  const [a, b, c] = steps.segs;
  expect(b.t0 - a.t1).toBeCloseTo(250, 3);
  expect(c.t0 - b.t1).toBeCloseTo(250, 3);
  expect(c.t1).toBeCloseTo(steps.drawEnd - steps.start, 3);
  // the hold is visible: the painted progress of the list sits at the first part boundary for the hold
  const u = await page.evaluate((it) => {
    const d = window.__khan.engine.current.drawables.get(it.id);
    const seg = it.segs[0];
    const probe = (e) => { for (const s of it.segs) { if (e < s.t0) return s.u0; if (e < s.t1) return s.u0 + (s.u1 - s.u0) * ((e - s.t0) / (s.t1 - s.t0)); } return 1; };
    const mid = probe(seg.t1 + 125);
    return { mid, parts: d.partStarts, completeAtHold: d.progress(mid).completeCount, completeBefore: d.progress(probe(seg.t1 - 1)).completeCount, totalStrokes: d.strokes.length };
  }, steps);
  expect(u.mid).toBeCloseTo(u.parts[1], 6);
  expect(u.completeAtHold).toBeGreaterThan(0);
  expect(u.completeBefore).toBeLessThanOrEqual(u.completeAtHold);
  expect(u.completeAtHold).toBeLessThan(u.totalStrokes);
  expect(errors).toEqual([]);
});
