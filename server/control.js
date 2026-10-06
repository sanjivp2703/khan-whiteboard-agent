// server/control.js — control/ files the server writes for the producer (brief 00 C2):
// inbox.json (the ONE file the producer reads), question-<qId>.json, reject-<sceneId>.json.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_INBOX } from '../shared/layout-core/constants.js';
import { ttsStatus } from './tts/index.js';
import { readyAhead } from './playlist.js';

async function writeAtomic(path, obj) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await fs.rename(tmp, path);
}

export function buildInbox(store, lesson) {
  const ord = store.ordered(lesson);
  return {
    schema: SCHEMA_INBOX,
    lessonId: lesson.lessonId,
    updatedAt: new Date().toISOString(),
    pending: lesson.inboxPending.map(({ delivered, ...rest }) => rest),
    notices: lesson.notices.slice(),
    player: { connected: lesson.player.connected, position: lesson.player.position },
    buffer: { readyAhead: readyAhead(ord, lesson.player.lastStartSceneId) },
    tts: ttsStatus(store.provider),
    producerLastWriteAt: lesson.producerLastWriteAt,
  };
}

export function createControl(store) {
  let chain = Promise.resolve();
  const serial = (fn) => { chain = chain.then(fn, fn); return chain; };

  function writeInbox(lesson) {
    const inbox = buildInbox(store, lesson);
    return serial(() => writeAtomic(join(lesson.dir, 'control', 'inbox.json'), inbox).catch(() => {}));
  }

  function writeQuestion(lesson, q) {
    return serial(() => writeAtomic(join(lesson.dir, 'control', `question-${q.qId}.json`), { kind: 'question', ...q }).catch(() => {}));
  }

  function writeReject(lesson, sceneId, attempt, errors) {
    return serial(() => writeAtomic(join(lesson.dir, 'control', `reject-${sceneId}.json`), { kind: 'reject', sceneId, attempt, errors, createdAt: new Date().toISOString() }).catch(() => {}));
  }

  function writePlaylist(lesson) {
    const snap = store.snapshot(lesson);
    return serial(() => writeAtomic(join(lesson.dir, 'state', 'playlist.json'), snap).catch(() => {}));
  }

  function flush() { return chain; }

  return { writeInbox, writeQuestion, writeReject, writePlaylist, flush };
}
