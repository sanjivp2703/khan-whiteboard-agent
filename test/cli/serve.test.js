// khan serve (criterion 2): spawn detached, healthy ≤ 5 s, pidfile, survives the CLI, reuse, stale pidfile → respawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeHome, runKhan, pidAlive, killPid, healthOk, sleep } from './helpers.js';

test('serve: spawns a detached server, writes server.json, reuses it, respawns on a stale pidfile, passes --lessons-dir through', async () => {
  const h = makeHome();
  const pids = [];
  try {
    const t0 = Date.now();
    const first = await runKhan(['serve', '--port', '0'], { env: h.env });
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.ok(Date.now() - t0 < 5000 + 1500, `serve took ${Date.now() - t0} ms`);
    assert.equal(first.lines.length, 1, 'one JSON line');
    const j = first.json;
    assert.equal(j.ok, true);
    assert.equal(j.spawned, true);
    assert.ok(Number.isInteger(j.port) && j.port > 0);
    assert.equal(j.host, '127.0.0.1');
    assert.equal(j.url, `http://127.0.0.1:${j.port}`);
    assert.equal(j.tts.provider, 'silent');
    assert.equal(j.tts.ready, true);
    assert.equal(j.lessonsDir, h.lessonsDir, 'default lessons dir under KHAN_HOME');
    pids.push(j.pid);
    // the CLI has exited; the server lives on
    assert.ok(pidAlive(j.pid), 'server pid alive after the CLI exited');
    assert.ok(await healthOk(j.port), 'server healthy after the CLI exited');
    const pidfile = h.readServerJson();
    assert.equal(pidfile.port, j.port);
    assert.equal(pidfile.pid, j.pid);
    assert.ok(pidfile.startedAt);
    assert.ok(existsSync(join(h.home, 'server.log')));

    // second serve: detects the running server, does not spawn
    const second = await runKhan(['serve'], { env: h.env });
    assert.equal(second.code, 0);
    assert.equal(second.json.spawned, false);
    assert.equal(second.json.pid, j.pid);
    assert.equal(second.json.port, j.port);
    // with a different explicit --lessons-dir → mismatch error, no second server
    const alt = join(h.home, 'alt-lessons');
    mkdirSync(alt);
    const mismatch = await runKhan(['serve', '--lessons-dir', alt], { env: h.env });
    assert.equal(mismatch.code, 1);
    assert.equal(mismatch.json.code, 'LESSONS_DIR_MISMATCH');

    // stale pidfile: kill the server, leave the file → respawn with a new pid
    await killPid(j.pid);
    assert.ok(!pidAlive(j.pid));
    assert.equal(await healthOk(j.port), null);
    assert.ok(existsSync(h.serverJson), 'pidfile still there (stale)');
    const third = await runKhan(['serve', '--port', '0', '--lessons-dir', alt], { env: h.env });
    assert.equal(third.code, 0, third.stdout);
    assert.equal(third.json.spawned, true);
    assert.notEqual(third.json.pid, j.pid);
    pids.push(third.json.pid);
    assert.equal(third.json.lessonsDir, alt, '--lessons-dir passed through to the server');
    assert.equal((await healthOk(third.json.port)).lessonsDir, alt);
    assert.equal(h.readServerJson().pid, third.json.pid);

    // a pidfile pointing at a dead pid AND a bogus port is also stale
    await killPid(third.json.pid);
    writeFileSync(h.serverJson, JSON.stringify({ port: 1, host: '127.0.0.1', pid: 999999, startedAt: 'x', lessonsDir: alt, url: 'http://127.0.0.1:1' }));
    const fourth = await runKhan(['serve', '--port', '0'], { env: h.env });
    assert.equal(fourth.code, 0, fourth.stdout);
    assert.equal(fourth.json.spawned, true);
    pids.push(fourth.json.pid);
    await sleep(50);
  } finally {
    for (const p of pids) await killPid(p);
    h.cleanup();
  }
});

test('serve: a server started by hand on the requested port (no pidfile) is adopted, not duplicated', async () => {
  const h = makeHome();
  let pid = null;
  try {
    const a = await runKhan(['serve', '--port', '0'], { env: h.env });
    assert.equal(a.code, 0, a.stdout);
    pid = a.json.pid;
    // forget the pidfile; ask for the same port explicitly
    const { rmSync } = await import('node:fs');
    rmSync(h.serverJson);
    const b = await runKhan(['serve', '--port', String(a.json.port)], { env: h.env });
    assert.equal(b.code, 0, b.stdout);
    assert.equal(b.json.spawned, false);
    assert.equal(b.json.port, a.json.port);
    assert.equal(b.json.pid, null, 'pid unknown for an adopted server');
  } finally {
    await killPid(pid);
    h.cleanup();
  }
});
