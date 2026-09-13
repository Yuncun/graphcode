import type { LoopGraph } from "../daemon/protocol.ts";

export const COLUMN_X = 40;
export const ROW_Y = 40;
export const COLUMN_STEP = 300;
export const ROW_STEP = 130;

/** Saved positions win. Otherwise: right of the first positioned upstream node, else column 0. Rows never overlap. */
export function placeNodes(
  graph: LoopGraph,
  saved: Record<string, { pos: [number, number] }>,
): Map<string, [number, number]> {
  const placed = new Map<string, [number, number]>();
  for (const node of graph.nodes) if (saved[node.id]) placed.set(node.id, [...saved[node.id]!.pos] as [number, number]);
  const upstream = new Map<string, string[]>();
  for (const edge of graph.edges) upstream.set(edge.to, [...(upstream.get(edge.to) ?? []), edge.from]);
  const taken = (x: number, y: number) => [...placed.values()].some(([px, py]) => Math.abs(px - x) < 1 && Math.abs(py - y) < 1);
  const firstFreeRow = (x: number, fromY: number) => { let y = fromY; while (taken(x, y)) y += ROW_STEP; return y; };

  // One pass: place every not-yet-placed node whose upstream is already placed. Returns whether anything moved.
  const cascade = (): boolean => {
    let progress = false;
    for (const node of graph.nodes) {
      if (placed.has(node.id)) continue;
      const parent = (upstream.get(node.id) ?? []).find((id) => placed.has(id));
      if (!parent) continue;
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
    // Children of this root now have a positioned upstream; place them in the next pass.
    while (cascade());
  }
  return placed;
}
