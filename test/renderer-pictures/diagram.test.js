// Slice 03 — `diagram` drawable (brief 03 criterion 6 + layout edge cases + 20× determinism).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareDiagram } from '../../player/renderer/pictures/index.js';
import { layout, findBackEdges, rankNodes } from '../../player/renderer/pictures/diagram-layout.js';
import { parse as parseMermaid, MermaidError } from '../../shared/mermaid-subset.js';
import { slotRect } from '../../shared/layout-core/grid.js';
import { STROKE_WIDTH } from '../../player/renderer/pictures/common.js';
import { ensureFont, ctxFor, insideSlot, rectInside, signature, distToPolygon, pointInPolygon, REPO_ROOT } from './helpers.js';

before(ensureFont);

const el = (mermaid, slot = 'A1:C3', id = 'dg') => ({ id, type: 'diagram', slot, mermaid });
const prep = (e) => prepareDiagram(e, ctxFor([e]));
const fixtureScene = (lesson, scene) => JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', 'lessons', lesson, 'scenes', `${scene}.json`), 'utf8'));
const diagramsOf = (lesson) => {
  const out = [];
  for (const s of ['s001', 's002', 's003']) {
    let scene;
    try { scene = fixtureScene(lesson, s); } catch { continue; }
    for (const e of scene.elements) if (e.type === 'diagram') out.push(e);
  }
  return out;
};

/** Structural checks shared by every diagram: parts, boundaries, overlap, label fit, rank order, containment. */
function checkDiagram(e, d) {
  const ast = parseMermaid(e.mermaid);
  const p = d.picture;
  assert.equal(d.parts, ast.nodes.length + ast.edges.length, `${e.id}: parts = nodes + edges`);
  assert.deepEqual(p.partKinds.slice(0, ast.nodes.length), ast.nodes.map(() => 'node'), `${e.id}: nodes first`);
  assert.deepEqual(p.partKinds.slice(ast.nodes.length), ast.edges.map(() => 'edge'), `${e.id}: then edges`);
  assert.ok(insideSlot(d, e.slot), `${e.id}: bounds ${JSON.stringify(d.bounds)} inside ${JSON.stringify(slotRect(e.slot))}`);
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  // no two node rects overlap
  for (let i = 0; i < p.nodes.length; i++) for (let j = i + 1; j < p.nodes.length; j++) {
    const A = p.nodes[i].rect, B = p.nodes[j].rect;
    const disjoint = B.x >= A.x + A.w || B.x + B.w <= A.x || B.y >= A.y + A.h || B.y + B.h <= A.y;
    assert.ok(disjoint, `${e.id}: nodes ${p.nodes[i].id} and ${p.nodes[j].id} overlap`);
  }
  // labels fit inside their node rect
  for (const n of p.nodes) assert.ok(rectInside(n.rect, n.label.box, 0.5), `${e.id}: label of ${n.id} ${JSON.stringify(n.label.box)} inside ${JSON.stringify(n.rect)}`);
  // edges start/end on the node boundary (±2 px) and outside both interiors
  for (const ed of p.edges) {
    const a = byId.get(ed.from), b = byId.get(ed.to);
    const first = ed.points[0], last = ed.points[ed.points.length - 1];
    assert.ok(distToPolygon(first, a.polygon) <= 2, `${e.id}: edge ${ed.from}->${ed.to} start ${first} on ${ed.from} boundary`);
    assert.ok(distToPolygon(last, b.polygon) <= 2, `${e.id}: edge ${ed.from}->${ed.to} end ${last} on ${ed.to} boundary`);
    // one step along the edge away from each node is outside that node
    const stepOut = (q, towards, poly) => { const dx = towards[0] - q[0], dy = towards[1] - q[1], l = Math.hypot(dx, dy) || 1; return !pointInPolygon([q[0] + (dx / l) * 3, q[1] + (dy / l) * 3], poly); };
    assert.ok(stepOut(first, ed.points[1], a.polygon), `${e.id}: edge ${ed.from}->${ed.to} leaves ${ed.from}`);
    assert.ok(stepOut(last, ed.points[ed.points.length - 2], b.polygon), `${e.id}: edge ${ed.from}->${ed.to} arrives at ${ed.to} from outside`);
    if (ed.label) assert.ok(ed.labelBox && rectInside(slotRect(e.slot), ed.labelBox, 0.5), `${e.id}: edge label "${ed.label}" drawn inside the slot`);
    else assert.equal(ed.labelBox, null);
  }
  // rank ordering: TD top→bottom, LR left→right (every node of rank r precedes every node of rank r+1)
  const main = (n) => (p.direction === 'TD' ? n.rect.y + n.rect.h / 2 : n.rect.x + n.rect.w / 2);
  for (let r = 0; r + 1 < p.ranks.length; r++) {
    for (const idA of p.ranks[r]) for (const idB of p.ranks[r + 1]) assert.ok(main(byId.get(idA)) < main(byId.get(idB)), `${e.id}: rank ${r} before rank ${r + 1}`);
  }
}

test('fixture diagrams: part counts, boundary endpoints, no overlaps, label fit, rank order, containment', () => {
  const all = [...diagramsOf('fx-type-diagram'), ...diagramsOf('fx-pic-dense')];
  assert.ok(all.length >= 5);
  for (const e of all) checkDiagram(e, prep(e));
  const tour = fixtureScene('fx-full-tour', 's004').elements.find((x) => x.type === 'diagram');
  checkDiagram(tour, prep(tour));
});

test('20 repeated layouts of the 8-node/12-edge near-cap fixture are identical (determinism)', () => {
  const e = diagramsOf('fx-type-diagram').find((x) => x.id === 'max');
  const ref = signature(prep(e));
  for (let i = 0; i < 20; i++) assert.equal(signature(prep(e)), ref, `run ${i}`);
  const dense = diagramsOf('fx-pic-dense').find((x) => x.id === 'dense');
  const ref2 = signature(prep(dense));
  for (let i = 0; i < 20; i++) assert.equal(signature(prep(dense)), ref2, `dense run ${i}`);
});

test('the 8-node/12-edge fixture fits a 2×2 slot at note size without shrinking text; a 4-node one keeps body text', () => {
  const dense = diagramsOf('fx-pic-dense').find((x) => x.id === 'dense');
  assert.equal(dense.slot, 'A1:B2');
  const d = prep(dense);
  assert.equal(d.picture.style, 'note');
  assert.equal(d.picture.textScale, 1, 'text not shrunk below note');
  checkDiagram(dense, d);
  const four = diagramsOf('fx-pic-dense').find((x) => x.id === 'four');
  assert.equal(four.slot, 'C1:D2');
  const f = prep(four);
  assert.equal(f.picture.style, 'body');
  assert.equal(f.picture.textScale, 1);
  checkDiagram(four, f);
});

test('node shapes map to their primitives and edge styles to line treatment', () => {
  const e = el('flowchart TD\nA[Rect] --> B(Round)\nB --- C([Stadium])\nC -.-> D{Diamond}\nD ==> E((Circle))');
  const d = prep(e);
  const shapes = d.picture.nodes.map((n) => n.shape);
  assert.deepEqual(shapes, ['rect', 'round', 'stadium', 'diamond', 'circle']);
  const circle = d.picture.nodes[4];
  assert.ok(Math.abs(circle.rect.w - circle.rect.h) < 1e-6, 'circle node is square');
  assert.equal(d.picture.nodes[3].polygon.length, 4, 'diamond polygon has 4 corners');
  // edge strokes: find the stroke index ranges per part via revealAt at part boundaries
  const edgeParts = d.picture.partMeta.slice(5);
  assert.deepEqual(edgeParts.map((m) => m.style), ['arrow', 'line', 'dotted', 'thick']);
  const dotted = d.strokeInfo.filter((s) => s.dash);
  assert.ok(dotted.length >= 1, 'dotted edge uses a dash pattern');
  const thick = d.strokeInfo.filter((s) => s.width > STROKE_WIDTH && s.mode === 'stroke');
  assert.ok(thick.length >= 1, 'thick edge is wider');
  checkDiagram(e, d);
});

test('edge cases: single node; two nodes one edge; fan-out 1→7; long LR chain of 8 shrinks to fit a 2×2 slot', () => {
  const single = prep(el('flowchart TD\nA[Only one]', 'A1:B2'));
  assert.equal(single.parts, 1);
  assert.ok(insideSlot(single, 'A1:B2'));
  const two = el('graph LR\nA[Left] --> B[Right]', 'A1:B2');
  const d2 = prep(two);
  assert.equal(d2.parts, 3);
  checkDiagram(two, d2);
  assert.ok(d2.picture.nodes[0].rect.x + d2.picture.nodes[0].rect.w < d2.picture.nodes[1].rect.x);
  const fan = el('flowchart TD\nR[Root] --> A[n1]\nR --> B[n2]\nR --> C[n3]\nR --> D[n4]\nR --> E[n5]\nR --> F[n6]\nR --> G[n7]', 'A1:C2');
  const df = prep(fan);
  assert.deepEqual(df.picture.ranks, [['R'], ['A', 'B', 'C', 'D', 'E', 'F', 'G']]);
  checkDiagram(fan, df);
  const chain = el('graph LR\nA[Alpha] --> B[Bravo] --> C[Charlie] --> D[Delta] --> E[Echo] --> F[Foxtrot] --> G[Golf] --> H[Hotel]', 'A1:B2');
  const dc = prep(chain);
  assert.equal(dc.picture.ranks.length, 8);
  assert.ok(dc.picture.textScale < 1, 'eight long labels across two cells must shrink');
  assert.ok(dc.picture.textScale > 0.3);
  checkDiagram(chain, dc);
});

test('self-loop: the shared parser rejects `a --> a`, so the drawable never sees one (documented)', () => {
  assert.throws(() => parseMermaid('flowchart TD\na --> a'), MermaidError);
});

test('cycles are broken deterministically for ranking but drawn in their real direction', () => {
  const ast = parseMermaid('flowchart TD\nA[a] --> B[b]\nB --> C[c]\nC --> A');
  const back = findBackEdges(ast);
  assert.deepEqual([...back], [2]);
  const ranks = rankNodes(ast, back);
  assert.deepEqual([ranks.get('A'), ranks.get('B'), ranks.get('C')], [0, 1, 2]);
  const d = prep(el('flowchart TD\nA[a] --> B[b]\nB --> C[c]\nC --> A', 'A1:B2'));
  const backEdge = d.picture.edges[2];
  assert.equal(backEdge.from, 'C');
  assert.equal(backEdge.to, 'A');
  // it starts at C (bottom) and ends at A (top)
  assert.ok(backEdge.points[0][1] > backEdge.points[backEdge.points.length - 1][1]);
});

test('layout(): equal-rank nodes are spaced evenly and ranks fill the rect; scale is 1 when everything fits', () => {
  const ast = parseMermaid('flowchart TD\nR[r] --> A[a]\nR --> B[b]\nR --> C[c]');
  const sizes = new Map(ast.nodes.map((n) => [n.id, { w: 60, h: 30 }]));
  const rect = { x: 0, y: 0, w: 600, h: 300 };
  const lay = layout(ast, sizes, rect);
  assert.equal(lay.scale, 1);
  const a = lay.nodes.get('A'), b = lay.nodes.get('B'), c = lay.nodes.get('C');
  assert.ok(Math.abs((b.x - a.x) - (c.x - b.x)) < 1e-6, 'even spacing');
  assert.equal(a.y, b.y);
  assert.ok(lay.nodes.get('R').y < a.y);
  const lay2 = layout(ast, sizes, rect);
  assert.deepEqual([...lay2.nodes], [...lay.nodes]);
});

test('antiparallel edges do not overlap and a labelled edge keeps its label clear of the line', () => {
  const d = prep(el('graph LR\nA[Left] --> B[Right]\nB --> A', 'A1:C2'));
  const [ab, ba] = d.picture.edges;
  const yAB = ab.points[0][1], yBA = ba.points[0][1];
  assert.ok(Math.abs(yAB - yBA) > 5, 'parallel edges are offset');
  const l = prep(el('flowchart TD\nA[Top] -->|yes| B[Bottom]', 'A1:B2'));
  const edge = l.picture.edges[0];
  const x = edge.points[0][0];
  const box = edge.labelBox;
  assert.ok(box.x > x || box.x + box.w < x, 'label box does not straddle a vertical edge line');
});
