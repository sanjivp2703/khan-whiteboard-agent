// SKILL.md lint (criteria 10–11): frontmatter, trigger phrases, required rules, validated examples,
// no instruction to read the lesson directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_PATH } from './helpers.js';
import { validateScene, validateOutline, prepareValidator } from '../../shared/schema/validate.js';
import { createOccupancy } from '../../shared/layout-core/occupancy.js';
import { ELEMENT_TYPES } from '../../shared/layout-core/constants.js';

const md = readFileSync(SKILL_PATH, 'utf8');

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'SKILL.md must start with a --- frontmatter block');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { fm, body: text.slice(m[0].length) };
}

const { fm, body } = parseFrontmatter(md);

test('frontmatter parses; name is khan; description carries the trigger phrases', () => {
  assert.equal(fm.name, 'khan');
  assert.ok(fm.description && fm.description.length > 50);
  for (const phrase of ['/khan', 'khan, explain this', 'whiteboard this', 'turn this into a video']) {
    assert.ok(fm.description.includes(phrase), `description lacks "${phrase}"`);
  }
  assert.match(fm.description, /focus/i, 'description mentions the free-text focus argument');
  assert.match(fm.description, /audience/i);
});

test('body contains every required rule (criterion 10)', () => {
  const has = (re, what) => assert.match(body, re, `SKILL.md body lacks: ${what}`);
  has(/sketch → diagram → plot → svg/, 'tier order');
  has(/tts\.ready/, 'tts.ready check');
  has(/OPENAI_API_KEY/, 'OPENAI_API_KEY');
  has(/tts\.ready[^\n]*false[^\n]*\n?[^\n]*stop/i, 'the no-key stop rule');
  has(/15–90 words|15 to 90 words/, 'narration word range');
  has(/great question/i, 'filler ban: great question');
  has(/let'?s dive in/i, 'filler ban: let\'s dive in');
  has(/one idea per scene/i, 'one idea per scene');
  for (const ev of ['continue', 'reject', 'question', 'timeout', 'finished', 'player-closed']) has(new RegExp('`' + ev + '`'), `wait event ${ev}`);
  has(/khan wait/, 'the khan wait loop');
  has(/first[^\n]*answer scene[^\n]*wipe/i, 'first answer scene is a wipe');
  has(/questionId/, 'questionId');
  has(/insertAfter/, 'insertAfter');
  has(/"final": true/, 'final: true on the last answer scene');
  has(/same concept, same color/i, 'color consistency');
  has(/one accent[^\n]*per concept/i, 'one accent per concept');
  has(/Scene 1 first, immediately, and small/i, 'first-scene-fast rule');
  has(/eight seconds/i, 'first audio target');
  has(/outline/i, 'outline first');
  has(/3–12 scenes/, '3–12 scenes');
  has(/`code` element/, 'code in code elements');
  has(/never read the board aloud/i, 'no reading the board aloud');
  has(/region/, 'region guidance');
  has(/wipe/, 'wipe guidance');
  has(/one-row `table` with an index header/i, 'arrays as a one-row table');
  has(/Equations are `math`, never `text`/, 'equations as math');
  has(/\$ARGUMENTS/, 'argument substitution');
  has(/\$\{CLAUDE_PROJECT_DIR\}\/bin\/khan/, 'CLI path');
  has(/no argument|Empty\*\* →/i, 'no-argument contract');
  has(/scope\/focus/i, 'free-text focus contract');
  has(/audience/i, 'audience hints');
  has(/length hints/i, 'length hints');
  has(/turn stays open/i, 'turn stays open note');
  has(/Esc/, 'Esc note');
  // the cheat-sheet names all twelve types with caps
  for (const t of ELEMENT_TYPES) has(new RegExp('^\\| `' + t + '` \\|', 'm'), `cheat-sheet row for ${t}`);
  has(/≤ 8 nodes, ≤ 12 edges/, 'diagram caps');
  has(/≤ 4 KB/, 'svg size cap');
});

test('the skill never tells Claude to read the lesson directory (criterion 11)', () => {
  for (const forbidden of ['ls .khan', 'cat .khan', 'scenes/', '.khan/lessons', 'playlist.json', 'audio/']) {
    assert.ok(!body.includes(forbidden), `SKILL.md must not mention "${forbidden}"`);
  }
  assert.match(body, /control\/inbox\.json/, 'inbox.json is the one file named');
  assert.match(body, /Never read the lesson folder/i);
});

test('every fenced JSON block is a valid outline or a valid scene in a fresh occupancy; all twelve element types have an example', async () => {
  await prepareValidator();
  const blocks = [...body.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 13, `expected at least 13 json blocks (outline + answer + 11 scenes), got ${blocks.length}`);
  const types = new Set();
  let outlines = 0;
  let answers = 0;
  for (const [i, text] of blocks.entries()) {
    let json;
    try { json = JSON.parse(text); } catch (e) { assert.fail(`json block #${i} does not parse: ${e.message}`); }
    if (json.schema === 'khan-outline/1') {
      const r = validateOutline(json, { lessonId: json.lessonId });
      assert.ok(r.ok, `outline block #${i}: ${JSON.stringify(r.errors)}`);
      json.scenes.forEach((s, k) => assert.equal(s.sceneId, `s${String(k + 1).padStart(3, '0')}`));
      outlines++;
      continue;
    }
    assert.equal(json.schema, 'khan-scene/1', `block #${i} must be an outline or a scene`);
    const r = await validateScene(json, createOccupancy(), { lessonId: json.lessonId });
    assert.ok(r.ok, `scene block #${i} (${json.sceneId}): ${JSON.stringify(r.errors)}`);
    for (const el of json.elements) types.add(el.type);
    if (/^q\d{3}-a\d{2}$/.test(json.sceneId)) {
      answers++;
      assert.equal(json.board.mode, 'wipe');
      assert.equal(json.questionId, json.sceneId.slice(0, 4));
      assert.match(json.insertAfter, /^s\d{3}$/);
      assert.equal(json.final, true);
    }
  }
  assert.equal(outlines, 1, 'exactly one outline example');
  assert.ok(answers >= 1, 'an answer-scene example');
  for (const t of ELEMENT_TYPES) assert.ok(types.has(t), `no example element of type ${t}`);
  // at least one region example and one with explicit timing
  const scenes = blocks.map((b) => JSON.parse(b)).filter((j) => j.schema === 'khan-scene/1');
  assert.ok(scenes.some((s) => s.board.mode === 'region'), 'a region example');
  assert.ok(scenes.some((s) => s.elements.some((e) => e.at !== undefined || e.itemAt)), 'an explicit timing example');
});
