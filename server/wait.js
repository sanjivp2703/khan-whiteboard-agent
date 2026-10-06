// server/wait.js — the long-poll behind `khan wait` (spec §7, brief 00 C3 "wait semantics").
// On each call, in order: (1) an undelivered inbox entry → question/reject; (2) ended → finished;
// (3) player had an SSE client and none for > playerClosedMs → player-closed; (4) no final lesson
// scene yet and readyAhead < 3 → continue; (5) otherwise block until one of those or timeout.
// Notices (degradations) ride along on every response and are cleared once sent.
import { readyAhead, lastLessonEntry } from './playlist.js';

export function createWait({ store, env = {} }) {
  const playerClosedMs = Number(env.KHAN_PLAYER_CLOSED_MS) > 0 ? Number(env.KHAN_PLAYER_CLOSED_MS) : 15000;
  const bufferTarget = 3;

  function takeNotices(lesson) {
    const n = lesson.notices.slice();
    lesson.notices.length = 0;
    return n;
  }

  /** Immediate evaluation; returns an event object or null when nothing is due. */
  function evaluate(lesson) {
    const pending = lesson.inboxPending.find((p) => !p.delivered);
    if (pending) {
      pending.delivered = true;
      const { delivered, kind, ...rest } = pending;
      return { event: kind, ...rest, notices: takeNotices(lesson) };
    }
    if (lesson.ended) return { event: 'finished', summary: store.counts(lesson), notices: takeNotices(lesson) };
    const p = lesson.player;
    if (p.everConnected && p.clients === 0 && p.lastDisconnectAt && Date.now() - p.lastDisconnectAt > playerClosedMs) {
      return { event: 'player-closed', notices: takeNotices(lesson) };
    }
    const ordered = store.ordered(lesson);
    const last = lastLessonEntry(ordered);
    const hasFinal = !!(last && last.final);
    const ahead = readyAhead(ordered, p.lastStartSceneId);
    if (!hasFinal && ahead < bufferTarget) return { event: 'continue', readyAhead: ahead, notices: takeNotices(lesson) };
    return null;
  }

  /** @returns {Promise<object>} one event */
  function wait(lesson, timeoutSec) {
    const immediate = evaluate(lesson);
    if (immediate) return Promise.resolve(immediate);
    const timeoutMs = Math.max(0, Number(timeoutSec) || 0) * 1000;
    return new Promise((resolve) => {
      let done = false;
      const waiter = {
        check() {
          if (done) return;
          const ev = evaluate(lesson);
          if (ev) finish(ev);
        },
      };
      const finish = (ev) => {
        if (done) return;
        done = true;
        clearInterval(tick);
        clearTimeout(timer);
        lesson.waiters.delete(waiter);
        resolve(ev);
      };
      const tick = setInterval(() => waiter.check(), 250);
      const timer = setTimeout(() => finish({ event: 'timeout', notices: takeNotices(lesson) }), timeoutMs);
      lesson.waiters.add(waiter);
    });
  }

  return { wait, evaluate, playerClosedMs };
}
