import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, canAsk, canJump, STATES, ASKABLE } from '../../player/engine/reducer.js';

const run = (actions, s = initialState()) => {
  for (const a of actions) {
    const r = reduce(s, a);
    assert.ok(r.ok, `${a.type} from ${s.state}: ${r.reason}`);
    s = r.state;
  }
  return s;
};
const ARM_PLAY = [{ type: 'ARM' }, { type: 'FIRST_READY' }];

test('reducer: start gate in both orders (click first, ready first)', () => {
  // click before ready: waiting → armed, then ready → playing
  let s = initialState();
  assert.equal(s.state, 'waiting');
  assert.equal(reduce(s, { type: 'FIRST_READY' }).ok, false); // ready first does nothing until armed
  s = run([{ type: 'ARM' }]);
  assert.equal(s.state, 'armed');
  s = run([{ type: 'FIRST_READY' }], s);
  assert.equal(s.state, 'playing');
  // ARM twice is refused
  assert.equal(reduce(s, { type: 'ARM' }).ok, false);
});

test('reducer: every legal transition of the §6 table', () => {
  let s = run(ARM_PLAY);
  s = run([{ type: 'PAUSE' }], s); assert.equal(s.state, 'paused');
  s = run([{ type: 'RESUME' }], s); assert.equal(s.state, 'playing');
  s = run([{ type: 'COMPLETE', next: 'ready' }], s); assert.equal(s.state, 'playing');
  s = run([{ type: 'COMPLETE', next: 'missing' }], s); assert.equal(s.state, 'stalled');
  s = run([{ type: 'READY' }], s); assert.equal(s.state, 'playing');
  s = run([{ type: 'ASK', entry: { sceneId: 's002', t: 3.2 } }], s); assert.equal(s.state, 'thinking');
  assert.equal(s.questionOpen, true);
  assert.deepEqual(s.stack.map((e) => [e.sceneId, e.t, e.from]), [['s002', 3.2, 'playing']]);
  s = run([{ type: 'SUBMIT_ASK' }, { type: 'SET_QID', qId: 'q001' }], s);
  assert.equal(s.questionOpen, false);
  assert.equal(s.stack[0].qId, 'q001');
  s = run([{ type: 'READY' }], s); assert.equal(s.state, 'playing'); // first answer scene plays
  s = run([{ type: 'COMPLETE', next: 'missing' }], s); assert.equal(s.state, 'thinking'); // between answer scenes
  s = run([{ type: 'READY' }], s);
  const popped = reduce(s, { type: 'POP' });
  assert.ok(popped.ok);
  assert.equal(popped.state.state, 'playing');
  assert.deepEqual(popped.entry.sceneId, 's002');
  assert.equal(popped.state.stack.length, 0);
  s = run([{ type: 'COMPLETE', next: 'end' }], popped.state); assert.equal(s.state, 'ended');
  for (const st of STATES) assert.ok(typeof st === 'string');
});

test('reducer: illegal transitions are refused (question in waiting, skip to not-ready, resume with empty stack, …)', () => {
  const w = initialState();
  assert.equal(reduce(w, { type: 'ASK', entry: { sceneId: 's001', t: 0 } }).ok, false);
  assert.equal(canAsk(w), false);
  assert.equal(reduce(w, { type: 'PAUSE' }).ok, false);
  assert.equal(reduce(w, { type: 'JUMP', ready: true }).ok, false);
  assert.equal(canJump(w), false);
  const armed = run([{ type: 'ARM' }]);
  assert.equal(reduce(armed, { type: 'ASK', entry: { sceneId: 's001', t: 0 } }).ok, false);
  const p = run(ARM_PLAY);
  assert.equal(reduce(p, { type: 'JUMP', ready: false }).ok, false, 'skip to a not-ready scene is refused');
  assert.equal(reduce(p, { type: 'POP' }).ok, false, 'resume with an empty stack is refused');
  assert.equal(reduce(p, { type: 'RESUME' }).ok, false);
  assert.equal(reduce(p, { type: 'READY' }).ok, false);
  assert.equal(reduce(p, { type: 'CANCEL_ASK' }).ok, false);
  assert.equal(reduce(p, { type: 'SUBMIT_ASK' }).ok, false);
  assert.equal(reduce(p, { type: 'COMPLETE', next: 'nonsense' }).ok, false);
  assert.equal(reduce(p, { type: 'NOPE' }).ok, false);
  assert.equal(reduce(p, null).ok, false);
  const paused = run([{ type: 'PAUSE' }], p);
  assert.equal(reduce(paused, { type: 'COMPLETE', next: 'ready' }).ok, false);
  assert.equal(reduce(paused, { type: 'PAUSE' }).ok, false);
  // a refused action returns the unchanged state
  assert.equal(reduce(paused, { type: 'PAUSE' }).state, paused);
});

test('reducer: Esc cancels and returns to the interrupted state without posting', () => {
  const p = run(ARM_PLAY);
  for (const from of ASKABLE) {
    let s = p;
    if (from === 'paused') s = run([{ type: 'PAUSE' }], p);
    if (from === 'stalled') s = run([{ type: 'COMPLETE', next: 'missing' }], p);
    if (from === 'ended') s = run([{ type: 'COMPLETE', next: 'end' }], p);
    assert.equal(s.state, from);
    assert.equal(canAsk(s), true);
    const asked = run([{ type: 'ASK', entry: { sceneId: 's003', t: 1 } }], s);
    assert.equal(asked.state, 'thinking');
    const r = reduce(asked, { type: 'CANCEL_ASK' });
    assert.ok(r.ok);
    assert.equal(r.state.state, from);
    assert.equal(r.state.stack.length, 0);
    assert.equal(r.entry.sceneId, 's003');
  }
});

test('reducer: nested questions to depth 3, then Ask is refused until the stack unwinds', () => {
  let s = run(ARM_PLAY);
  s = run([{ type: 'ASK', entry: { sceneId: 's002', t: 3 } }, { type: 'SUBMIT_ASK' }, { type: 'SET_QID', qId: 'q001' }, { type: 'READY' }], s);
  s = run([{ type: 'ASK', entry: { sceneId: 'q001-a01', t: 2 } }, { type: 'SUBMIT_ASK' }, { type: 'SET_QID', qId: 'q002' }, { type: 'READY' }], s);
  s = run([{ type: 'ASK', entry: { sceneId: 'q002-a01', t: 1 } }, { type: 'SUBMIT_ASK' }, { type: 'SET_QID', qId: 'q003' }, { type: 'READY' }], s);
  assert.equal(s.stack.length, 3);
  assert.deepEqual(s.stack.map((e) => e.qId), ['q001', 'q002', 'q003']);
  assert.equal(canAsk(s), false);
  assert.equal(reduce(s, { type: 'ASK', entry: { sceneId: 'q003-a01', t: 0 } }).ok, false);
  let r = reduce(s, { type: 'POP' });
  assert.equal(r.entry.sceneId, 'q002-a01');
  assert.equal(r.state.state, 'playing');
  assert.equal(canAsk(r.state), true);
  r = reduce(r.state, { type: 'POP' });
  assert.equal(r.entry.sceneId, 'q001-a01');
  r = reduce(r.state, { type: 'POP' });
  assert.equal(r.entry.sceneId, 's002');
  assert.equal(r.entry.t, 3);
  assert.equal(r.state.stack.length, 0);
  assert.equal(reduce(r.state, { type: 'POP' }).ok, false);
});

test('reducer: asking after ended returns to ended after the answer; a jump clears the stack and keeps pause', () => {
  let s = run([...ARM_PLAY, { type: 'COMPLETE', next: 'end' }]);
  assert.equal(s.state, 'ended');
  s = run([{ type: 'ASK', entry: { sceneId: 's004', t: 8.4 } }, { type: 'SUBMIT_ASK' }, { type: 'SET_QID', qId: 'q001' }], s);
  assert.equal(s.state, 'thinking');
  s = run([{ type: 'READY' }], s);
  const r = reduce(s, { type: 'POP' });
  assert.equal(r.state.state, 'ended');
  assert.equal(r.entry.from, 'ended');
  // jump
  let p = run(ARM_PLAY);
  p = run([{ type: 'ASK', entry: { sceneId: 's002', t: 1 } }, { type: 'SUBMIT_ASK' }, { type: 'READY' }], p);
  assert.equal(reduce(p, { type: 'JUMP', ready: true }).state.stack.length, 0);
  const paused = run([{ type: 'PAUSE' }], run(ARM_PLAY));
  assert.equal(reduce(paused, { type: 'JUMP', ready: true }).state.state, 'paused');
  assert.equal(reduce(run(ARM_PLAY), { type: 'JUMP', ready: true }).state.state, 'playing');
  const stalled = run([{ type: 'COMPLETE', next: 'missing' }], run(ARM_PLAY));
  assert.equal(reduce(stalled, { type: 'JUMP', ready: true }).state.state, 'playing');
  // no jumping while the question field is open
  const asking = run([{ type: 'ASK', entry: { sceneId: 's002', t: 1 } }], run(ARM_PLAY));
  assert.equal(reduce(asking, { type: 'JUMP', ready: true }).ok, false);
  assert.equal(reduce(asking, { type: 'READY' }).ok, false, 'no advance while the field is open');
});

test('reducer: a failed POST after submit aborts the question and gives the position back', () => {
  const asking = run([{ type: 'ASK', entry: { sceneId: 's002', t: 1 } }], run(ARM_PLAY));
  assert.equal(reduce(asking, { type: 'ABORT_ASK' }).ok, false, 'field still open: that is a cancel, not an abort');
  const submitted = run([{ type: 'SUBMIT_ASK' }], asking);
  const r = reduce(submitted, { type: 'ABORT_ASK' });
  assert.ok(r.ok);
  assert.equal(r.state.state, 'playing');
  assert.equal(r.state.stack.length, 0);
  assert.equal(r.entry.sceneId, 's002');
  const withQ = run([{ type: 'SET_QID', qId: 'q001' }], submitted);
  assert.equal(reduce(withQ, { type: 'ABORT_ASK' }).ok, false, 'once the server assigned a qId there is nothing to abort');
});
