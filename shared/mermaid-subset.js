// shared/mermaid-subset.js — parser for the Mermaid flowchart/graph TD|LR subset (spec §4.4
// `diagram`, brief 00 C1). Only the syntax; no Mermaid runtime. Shared by the validator
// (content stage) and the diagram drawable (slice 03).
//
//   parse(source) → { direction:'TD'|'LR', nodes:[{id, label, shape}], edges:[{from, to, label, style}] }
//   throws MermaidError (code BAD_MERMAID) for anything outside the subset.
//
// Grammar: first statement `flowchart TD|LR` or `graph TD|LR`. Statements separated by newline
// or `;`. `%%` starts a comment. Node forms: id, id[label], id(label), id([label]), id{label},
// id((label)); labels may be double-quoted. Edges: -->, ---, -.->, ==> with optional |label| or
// the inline forms `-- label -->`, `-. label .->`, `== label ==>`. Chains `a --> b --> c` allowed.
import { CAPS, REGEX } from './layout-core/constants.js';

export class MermaidError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'MermaidError';
    this.code = 'BAD_MERMAID';
    this.line = line;
  }
}

export const NODE_SHAPES = Object.freeze(['rect', 'round', 'stadium', 'diamond', 'circle']);
export const EDGE_STYLES = Object.freeze(['arrow', 'line', 'dotted', 'thick']);

const HEADER_RE = /^(flowchart|graph)\s+(TD|LR)$/;
const NODE_RE = /^([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\(\s*("[^"]*"|[^()"]*?)\s*\)\)|\(\[\s*("[^"]*"|[^[\]"]*?)\s*\]\)|\[\s*("[^"]*"|[^[\]"]*?)\s*\]|\(\s*("[^"]*"|[^()"]*?)\s*\)|\{\s*("[^"]*"|[^{}"]*?)\s*\})?/;
const EDGE_RE = /^(?:(-->|---|-\.->|==>)(?:\s*\|([^|]*)\|)?|--\s+([^-][^]*?)\s+-->|-\.\s+([^.][^]*?)\s+\.->|==\s+([^=][^]*?)\s+==>)/;

const unquote = (s) => {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).trim();
  return t;
};

function stripComments(source) {
  return source.split('\n').map((l) => {
    const i = l.indexOf('%%');
    return i >= 0 ? l.slice(0, i) : l;
  });
}

/** Parse the subset. Does not enforce caps (see checkCaps). */
export function parse(source) {
  if (typeof source !== 'string') throw new MermaidError('mermaid source must be a string', 0);
  const lines = stripComments(source);
  const statements = [];
  lines.forEach((l, idx) => {
    for (const part of l.split(';')) {
      const s = part.trim();
      if (s) statements.push({ text: s, line: idx + 1 });
    }
  });
  if (statements.length === 0) throw new MermaidError('empty diagram', 0);
  const header = HEADER_RE.exec(statements[0].text);
  if (!header) throw new MermaidError(`first line must be "flowchart TD|LR" or "graph TD|LR", got "${statements[0].text}"`, statements[0].line);
  const direction = header[2];
  const nodes = new Map();
  const edges = [];

  const addNode = (id, label, shape, line) => {
    if (!REGEX.mermaidNodeId.test(id)) throw new MermaidError(`bad node id "${id}"`, line);
    const existing = nodes.get(id);
    if (existing) {
      if (label !== undefined) { existing.label = label; existing.shape = shape; }
      return existing;
    }
    const node = { id, label: label === undefined ? id : label, shape: label === undefined ? 'rect' : shape };
    nodes.set(id, node);
    return node;
  };

  for (const st of statements.slice(1)) {
    let rest = st.text;
    const lower = rest.toLowerCase();
    for (const banned of ['subgraph', 'classdef', 'class ', 'click', 'style', 'linkstyle', 'end', 'direction', 'sequencediagram', 'classdiagram', 'statediagram', 'erdiagram', 'gantt', 'pie', 'journey', 'mindmap', 'gitgraph']) {
      if (lower === banned.trim() || lower.startsWith(banned)) throw new MermaidError(`"${rest.slice(0, banned.trim().length)}" is not supported`, st.line);
    }
    let prev = null;
    let pendingEdge = null;
    while (rest.length) {
      const nm = NODE_RE.exec(rest);
      if (!nm || nm[0].length === 0) throw new MermaidError(`cannot parse "${rest}"`, st.line);
      const id = nm[1];
      let label, shape;
      if (nm[2] !== undefined) { label = unquote(nm[2]); shape = 'circle'; }
      else if (nm[3] !== undefined) { label = unquote(nm[3]); shape = 'stadium'; }
      else if (nm[4] !== undefined) { label = unquote(nm[4]); shape = 'rect'; }
      else if (nm[5] !== undefined) { label = unquote(nm[5]); shape = 'round'; }
      else if (nm[6] !== undefined) { label = unquote(nm[6]); shape = 'diamond'; }
      const node = addNode(id, label, shape, st.line);
      if (pendingEdge) {
        if (prev.id === node.id) throw new MermaidError(`self-loop on "${id}" is not supported`, st.line);
        edges.push({ from: prev.id, to: node.id, label: pendingEdge.label, style: pendingEdge.style });
        pendingEdge = null;
      }
      prev = node;
      rest = rest.slice(nm[0].length).trim();
      if (!rest.length) break;
      const em = EDGE_RE.exec(rest);
      if (!em) throw new MermaidError(`expected an edge after "${id}", got "${rest}"`, st.line);
      let style, label2;
      if (em[1] !== undefined) {
        style = { '-->': 'arrow', '---': 'line', '-.->': 'dotted', '==>': 'thick' }[em[1]];
        label2 = em[2] !== undefined ? unquote(em[2]) : '';
      } else if (em[3] !== undefined) { style = 'arrow'; label2 = unquote(em[3]); }
      else if (em[4] !== undefined) { style = 'dotted'; label2 = unquote(em[4]); }
      else { style = 'thick'; label2 = unquote(em[5]); }
      pendingEdge = { style, label: label2 };
      rest = rest.slice(em[0].length).trim();
      if (!rest.length) throw new MermaidError(`edge after "${id}" has no target`, st.line);
    }
  }
  return { direction, nodes: [...nodes.values()], edges };
}

const words = (s) => String(s).split(/\s+/).filter((w) => w.length).length;

/** Cap errors as messages (empty when within caps): nodes, edges, node/edge label words. */
export function checkCaps(ast, caps = CAPS) {
  const problems = [];
  if (ast.nodes.length === 0) problems.push('diagram has no nodes');
  if (ast.nodes.length > caps.diagramNodesMax) problems.push(`${ast.nodes.length} nodes exceed the cap of ${caps.diagramNodesMax}`);
  if (ast.edges.length > caps.diagramEdgesMax) problems.push(`${ast.edges.length} edges exceed the cap of ${caps.diagramEdgesMax}`);
  for (const n of ast.nodes) {
    if (words(n.label) > caps.diagramNodeLabelWords) problems.push(`node "${n.id}" label has ${words(n.label)} words (cap ${caps.diagramNodeLabelWords})`);
  }
  for (const e of ast.edges) {
    if (e.label && words(e.label) > caps.diagramEdgeLabelWords) problems.push(`edge ${e.from}->${e.to} label has ${words(e.label)} words (cap ${caps.diagramEdgeLabelWords})`);
  }
  return problems;
}

/** Parse and enforce caps; throws MermaidError. */
export function parseStrict(source, caps = CAPS) {
  const ast = parse(source);
  const problems = checkCaps(ast, caps);
  if (problems.length) throw new MermaidError(problems.join('; '), 0);
  return ast;
}
