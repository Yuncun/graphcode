import { describe, expect, it } from "vitest";
import { COLUMN_STEP, COLUMN_X, placeNodes, ROW_STEP } from "../app/canvas/placement.ts";
import type { LoopGraph, LoopNode } from "../app/daemon/protocol.ts";

const n = (id: string): LoopNode => ({ id, title: id, loopType: "goalBased", state: { idle: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted" });
const g = (nodes: string[], edges: Array<[string, string]>): LoopGraph => ({
  id: "G", revision: 1, project: { path: "/p", name: "p" }, nodes: nodes.map(n),
  edges: edges.map(([from, to], i) => ({ id: `E${i}`, from, to, kind: "handoff", condition: "always", fireCount: 0 })),
});

describe("placeNodes", () => {
  it("keeps saved positions", () => {
    const pos = placeNodes(g(["A"], []), { A: { pos: [7, 9] } });
    expect(pos.get("A")).toEqual([7, 9]);
  });
  it("stacks roots in column 40 on rows 170 apart", () => {
    const pos = placeNodes(g(["A", "B"], []), {});
    expect(pos.get("A")).toEqual([40, 40]);
    expect(pos.get("B")).toEqual([40, 40 + ROW_STEP]);
  });
  it("places a child 300 right of its upstream, and a second child on the next free row", () => {
    const pos = placeNodes(g(["A", "B", "C"], [["A", "B"], ["A", "C"]]), { A: { pos: [100, 100] } });
    expect(pos.get("B")).toEqual([100 + COLUMN_STEP, 100]);
    expect(pos.get("C")).toEqual([100 + COLUMN_STEP, 100 + ROW_STEP]);
  });
  it("follows a chain of 8 without folding into one column", () => {
    const ids = ["N0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"];
    const pos = placeNodes(g(ids, ids.slice(1).map((id, i) => [ids[i]!, id])), {});
    expect(pos.get("N7")![0]).toBe(COLUMN_X + 7 * COLUMN_STEP);
  });
  it("follows the longest chain when a lead node also has a direct edge to every stage", () => {
    // Reproduces the twodrive graph: L is the lead with a direct edge to every stage, but the
    // real chain runs L->A->B->C. Each stage must land one column past its deepest predecessor,
    // not one column past L (which would flatten the whole chain into a single column).
    const pos = placeNodes(g(["L", "A", "B", "C"], [["L", "A"], ["A", "B"], ["B", "C"], ["L", "B"], ["L", "C"]]), {});
    expect(pos.get("A")![0]).toBe(COLUMN_X + COLUMN_STEP);
    expect(pos.get("B")![0]).toBe(COLUMN_X + 2 * COLUMN_STEP);
    expect(pos.get("C")![0]).toBe(COLUMN_X + 3 * COLUMN_STEP);
  });
  it("gives the same result regardless of graph.nodes order", () => {
    // Same reproduction as above, but the daemon lists the nodes in a different order. The
    // daemon does not promise any order, so the result must not depend on it.
    const pos = placeNodes(g(["C", "B", "A", "L"], [["L", "A"], ["A", "B"], ["B", "C"], ["L", "B"], ["L", "C"]]), {});
    expect(pos.get("L")![0]).toBe(40);
    expect(pos.get("A")![0]).toBe(COLUMN_X + COLUMN_STEP);
    expect(pos.get("B")![0]).toBe(COLUMN_X + 2 * COLUMN_STEP);
    expect(pos.get("C")![0]).toBe(COLUMN_X + 3 * COLUMN_STEP);
  });
  it("spaces columns and rows for the 300-wide card", () => {
    expect(COLUMN_STEP).toBe(340);
    expect(ROW_STEP).toBe(220);
  });
  it("terminates on a two-node cycle, placing both nodes with at most one of them in column 40", () => {
    const pos = placeNodes(g(["A", "B"], [["A", "B"], ["B", "A"]]), {});
    expect(pos.size).toBe(2);
    expect(pos.has("A")).toBe(true);
    expect(pos.has("B")).toBe(true);
    const atColumn40 = [...pos.values()].filter(([x]) => x === COLUMN_X).length;
    expect(atColumn40).toBeLessThanOrEqual(1);
  });
  it("terminates on a self-loop", () => {
    const pos = placeNodes(g(["C"], [["C", "C"]]), {});
    expect(pos.get("C")).toEqual([40, 40]);
  });
});
