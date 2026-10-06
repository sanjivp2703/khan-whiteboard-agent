// cli/lesson-id.js — `YYYYMMDD-HHMMSS-<slug>` lesson ids (brief 05, `khan outline -`).
// Always matches ^[a-z0-9-]{8,64}$: the timestamp alone is 15 chars, the slug is clamped so the
// whole id stays ≤ 64, and an empty / non-latin title falls back to "lesson".
import { REGEX } from '../shared/layout-core/constants.js';

export const ID_MAX = 64;
const TIMESTAMP_LEN = 15; // YYYYMMDD-HHMMSS
const SLUG_MAX = ID_MAX - TIMESTAMP_LEN - 1;
const FALLBACK_SLUG = 'lesson';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Local-time stamp, e.g. 20261006-142207 */
export function timestamp(now = new Date()) {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** Lower-case, accents stripped, every run of non [a-z0-9] collapsed to one "-", trimmed. */
export function slugify(title) {
  if (typeof title !== 'string') return '';
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateLessonId(title, now = new Date()) {
  let slug = slugify(title);
  if (slug.length > SLUG_MAX) slug = slug.slice(0, SLUG_MAX).replace(/-+$/g, '');
  if (!slug) slug = FALLBACK_SLUG;
  const id = `${timestamp(now)}-${slug}`;
  if (!REGEX.lessonId.test(id)) throw new Error(`generated lessonId "${id}" is invalid`); // cannot happen; guards the invariant
  return id;
}
