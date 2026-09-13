import type { LoopGraph } from "../daemon/protocol.ts";

export const COLUMN_X = 40;
export const ROW_Y = 40;
export const COLUMN_STEP = 300;
export const ROW_STEP = 170;

/**
 * Saved positions win. Otherwise a node's column sits one step right of its longest-chain
 * upstream: among its immediate upstream nodes, the one reached by the longest path through
 * the graph (so a lead node with a direct edge to every stage of a deep chain doesn't flatten
 * the chain into one column). A node with no upstream lands in column 40. Rows never overlap.
 */
export function placeNodes(
  graph: LoopGraph,
  saved: Record<string, { pos: [number, number] }>,
): Map<string, [number, number]> {
  const placed = new Map<string, [number, number]>();
  for (const node of graph.nodes) if (saved[node.id]) placed.set(node.id, [...saved[node.id]!.pos] as [number, number]);

  const upstream = new Map<string, string[]>();
  for (const edge of graph.edges) upstream.set(edge.to, [...(upstream.get(edge.to) ?? []), edge.from]);

  // Longest path from any root to each node, purely structural — never influenced by saved
  // or already-placed positions, so which nodes happen to be saved cannot change depth.
  // A node still on the recursion stack (a cycle) contributes 0 for that back-edge rather
  // than recursing forever.
  const depthCache = new Map<string, number>();
  const onStack = new Set<string>();
  const depth = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (onStack.has(id)) return 0;
    onStack.add(id);
    const ups = upstream.get(id) ?? [];
    const d = ups.length === 0 ? 0 : 1 + Math.max(...ups.map(depth));
    onStack.delete(id);
    depthCache.set(id, d);
    return d;
  };
  for (const node of graph.nodes) depth(node.id);

  // Each node's reference parent: the immediate upstream with the greatest longest-path depth,
  // i.e. the predecessor on the longest chain reaching this node, not just any placed upstream.
  const referenceParent = new Map<string, string>();
  for (const node of graph.nodes) {
    const ups = upstream.get(node.id) ?? [];
    if (ups.length === 0) continue;
    let best = ups[0]!;
    for (const candidate of ups) if (depth(candidate) > depth(best)) best = candidate;
    referenceParent.set(node.id, best);
  }

  const taken = (x: number, y: number) => [...placed.values()].some(([px, py]) => Math.abs(px - x) < 1 && Math.abs(py - y) < 1);
  const firstFreeRow = (x: number, fromY: number) => { let y = fromY; while (taken(x, y)) y += ROW_STEP; return y; };

  // One pass: place every not-yet-placed node whose reference parent is already placed. Returns whether anything moved.
  const cascade = (): boolean => {
    let progress = false;
    for (const node of graph.nodes) {
      if (placed.has(node.id)) continue;
      const parent = referenceParent.get(node.id);
      if (parent === undefined || !placed.has(parent)) continue;
      const [px, py] = placed.get(parent)!;
      placed.set(node.id, [px + COLUMN_STEP, firstFreeRow(px + COLUMN_STEP, py)]);
      progress = true;
    }
    return progress;
  };

  while (cascade());
  for (const node of graph.nodes) {
    if (placed.has(node.id)) continue;
    placed.set(node.id, [COLUMN_X, firstFreeRow(COLUMN_X, ROW_Y)]);
    // Nodes whose reference parent is this root now have a positioned upstream; place them in the next pass.
    while (cascade());
  }
  return placed;
}
