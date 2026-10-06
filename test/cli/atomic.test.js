// Atomic writes (criterion 4): .tmp then rename, never a partial read; the watcher ingests once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watch, readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../../cli/atomic.js';
import { makeHome, runKhan, startHomeServer, outlineOf, sceneOf, sleep } from './helpers.js';

test('writeJsonAtomic: fs.watch sees the .tmp before the final name; every read of the final file is complete JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khan-atomic-'));
  try {
    const file = join(dir, 's001.json');
    const events = [];
    const w = watch(dir, (type, name) => events.push({ type, name }));
    const big = { schema: 'khan-scene/1', pad: Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`) };
    let partial = 0;
    let reads = 0;
    const reader = setInterval(() => {
      if (!existsSync(file)) return;
      reads++;
      try { JSON.parse(readFileSync(file, 'utf8')); } catch { partial++; }
    }, 1);
    for (let i = 0; i < 5; i++) await writeJsonAtomic(file, { ...big, i });
    await sleep(150);
    clearInterval(reader);
    w.close();
    assert.equal(partial, 0, `saw ${partial} partial reads out of ${reads}`);
    assert.ok(reads > 0, 'the reader did observe the file');
    assert.deepEqual(readdirSync(dir), ['s001.json'], 'no .tmp left behind');
    const firstTmp = events.findIndex((e) => e.name === 's001.json.tmp');
    const firstFinal = events.findIndex((e) => e.name === 's001.json');
    assert.ok(firstTmp >= 0, `expected an event for the .tmp file, got ${JSON.stringify(events)}`);
    assert.ok(firstFinal >= 0, 'expected an event for the final file');
    assert.ok(firstTmp < firstFinal, `tmp (${firstTmp}) must precede final (${firstFinal})`);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).i, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('khan scene / outline via the CLI are ingested exactly once and never seen partial by the foundation watcher', async () => {
  const h = makeHome();
  const srv = await startHomeServer(h);
  try {
    const o = await runKhan(['outline', 'atomic-lesson-01'], { env: h.env, stdin: outlineOf('Atomic', 3) });
    assert.equal(o.code, 0, o.stdout);
    assert.equal(o.json.ingested, true);
    const statuses = new Set();
    const poll = setInterval(async () => { const p = await srv.playlist('atomic-lesson-01'); const e = p && p.entries.find((x) => x.sceneId === 's001'); if (e) statuses.add(e.status); }, 10);
    const big = sceneOf('s001', { elements: [{ id: 'c', type: 'code', slot: 'A1:F2', lines: Array.from({ length: 14 }, (_, i) => `const line${i} = ${'1'.repeat(100)};`) }] });
    const s = await runKhan(['scene', 'atomic-lesson-01', 's001'], { env: h.env, stdin: big });
    clearInterval(poll);
    assert.equal(s.code, 0);
    assert.notEqual(s.json.status, 'pending');
    assert.ok(!statuses.has('rejected'), `statuses seen: ${[...statuses]}`);
    assert.ok(!s.json.errors.some((e) => e.code === 'BAD_JSON'), JSON.stringify(s.json.errors));
    assert.equal(srv.info.store.get('atomic-lesson-01').scenes.get('s001').attempts, 1, 'ingested exactly once');
    assert.deepEqual(readdirSync(join(h.lessonsDir, 'atomic-lesson-01', 'scenes')), ['s001.json']);
    assert.ok(!existsSync(join(h.lessonsDir, 'atomic-lesson-01', 'outline.json.tmp')));
  } finally {
    await srv.close();
    h.cleanup();
  }
});
