import { describe, expect, it } from "vitest";
import { placeNodes } from "../app/canvas/placement.ts";
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
    expect(pos.get("B")).toEqual([40, 210]);
  });
  it("places a child 300 right of its upstream, and a second child on the next free row", () => {
    const pos = placeNodes(g(["A", "B", "C"], [["A", "B"], ["A", "C"]]), { A: { pos: [100, 100] } });
    expect(pos.get("B")).toEqual([400, 100]);
    expect(pos.get("C")).toEqual([400, 270]);
  });
  it("follows a chain of 8 without folding into one column", () => {
    const ids = ["N0", "N1", "N2", "N3", "N4", "N5", "N6", "N7"];
    const pos = placeNodes(g(ids, ids.slice(1).map((id, i) => [ids[i]!, id])), {});
    expect(pos.get("N7")![0]).toBe(40 + 7 * 300);
  });
  it("follows the longest chain when a lead node also has a direct edge to every stage", () => {
    // Reproduces the twodrive graph: L is the lead with a direct edge to every stage, but the
    // real chain runs L->A->B->C. Each stage must land one column past its deepest predecessor,
    // not one column past L (which would flatten the whole chain into a single column).
    const pos = placeNodes(g(["L", "A", "B", "C"], [["L", "A"], ["A", "B"], ["B", "C"], ["L", "B"], ["L", "C"]]), {});
    expect(pos.get("A")![0]).toBe(340);
    expect(pos.get("B")![0]).toBe(640);
    expect(pos.get("C")![0]).toBe(940);
  });
});
