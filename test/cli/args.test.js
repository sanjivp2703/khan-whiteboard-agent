// Unit: argument parsing, help, lessonId generation, output formatting, outline/scene preparation, exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgv, helpText, UsageError, COMMANDS } from '../../cli/args.js';
import { generateLessonId, slugify, timestamp } from '../../cli/lesson-id.js';
import { format, CliError, EXIT } from '../../cli/output.js';
import { prepareOutline } from '../../cli/commands/outline.js';
import { prepareScene } from '../../cli/commands/scene.js';
import { REGEX } from '../../shared/layout-core/constants.js';
import { runKhan, makeHome, REPO_ROOT, outlineOf } from './helpers.js';

test('parseArgv: every command, flags in both forms, global --pretty before or after', () => {
  assert.deepEqual(parseArgv(['serve']), { command: 'serve', positionals: [], flags: {}, pretty: false, help: false });
  assert.deepEqual(parseArgv(['serve', '--port', '8000', '--lessons-dir', '/x', '--foreground']).flags, { port: 8000, 'lessons-dir': '/x', foreground: true });
  assert.deepEqual(parseArgv(['serve', '--port=8000', '--cache-dir=/c']).flags, { port: 8000, 'cache-dir': '/c' });
  assert.deepEqual(parseArgv(['outline', '-']).positionals, ['-']);
  assert.deepEqual(parseArgv(['outline', 'my-lesson-01', '--no-open']).flags, { 'no-open': true });
  assert.deepEqual(parseArgv(['scene', 'my-lesson-01', 's001']).positionals, ['my-lesson-01', 's001']);
  assert.equal(parseArgv(['scene', 'my-lesson-01', 's001', '--timeout-ms', '500']).flags['timeout-ms'], 500);
  assert.equal(parseArgv(['wait', 'my-lesson-01', '--timeout', '2']).flags.timeout, 2);
  assert.deepEqual(parseArgv(['status', 'my-lesson-01']).positionals, ['my-lesson-01']);
  assert.deepEqual(parseArgv(['play', 'fx-full-tour', '--lessons-dir', 'fixtures/lessons', '--no-open']).flags, { 'lessons-dir': 'fixtures/lessons', 'no-open': true });
  assert.equal(parseArgv(['--pretty', 'status', 'my-lesson-01']).pretty, true);
  assert.equal(parseArgv(['status', 'my-lesson-01', '--pretty']).pretty, true);
  assert.equal(parseArgv(['scene', '--help']).help, true);
  assert.equal(parseArgv(['-h']).help, true);
  assert.equal(parseArgv([]).command, null);
});

test('parseArgv: usage errors are UsageError with the command attached', () => {
  const bad = (argv, re) => assert.throws(() => parseArgv(argv), (e) => e instanceof UsageError && re.test(e.message));
  bad(['bogus'], /unknown command/);
  bad(['serve', '--nope'], /unknown flag --nope/);
  bad(['serve', '--port'], /needs a value/);
  bad(['serve', '--port', 'abc'], /non-negative integer/);
  bad(['serve', '--foreground=1'], /takes no value/);
  bad(['scene', 'only-one'], /usage: khan scene/);
  bad(['scene', 'a', 'b', 'c'], /usage: khan scene/);
  bad(['wait'], /usage: khan wait/);
  bad(['outline'], /usage: khan outline/);
  bad(['status'], /usage: khan status/);
  bad(['play'], /usage: khan play/);
  bad(['wait', 'x', '--lessons-dir', '/y'], /unknown flag --lessons-dir for "wait"/);
});

test('help lists all six commands; per-command help shows usage and flags', () => {
  const h = helpText();
  for (const c of ['serve', 'outline', 'scene', 'wait', 'status', 'play']) assert.match(h, new RegExp(`^  ${c}\\b`, 'm'));
  assert.equal(Object.keys(COMMANDS).length, 6);
  assert.match(helpText('wait'), /khan wait <lessonId> \[--timeout S\]/);
  assert.match(helpText('wait'), /--timeout/);
  assert.match(helpText('serve'), /--foreground/);
});

test('generateLessonId: timestamp prefix, slug rules, unicode, empty, 80-char title → ≤ 64 and regex-safe', () => {
  const now = new Date(2026, 9, 6, 14, 22, 7); // local time
  assert.equal(timestamp(now), '20261006-142207');
  assert.equal(generateLessonId('How the response cache works', now), '20261006-142207-how-the-response-cache-works');
  assert.equal(generateLessonId('  Caching: a   (short) intro!! ', now), '20261006-142207-caching-a-short-intro');
  assert.equal(generateLessonId('Café — Zürich & naïve façade', now), '20261006-142207-cafe-zurich-naive-facade');
  assert.equal(generateLessonId('日本語のタイトル', now), '20261006-142207-lesson');
  assert.equal(generateLessonId('', now), '20261006-142207-lesson');
  assert.equal(generateLessonId(undefined, now), '20261006-142207-lesson');
  assert.equal(generateLessonId('---', now), '20261006-142207-lesson');
  const long = generateLessonId('a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(18), now);
  assert.ok(long.length <= 64, long);
  assert.ok(long.startsWith('20261006-142207-' + 'a'.repeat(30) + '-'));
  assert.ok(!long.endsWith('-'), 'no trailing dash after truncation');
  for (const t of ['', 'x', 'A'.repeat(80), 'ünïcödé', '!!!', 'mixed Case Title 123']) assert.match(generateLessonId(t, now), REGEX.lessonId);
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify(42), '');
});

test('format: one line by default, indented with --pretty; CliError JSON shape and exit codes', () => {
  const o = { ok: true, a: [1, 2] };
  assert.equal(format(o), '{"ok":true,"a":[1,2]}\n');
  assert.equal(format(o).split('\n').length, 2);
  assert.equal(format(o, true), JSON.stringify(o, null, 2) + '\n');
  const e = new CliError('BAD_JSON', 'nope', { details: [1] });
  assert.deepEqual(e.toJSON(), { ok: false, code: 'BAD_JSON', message: 'nope', details: [1] });
  assert.equal(e.exit, EXIT.ERROR);
  assert.equal(new CliError('SERVER_DOWN', 'x', { exit: EXIT.SERVER_DOWN }).exit, 2);
});

test('prepareOutline: fills lessonId/schema/producer for "-", rejects 2 / 13 scenes, non-sequential ids, mismatched id', () => {
  const now = new Date(2026, 9, 6, 1, 2, 3);
  const ok = prepareOutline(outlineOf('Hello World', 3), '-', now);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.outline.lessonId, '20261006-010203-hello-world');
  assert.equal(ok.outline.schema, 'khan-outline/1');
  assert.deepEqual(ok.outline.producer, { kind: 'claude-code-skill', version: '1' });
  assert.equal(prepareOutline(outlineOf('t', 12), '-', now).errors.length, 0);
  assert.ok(prepareOutline(outlineOf('t', 2), '-', now).errors.some((e) => e.code === 'CAP_COUNT'));
  assert.ok(prepareOutline(outlineOf('t', 13), '-', now).errors.some((e) => e.code === 'CAP_COUNT'));
  const gap = outlineOf('t', 3); gap.scenes[2].sceneId = 's004';
  assert.ok(prepareOutline(gap, '-', now).errors.some((e) => e.code === 'BAD_SCENE_ID' && /expected "s003"/.test(e.message)));
  const swapped = outlineOf('t', 3); swapped.scenes[0].sceneId = 's002'; swapped.scenes[1].sceneId = 's001';
  assert.ok(prepareOutline(swapped, '-', now).errors.some((e) => e.code === 'BAD_SCENE_ID'));
  // explicit id used as-is; a different embedded lessonId is refused
  assert.equal(prepareOutline(outlineOf('t', 3), 'my-lesson-01', now).outline.lessonId, 'my-lesson-01');
  assert.ok(prepareOutline({ ...outlineOf('t', 3), lessonId: 'other-lesson' }, 'my-lesson-01', now).errors.some((e) => e.code === 'BAD_LESSON_ID'));
  assert.equal(prepareOutline({ ...outlineOf('t', 3), lessonId: 'keep-this-id' }, '-', now).outline.lessonId, 'keep-this-id');
  assert.ok(prepareOutline([], '-', now).errors.some((e) => e.code === 'BAD_SCHEMA'));
  assert.ok(prepareOutline({ scenes: outlineOf('t', 3).scenes }, '-', now).errors.some((e) => e.code === 'MISSING_FIELD'), 'title required');
});

test('prepareScene: fills schema/lessonId/sceneId, refuses mismatches and non-objects', () => {
  const s = prepareScene({ title: 'x' }, 'my-lesson-01', 's001');
  assert.equal(s.schema, 'khan-scene/1');
  assert.equal(s.lessonId, 'my-lesson-01');
  assert.equal(s.sceneId, 's001');
  assert.throws(() => prepareScene({ lessonId: 'other-lesson' }, 'my-lesson-01', 's001'), (e) => e.code === 'ID_MISMATCH');
  assert.throws(() => prepareScene({ sceneId: 's002' }, 'my-lesson-01', 's001'), (e) => e.code === 'ID_MISMATCH');
  assert.throws(() => prepareScene('str', 'my-lesson-01', 's001'), (e) => e.code === 'BAD_SCENE');
});

test('bin/khan: --help exit 0 lists six commands, unknown command exit 1 with JSON, every cli file parses (criterion 1)', async () => {
  const h = makeHome();
  try {
    const help = await runKhan(['--help'], { env: h.env });
    assert.equal(help.code, 0);
    for (const c of ['serve', 'outline', 'scene', 'wait', 'status', 'play']) assert.match(help.stdout, new RegExp(`^  ${c}\\b`, 'm'));
    const sub = await runKhan(['wait', '--help'], { env: h.env });
    assert.equal(sub.code, 0);
    assert.match(sub.stdout, /khan wait <lessonId>/);
    const none = await runKhan([], { env: h.env });
    assert.equal(none.code, 1, 'no command → help + exit 1');
    const bogus = await runKhan(['bogus'], { env: h.env });
    assert.equal(bogus.code, 1);
    assert.equal(bogus.json.ok, false);
    assert.equal(bogus.json.code, 'USAGE');
    assert.equal(bogus.lines.length, 1, 'one JSON line');
    const badId = await runKhan(['status', 'BAD ID'], { env: h.env });
    assert.equal(badId.code, 1);
    assert.equal(badId.json.code, 'BAD_LESSON_ID');
    const pretty = await runKhan(['--pretty', 'status', 'BAD ID'], { env: h.env });
    assert.ok(pretty.stdout.split('\n').length > 3, 'pretty output is indented');
    assert.equal(JSON.parse(pretty.stdout).code, 'BAD_LESSON_ID');
    // syntax gate
    execFileSync(process.execPath, ['--check', join(REPO_ROOT, 'bin', 'khan')]);
    const files = [...readdirSync(join(REPO_ROOT, 'cli')).filter((f) => f.endsWith('.js')).map((f) => join(REPO_ROOT, 'cli', f)), ...readdirSync(join(REPO_ROOT, 'cli', 'commands')).map((f) => join(REPO_ROOT, 'cli', 'commands', f))];
    assert.ok(files.length >= 10);
    for (const f of files) execFileSync(process.execPath, ['--check', f]);
  } finally {
    h.cleanup();
  }
});
