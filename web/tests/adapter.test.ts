// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LGraph } from "@comfyorg/litegraph";
import { GraphAdapter } from "../app/canvas/adapter.ts";
import type { LoopGraph, LoopNode } from "../app/daemon/protocol.ts";

const n = (id: string, title = id): LoopNode => ({ id, title, loopType: "goalBased", state: { running: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted" });
const g = (nodes: LoopNode[], edges: Array<[string, string, "handoff" | "message"]>): LoopGraph => ({
  id: "G", revision: 1, project: { path: "/p", name: "p" }, nodes,
  edges: edges.map(([from, to, kind], i) => ({ id: `E${i}`, from, to, kind, condition: "always", fireCount: 0 })),
});

describe("GraphAdapter", () => {
  it("mirrors nodes and edges, then removes what the daemon dropped", () => {
    const lgraph = new LGraph();
    const adapter = new GraphAdapter(lgraph);
    adapter.sync(g([n("A"), n("B"), n("C")], [["A", "B", "handoff"], ["A", "C", "message"], ["B", "C", "handoff"]]), { version: 1, nodes: {} });
    expect(lgraph.nodes.map((x) => x.id).sort()).toEqual(["A", "B", "C"]);
    expect(lgraph.links.size).toBe(3);
    const c = lgraph.getNodeById("C")!;
    expect(c.inputs.map((i) => i.name)).toEqual(["message", "handoff"]);
    adapter.sync(g([n("A"), n("B", "B renamed")], [["A", "B", "handoff"]]), { version: 1, nodes: {} });
    expect(lgraph.nodes.map((x) => x.id).sort()).toEqual(["A", "B"]);
    expect(lgraph.links.size).toBe(1);
    expect(lgraph.getNodeById("B")!.title).toBe("B renamed");
  });

  it("applies saved positions and reports current ones", () => {
    const lgraph = new LGraph();
    const adapter = new GraphAdapter(lgraph);
    adapter.sync(g([n("A")], []), { version: 1, nodes: { A: { pos: [123, 456] } } });
    expect([...lgraph.getNodeById("A")!.pos]).toEqual([123, 456]);
    expect(adapter.positions().nodes.A?.pos).toEqual([123, 456]);
  });

  it("keeps a stable edge id's link current: colour follows a condition change, and a retarget recreates the link", () => {
    const lgraph = new LGraph();
    const adapter = new GraphAdapter(lgraph);
    const base: Omit<LoopGraph, "edges"> = { id: "G", revision: 1, project: { path: "/p", name: "p" }, nodes: [n("A"), n("B"), n("C")] };

    adapter.sync({ ...base, edges: [{ id: "E0", from: "A", to: "B", kind: "handoff", condition: "always", fireCount: 0 }] }, { version: 1, nodes: {} });
    expect(lgraph.links.size).toBe(1);
    expect([...lgraph.links.values()][0]!.color).toBe("#cfd3d8");

    adapter.sync({ ...base, edges: [{ id: "E0", from: "A", to: "B", kind: "handoff", condition: "onFailure", fireCount: 0 }] }, { version: 1, nodes: {} });
    expect(lgraph.links.size).toBe(1);
    expect([...lgraph.links.values()][0]!.color).toBe("#ef4444");

    adapter.sync({ ...base, edges: [{ id: "E0", from: "A", to: "C", kind: "handoff", condition: "onFailure", fireCount: 0 }] }, { version: 1, nodes: {} });
    expect(lgraph.links.size).toBe(1);
    expect([...lgraph.links.values()][0]!.target_id).toBe("C");
  });
});
