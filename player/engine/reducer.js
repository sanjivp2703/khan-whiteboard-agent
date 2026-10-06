// player/engine/reducer.js — the player state machine (spec §6 states, §7 interactivity) as a
// pure function. DOM-free and unit-tested in Node. The engine (index.js) owns audio, drawing and
// the network; it feeds actions in here and acts on the resulting state.
//
//   waiting → armed → playing → paused | stalled | thinking → playing → ended
//
// reduce(s, action) → { ok: true, state: s' , entry? } or { ok: false, reason, state: s }.
// Illegal transitions are refused, never thrown: the engine ignores them (and logs them).
import { push, pop, withTopQId, isFull, MAX_DEPTH } from './resume-stack.js';

export const STATES = Object.freeze(['waiting', 'armed', 'playing', 'paused', 'stalled', 'thinking', 'ended']);

/** States in which the user may ask a question (spec §7: "any state except waiting"; `armed`
 *  has no position yet and `thinking` is already asking). */
export const ASKABLE = Object.freeze(['playing', 'paused', 'stalled', 'ended']);
/** States in which the user may jump (rewind/skip). */
export const JUMPABLE = Object.freeze(['playing', 'paused', 'stalled', 'ended']);

export function initialState() {
  return { state: 'waiting', questionOpen: false, stack: [], maxDepth: MAX_DEPTH };
}

const ok = (state, extra = {}) => ({ ok: true, state, ...extra });
const no = (state, reason) => ({ ok: false, reason, state });

export function canAsk(s) {
  return ASKABLE.includes(s.state) && !s.questionOpen && !isFull(s.stack, s.maxDepth);
}

export function canJump(s) {
  return JUMPABLE.includes(s.state);
}

/**
 * @param {ReturnType<typeof initialState>} s
 * @param {{type:string}} action
 */
export function reduce(s, action) {
  if (!action || typeof action.type !== 'string') return no(s, 'bad action');
  switch (action.type) {
    case 'ARM':
      if (s.state !== 'waiting') return no(s, `ARM only from waiting (in ${s.state})`);
      return ok({ ...s, state: 'armed' });

    case 'FIRST_READY': // scene 1 is ready: play only once armed
      if (s.state === 'armed') return ok({ ...s, state: 'playing' });
      if (s.state === 'waiting') return no(s, 'not armed yet');
      return no(s, `FIRST_READY only from armed (in ${s.state})`);

    case 'PAUSE':
      if (s.state !== 'playing') return no(s, `PAUSE only from playing (in ${s.state})`);
      return ok({ ...s, state: 'paused' });

    case 'RESUME':
      if (s.state !== 'paused') return no(s, `RESUME only from paused (in ${s.state})`);
      return ok({ ...s, state: 'playing' });

    case 'COMPLETE': {
      // the current scene finished (audio ended and last stroke done); `next` says what follows
      if (s.state !== 'playing') return no(s, `COMPLETE only from playing (in ${s.state})`);
      if (action.next === 'ready') return ok({ ...s, state: 'playing' });
      if (action.next === 'missing') return ok({ ...s, state: s.stack.length ? 'thinking' : 'stalled' });
      if (action.next === 'end') return ok({ ...s, state: 'ended' });
      return no(s, `COMPLETE needs next ready|missing|end`);
    }

    case 'READY': // the awaited scene became ready (after the 400 ms beat)
      if (s.state === 'stalled') return ok({ ...s, state: 'playing' });
      if (s.state === 'thinking' && !s.questionOpen) return ok({ ...s, state: 'playing' });
      if (s.state === 'thinking') return no(s, 'question field still open');
      return no(s, `READY only from stalled|thinking (in ${s.state})`);

    case 'ASK': {
      if (!ASKABLE.includes(s.state)) return no(s, `ASK not allowed in ${s.state}`);
      if (s.questionOpen) return no(s, 'already asking');
      const entry = action.entry || {};
      const stack = push(s.stack, { sceneId: entry.sceneId, t: entry.t, from: s.state }, s.maxDepth);
      if (!stack) return no(s, `resume stack full (depth ${s.maxDepth})`);
      return ok({ ...s, state: 'thinking', questionOpen: true, stack });
    }

    case 'CANCEL_ASK': { // Esc in the field: pop, resume where it was
      if (!(s.state === 'thinking' && s.questionOpen)) return no(s, 'no open question to cancel');
      const [entry, stack] = pop(s.stack);
      return ok({ ...s, state: entry.from, questionOpen: false, stack }, { entry });
    }

    case 'SUBMIT_ASK':
      if (!(s.state === 'thinking' && s.questionOpen)) return no(s, 'no open question to submit');
      return ok({ ...s, questionOpen: false });

    case 'SET_QID':
      if (!s.stack.length) return no(s, 'empty stack');
      return ok({ ...s, stack: withTopQId(s.stack, action.qId) });

    case 'ABORT_ASK': { // the POST /question failed after submit: give the position back
      if (!(s.state === 'thinking' && !s.questionOpen && s.stack.length && s.stack[s.stack.length - 1].qId == null)) return no(s, 'nothing to abort');
      const [entry, stack] = pop(s.stack);
      return ok({ ...s, state: entry.from, stack }, { entry });
    }

    case 'POP': { // the final answer scene completed: restore the interrupted position
      if (!s.stack.length) return no(s, 'resume with empty stack');
      if (s.questionOpen) return no(s, 'question field open');
      if (s.state !== 'playing' && s.state !== 'thinking') return no(s, `POP only from playing|thinking (in ${s.state})`);
      const [entry, stack] = pop(s.stack);
      return ok({ ...s, state: entry.from === 'ended' ? 'ended' : 'playing', stack }, { entry });
    }

    case 'JUMP': { // rewind/skip to the start of a scene; forward only if ready (caller passes ready)
      if (!JUMPABLE.includes(s.state)) return no(s, `JUMP not allowed in ${s.state}`);
      if (!action.ready) return no(s, 'target scene is not ready');
      // a manual jump abandons any pending resume positions (the user moved on purpose)
      return ok({ ...s, state: s.state === 'paused' ? 'paused' : 'playing', stack: [] });
    }

    default:
      return no(s, `unknown action ${action.type}`);
  }
}
