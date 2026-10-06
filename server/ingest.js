// server/ingest.js — the ingest path: validate (with the occupancy chain), reject → rewrite →
// degrade, voice through the TTS cache, questions, positions, `ended`. Spec §5/§6/§7, brief 00 C1–C3.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { validateScene, validateOutline, dropElements, badElementIds } from '../shared/schema/validate.js';
import { createOccupancy, toJSON, freeCells, applyScene } from '../shared/layout-core/occupancy.js';
import { kindOf } from './playlist.js';
import { estimateDurationMs } from './tts/silent.js';
import { err } from '../shared/schema/errors.js';

const MAX_DEGRADE_PASSES = 8;

export function createIngest({ store, cache, control, provider, env = {}, onChange = () => {}, onNewOutline = () => {}, onEnded = () => {}, log = () => {} }) {
  const rejectGraceMs = Number(env.KHAN_REJECT_GRACE_MS) > 0 ? Number(env.KHAN_REJECT_GRACE_MS) : 30000;

  function touchProducer(lesson) { lesson.producerLastWriteAt = new Date().toISOString(); }

  function changed(lesson) {
    const endedChanged = store.recomputeEnded(lesson);
    control.writeInbox(lesson);
    control.writePlaylist(lesson);
    for (const w of lesson.waiters) w.check();
    onChange(lesson);
    if (endedChanged && lesson.ended) onEnded(lesson);
  }

  // ---------- outline ----------
  /** `meta.initial` is true when the watcher found the file during its startup scan (replay). */
  function ingestOutline(lessonId, json, parseError, meta = {}) {
    const lesson = store.ensure(lessonId);
    touchProducer(lesson);
    if (parseError || !json) {
      lesson.outlineErrors = [err(null, 'BAD_JSON', parseError || 'empty outline')];
      changed(lesson);
      return;
    }
    const r = validateOutline(json, { lessonId });
    lesson.outlineErrors = r.errors;
    if (r.ok || (json && Array.isArray(json.scenes))) {
      const first = lesson.outline === null;
      lesson.outline = json;
      if (first && !lesson.opened) { lesson.opened = true; onNewOutline(lesson, { initial: meta.initial === true }); }
    }
    changed(lesson);
  }

  // ---------- scenes ----------
  function trackKey(sceneId) { return kindOf(sceneId) === 'answer' ? sceneId.slice(0, 4) : 'lesson'; }

  /** Entries of a track in playlist order. */
  function trackEntries(lesson, key) {
    return store.ordered(lesson).filter((e) => trackKey(e.sceneId) === key && e.raw);
  }

  function applyMeta(entry, scene) {
    entry.title = typeof scene.title === 'string' ? scene.title : null;
    entry.board = scene.board && typeof scene.board === 'object' ? scene.board : null;
    entry.final = scene.final === true;
    entry.questionId = typeof scene.questionId === 'string' ? scene.questionId : null;
    entry.insertAfter = typeof scene.insertAfter === 'string' ? scene.insertAfter : null;
  }

  function clearRejectTimer(entry) {
    if (entry.rejectTimer) { clearTimeout(entry.rejectTimer); entry.rejectTimer = null; }
  }

  async function ingestScene(lessonId, sceneId, json, parseError) {
    const lesson = store.ensure(lessonId);
    touchProducer(lesson);
    const entry = store.entry(lesson, sceneId);
    entry.attempts++;
    entry.generation++;
    clearRejectTimer(entry);
    entry.raw = json ?? null;
    entry.parseError = parseError || null;
    entry.effective = null;
    entry.errors = [];
    entry.degraded = false;
    entry.droppedElementIds = [];
    entry.audio = null;
    entry.durationMs = null;
    entry.status = 'validating';
    if (json && typeof json === 'object') applyMeta(entry, json);
    // a rewrite clears the pending reject for this scene (re-added below if it is invalid again)
    lesson.inboxPending = lesson.inboxPending.filter((p) => !(p.kind === 'reject' && p.sceneId === sceneId));
    // a scene answering a question clears that question's pending entry
    if (entry.questionId && lesson.questions.has(entry.questionId)) {
      const q = lesson.questions.get(entry.questionId);
      if (!q.answeredBy.includes(sceneId)) q.answeredBy.push(sceneId);
      q.complete = q.answeredBy.some((id) => { const e = lesson.scenes.get(id); return e && e.final; });
      lesson.inboxPending = lesson.inboxPending.filter((p) => !(p.kind === 'question' && p.qId === entry.questionId));
    }
    changed(lesson);
    await revalidateTrack(lesson, trackKey(sceneId), sceneId);
  }

  /**
   * Re-run validation along a track from `fromSceneId` (inclusive) so later scenes see the
   * right occupancy. Scenes whose input occupancy and raw content are unchanged are skipped.
   */
  async function revalidateTrack(lesson, key, fromSceneId) {
    const entries = trackEntries(lesson, key);
    let occ = createOccupancy();
    let reached = false;
    for (const e of entries) {
      if (e.sceneId === fromSceneId) reached = true;
      const occInJson = JSON.stringify(toJSON(occ));
      if (!reached) {
        occ = e.occOut || occ;
        continue;
      }
      if (e.sceneId !== fromSceneId && e.occIn === occInJson) { occ = e.occOut || occ; continue; } // unchanged input: keep its state
      e.occIn = occInJson;
      await validateEntry(lesson, e, occ);
      occ = e.occOut || occ;
    }
  }

  async function validateEntry(lesson, entry, occIn) {
    const gen = entry.generation;
    if (entry.parseError || entry.raw === null) {
      entry.errors = [err(null, 'BAD_JSON', entry.parseError || 'empty scene file')];
      finishInvalid(lesson, entry, occIn, null);
      return;
    }
    const result = await validateScene(entry.raw, occIn, { lessonId: lesson.lessonId });
    if (gen !== entry.generation) return; // superseded by a rewrite
    if (result.ok) {
      entry.errors = [];
      entry.effective = result.effective;
      entry.occOut = result.occupancy;
      entry.degraded = false;
      entry.droppedElementIds = [];
      entry.invalidAttempts = 0; // a valid revision resets the reject → rewrite → degrade cycle
      startVoicing(lesson, entry);
      return;
    }
    entry.errors = result.errors;
    await finishInvalid(lesson, entry, occIn, result);
  }

  /**
   * Reject → rewrite → degrade (spec §5). Only invalid attempts count: `invalidAttempts` is the
   * number of consecutive invalid validations of this scene since it was last valid, so a scene
   * that was ready and is then rewritten invalid still gets its reject round (QA finding 6).
   * `attempts` keeps counting every ingest (diagnostics only).
   */
  async function finishInvalid(lesson, entry, occIn, result) {
    entry.invalidAttempts = (entry.invalidAttempts || 0) + 1;
    if (entry.invalidAttempts <= 1) {
      entry.status = 'rejected';
      entry.occOut = occIn;
      lesson.inboxPending = lesson.inboxPending.filter((p) => !(p.kind === 'reject' && p.sceneId === entry.sceneId));
      lesson.inboxPending.push({ kind: 'reject', sceneId: entry.sceneId, attempt: entry.invalidAttempts, errors: entry.errors, delivered: false });
      control.writeReject(lesson, entry.sceneId, entry.invalidAttempts, entry.errors);
      const gen = entry.generation;
      entry.rejectTimer = setTimeout(() => {
        entry.rejectTimer = null;
        if (gen !== entry.generation) return;
        degrade(lesson, entry, occIn).catch((e) => log('degrade error', e));
      }, rejectGraceMs);
      changed(lesson);
      return;
    }
    await degrade(lesson, entry, occIn);
  }

  /** Drop offending elements (≤ 8 passes), else narration-only; never wipe the board as a side effect. */
  async function degrade(lesson, entry, occIn) {
    const gen = entry.generation;
    lesson.inboxPending = lesson.inboxPending.filter((p) => !(p.kind === 'reject' && p.sceneId === entry.sceneId));
    let scene = entry.raw && typeof entry.raw === 'object' && !Array.isArray(entry.raw) ? entry.raw : null;
    const dropped = [];
    let result = null;
    if (scene && Array.isArray(scene.elements)) {
      for (let pass = 0; pass < MAX_DEGRADE_PASSES; pass++) {
        result = await validateScene(scene, occIn, { lessonId: lesson.lessonId });
        if (gen !== entry.generation) return;
        if (result.ok) break;
        const bad = badElementIds(result.errors);
        if (bad.length === 0) break; // only scene-level errors remain
        dropped.push(...bad);
        scene = dropElements(scene, bad);
        result = null;
      }
    }
    let effective;
    if (result && result.ok && scene.elements.length > 0) {
      effective = scene;
      entry.occOut = result.occupancy;
    } else {
      // narration-only: keep the narration; keep the board when it is valid, otherwise a region on a
      // free single cell (never a wipe as a side effect of degrading); elements: []
      const raw = entry.raw && typeof entry.raw === 'object' && !Array.isArray(entry.raw) ? entry.raw : {};
      const boardInvalid = entry.errors.some((e) => e.code === 'BAD_BOARD' || e.code === 'REGION_OCCUPIED') || !raw.board || (raw.board.mode !== 'wipe' && raw.board.mode !== 'region');
      let board;
      if (!boardInvalid) board = raw.board.mode === 'wipe' ? { mode: 'wipe' } : { mode: 'region', slots: raw.board.slots };
      else { const free = freeCells(occIn); board = { mode: 'region', slots: free.length ? free[0] : 'A1' }; }
      const narration = typeof raw.narration === 'string' && raw.narration.trim() ? raw.narration : (typeof raw.title === 'string' ? raw.title : 'This scene could not be drawn.');
      effective = {
        schema: 'khan-scene/1', lessonId: lesson.lessonId, sceneId: entry.sceneId, title: typeof raw.title === 'string' ? raw.title : entry.sceneId,
        narration, board, elements: [], final: raw.final === true,
        ...(entry.kind === 'answer' ? { questionId: raw.questionId, insertAfter: raw.insertAfter } : {}),
      };
      if (Array.isArray(raw.elements)) for (const el of raw.elements) if (el && typeof el.id === 'string' && !dropped.includes(el.id)) dropped.push(el.id);
      entry.occOut = board.mode === 'wipe' ? createOccupancy() : occIn;
    }
    entry.effective = effective;
    entry.degraded = true;
    entry.droppedElementIds = [...new Set(dropped)];
    applyMeta(entry, effective);
    entry.status = 'degraded';
    lesson.notices.push({ kind: 'degraded', sceneId: entry.sceneId, droppedElementIds: entry.droppedElementIds });
    changed(lesson);
    startVoicing(lesson, entry);
    // later scenes on the track may depend on the new occupancy
    const key = trackKey(entry.sceneId);
    const after = trackEntries(lesson, key);
    const idx = after.findIndex((e) => e.sceneId === entry.sceneId);
    if (idx >= 0 && idx + 1 < after.length) await revalidateTrack(lesson, key, after[idx + 1].sceneId);
  }

  // ---------- voicing ----------
  function startVoicing(lesson, entry) {
    const gen = entry.generation;
    entry.status = 'voicing';
    changed(lesson);
    voice(lesson, entry, gen).catch((e) => log('voice error', e));
  }

  async function voice(lesson, entry, gen) {
    const text = entry.effective.narration;
    const estimate = estimateDurationMs(text);
    const ready = provider.ready();
    try {
      if (!ready.ok) { const e = new Error(ready.reason || 'TTS not ready'); e.code = 'TTS_FAILED'; throw e; }
      const hit = await cache.getOrSynthesize(provider, text);
      if (gen !== entry.generation) return;
      const audioDir = join(lesson.dir, 'audio');
      await fs.mkdir(audioDir, { recursive: true });
      const dest = join(audioDir, `${entry.sceneId}.${hit.ext}`);
      await fs.copyFile(hit.path, `${dest}.tmp`);
      await fs.rename(`${dest}.tmp`, dest);
      if (gen !== entry.generation) return;
      entry.audio = { ext: hit.ext, mime: hit.mime, path: dest, cached: hit.cached };
      entry.durationMs = Math.round(hit.durationMs);
    } catch (e) {
      if (gen !== entry.generation) return;
      entry.audio = null;
      entry.durationMs = estimate;
      entry.errors = [...entry.errors.filter((x) => x.code !== 'TTS_FAILED'), err(null, 'TTS_FAILED', e && e.message ? e.message : String(e))];
    }
    entry.status = 'ready';
    changed(lesson);
  }

  // ---------- player position / questions ----------
  function reportPosition(lesson, { sceneId, event, t }) {
    lesson.player.position = { sceneId, event, ...(typeof t === 'number' ? { t } : {}) };
    if (event === 'start') lesson.player.lastStartSceneId = sceneId;
    if (event === 'end') lesson.player.lastEndSceneId = sceneId;
    changed(lesson);
  }

  function addQuestion(lesson, { text, atSceneId, atTime }) {
    const qId = store.nextQuestionId(lesson);
    const q = { qId, text, atSceneId: atSceneId ?? null, atTime: typeof atTime === 'number' ? atTime : null, createdAt: new Date().toISOString(), answeredBy: [], complete: false };
    lesson.questions.set(qId, q);
    lesson.inboxPending.push({ kind: 'question', qId, text, atSceneId: q.atSceneId, atTime: q.atTime, createdAt: q.createdAt, delivered: false });
    control.writeQuestion(lesson, q);
    changed(lesson);
    return q;
  }

  function dispose() {
    for (const lesson of store.lessons.values()) for (const e of lesson.scenes.values()) clearRejectTimer(e);
  }

  return { ingestOutline, ingestScene, reportPosition, addQuestion, dispose, applySceneOccupancy: applyScene };
}
