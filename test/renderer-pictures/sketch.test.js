// Slice 03 — `sketch` drawable (brief 03 criterion 5, plus containment/determinism), extended by
// change-khan-feel (doodle scale, label beside/beneath, Sal's five shapes).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSketch } from '../../player/renderer/pictures/index.js';
import { DOODLE_HEIGHT, DOODLE_MIN_HEIGHT, DOODLE_MAX_HEIGHT } from '../../player/renderer/pictures/sketch.js';
import { SKETCH_LIBRARY, LIBRARY_SHAPES } from '../../player/renderer/pictures/sketch-library.js';
import { rectsIntersect } from '../../player/renderer/pictures/common.js';
import { SKETCH_SHAPES } from '../../shared/layout-core/constants.js';
import { slotRect, slotInnerRect } from '../../shared/layout-core/grid.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { ensureFont, ctxFor, insideSlot, rectInside, signature } from './helpers.js';

before(ensureFont);

const el = (overrides) => ({ id: 'sk', type: 'sketch', slot: 'A1:B2', shape: 'circle', ...overrides });
const prep = (e) => prepareSketch(e, ctxFor([e]));
const SAL_SHAPES = ['rock', 'ground', 'smiley', 'zigzag', 'curve'];
const SLOTS = ['A1', 'A1:B1', 'A1:A2', 'A1:C2'];

test('the library covers exactly the enum in constants.js and every entry has a positive aspect and primitives', () => {
  assert.deepEqual([...LIBRARY_SHAPES].sort(), [...SKETCH_SHAPES].sort());
  for (const name of LIBRARY_SHAPES) {
    const def = SKETCH_LIBRARY[name];
    assert.ok(def.aspect > 0, name);
    assert.ok(Array.isArray(def.primitives) && def.primitives.length > 0, name);
  }
});

// MODIFIED (change-khan-feel): fifteen shapes now; the assertions are unchanged.
test('all fifteen shapes produce a non-empty Drawable inside the slot, in every slot aspect (1×1, 2×1, 1×2, 3×2)', () => {
  assert.equal(SKETCH_SHAPES.length, 15);
  for (const shape of SKETCH_SHAPES) {
    for (const slot of SLOTS) {
      const d = prep(el({ shape, slot, label: shape }));
      assert.equal(d.type, 'sketch');
      assert.ok(d.paths.length > 0, `${shape} ${slot} has paths`);
      assert.ok(d.naturalMs > 0, `${shape} ${slot} naturalMs`);
      assert.ok(d.parts >= 1 && d.partStarts.length === d.parts);
      assert.ok(insideSlot(d, slot), `${shape} in ${slot}: bounds ${JSON.stringify(d.bounds)} inside ${JSON.stringify(slotRect(slot))}`);
      assert.ok(rectInside(slotRect(slot), d.picture.shapeRect), `${shape} ${slot} nominal rect inside`);
    }
  }
});

test('an unknown shape name throws a clear error (never silently draws nothing)', () => {
  assert.throws(() => prep(el({ shape: 'hexagon' })), /sketch: unknown shape "hexagon"/);
  assert.throws(() => prep(el({ shape: undefined })), /unknown shape/);
});

test('aspect ratio is preserved: a circle in a 2×1 slot has equal width and height (nominal exact; roughened within tolerance)', () => {
  const d = prep(el({ shape: 'circle', slot: 'A1:B1' }));
  const r = d.picture.shapeRect;
  assert.ok(Math.abs(r.w - r.h) <= 2, `nominal ${r.w} vs ${r.h}`);
  assert.equal(d.picture.aspect, 1);
  // the roughened strokes wobble a few px either way; the drawn box must still be close to square
  assert.ok(Math.abs(d.bounds.w - d.bounds.h) <= 12, `drawn ${d.bounds.w} vs ${d.bounds.h}`);
  // a wide shape in a tall slot shrinks to the slot width
  const n = prep(el({ shape: 'numberline', slot: 'A1:A2' }));
  assert.ok(Math.abs(n.picture.shapeRect.w / n.picture.shapeRect.h - SKETCH_LIBRARY.numberline.aspect) < 1e-6);
  assert.ok(n.picture.shapeRect.w <= slotRect('A1:A2').w);
});

test('label present and absent both render; the label is a separate part written in the element colour', () => {
  const plain = prep(el({ shape: 'cloud' }));
  assert.equal(plain.parts, 1);
  assert.deepEqual(plain.picture.partKinds, ['shape']);
  assert.equal(plain.picture.labelPlacement, 'none');
  const labelled = prep(el({ shape: 'cloud', label: 'response cache', color: 'accent3' }));
  assert.equal(labelled.parts, 2);
  assert.deepEqual(labelled.picture.partKinds, ['shape', 'label']);
  assert.equal(labelled.picture.labelPlacement, 'beneath');
  assert.ok(labelled.paths.length > plain.paths.length);
  // every glyph stroke is a fill in the element colour; the shape strokes too
  assert.ok(labelled.strokeInfo.some((s) => s.mode === 'fill'));
  assert.ok(labelled.strokeInfo.every((s) => s.color === tokens.accent3));
  assert.ok(insideSlot(labelled, 'A1:B2'));
  // the label block sits below the shape
  const labelMeta = labelled.picture.partMeta[1];
  assert.ok(labelMeta.box.y >= labelled.picture.shapeRect.y + labelled.picture.shapeRect.h - 0.01);
});

// MODIFIED (change-khan-feel): at doodle scale a label is never written inside the shape (Sal labels
// beside or under his pictures); server and document now follow the same beside/beneath rule.
test('server and document are labelled beside (wide slot) or beneath (square, tall or tiny slot), never inside', () => {
  const big = prep(el({ shape: 'server', slot: 'A1:C2', label: 'app server' }));
  assert.equal(big.picture.labelPlacement, 'beside');
  assert.ok(!rectsIntersect(big.picture.shapeRect, big.picture.partMeta[1].box));
  const doc = prep(el({ shape: 'document', slot: 'B1:D3', label: 'design doc' }));
  assert.equal(doc.picture.labelPlacement, 'beneath');
  // the document keeps its text lines now that nothing is written over them
  assert.equal(SKETCH_LIBRARY.document.primitives.filter((p) => p.k === 'line').length, 3);
  // a four-word label in a single cell goes beneath and stays in the slot
  const tiny = prep(el({ shape: 'server', slot: 'A1', label: 'four words fit here' }));
  assert.equal(tiny.picture.labelPlacement, 'beneath');
  assert.ok(insideSlot(tiny, 'A1'));
});

test('a long label drops to note size and wraps to at most two lines, never past the slot', () => {
  const d = prep(el({ shape: 'stack', slot: 'A1', label: 'four quite long words' }));
  const meta = d.picture.partMeta[1];
  assert.ok(meta.lines.length <= 2);
  assert.ok(['body', 'note'].includes(meta.style));
  assert.ok(insideSlot(d, 'A1'));
});

test('determinism: identical input → identical paths/bounds/partStarts/naturalMs; another id → different rough paths, same nominal rect', () => {
  const a = prep(el({ shape: 'database', label: 'db' }));
  const b = prep(el({ shape: 'database', label: 'db' }));
  assert.equal(signature(a), signature(b));
  const c = prep(el({ id: 'other', shape: 'database', label: 'db' }));
  assert.notDeepEqual(c.paths, a.paths);
  assert.deepEqual(c.picture.shapeRect, a.picture.shapeRect);
});

test('colour tokens resolve through tokens.js; no colour → chalk', () => {
  const d = prep(el({ shape: 'grid' }));
  assert.ok(d.strokeInfo.every((s) => s.color === tokens.chalk));
  const m = prep(el({ shape: 'grid', color: 'muted' }));
  assert.ok(m.strokeInfo.every((s) => s.color === tokens.muted));
});

// ---------- change-khan-feel: doodle scale and Sal's shapes ----------

test('doodle scale: every shape in every slot aspect is 60–120 px tall, centred in the slot, and never fills it', () => {
  assert.ok(DOODLE_HEIGHT >= DOODLE_MIN_HEIGHT && DOODLE_HEIGHT <= DOODLE_MAX_HEIGHT);
  for (const shape of SKETCH_SHAPES) {
    for (const slot of SLOTS) {
      for (const label of [null, shape]) {
        const d = prep(el({ shape, slot, ...(label ? { label } : {}) }));
        const r = d.picture.shapeRect;
        const inner = slotInnerRect(slot);
        assert.ok(r.h >= DOODLE_MIN_HEIGHT && r.h <= DOODLE_MAX_HEIGHT, `${shape} ${slot} label=${label}: ${r.h.toFixed(1)} px tall`);
        assert.ok(r.w <= inner.w && r.h < inner.h * 0.8, `${shape} ${slot}: doodle (${r.w.toFixed(0)}×${r.h.toFixed(0)}) does not fill the slot`);
        if (!label) {
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          assert.ok(Math.abs(cx - (inner.x + inner.w / 2)) < 1 && Math.abs(cy - (inner.y + inner.h / 2)) < 1, `${shape} ${slot}: centred`);
        }
        assert.ok(insideSlot(d, slot));
      }
    }
  }
  // big slots do not grow the doodle either
  const big = prep(el({ shape: 'smiley', slot: 'A1:F4', label: 'the whole board' }));
  assert.equal(big.picture.shapeRect.h, DOODLE_HEIGHT);
  assert.ok(insideSlot(big, 'A1:F4'));
});

test('labels go beside the doodle in a wide slot (pair centred as a group) and beneath it otherwise; the label never touches the shape', () => {
  for (const shape of SKETCH_SHAPES) {
    const wide = prep(el({ shape, slot: 'A1:B1', label: 'a label' }));
    assert.equal(wide.picture.labelPlacement, 'beside', `${shape} in a 2×1 slot`);
    const r = wide.picture.shapeRect, lb = wide.picture.partMeta[1].box;
    assert.ok(lb.x >= r.x + r.w + 4, `${shape}: label to the right of the doodle`);
    assert.ok(lb.y < r.y + r.h && lb.y + lb.h > r.y, `${shape}: label vertically beside the doodle`);
    const inner = slotInnerRect('A1:B1');
    const groupMid = (r.x + lb.x + lb.w) / 2;
    assert.ok(Math.abs(groupMid - (inner.x + inner.w / 2)) < 1, `${shape}: group centred`);
    assert.ok(!rectsIntersect(r, lb));
    assert.ok(insideSlot(wide, 'A1:B1'));
    for (const slot of ['A1', 'A1:A2', 'A1:B2']) {
      const d = prep(el({ shape, slot, label: 'a label' }));
      assert.equal(d.picture.labelPlacement, 'beneath', `${shape} in ${slot}`);
      const sr = d.picture.shapeRect, b = d.picture.partMeta[1].box;
      assert.ok(b.y >= sr.y + sr.h + 4, `${shape} ${slot}: label under the doodle`);
      assert.ok(!rectsIntersect(sr, b));
      assert.ok(insideSlot(d, slot));
    }
  }
  // a wide slot whose label is too long for one body line beside the doodle falls back to beneath
  const long = prep(el({ shape: 'ground', slot: 'A1:B1', label: 'four quite long words' }));
  assert.equal(long.picture.labelPlacement, 'beneath');
  assert.ok(insideSlot(long, 'A1:B1'));
});

test("Sal's five shapes — rock, ground, smiley, zigzag, curve — are in the enum and the library with the expected anatomy", () => {
  for (const s of SAL_SHAPES) {
    assert.ok(SKETCH_SHAPES.includes(s), `${s} in SKETCH_SHAPES`);
    assert.ok(SKETCH_LIBRARY[s], `${s} in the library`);
  }
  const { rock, ground, smiley, zigzag, curve } = SKETCH_LIBRARY;
  assert.equal(rock.primitives.length, 2, 'rock: a blob and a squiggle');
  assert.ok(rock.primitives.every((p) => p.k === 'path'));
  assert.equal(ground.primitives[0].k, 'line', 'ground: a surface line');
  assert.ok(ground.primitives.length >= 6, 'ground: hatching below');
  assert.ok(ground.primitives.slice(1).every((p) => p.k === 'line' && p.y2 > p.y1 && p.y1 >= ground.primitives[0].y1), 'hatching hangs below the line');
  assert.equal(smiley.primitives[0].k, 'ellipse', 'smiley: a face');
  assert.equal(smiley.primitives.filter((p) => p.k === 'ellipse').length, 3, 'smiley: face and two eyes');
  assert.equal(smiley.primitives.filter((p) => p.k === 'arc').length, 1, 'smiley: a mouth');
  assert.equal(zigzag.primitives.length, 1);
  assert.ok(zigzag.primitives[0].k === 'poly' && !zigzag.primitives[0].closed && zigzag.primitives[0].pts.length >= 6, 'zigzag: an open polyline');
  assert.equal(curve.primitives[0].k, 'path', 'curve: a smooth path');
  assert.ok(curve.primitives[1].k === 'poly' && curve.primitives[1].pts.length === 3, 'curve: an arrowhead');
  // each draws, is deterministic and stays inside a single cell, labelled or not
  for (const s of SAL_SHAPES) {
    const a = prep(el({ shape: s, slot: 'A1', label: s, color: 'accent4' }));
    const b = prep(el({ shape: s, slot: 'A1', label: s, color: 'accent4' }));
    assert.equal(signature(a), signature(b));
    assert.ok(a.paths.length >= 2, `${s} has at least two strokes`);
    assert.ok(a.strokeInfo.every((st) => st.color === tokens.accent4));
    assert.ok(insideSlot(a, 'A1'));
    assert.deepEqual(a.picture.partKinds, ['shape', 'label']);
  }
});
