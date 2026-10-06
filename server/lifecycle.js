// server/lifecycle.js — browser opening and idle exit (spec §6 Lifecycle, brief 00 C3).
// Opens the browser when a new outline appears (macOS `open`, else `xdg-open`; KHAN_NO_OPEN=1
// suppresses it). Exits idleExitMs after `ended` or after the last SSE client disconnected
// (if any ever connected). KHAN_IDLE_EXIT_MS overrides the 10 minute default (tests).
import { spawn } from 'node:child_process';

export function defaultOpener(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* ignore */ }
}

export function createLifecycle({ env = {}, opener = defaultOpener, onIdleExit = () => {}, idleExitMs } = {}) {
  const idleMs = idleExitMs ?? (Number(env.KHAN_IDLE_EXIT_MS) > 0 ? Number(env.KHAN_IDLE_EXIT_MS) : 10 * 60 * 1000);
  const noOpen = env.KHAN_NO_OPEN === '1' || env.KHAN_NO_OPEN === 'true';
  const opened = [];
  let timer = null;
  let reason = null;
  let armed = true;

  function openBrowser(url) {
    if (noOpen) return false;
    opened.push(url);
    opener(url);
    return true;
  }

  function schedule(why) {
    if (!armed) return;
    cancel();
    reason = why;
    timer = setTimeout(() => { timer = null; onIdleExit(why); }, idleMs);
    if (timer.unref) timer.unref();
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    reason = null;
  }

  return {
    idleMs,
    noOpen,
    opened,
    openBrowser,
    /** Called when a lesson's `ended` becomes true. */
    noteEnded() { schedule('ended'); },
    /** Called when the last SSE client disconnected (any lesson). */
    noteAllClientsGone() { schedule('player-closed'); },
    /** Called when an SSE client connects or a new lesson starts: cancels a pending exit. */
    noteActivity() { cancel(); },
    pendingReason() { return reason; },
    dispose() { armed = false; cancel(); },
  };
}
