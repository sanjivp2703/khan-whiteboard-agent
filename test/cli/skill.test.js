// SKILL.md lint (criteria 10–11): frontmatter, trigger phrases, required rules, validated examples,
// no instruction to read the lesson directory; the cheat-sheet's caps and enums against the constants
// (qa/04 finding 3: sketch shapes and plot caps as well as the text cap and highlight styles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_PATH } from './helpers.js';
import { validateScene, validateOutline, prepareValidator } from '../../shared/schema/validate.js';
import { createOccupancy } from '../../shared/layout-core/occupancy.js';
import { ELEMENT_TYPES, CAPS, HIGHLIGHT_STYLES, SKETCH_SHAPES, TIMING, PEN_PX_PER_S } from '../../shared/layout-core/constants.js';
import { ERROR_CODES } from '../../shared/schema/errors.js';
import { PLOT_AXIS_NAME_WORDS, PLOT_POINT_LABEL_WORDS } from '../../shared/schema/shape.js';
import { TICKS_MIN, TICKS_MAX } from '../../player/renderer/pictures/plot.js';
import { BANNED_MACROS } from '../../shared/math.js';

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

test('section 7 maps every validator error code to a fix and lists every banned math macro; the wait loop fits the Bash tool timeout (QA finding 12)', () => {
  const sec = body.slice(body.indexOf('## 7.'), body.indexOf('## 8.'));
  for (const code of ERROR_CODES) assert.ok(sec.includes('| `' + code + '` |'), `error table lacks a row for ${code}`);
  for (const m of BANNED_MACROS) assert.ok(sec.includes('`\\' + m + '`'), `BAD_MATH row lacks \\${m}`);
  assert.match(sec, /base.*ams/, 'states the base + ams package rule');
  // khan wait must return before Claude Code's 120 s default Bash timeout; a timeout event is silent
  assert.match(body, /khan" wait <lessonId> --timeout 100/, 'wait is invoked with --timeout 100');
  assert.doesNotMatch(body, /khan" wait <lessonId>\n/, 'no bare wait invocation without --timeout');
  assert.match(body, /120 s/, 'names the Bash tool default timeout');
  assert.match(body, /\| `timeout` \|[^\n]*run `wait` again immediately and silently/, 'timeout → wait again, silently');
  assert.match(body, /\| `continue` \|[^\n]*write the next scene, then `wait` again/, 'continue fast path unchanged');
});

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const row = (sheet, type) => {
  const r = sheet.split('\n').find((l) => l.startsWith('| `' + type + '` |'));
  assert.ok(r, `cheat-sheet row for ${type}`);
  return r;
};

test('cheat-sheet ↔ constants (qa/04 finding 3): text cap, highlight styles, the sketch shape list, the plot caps and the matching section 7 rows', () => {
  const sheet = body.slice(body.indexOf('## 6.'), body.indexOf('## 7.'));
  const errors = body.slice(body.indexOf('## 7.'), body.indexOf('## 8.'));
  const rules = body.slice(body.indexOf('## 4.'), body.indexOf('## 5.'));
  // text
  const textRow = row(sheet, 'text');
  assert.match(textRow, new RegExp(`≤ ${CAPS.textWordsPerCell} words per cell, ≤ ${CAPS.textWordsMax} total`));
  assert.match(textRow, new RegExp(`\`title\` ≤ ${CAPS.titleWordsMax} words`));
  assert.ok(errors.includes(`text ${CAPS.textWordsPerCell} per cell / ${CAPS.textWordsMax} total, title ${CAPS.titleWordsMax}`), 'CAP_WORDS row: text and title caps');
  // highlight styles, in constant order
  assert.ok(row(sheet, 'highlight').includes('`style` ' + HIGHLIGHT_STYLES.join('/')), 'highlight row lists every style');
  assert.ok(errors.includes('highlight: ' + HIGHLIGHT_STYLES.join('/')), 'BAD_ENUM row lists every highlight style');
  // sketch shapes: the cheat-sheet row and the tier-order paragraph list all of them in constant order; BAD_ENUM counts them
  const shapes = SKETCH_SHAPES.join(', ');
  assert.ok(row(sheet, 'sketch').includes('shape ∈ ' + shapes), `sketch row lists ${shapes}`);
  assert.ok(rules.includes('(' + shapes), 'section 4 tier-order paragraph lists every sketch shape');
  assert.ok(errors.includes(`the ${NUMBER_WORDS[SKETCH_SHAPES.length]} sketch shapes`), `BAD_ENUM row says "the ${NUMBER_WORDS[SKETCH_SHAPES.length]} sketch shapes"`);
  assert.match(row(sheet, 'sketch'), new RegExp(`\`label\` \\(≤ ${CAPS.sketchLabelWords} words\\)`));
  assert.ok(errors.includes(`arrow or sketch label ${CAPS.sketchLabelWords}`), 'CAP_WORDS row: sketch label cap');
  // plot caps
  const plotRow = row(sheet, 'plot');
  assert.ok(plotRow.includes(`≤ ${CAPS.plotSeriesMax} fns/series`), 'plot row: series cap');
  assert.ok(plotRow.includes(`≤ ${CAPS.plotPointsMax} points per series`), 'plot row: points cap');
  assert.ok(plotRow.includes(`slot at least ${CAPS.plotMinSpan} × ${CAPS.plotMinSpan} cells`), 'plot row: min span');
  assert.ok(plotRow.includes(`${TICKS_MIN}–${TICKS_MAX} integer ticks`), 'plot row: tick count');
  assert.ok(plotRow.includes(`\`xLabel\`/\`yLabel\`, ≤ ${PLOT_AXIS_NAME_WORDS} words`), 'plot row: axis name cap');
  assert.ok(plotRow.includes(`≤ ${PLOT_POINT_LABEL_WORDS} words each`), 'plot row: point label cap');
  assert.ok(plotRow.includes('`hole: [x, y]`'), 'plot row: hole');
  assert.ok(errors.includes(`plot axis name ${PLOT_AXIS_NAME_WORDS}, plot point label ${PLOT_POINT_LABEL_WORDS}`), 'CAP_WORDS row: plot caps');
  // timing wording (qa/04 finding 2): talk-first default, itemAt inside the window, no "spaced evenly" left
  const pct = Math.round(TIMING.firstAt * 100);
  assert.match(rules, new RegExp(`talk-first at about ${pct} % of the audio`), 'Ids and timing: talk-first default');
  assert.match(rules, new RegExp(`up to ${Math.round(TIMING.lastWindowEnd * 100)} %`), 'Ids and timing: last window end');
  assert.match(rules, /`itemAt` starts below 0\.08 needs an explicit `"at": 0`/, 'Ids and timing: the at: 0 remedy');
  assert.equal(String(TIMING.firstAt), '0.08');
  assert.doesNotMatch(body, /spaced evenly/, 'the old even-spacing wording is gone');
  assert.match(errors, /\| `BAD_AT` \|[^\n]*lies outside the element window[^\n]*\| omit `at`[^\n]*`"at": 0`/, 'BAD_AT row names the window message and the remedy');
  // pacing budget (qa/04 finding 1c): the pen speed from the constant, the rule of thumb, split not compress
  assert.match(rules, new RegExp(`\\*\\*Pacing budget\\.\\*\\*[^\n]*about ${PEN_PX_PER_S} board-px per second`), 'pacing budget states PEN_PX_PER_S');
  assert.match(rules, /one written word per two spoken words/, 'rule of thumb');
  assert.match(rules, /code block of n lines needs roughly 2·n \+ 4 seconds of narration or its own scene/, 'code block rule');
  assert.match(rules, /compresses the writing[^\n]*Split such a scene/, 'overfull scenes are compressed; split instead');
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
