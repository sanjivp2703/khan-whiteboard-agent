// server/lesson-store.js — in-memory state per lesson plus the playlist snapshot builder.
import { join } from 'node:path';
import { orderEntries, deriveEnded, readyAhead, kindOf } from './playlist.js';
import { ttsStatus } from './tts/index.js';

export function createStore({ lessonsDir, provider }) {
  const lessons = new Map();

  function get(lessonId) { return lessons.get(lessonId) || null; }

  function ensure(lessonId) {
    let l = lessons.get(lessonId);
    if (!l) {
      l = {
        lessonId,
        dir: join(lessonsDir, lessonId),
        outline: null,
        outlineErrors: [],
        createdAt: new Date().toISOString(),
        scenes: new Map(),
        questions: new Map(),
        nextQuestion: 1,
        notices: [],          // {kind:'degraded', sceneId, droppedElementIds}
        inboxPending: [],     // {kind:'question'|'reject', ..., delivered:false}
        player: { connected: false, clients: 0, everConnected: false, lastDisconnectAt: null, position: null, lastStartSceneId: null, lastEndSceneId: null },
        producerLastWriteAt: null,
        ended: false,
        endedAt: null,
        waiters: new Set(),
        listeners: new Set(),
        opened: false,
      };
      lessons.set(lessonId, l);
    }
    return l;
  }

  function entry(lesson, sceneId) {
    let e = lesson.scenes.get(sceneId);
    if (!e) {
      e = {
        sceneId, kind: kindOf(sceneId), status: 'pending', raw: null, effective: null, errors: [], degraded: false,
        droppedElementIds: [], attempts: 0, audio: null, durationMs: null, title: null, board: null, final: false,
        questionId: null, insertAfter: null, occIn: null, occOut: null, generation: 0, rejectTimer: null,
      };
      lesson.scenes.set(sceneId, e);
    }
    return e;
  }

  /** Entries in playlist order. */
  function ordered(lesson) {
    return orderEntries([...lesson.scenes.values()]);
  }

  function recomputeEnded(lesson) {
    const was = lesson.ended;
    lesson.ended = deriveEnded({ ordered: ordered(lesson), lastEndSceneId: lesson.player.lastEndSceneId, questions: [...lesson.questions.values()] });
    if (lesson.ended && !was) lesson.endedAt = Date.now();
    if (!lesson.ended) lesson.endedAt = null;
    return lesson.ended !== was;
  }

  function producer(lesson) {
    return { lastWriteAt: lesson.producerLastWriteAt, lastWriteAgeMs: lesson.producerLastWriteAt ? Date.now() - new Date(lesson.producerLastWriteAt).getTime() : null };
  }

  function entrySnapshot(lesson, e, position) {
    return {
      sceneId: e.sceneId, kind: e.kind, position, status: e.status, title: e.title, board: e.board, final: !!e.final,
      questionId: e.questionId, insertAfter: e.insertAfter,
      audioUrl: e.audio && e.audio.ext ? `/api/lesson/${lesson.lessonId}/audio/${e.sceneId}` : null,
      durationMs: e.durationMs, degraded: !!e.degraded, droppedElementIds: e.droppedElementIds || [], errors: e.errors || [],
    };
  }

  function snapshot(lesson) {
    const ord = ordered(lesson);
    return {
      lessonId: lesson.lessonId,
      title: lesson.outline ? lesson.outline.title : null,
      ended: lesson.ended,
      tts: ttsStatus(provider),
      producer: producer(lesson),
      outline: lesson.outline,
      entries: ord.map((e, i) => entrySnapshot(lesson, e, i)),
      questions: [...lesson.questions.values()].map((q) => ({ ...q, answeredBy: [...q.answeredBy] })),
      buffer: { readyAhead: readyAhead(ord, lesson.player.lastStartSceneId) },
      player: { connected: lesson.player.connected, position: lesson.player.position },
    };
  }

  function counts(lesson) {
    const entries = [...lesson.scenes.values()];
    let svgElements = 0;
    for (const e of entries) for (const el of (e.effective && e.effective.elements) || []) if (el.type === 'svg') svgElements++;
    return {
      planned: lesson.outline ? lesson.outline.scenes.length : 0,
      scenes: entries.filter((e) => e.kind === 'lesson').length,
      ready: entries.filter((e) => e.status === 'ready').length,
      degraded: entries.filter((e) => e.degraded).length,
      rejected: entries.filter((e) => e.status === 'rejected').length,
      answerScenes: entries.filter((e) => e.kind === 'answer').length,
      questions: lesson.questions.size,
      svgElements,
    };
  }

  function status(lesson) {
    const ord = ordered(lesson);
    return {
      lessonId: lesson.lessonId,
      title: lesson.outline ? lesson.outline.title : null,
      tts: ttsStatus(provider),
      producer: producer(lesson),
      counts: counts(lesson),
      buffer: { readyAhead: readyAhead(ord, lesson.player.lastStartSceneId) },
      player: { connected: lesson.player.connected, position: lesson.player.position },
      ended: lesson.ended,
    };
  }

  function nextQuestionId(lesson) {
    const id = `q${String(lesson.nextQuestion).padStart(3, '0')}`;
    lesson.nextQuestion++;
    return id;
  }

  return { lessonsDir, provider, lessons, get, ensure, entry, ordered, recomputeEnded, snapshot, status, counts, producer, nextQuestionId };
}
