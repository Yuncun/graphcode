import { describe, expect, it } from "vitest";
import { graphForDocument } from "../app/canvas/documentGraph.ts";
import { emptyCanvasDoc } from "../app/canvas/document.ts";
import type { WorkflowDocument } from "../shared/workflowDocument.ts";
import type { LoopGraph, LoopNode } from "../app/daemon/protocol.ts";

const doc = (project: string | null): WorkflowDocument => ({
  version: 1, id: "6a3df1a0-a23f-4ccc-8850-237447de2466", name: "Review", project,
  canvas: { ...emptyCanvasDoc(), nodes: { A: { pos: [0, 0] }, B: { pos: [350, 0] } } },
});
const node = (id: string): LoopNode => ({ id, title: id, loopType: "sketch", state: { idle: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted" });

describe("graphForDocument", () => {
  it("gives an unbound workflow a stable canvas identity without a filesystem path or daemon graph", () => {
    const document = doc(null);
    expect(graphForDocument(document, null)).toEqual({
      id: document.id, project: { path: `workflow:${document.id}`, name: "Review" }, nodes: [], edges: [],
    });
  });

  it("waits for a bound project rather than treating unavailable live nodes as editable drafts", () => {
    expect(graphForDocument(doc("/workspace"), null)).toBe(null);
    expect(graphForDocument(doc("/workspace"), { id: "other", project: { path: "/other", name: "Other" }, nodes: [], edges: [] })).toBe(null);
  });

  it("shows only owned nodes and their internal edges when several workflows share a project", () => {
    const project: LoopGraph = {
      id: "project", revision: 8, project: { path: "/workspace", name: "Workspace" },
      nodes: [node("A"), node("B"), node("unrelated")],
      edges: [
        { id: "owned", from: "A", to: "B", kind: "handoff", condition: "onSuccess", fireCount: 0 },
        { id: "outside", from: "B", to: "unrelated", kind: "message", condition: "always", fireCount: 0 },
      ],
    };
    const graph = graphForDocument(doc("/workspace"), project)!;
    expect(graph.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(graph.edges.map((e) => e.id)).toEqual(["owned"]);
    expect(graph.project.path).toBe("workflow:6a3df1a0-a23f-4ccc-8850-237447de2466");
    expect(project.nodes).toHaveLength(3);
    expect(project.edges).toHaveLength(2);
  });
});
