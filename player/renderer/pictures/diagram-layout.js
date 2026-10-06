// player/renderer/pictures/diagram-layout.js — deterministic layered layout for the Mermaid
// flowchart subset AST ({direction, nodes, edges}). Written in-house (no dagre): with ≤ 8 nodes
// and ≤ 12 edges a longest-path ranking plus barycenter ordering is enough, and it is trivially
// deterministic (every tie is broken by source order).
//
//   layout(ast, sizes, rect, opts) → { nodes: Map<id, {x,y,w,h,rank,order}>, ranks: string[][],
//                                      scale, natural:{w,h}, reversed:Set<edgeIndex> }
// `sizes` is Map<id, {w,h}> of the natural node boxes; the result places those boxes inside
// `rect` (main axis = ranks: TD → y, LR → x). When even the minimum gaps do not fit, the whole
// layout is scaled down uniformly (`scale` < 1) — callers scale their text accordingly.

export const LAYOUT = Object.freeze({
  rankGap: 56, rankGapMin: 22, rankGapMax: 170,
  nodeGap: 36, nodeGapMin: 14, nodeGapMax: 150,
});

/** Break cycles with a DFS in source order; returns the set of edge indices to treat as reversed. */
export function findBackEdges(ast) {
  const out = new Map(ast.nodes.map((n) => [n.id, []]));
  ast.edges.forEach((e, i) => { if (out.has(e.from)) out.get(e.from).push({ to: e.to, i }); });
  const state = new Map(); // 1 = on stack, 2 = done
  const reversed = new Set();
  const visit = (id) => {
    state.set(id, 1);
    for (const { to, i } of out.get(id) || []) {
      const s = state.get(to);
      if (s === 1) reversed.add(i);
      else if (!s) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of ast.nodes) if (!state.get(n.id)) visit(n.id);
  return reversed;
}

/** Longest-path ranks over the DAG (reversed edges flipped). Sources sit at rank 0. */
export function rankNodes(ast, reversed) {
  const ids = ast.nodes.map((n) => n.id);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const succ = new Map(ids.map((id) => [id, []]));
  ast.edges.forEach((e, i) => {
    const [a, b] = reversed.has(i) ? [e.to, e.from] : [e.from, e.to];
    if (a === b || !succ.has(a) || !indeg.has(b)) return;
    succ.get(a).push(b);
    indeg.set(b, indeg.get(b) + 1);
  });
  const rank = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const b of succ.get(id)) {
      rank.set(b, Math.max(rank.get(b), rank.get(id) + 1));
      indeg.set(b, indeg.get(b) - 1);
      if (indeg.get(b) === 0) queue.push(b);
    }
  }
  return rank;
}

/** Group ids by rank (source order inside a rank), then reduce crossings with barycenter sweeps. */
export function orderRanks(ast, rank) {
  const maxRank = Math.max(0, ...rank.values());
  const ranks = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of ast.nodes) ranks[rank.get(n.id)].push(n.id);
  const neighbours = (id, dir) => {
    const list = [];
    for (const e of ast.edges) {
      if (dir === 'up' && e.to === id && rank.get(e.from) < rank.get(id)) list.push(e.from);
      if (dir === 'down' && e.from === id && rank.get(e.to) > rank.get(id)) list.push(e.to);
      if (dir === 'up' && e.from === id && rank.get(e.to) < rank.get(id)) list.push(e.to);
      if (dir === 'down' && e.to === id && rank.get(e.from) > rank.get(id)) list.push(e.from);
    }
    return list;
  };
  const position = () => { const p = new Map(); ranks.forEach((r) => r.forEach((id, i) => p.set(id, i))); return p; };
  for (let sweep = 0; sweep < 2; sweep++) {
    // downward sweep: order rank r by the mean position of its upper neighbours
    for (let r = 1; r < ranks.length; r++) {
      const pos = position();
      const bary = (id) => { const ns = neighbours(id, 'up'); return ns.length ? ns.reduce((a, b) => a + pos.get(b), 0) / ns.length : pos.get(id); };
      ranks[r] = ranks[r].map((id, i) => ({ id, i, b: bary(id) })).sort((a, b) => a.b - b.b || a.i - b.i).map((x) => x.id);
    }
    // upward sweep
    for (let r = ranks.length - 2; r >= 0; r--) {
      const pos = position();
      const bary = (id) => { const ns = neighbours(id, 'down'); return ns.length ? ns.reduce((a, b) => a + pos.get(b), 0) / ns.length : pos.get(id); };
      ranks[r] = ranks[r].map((id, i) => ({ id, i, b: bary(id) })).sort((a, b) => a.b - b.b || a.i - b.i).map((x) => x.id);
    }
  }
  return ranks;
}

/**
 * Place node boxes. Main axis (ranks) and cross axis (nodes in a rank) are spread evenly to fill
 * `rect` up to the max gaps, centred otherwise; when the natural size exceeds `rect` the gaps
 * shrink to their minimums and, if still too large, everything is scaled by `scale` < 1.
 */
export function layout(ast, sizes, rect, { direction = ast.direction } = {}) {
  const reversed = findBackEdges(ast);
  const rank = rankNodes(ast, reversed);
  const ranks = orderRanks(ast, rank);
  const td = direction !== 'LR';
  // sizes along main (m) and cross (c) axes
  const main = (id) => (td ? sizes.get(id).h : sizes.get(id).w);
  const cross = (id) => (td ? sizes.get(id).w : sizes.get(id).h);
  const rankExtent = ranks.map((ids) => Math.max(...ids.map(main)));
  const rankCross = ranks.map((ids) => ids.reduce((a, id) => a + cross(id), 0));
  const availMain = td ? rect.h : rect.w;
  const availCross = td ? rect.w : rect.h;

  const naturalMain = (gap) => rankExtent.reduce((a, b) => a + b, 0) + gap * Math.max(0, ranks.length - 1);
  const naturalCross = (gap) => Math.max(...ranks.map((ids, i) => rankCross[i] + gap * Math.max(0, ids.length - 1)));

  let rankGap = LAYOUT.rankGap, nodeGap = LAYOUT.nodeGap;
  let scale = 1;
  if (naturalMain(rankGap) > availMain || naturalCross(nodeGap) > availCross) {
    rankGap = LAYOUT.rankGapMin; nodeGap = LAYOUT.nodeGapMin;
    const nm = naturalMain(rankGap), nc = naturalCross(nodeGap);
    scale = Math.min(1, availMain / nm, availCross / nc);
  }
  const s = scale;
  // main-axis positions
  const totalMain = naturalMain(rankGap) * s;
  let gapMain = rankGap * s;
  if (ranks.length > 1) {
    const spare = availMain - totalMain;
    gapMain = Math.min(LAYOUT.rankGapMax, rankGap * s + Math.max(0, spare) / (ranks.length - 1));
  }
  const usedMain = rankExtent.reduce((a, b) => a + b * s, 0) + gapMain * Math.max(0, ranks.length - 1);
  const mainStart = (td ? rect.y : rect.x) + Math.max(0, (availMain - usedMain) / 2);

  const nodes = new Map();
  let cursor = mainStart;
  ranks.forEach((ids, r) => {
    const extent = rankExtent[r] * s;
    const sumCross = rankCross[r] * s;
    let gapCross = nodeGap * s;
    if (ids.length > 1) gapCross = Math.min(LAYOUT.nodeGapMax, nodeGap * s + Math.max(0, availCross - sumCross - nodeGap * s * (ids.length - 1)) / (ids.length - 1));
    const usedCross = sumCross + gapCross * Math.max(0, ids.length - 1);
    let c = (td ? rect.x : rect.y) + Math.max(0, (availCross - usedCross) / 2);
    ids.forEach((id, order) => {
      const w = sizes.get(id).w * s, h = sizes.get(id).h * s;
      const mainPos = cursor + (extent - (td ? h : w)) / 2; // centre within the rank band
      const box = td ? { x: c, y: mainPos, w, h } : { x: mainPos, y: c, w, h };
      nodes.set(id, { ...box, rank: r, order });
      c += (td ? w : h) + gapCross;
    });
    cursor += extent + gapMain;
  });
  return { nodes, ranks, scale, reversed, natural: { main: naturalMain(LAYOUT.rankGap), cross: naturalCross(LAYOUT.nodeGap) }, direction: td ? 'TD' : 'LR' };
}
