// cli/open.js — open a URL in the default browser unless KHAN_NO_OPEN=1 / --no-open.
// Reuses the foundation's opener (macOS `open`, Linux `xdg-open`, Windows `start`).
import { defaultOpener } from '../server/lifecycle.js';

export function shouldOpen(env = process.env, flags = {}) {
  if (flags['no-open']) return false;
  return !(env.KHAN_NO_OPEN === '1' || env.KHAN_NO_OPEN === 'true');
}

export function openBrowser(url, env = process.env, flags = {}, opener = defaultOpener) {
  if (!shouldOpen(env, flags)) return false;
  opener(url);
  return true;
}
