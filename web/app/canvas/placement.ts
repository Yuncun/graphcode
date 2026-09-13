import type { LoopGraph } from "../daemon/protocol.ts";

export const COLUMN_X = 40;
export const ROW_Y = 40;
export const COLUMN_STEP = 300;
export const ROW_STEP = 170;

/**
 * Saved positions win. Otherwise a node's column sits one step right of its longest-chain
 * upstream: among its immediate upstream nodes with strictly less depth than this node, the
 * one with the greatest depth (so a lead node with a direct edge to every stage of a deep
 * chain doesn't flatten the chain into one column). A node with no such upstream — including
 * one whose only upstream candidates sit on a cycle through it — lands in column 40. Nodes
 * are processed in depth order, not `graph.nodes` order, so the result does not depend on how
 * the daemon happens to order nodes. Rows never overlap.
 */
export function placeNodes(
  graph: LoopGraph,
  saved: Record<string, { pos: [number, number] }>,
): Map<string, [number, number]> {
  const upstream = new Map<string, string[]>();
  for (const edge of graph.edges) upstream.set(edge.to, [...(upstream.get(edge.to) ?? []), edge.from]);

  // Longest path from any root to each node, purely structural — never influenced by saved
  // positions, so which nodes happen to be saved cannot change depth. A node still on the
  // recursion stack (a cycle) contributes 0 for that back-edge rather than recursing forever.
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

  const placed = new Map<string, [number, number]>();
  const taken = (x: number, y: number) => [...placed.values()].some(([px, py]) => Math.abs(px - x) < 1 && Math.abs(py - y) < 1);
  const firstFreeRow = (x: number, fromY: number) => { let y = fromY; while (taken(x, y)) y += ROW_STEP; return y; };

  // Process nodes by depth ascending (ties keep graph.nodes order). A node's reference parent
  // — any upstream with strictly less depth — is then guaranteed to already be placed, so one
  // pass suffices regardless of how graph.nodes happens to be ordered.
  const order = graph.nodes
    .map((node, index) => ({ id: node.id, index, depth: depth(node.id) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index);

  for (const { id, depth: d } of order) {
    if (saved[id]) {
      placed.set(id, [...saved[id]!.pos] as [number, number]);
      continue;
    }
    let parent: string | undefined;
    for (const candidate of upstream.get(id) ?? []) {
      if (depth(candidate) >= d) continue; // not strictly shallower: a cycle partner, not a valid reference
      if (parent === undefined || depth(candidate) > depth(parent)) parent = candidate;
    }
    if (parent === undefined) {
      placed.set(id, [COLUMN_X, firstFreeRow(COLUMN_X, ROW_Y)]);
      continue;
    }
    const [px, py] = placed.get(parent)!;
    placed.set(id, [px + COLUMN_STEP, firstFreeRow(px + COLUMN_STEP, py)]);
  }
  return placed;
}
