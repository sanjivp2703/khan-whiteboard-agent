// Slice 04 — questions and the resume stack (spec §7, §11 "Resume after question").
// Criteria 10, 11, 12, 13 of briefs/04-player-engine.md. The test acts as the producer.
import { test, expect } from '@playwright/test';
import { makeLesson, openLesson, collectErrors, recordPosts, engine, fixtureScene, expectSameSet, sleep } from './engine-helpers.js';

const ANSWER_IDS = ['a1', 'a2', 'b1'];

/** Start fx-answer-insert's lesson scenes and get to s002 at t ≥ 3 s. */
async function startAtS002(page, lesson, rate = 2) {
  lesson.writeAll(['s001', 's002', 's003', 's004']);
  await openLesson(page, lesson.lessonId, { config: { playbackRate: rate } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready', s004: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'playing');
  await page.getByTestId('sidebar-item-s002').click();
  await engine.waitForSceneTime(page, 's002', 3.0, 30_000);
  await page.locator('body').focus();
}

async function askNow(page, text) {
  await page.keyboard.press('Shift+?');
  await expect(page.getByTestId('state')).toHaveText('thinking');
  await expect(page.getByTestId('question-input')).toBeFocused();
  const stack = await engine.stack(page);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  return stack[stack.length - 1];
}

/** Every scene start so far, in order, as "sceneId" or "sceneId(resume)". */
async function sceneStarts(page) {
  return (await engine.events(page)).filter((e) => e.type === 'scene-start').map((e) => `${e.sceneId}${e.resume ? '(resume)' : ''}`);
}

/** Wait for the `resume` event into sceneId and return it (t at the instant of resumption). */
async function waitForResume(page, sceneId, timeout = 40_000) {
  await page.waitForFunction((id) => window.__khan.engine.events.some((e) => e.type === 'resume' && e.sceneId === id), sceneId, { timeout, polling: 15 });
  const ev = (await engine.events(page)).filter((e) => e.type === 'resume' && e.sceneId === sceneId).pop();
  const live = await page.evaluate(() => ({ state: window.__khan.engine.state, position: window.__khan.engine.position, drawn: window.__khan.engine.drawnElementIds(), audio: window.__khan.engine.audio.currentTime, stack: window.__khan.engine.resumeStack }));
  return { ev, live };
}

test('criterion 10: ask at t≈3 of s002 → thinking, stack depth 1, input focused; POST carries the position; answers play in order; resume restores board, time and state', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-answer-insert');
  await startAtS002(page, lesson);
  const top = await askNow(page, 'why does the second scene matter?');
  expect(top.sceneId).toBe('s002');
  expect(top.t).toBeGreaterThanOrEqual(3);
  expect(top.t).toBeLessThan(4.5);
  expect((await engine.stack(page)).length).toBe(1);
  await expect(page.getByTestId('caption')).toHaveText('khan is thinking…');
  expect(await page.evaluate(() => window.__khan.engine.pen.mode)).toBe('idle');
  expect((await engine.audio(page)).paused).toBe(true);
  await expect.poll(() => posts.filter((p) => p.kind === 'question').length).toBe(1);
  const q = posts.find((p) => p.kind === 'question');
  expect(q).toEqual(expect.objectContaining({ text: 'why does the second scene matter?', atSceneId: 's002' }));
  expect(Math.abs(q.atTime - top.t)).toBeLessThan(0.01);
  // the producer answers with two scenes (insertAfter is already s002 in the fixture)
  lesson.writeScene('q001-a01');
  await engine.waitForScene(page, 'q001-a01', 30_000);
  expect(await engine.state(page)).toBe('playing');
  await expect(page.getByTestId('answering-badge')).toBeVisible();
  expect(await engine.drawn(page)).not.toEqual(expect.arrayContaining(['t2'])); // answers draw on a fresh board (wipe)
  await expect(page.getByTestId('sidebar-item-q001-a01')).toHaveAttribute('aria-current', 'true');
  lesson.writeScene('q001-a02');
  await engine.waitForScene(page, 'q001-a02', 30_000);
  expect(await engine.drawn(page)).toEqual(expect.arrayContaining(['a1'])); // a02 is a region on a01's board
  const { ev, live } = await waitForResume(page, 's002');
  expect(Math.abs(ev.t - top.t)).toBeLessThan(0.01);
  expect(live.state).toBe('playing');
  expect(live.position.sceneId).toBe('s002');
  expect(Math.abs(live.audio - top.t)).toBeLessThanOrEqual(0.25);
  expect(live.stack).toEqual([]);
  // board = s002 elements with start < t (t2 at 0) plus earlier elements since the last wipe (none: s002 wipes), nothing from the answers
  const s002 = fixtureScene('fx-answer-insert', 's002');
  expectSameSet(live.drawn, s002.elements.map((e) => e.id));
  expect(live.drawn.some((id) => ANSWER_IDS.includes(id))).toBe(false);
  await expect(page.getByTestId('answering-badge')).toBeHidden();
  // positions: a01 start/end, a02 start/end, then s002 start again
  const seq = posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`);
  expect(seq.slice(seq.indexOf('start q001-a01'))).toEqual(['start q001-a01', 'end q001-a01', 'start q001-a02', 'end q001-a02', 'start s002']);
  // spec §7 step 5 (QA finding 1): the resumed s002 plays out and the lesson continues with s003 — the answers do NOT replay
  await engine.waitForScene(page, 's003', 40_000);
  expect(await sceneStarts(page)).toEqual(['s001', 's002', 'q001-a01', 'q001-a02', 's002(resume)', 's003']);
  const seq2 = posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`);
  expect(seq2.slice(seq2.lastIndexOf('start s002'))).toEqual(['start s002', 'end s002', 'start s003']);
  expect(errors).toEqual([]);
});

test('criterion 11: nested questions — depth 2 returns to q001-a01 then s002; depth 3 disables Ask until the stack unwinds', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-answer-insert');
  await startAtS002(page, lesson, 2);
  const top1 = await askNow(page, 'first question');
  lesson.writeScene('q001-a01');
  await engine.waitForSceneTime(page, 'q001-a01', 2.0, 30_000);
  // nested: ask during the answer
  const top2 = await askNow(page, 'second question, nested');
  expect(top2.sceneId).toBe('q001-a01');
  expect(top2.t).toBeGreaterThanOrEqual(2);
  expect((await engine.stack(page)).map((e) => e.sceneId)).toEqual(['s002', 'q001-a01']);
  await expect.poll(() => posts.filter((p) => p.kind === 'question').length).toBe(2);
  expect(posts.filter((p) => p.kind === 'question')[1]).toEqual(expect.objectContaining({ atSceneId: 'q001-a01' }));
  lesson.writeScene('q002-a01'); // insertAfter q001-a01, final
  await engine.waitForSceneTime(page, 'q002-a01', 1.0, 30_000);
  // depth 3: ask during the nested answer
  const top3 = await askNow(page, 'third question, depth three');
  expect(top3.sceneId).toBe('q002-a01');
  expect((await engine.stack(page)).length).toBe(3);
  await expect(page.getByTestId('ask-button')).toBeDisabled();
  await expect.poll(() => posts.filter((p) => p.kind === 'question').length).toBe(3);
  // a fourth attempt is ignored: `?` does nothing, the stack stays at 3
  lesson.writeRaw({ ...fixtureScene('fx-answer-insert', 'q002-a01'), sceneId: 'q003-a01', title: 'Depth three answer', questionId: 'q003', insertAfter: 'q002-a01', final: true, elements: [{ id: 'c1', type: 'text', slot: 'A1:C1', style: 'body', text: 'Depth three answer.' }] });
  await engine.waitForSceneTime(page, 'q003-a01', 0.5, 30_000);
  await expect(page.getByTestId('ask-button')).toBeDisabled();
  await page.keyboard.press('Shift+?');
  await sleep(200);
  expect(await engine.state(page)).toBe('playing');
  expect((await engine.stack(page)).length).toBe(3);
  expect(posts.filter((p) => p.kind === 'question').length).toBe(3);
  // unwind 1: q003-a01 (final) → back to q002-a01 at its t; Ask re-enabled
  const r3 = await waitForResume(page, 'q002-a01', 40_000);
  expect(Math.abs(r3.ev.t - top3.t)).toBeLessThan(0.01);
  expect(Math.abs(r3.live.audio - top3.t)).toBeLessThanOrEqual(0.25);
  expect(r3.live.stack.map((e) => e.sceneId)).toEqual(['s002', 'q001-a01']);
  await expect(page.getByTestId('ask-button')).toBeEnabled();
  // unwind 2: q002-a01 (final) → back to q001-a01 at its t
  const r2 = await waitForResume(page, 'q001-a01', 40_000);
  expect(Math.abs(r2.ev.t - top2.t)).toBeLessThan(0.01);
  expect(Math.abs(r2.live.audio - top2.t)).toBeLessThanOrEqual(0.25);
  expect(r2.live.state).toBe('playing');
  expectSameSet(r2.live.drawn, ['a1']);
  expect(r2.live.stack.map((e) => e.sceneId)).toEqual(['s002']);
  // q001-a01 finishes, a02 is not written yet → thinking (not stalled); then a02 → final → back to s002
  await engine.waitForState(page, 'thinking', 30_000);
  await expect(page.getByTestId('caption')).toHaveText('khan is thinking…');
  lesson.writeScene('q001-a02');
  await engine.waitForScene(page, 'q001-a02', 30_000);
  const r1 = await waitForResume(page, 's002', 40_000);
  expect(Math.abs(r1.ev.t - top1.t)).toBeLessThan(0.01);
  expect(Math.abs(r1.live.audio - top1.t)).toBeLessThanOrEqual(0.25);
  expect(r1.live.stack).toEqual([]);
  expectSameSet(r1.live.drawn, ['t2']);
  // playlist order from the server: s001, s002, q001-a01, q002-a01, q003-a01, q001-a02, s003, s004
  const pl = await engine.playlist(page);
  expect(pl.entries.map((e) => e.sceneId)).toEqual(['s001', 's002', 'q001-a01', 'q002-a01', 'q003-a01', 'q001-a02', 's003', 's004']);
  // depth-3 continue (QA finding 1): after the fully unwound s002 ends, s003 plays next — none of the four answer
  // scenes sitting between s002 and s003 in the playlist replays
  await engine.waitForScene(page, 's003', 40_000);
  expect(await sceneStarts(page)).toEqual(['s001', 's002', 'q001-a01', 'q002-a01', 'q003-a01', 'q002-a01(resume)', 'q001-a01(resume)', 'q001-a02', 's002(resume)', 's003']);
  const seq = posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`);
  expect(seq.slice(seq.lastIndexOf('start s002'))).toEqual(['start s002', 'end s002', 'start s003']);
  expect(errors).toEqual([]);
});

test('criterion 10b: after the answer and the resumed scene, playback continues with the next LESSON scene (QA finding 1 repro on fx-eng-short); a manual rewind still replays the answer in position', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 2 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForSceneTime(page, 's001', 1.0);
  await page.locator('body').focus();
  const top = await askNow(page, 'why is scene one so short?');
  expect(top.sceneId).toBe('s001');
  expect(top.t).toBeGreaterThanOrEqual(1);
  await expect.poll(() => posts.filter((p) => p.kind === 'question').length).toBe(1);
  // the producer answers with a single final wipe scene inserted after s001
  const three = fixtureScene('fx-eng-short', 's003');
  lesson.writeRaw({ ...three, sceneId: 'q001-a01', title: 'Answer', board: { mode: 'wipe' }, elements: [{ ...three.elements[0], id: 'ans', text: 'Because.' }], final: true, questionId: 'q001', insertAfter: 's001' });
  await engine.waitForScene(page, 'q001-a01', 30_000);
  const { ev, live } = await waitForResume(page, 's001');
  expect(Math.abs(ev.t - top.t)).toBeLessThan(0.01);
  expect(live.state).toBe('playing');
  // s001 plays out → s002 (not q001-a01 again) → s003 → ended
  await engine.waitForState(page, 'ended', 40_000);
  expect(await sceneStarts(page)).toEqual(['s001', 'q001-a01', 's001(resume)', 's002', 's003']);
  const seq = posts.filter((p) => p.kind === 'position').map((p) => `${p.event} ${p.sceneId}`);
  expect(seq).toEqual(['start s001', 'start q001-a01', 'end q001-a01', 'start s001', 'end s001', 'start s002', 'end s002', 'start s003', 'end s003']);
  await expect(page.getByTestId('summary')).toHaveAttribute('data-scenes', '4');
  await expect(page.getByTestId('summary')).toHaveAttribute('data-questions', '1');
  // spec §7 rewind: "answer scenes already in the playlist are replayed in position" — jump back to s001
  const before = (await sceneStarts(page)).length;
  await page.getByTestId('sidebar-item-s001').click();
  await engine.waitForScene(page, 's001', 20_000);
  expect(await engine.state(page)).toBe('playing');
  await engine.waitForState(page, 'ended', 40_000);
  expect((await sceneStarts(page)).slice(before)).toEqual(['s001', 'q001-a01', 's002', 's003']);
  expect(await engine.drawn(page)).toEqual(['three']);
  expect(errors).toEqual([]);
});

test('criterion 12: Esc in the question field cancels — stack popped, resumes at the same t, no POST', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const posts = recordPosts(page);
  const lesson = makeLesson('fx-answer-insert');
  await startAtS002(page, lesson, 2);
  await page.keyboard.press('Shift+?');
  await expect(page.getByTestId('state')).toHaveText('thinking');
  const [top] = await engine.stack(page);
  expect(top.sceneId).toBe('s002');
  expect((await engine.audio(page)).paused).toBe(true);
  await page.keyboard.type('never mind');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('state')).toHaveText('playing');
  const after = await page.evaluate(() => ({ stack: window.__khan.engine.resumeStack, t: window.__khan.engine.audio.currentTime, paused: window.__khan.engine.audio.paused, scene: window.__khan.engine.position.sceneId }));
  expect(after.stack).toEqual([]);
  expect(after.scene).toBe('s002');
  expect(after.paused).toBe(false);
  expect(after.t).toBeGreaterThanOrEqual(top.t - 0.01);
  expect(after.t - top.t).toBeLessThan(0.5);
  await expect(page.getByTestId('question-form')).toBeHidden();
  await sleep(300);
  expect(posts.filter((p) => p.kind === 'question')).toEqual([]);
  // Esc also works from the Cancel button, and from a paused state the lesson stays paused
  await page.getByTestId('pause-button').click();
  await expect(page.getByTestId('state')).toHaveText('paused');
  await page.getByTestId('ask-button').click();
  await expect(page.getByTestId('state')).toHaveText('thinking');
  await page.getByTestId('question-cancel').click();
  await expect(page.getByTestId('state')).toHaveText('paused');
  expect(posts.filter((p) => p.kind === 'question')).toEqual([]);
  expect(errors).toEqual([]);
});

test('criterion 13: ask after ended — the answer plays, the state returns to ended, the summary counts the question', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lesson = makeLesson('fx-eng-short');
  lesson.writeAll();
  await openLesson(page, lesson.lessonId, { config: { playbackRate: 4 } });
  await engine.waitForStatuses(page, { s001: 'ready', s002: 'ready', s003: 'ready' });
  await page.getByTestId('start-button').click();
  await engine.waitForState(page, 'ended', 40_000);
  await expect(page.getByTestId('summary')).toHaveAttribute('data-questions', '0');
  await page.getByTestId('ask-button').click();
  await expect(page.getByTestId('state')).toHaveText('thinking');
  await page.getByTestId('question-input').fill('one more thing?');
  await page.getByTestId('question-input').press('Enter');
  await expect(page.getByTestId('summary')).toBeHidden();
  const base = fixtureScene('fx-answer-insert', 'q001-a01');
  lesson.writeRaw({ ...base, insertAfter: 's003', final: true, title: 'After the end' });
  await engine.waitForScene(page, 'q001-a01', 30_000);
  expect(await engine.state(page)).toBe('playing');
  await engine.waitForState(page, 'ended', 40_000);
  await expect(page.getByTestId('summary')).toBeVisible();
  await expect(page.getByTestId('summary')).toHaveAttribute('data-questions', '1');
  await expect(page.getByTestId('summary')).toHaveAttribute('data-scenes', '4');
  expect((await engine.position(page)).sceneId).toBe('s003'); // the board shows the end of the lesson again
  expect(await engine.drawn(page)).toEqual(['three']);
  await expect.poll(async () => (await (await page.request.get(`/api/lesson/${lesson.lessonId}/status`)).json()).ended, { timeout: 10_000 }).toBe(true);
  expect(errors).toEqual([]);
});
