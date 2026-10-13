// change-khan-feel (design/02-khan-video-study.md §4 items 3, 4, 7, 9, 10, 12): sweep reveal,
// handwriting shear and jitter, the raised sizes and re-derived caps (constants ↔ SKILL.md),
// handwritten math glyphs fitted into MathJax's boxes, and the row colours of gridless tables.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FONT_SIZES, LINE_HEIGHTS, CAPS, HIGHLIGHT_STYLES, MATH_LAYOUT } from '../../shared/layout-core/constants.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { flatten } from '../../shared/strokes.js';
import { HAND, handJitter, handGlyphPath, jitterPath, sweepEdge, strokeTip, boundsOfPaths, glyphOutline } from '../../player/renderer/core/drawable.js';
import { mathChar, BAR_GLYPHS } from '../../player/renderer/core/math.js';
import { rowColorToken } from '../../player/renderer/core/table.js';
import { setup, scene, makeDrawCtx, prepare, prepareLesson, fixtureElement, rectContainsRect, fakeCtx2d } from './helpers.js';

before(async () => { await setup(); });

const txt = (id, slot, text, over = {}) => ({ id, type: 'text', slot, text, ...over });
const ctxFor = (...elements) => makeDrawCtx([scene('s001', 'wipe', elements)], 0);
const skill = readFileSync(new URL('../../.claude/skills/khan/SKILL.md', import.meta.url), 'utf8');

// ---------- item 3: glyph reveal by sweep ----------

test('sweep: the reveal edge of the glyph being written is monotonic in u, runs left → right across the glyph, and the tip sits on that edge', () => {
  const el = txt('sweep', 'A1:C1', 'Limit');
  const d = prepare(el, ctxFor(el));
  let lastEdge = -Infinity, lastIndex = -1, sawProgress = 0;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const p = d.progress(u);
    if (p.current < 0) continue;
    const s = d.strokes[p.current];
    const edge = sweepEdge(s, p.fraction);
    if (p.current === lastIndex) assert.ok(edge >= lastEdge - 1e-9, `edge fell from ${lastEdge} to ${edge} at u=${u}`);
    else assert.ok(p.current > lastIndex, 'glyphs are revealed in order');
    assert.ok(edge >= s.bounds.x - 2 - 1e-9 && edge <= s.bounds.x + s.bounds.w + 2 + 1e-9, `edge ${edge} outside glyph ${s.char}`);
    const tip = d.tipAt(u);
    assert.ok(Math.abs(tip.x - Math.max(s.bounds.x, Math.min(s.bounds.x + s.bounds.w, edge))) < 1e-9, `tip x ${tip.x} is not the edge ${edge}`);
    assert.ok(tip.y >= s.bounds.y - 1e-9 && tip.y <= s.bounds.y + s.bounds.h + 1e-9, `tip y ${tip.y} off the glyph ${s.char}`);
    lastEdge = edge; lastIndex = p.current; sawProgress++;
  }
  assert.ok(sawProgress > 300);
  // a finished glyph's tip is its right edge; an unstarted glyph's tip is its left edge
  const first = d.strokes[0];
  assert.ok(Math.abs(strokeTip(first, 1).x - (first.bounds.x + first.bounds.w)) < 1e-9);
  assert.ok(Math.abs(strokeTip(first, 0).x - first.bounds.x) < 1e-9);
  assert.ok(Math.abs(d.tipAt(1).x - (d.strokes.at(-1).bounds.x + d.strokes.at(-1).bounds.w)) < 1e-9, 'tip at u=1 is the right edge of the last glyph');
});

test('sweep: paint of a half-written glyph clips (never traces the outline) and fills it like a finished glyph; nothing else changes', () => {
  const el = txt('p', 'A1:B1', 'ab');
  const d = prepare(el, ctxFor(el));
  // u inside the first glyph
  const u = 0.2;
  const p = d.progress(u);
  assert.equal(p.completeCount, 0);
  assert.equal(p.current, 0);
  assert.ok(p.fraction > 0 && p.fraction < 1);
  const { ctx, calls } = fakeCtx2d();
  d.paint(ctx, u);
  assert.equal(calls.clip, 1, 'one clip for the glyph in progress');
  assert.equal(calls.rect, 1);
  assert.equal(calls.fill, 1, 'the in-progress glyph is filled');
  assert.equal(calls.save, calls.restore);
  const done = fakeCtx2d();
  d.paint(done.ctx, 1);
  assert.equal(done.calls.clip, undefined, 'finished glyphs need no clip');
  assert.equal(done.calls.fill, 2);
  // rough strokes still trace partially (no clip)
  const box = { id: 'b', type: 'box', slot: 'A1' };
  const bd = prepare(box, ctxFor(box));
  const partial = fakeCtx2d();
  bd.paint(partial.ctx, 0.3);
  assert.equal(partial.calls.clip, undefined);
  assert.ok(partial.calls.stroke >= 1);
});

// ---------- item 4: sizes, shear, jitter ----------

test('sizes: body 38 / note 28 / title 44 / code 20 with line heights 48 / 36 / 54 / 24; math follows at 36 px', () => {
  assert.deepEqual({ ...FONT_SIZES }, { title: 44, body: 38, note: 28, code: 20 });
  assert.deepEqual({ ...LINE_HEIGHTS }, { title: 54, body: 48, note: 36, code: 24 });
  assert.ok(FONT_SIZES.title >= FONT_SIZES.body, 'titles are not smaller than body');
  assert.equal(MATH_LAYOUT.fontPx, 36);
  assert.equal(CAPS.textWordsPerCell, 8);
});

test('caps ↔ SKILL.md: the cheat-sheet states the text word cap, the highlight styles and the BAD_ENUM / CAP_WORDS rows exactly as the constants have them', () => {
  const sheet = skill.slice(skill.indexOf('## 6.'), skill.indexOf('## 7.'));
  const textRow = sheet.split('\n').find((l) => l.startsWith('| `text` |'));
  assert.match(textRow, new RegExp(`≤ ${CAPS.textWordsPerCell} words per cell, ≤ ${CAPS.textWordsMax} total`));
  assert.match(textRow, new RegExp(`\`title\` ≤ ${CAPS.titleWordsMax} words`));
  const hlRow = sheet.split('\n').find((l) => l.startsWith('| `highlight` |'));
  assert.ok(hlRow.includes('`style` ' + HIGHLIGHT_STYLES.join('/')), `highlight row lists ${HIGHLIGHT_STYLES.join('/')}: ${hlRow}`);
  const errors = skill.slice(skill.indexOf('## 7.'), skill.indexOf('## 8.'));
  assert.ok(errors.includes('highlight: ' + HIGHLIGHT_STYLES.join('/')), 'BAD_ENUM row lists every highlight style');
  assert.ok(errors.includes(`text ${CAPS.textWordsPerCell} per cell / ${CAPS.textWordsMax} total`), 'CAP_WORDS row states the per-cell cap');
  // the enum itself is additive: the four original styles are still there, in front
  assert.deepEqual(HIGHLIGHT_STYLES.slice(0, 2), ['circle', 'underline']);
  for (const s of ['circle', 'underline', 'strike', 'pointer', 'wavy', 'double', 'box']) assert.ok(HIGHLIGHT_STYLES.includes(s), s);
});

test('shear: hand-written glyphs lean right by HAND.shearDeg about the baseline; code glyphs stay upright', () => {
  const tan = Math.tan((HAND.shearDeg * Math.PI) / 180);
  assert.ok(Math.abs(HAND.shearDeg - 6) < 1e-9);
  // a tall rectangle outline sheared with no jitter: its top edge moves right by tan(6°) × height
  const h = 40, baseline = 100;
  const rect = handGlyphPath(`M10 ${baseline}L10 ${baseline - h}L20 ${baseline - h}L20 ${baseline}Z`, baseline, null);
  const b = boundsOfPaths([rect]);
  assert.ok(Math.abs(b.w - (10 + tan * h)) < 0.05, `sheared width ${b.w}`);
  assert.ok(Math.abs(b.x - 10) < 0.05, 'the baseline end does not move');
  // real text: every glyph path is exactly the font outline put through the hand transform with its own jitter
  const el = txt('hand', 'A1:B1', 'Hi there');
  const d = prepare(el, ctxFor(el));
  for (const s of d.strokes) {
    assert.equal(s.d, handGlyphPath(glyphOutline(s.char, 'body', s.x, s.baseline), s.baseline, s.jitter), `glyph ${s.char}`);
    assert.notEqual(s.d, glyphOutline(s.char, 'body', s.x, s.baseline), `glyph ${s.char} is not upright`);
  }
  // and the lean is to the right: the top of the sheared 'H' sits right of the top of the upright one
  const H = d.strokes.find((s) => s.char === 'H');
  const upright = boundsOfPaths([glyphOutline('H', 'body', H.x, H.baseline)]);
  const topX = (dd) => { const b = boundsOfPaths([dd]); const pts = flatten(dd).flatMap((sp) => sp.points); return Math.min(...pts.filter((p) => p[1] <= b.y + 1).map((p) => p[0])); };
  assert.ok(topX(H.d) > topX(glyphOutline('H', 'body', H.x, H.baseline)) + 0.6 * tan * upright.h, 'H leans right');
  // code: upright, no jitter meta
  const code = { id: 'c', type: 'code', slot: 'A1', lines: ['l'] };
  const cs = prepare(code, ctxFor(code)).strokes.find((x) => x.kind === 'glyph');
  assert.equal(cs.jitter, null);
  assert.equal(HAND.styles.includes('code'), false);
});

test('jitter: deterministic per element id and glyph index, within ±1 px / ±3 % / ±2°; the same text under another id differs, the same id never does', () => {
  for (let i = 0; i < 200; i++) {
    const j = handJitter('some_id', i);
    assert.ok(Math.abs(j.dy) <= HAND.baselinePx + 1e-9);
    assert.ok(Math.abs(j.size - 1) <= HAND.sizePct / 100 + 1e-9);
    assert.ok(Math.abs(j.rot) <= (HAND.rotationDeg * Math.PI) / 180 + 1e-9);
    assert.deepEqual(handJitter('some_id', i), j);
  }
  assert.notDeepEqual(handJitter('a', 0), handJitter('b', 0));
  assert.notDeepEqual(handJitter('a', 0), handJitter('a', 1));
  const text = 'Hello world, again';
  const a = prepare(txt('one', 'A1:C1', text), ctxFor(txt('one', 'A1:C1', text)));
  const a2 = prepare(txt('one', 'A1:C1', text), ctxFor(txt('one', 'A1:C1', text)));
  const b = prepare(txt('two', 'A1:C1', text), ctxFor(txt('two', 'A1:C1', text)));
  assert.deepEqual(a.paths, a2.paths, 'same id → identical glyph paths');
  assert.notDeepEqual(a.paths, b.paths, 'another id → other jitter');
  assert.deepEqual(a.meta.lineRects, b.meta.lineRects, 'measurement (wrap, advances, baselines) does not depend on the jitter');
  // glyph indices count characters (spaces included), so they rise strictly; each jitter is the keyed one
  a.strokes.forEach((s, i) => { if (i) assert.ok(s.index > a.strokes[i - 1].index); assert.deepEqual(s.jitter, handJitter('one', s.index)); });
  // glyph x (advance position) and baseline are the measured ones; only the outline moves
  a.strokes.forEach((s, i) => { assert.equal(s.x, b.strokes[i].x); assert.equal(s.baseline, b.strokes[i].baseline); });
  // jitterPath stays within its amplitude and is deterministic
  const d = 'M0 0L100 0L100 50L0 50Z';
  const j1 = jitterPath(d, 'k', 0.5), j2 = jitterPath(d, 'k', 0.5);
  assert.equal(j1, j2);
  assert.notEqual(j1, d);
  const jb = boundsOfPaths([j1]);
  assert.ok(jb.x >= -0.5 && jb.y >= -0.5 && jb.x + jb.w <= 100.5 && jb.y + jb.h <= 50.5);
});

// ---------- item 7: handwritten math ----------

test('math: MathJax glyph codes fold onto plain characters (italic/bold/script letters, digits, Greek, ℎ)', () => {
  assert.equal(mathChar('1D465'), 'x');  // italic x
  assert.equal(mathChar('1D44E'), 'a');  // italic a
  assert.equal(mathChar('1D434'), 'A');  // italic A
  assert.equal(mathChar('1D41A'), 'a');  // bold a
  assert.equal(mathChar('1D7CE'), '0');  // bold 0
  assert.equal(mathChar('210E'), 'h');   // planck h (italic h)
  assert.equal(mathChar('1D6FC'), 'α');  // italic alpha
  assert.equal(mathChar('1D70B'), 'π');  // italic pi
  assert.equal(mathChar('31'), '1');
  assert.equal(mathChar('68'), 'h');
  assert.equal(mathChar('2192'), '→');
  assert.equal(mathChar(null), null);
  assert.ok(BAR_GLYPHS.includes('3D') && BAR_GLYPHS.includes('2212'));
});

test('math: every fitted handwriting glyph lies inside the MathJax ink box it replaces; rules keep their path; fallbacks stay within 0.6 px of their box', async () => {
  let hand = 0, rule = 0, fallback = 0;
  for (const lessonId of ['fx-type-math', 'fx-core-dense', 'fx-full-tour']) {
    for (const { el, drawable: d } of await prepareLesson(lessonId)) {
      if (el.type !== 'math') continue;
      assert.equal(d.meta.handwritten, true);
      for (const s of d.strokes) {
        assert.ok(s.box, `${el.id}: stroke without a box`);
        assert.ok(['hand', 'rule', 'fallback'].includes(s.render), `${el.id}: render ${s.render}`);
        const tol = s.render === 'hand' ? 0.05 : s.render === 'rule' ? 1e-6 : 0.6;
        assert.ok(rectContainsRect(s.box, s.bounds, tol), `${el.id} line ${s.line} ${s.render} ${s.char || s.dataC || s.tag}: ${JSON.stringify(s.bounds)} escapes ${JSON.stringify(s.box)}`);
        if (s.render === 'hand') { hand++; assert.ok(typeof s.char === 'string' && s.char.length >= 1); }
        else if (s.render === 'rule') { rule++; assert.ok(s.tag === 'rect' || BAR_GLYPHS.includes(s.dataC.toUpperCase())); }
        else fallback++;
      }
    }
  }
  assert.ok(hand > 100, `only ${hand} handwriting glyphs`);
  assert.ok(rule >= 10, `only ${rule} rules`);
  assert.ok(fallback >= 1, 'Greek letters and arrows fall back to the MathJax outline');
});

test('math: letters, digits and parentheses are handwriting; =, − and fraction bars are plain rules; α and → fall back; the fitted glyph fills most of its box', async () => {
  const el = { id: 'mix', type: 'math', slot: 'A1:D1', lines: ['x_1 = \\alpha - 2 \\to \\frac{(a)}{b}'] };
  const ctx = makeDrawCtx([scene('s001', 'wipe', [el])], 0);
  const d = prepare(el, ctx);
  const by = (pred) => d.strokes.filter(pred);
  for (const ch of ['x', '1', '2', 'a', 'b', '(', ')']) assert.ok(by((s) => s.char === ch && s.render === 'hand').length >= 1, `${ch} is handwritten`);
  assert.ok(by((s) => s.dataC === '3D').every((s) => s.render === 'rule'), '= is a rule');
  assert.ok(by((s) => s.dataC === '2212').every((s) => s.render === 'rule'), '− is a rule');
  assert.ok(by((s) => s.tag === 'rect').every((s) => s.render === 'rule'), 'the fraction bar is a rule');
  assert.ok(by((s) => s.char === 'α').every((s) => s.render === 'fallback'), 'α falls back');
  assert.ok(by((s) => s.char === '→').every((s) => s.render === 'fallback'), '→ falls back');
  for (const s of by((s) => s.render === 'hand')) {
    const fill = Math.max(s.bounds.w / s.box.w, s.bounds.h / s.box.h);
    assert.ok(fill > 0.95, `${s.char} fills ${fill} of its box`);
  }
  // the subscript 1 is set at MathJax's 0.707 scale (its em is smaller than the base-line x's)
  const x = by((s) => s.char === 'x')[0], one = by((s) => s.char === '1')[0];
  assert.ok(Math.abs(one.em / x.em - 0.707) < 0.01, `${one.em} vs ${x.em}`);
  assert.ok(Math.abs(x.em - MATH_LAYOUT.fontPx) < 1e-6);
  assert.ok(rectContainsRect(ctx.slotRect('A1:D1'), d.bounds));
});

// ---------- items 10 and 12: gridless tables, marker-less lists ----------

test('table: row 0 keeps the element colour, every later row takes the next accent (wrapping); a muted/chalk table starts the cycle at accent1', async () => {
  assert.equal(rowColorToken('accent1', 0), 'accent1');
  assert.equal(rowColorToken('accent1', 1), 'accent2');
  assert.equal(rowColorToken('accent4', 2), 'accent1');
  assert.equal(rowColorToken('accent5', 1), 'accent1');
  assert.equal(rowColorToken('muted', 1), 'accent1');
  assert.equal(rowColorToken('chalk', 3), 'accent3');
  const { el, ctx } = fixtureElement('fx-type-table', 's002', 'big'); // accent2, 6 rows
  const d = prepare(el, ctx);
  const expected = ['accent2', 'accent3', 'accent4', 'accent5', 'accent1', 'accent2'].map((t) => tokens[t]);
  assert.deepEqual(d.meta.rowColors, expected);
  for (const s of d.strokes) if (s.kind === 'glyph') assert.equal(s.color, expected[s.row], `row ${s.row}`);
  assert.ok(d.strokes.filter((s) => s.headerUnderline).every((s) => s.color === tokens.accent2), 'header underlines in the element colour');
  const plain = { id: 'p', type: 'table', slot: 'A1:B1', rows: [['a', 'b'], ['c', 'd']] };
  const pd = prepare(plain, makeDrawCtx([scene('s001', 'wipe', [plain])], 0));
  assert.deepEqual(pd.meta.rowColors, [tokens.chalk, tokens.accent1]);
});

test('list: an unordered list has no marker strokes and the same layout as before (indent kept); an ordered list numbers its items', () => {
  const un = { id: 'u', type: 'list', slot: 'A1:B2', items: ['first', 'second', 'third'] };
  const ud = prepare(un, ctxFor(un));
  assert.equal(ud.strokes.filter((s) => s.marker).length, 0);
  assert.equal(ud.meta.marker, 'none');
  const od = prepare({ ...un, id: 'o', ordered: true }, ctxFor({ ...un, id: 'o', ordered: true }));
  assert.deepEqual(od.strokes.filter((s) => s.marker).map((s) => s.char), ['1', '.', '2', '.', '3', '.']);
  assert.equal(od.meta.marker, 'number');
});
