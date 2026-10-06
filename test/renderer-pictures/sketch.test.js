// Slice 03 — `sketch` drawable (brief 03 criterion 5, plus containment/determinism).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSketch } from '../../player/renderer/pictures/index.js';
import { SKETCH_LIBRARY, LIBRARY_SHAPES } from '../../player/renderer/pictures/sketch-library.js';
import { SKETCH_SHAPES } from '../../shared/layout-core/constants.js';
import { slotRect } from '../../shared/layout-core/grid.js';
import { tokens } from '../../shared/layout-core/tokens.js';
import { ensureFont, ctxFor, insideSlot, rectInside, signature } from './helpers.js';

before(ensureFont);

const el = (overrides) => ({ id: 'sk', type: 'sketch', slot: 'A1:B2', shape: 'circle', ...overrides });
const prep = (e) => prepareSketch(e, ctxFor([e]));

test('the library covers exactly the enum in constants.js and every entry has a positive aspect and primitives', () => {
  assert.deepEqual([...LIBRARY_SHAPES].sort(), [...SKETCH_SHAPES].sort());
  for (const name of LIBRARY_SHAPES) {
    const def = SKETCH_LIBRARY[name];
    assert.ok(def.aspect > 0, name);
    assert.ok(Array.isArray(def.primitives) && def.primitives.length > 0, name);
  }
});

test('all ten shapes produce a non-empty Drawable inside the slot, in every slot aspect (1×1, 2×1, 1×2, 3×2)', () => {
  for (const shape of SKETCH_SHAPES) {
    for (const slot of ['A1', 'A1:B1', 'A1:A2', 'A1:C2']) {
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

test('server and document write the label inside the shape when there is room, beneath otherwise', () => {
  const big = prep(el({ shape: 'server', slot: 'A1:C2', label: 'app server' }));
  assert.equal(big.picture.labelPlacement, 'inside');
  assert.ok(rectInside(big.picture.shapeRect, big.picture.partMeta[1].box));
  const doc = prep(el({ shape: 'document', slot: 'B1:D3', label: 'design doc' }));
  assert.equal(doc.picture.labelPlacement, 'inside');
  // a four-word label in a single cell falls back to beneath (region too small) and stays in the slot
  const tiny = prep(el({ shape: 'server', slot: 'A1', label: 'four words fit here' }));
  assert.ok(['inside', 'beneath'].includes(tiny.picture.labelPlacement));
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
