import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseStrict, checkCaps, MermaidError } from '../../shared/mermaid-subset.js';

const rejects = (src, re) => assert.throws(() => parseStrict(src), (e) => e instanceof MermaidError && e.code === 'BAD_MERMAID' && (!re || re.test(e.message)), `expected rejection: ${src}`);

test('every supported node form', () => {
  const ast = parse('flowchart TD\nA\nB[Rect label]\nC(Round)\nD([Stadium])\nE{Diamond}\nF((Circle))\nG["quoted label"]');
  assert.deepEqual(ast.nodes.map((n) => [n.id, n.label, n.shape]), [
    ['A', 'A', 'rect'], ['B', 'Rect label', 'rect'], ['C', 'Round', 'round'], ['D', 'Stadium', 'stadium'],
    ['E', 'Diamond', 'diamond'], ['F', 'Circle', 'circle'], ['G', 'quoted label', 'rect'],
  ]);
  assert.equal(ast.direction, 'TD');
  assert.equal(parse('graph LR\nA-->B').direction, 'LR');
});

test('every supported edge form, labels, chains, separators, comments', () => {
  const ast = parse([
    'graph LR',
    '%% a comment line',
    'A --> B --- C -.-> D ==> E  %% trailing comment',
    'A -->|yes| F; F -- no --> G',
    'G -. maybe .-> H',
    'H == strong ==> A',
    'B -->|"quoted edge"| C',
  ].join('\n'));
  assert.deepEqual(ast.edges.map((e) => [e.from, e.to, e.style, e.label]), [
    ['A', 'B', 'arrow', ''], ['B', 'C', 'line', ''], ['C', 'D', 'dotted', ''], ['D', 'E', 'thick', ''],
    ['A', 'F', 'arrow', 'yes'], ['F', 'G', 'arrow', 'no'], ['G', 'H', 'dotted', 'maybe'], ['H', 'A', 'thick', 'strong'],
    ['B', 'C', 'arrow', 'quoted edge'],
  ]);
  assert.equal(ast.nodes.length, 8);
  // a later declaration updates a label
  const upd = parse('flowchart TD\nA --> B\nB[Later label]');
  assert.equal(upd.nodes.find((n) => n.id === 'B').label, 'Later label');
  // whitespace tolerant
  assert.equal(parse('flowchart TD\n  A[ x ]   -->   B( y )  ').edges.length, 1);
});

test('caps: nodes, edges, label words', () => {
  const nodes = (n) => 'flowchart TD\n' + Array.from({ length: n }, (_, i) => `N${i}[n${i}]`).join('\n');
  assert.equal(parseStrict(nodes(8)).nodes.length, 8);
  rejects(nodes(9), /9 nodes/);
  const edges = (n) => 'flowchart TD\n' + Array.from({ length: n }, (_, i) => `A --> B${i % 7}`).join('\n');
  assert.equal(parseStrict(edges(12)).edges.length, 12);
  rejects(edges(13), /13 edges/);
  assert.ok(parseStrict('flowchart TD\nA[one two three four]'));
  rejects('flowchart TD\nA[one two three four five]', /5 words/);
  assert.ok(parseStrict('flowchart TD\nA -->|one two three| B'));
  rejects('flowchart TD\nA -->|one two three four| B', /4 words/);
  assert.deepEqual(checkCaps({ nodes: [], edges: [] }), ['diagram has no nodes']);
});

test('unsupported directives and other diagram types are rejected', () => {
  rejects('sequenceDiagram\nA->>B: hi', /first line/);
  rejects('classDiagram\nA <|-- B', /first line/);
  rejects('stateDiagram-v2\n[*] --> A', /first line/);
  rejects('flowchart TB\nA-->B', /first line/);
  rejects('flowchart RL\nA-->B', /first line/);
  rejects('flowchart BT\nA-->B', /first line/);
  rejects('A --> B', /first line/);
  rejects('', /empty/);
  rejects('flowchart TD\nsubgraph one\nA-->B\nend', /subgraph/);
  rejects('flowchart TD\nA-->B\nclassDef big fill:#f9f', /classDef/);
  rejects('flowchart TD\nA-->B\nclass A big', /class/);
  rejects('flowchart TD\nA-->B\nclick A callback', /click/);
  rejects('flowchart TD\nA-->B\nstyle A fill:#f9f', /style/);
  rejects('flowchart TD\nA-->B\nlinkStyle 0 stroke:red', /linkStyle/);
  rejects('flowchart TD\nA --> A', /self-loop/);
  rejects('flowchart TD\nA -->', /no target/);
  rejects('flowchart TD\nA -x B', /cannot parse|expected an edge/);
  rejects('flowchart TD\nA <--> B', /expected an edge|cannot parse/);
  rejects('flowchart TD\nA[unclosed', /expected an edge|cannot parse/);
  rejects('flowchart TD\n1A --> B', /cannot parse/);
  rejects('flowchart TD\nA-->B & C', /expected an edge|cannot parse/);
  rejects('flowchart TD\nA>B]', /expected an edge|cannot parse/);
  assert.throws(() => parse(42), MermaidError);
});
