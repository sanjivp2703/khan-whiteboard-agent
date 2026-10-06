// player/engine/resume-stack.js — the resume stack (spec §7 step 6, §9). Pure, DOM-free.
// Entries: { sceneId, t (seconds), from (state the question interrupted), qId|null }.
// Depth is capped at MAX_DEPTH; push past the cap is refused (the Ask control is disabled then).

export const MAX_DEPTH = 3;

/** New stack with `entry` on top, or null when the stack is already at `cap`. */
export function push(stack, entry, cap = MAX_DEPTH) {
  if (!Array.isArray(stack)) throw new TypeError('push(stack, entry)');
  if (stack.length >= cap) return null;
  if (!entry || typeof entry.sceneId !== 'string') throw new TypeError('resume entry needs a sceneId');
  const t = typeof entry.t === 'number' && Number.isFinite(entry.t) ? Math.max(0, entry.t) : 0;
  return [...stack, { sceneId: entry.sceneId, t, from: entry.from || 'playing', qId: entry.qId ?? null }];
}

/** [topEntry, restOfStack]; [null, stack] when empty. */
export function pop(stack) {
  if (!stack.length) return [null, stack];
  return [stack[stack.length - 1], stack.slice(0, -1)];
}

export function peek(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}

/** New stack whose top entry carries `qId` (no-op when empty). */
export function withTopQId(stack, qId) {
  if (!stack.length) return stack;
  const top = { ...stack[stack.length - 1], qId };
  return [...stack.slice(0, -1), top];
}

export function isFull(stack, cap = MAX_DEPTH) {
  return stack.length >= cap;
}
