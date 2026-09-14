import { LGraph, LiteGraph, type LLink } from "@comfyorg/litegraph";
import type { LoopGraph } from "../daemon/protocol.ts";
import { connectAsAdapter, LoopCardNode, outputSlotFor, registerLoopCardNode } from "./LoopCardNode.ts";
import { placeNodes } from "./placement.ts";

export interface CanvasNodeLayout { pos: [number, number]; size?: [number, number] }
export interface CanvasDoc { version: 1; nodes: Record<string, CanvasNodeLayout> }

const conditionColor: Record<string, string> = { always: "#cfd3d8", onSuccess: "#22c55e", onFailure: "#ef4444" };

/** Mirrors a LoopGraph onto an LGraph. The daemon's graph is the truth; litegraph objects are views. */
export class GraphAdapter {
  readonly lgraph: LGraph;
  private readonly linkByEdge = new Map<string, LLink>();

  constructor(lgraph: LGraph) {
    this.lgraph = lgraph;
    registerLoopCardNode();
  }

  sync(graph: LoopGraph, layout: CanvasDoc): void {
    const positions = placeNodes(graph, layout.nodes);
    const wanted = new Set(graph.nodes.map((n) => n.id));

    for (const existing of [...this.lgraph.nodes]) {
      if (!wanted.has(String(existing.id))) this.lgraph.remove(existing);
    }
    for (const loop of graph.nodes) {
      let card = this.lgraph.getNodeById(loop.id) as LoopCardNode | null;
      if (!card) {
        card = LiteGraph.createNode("graphcode/loop") as LoopCardNode;
        card.id = loop.id;
        card.pos = positions.get(loop.id) ?? [40, 40];
        this.lgraph.add(card);
      }
      card.apply(loop);
    }

    const wantedEdges = new Map(graph.edges.map((e) => [e.id, e]));
    for (const [edgeID, link] of [...this.linkByEdge]) {
      const edge = wantedEdges.get(edgeID);
      // Stale if the edge is gone, its link was removed some other way, or the edge now
      // points somewhere else (from/to/kind changed under the same edge id) — recreate it below.
      const stale = !edge
        || !this.lgraph.links.get(link.id)
        || link.origin_id !== edge.from
        || link.target_id !== edge.to
        || link.origin_slot !== outputSlotFor(edge.kind, edge.condition);
      if (stale) {
        if (this.lgraph.links.get(link.id)) this.lgraph.removeLink(link.id);
        this.linkByEdge.delete(edgeID);
      }
    }
    for (const edge of graph.edges) {
      if (this.linkByEdge.has(edge.id)) continue;
      const from = this.lgraph.getNodeById(edge.from) as LoopCardNode | null;
      const to = this.lgraph.getNodeById(edge.to) as LoopCardNode | null;
      if (!from || !to) continue;
      to.addInput(edge.kind, edge.kind);
      const inputIndex = to.inputs.length - 1;
      const link = connectAsAdapter(() => from.connect(outputSlotFor(edge.kind, edge.condition), to, inputIndex));
      if (!link) continue;
      this.linkByEdge.set(edge.id, link);
    }
    // The adapter is the graph's only writer. A card refuses a connection it did not make, but
    // a link can still arrive another way (a restored session, a future paste), so anything on
    // the graph that is not one of the daemon's edges is dropped here.
    const drawn = new Set([...this.linkByEdge.values()].map((link) => link.id));
    for (const id of [...this.lgraph.links.keys()]) if (!drawn.has(id)) this.lgraph.removeLink(id);
    // Colour follows the edge's condition every sync, not just at creation, so an edge whose
    // condition changes under a stable id (no retarget) still gets repainted.
    for (const [edgeID, link] of this.linkByEdge) {
      const edge = wantedEdges.get(edgeID)!;
      link.color = conditionColor[edge.condition] ?? conditionColor.always;
    }
    for (const node of this.lgraph.nodes as LoopCardNode[]) {
      for (let i = node.inputs.length - 1; i >= 0; i--) if (node.inputs[i]!.link == null) node.removeInput(i);
      node.setSize(node.computeSize());
    }
    this.lgraph.setDirtyCanvas(true, true);
  }

  positions(): CanvasDoc {
    const nodes: CanvasDoc["nodes"] = {};
    for (const node of this.lgraph.nodes) nodes[String(node.id)] = { pos: [node.pos[0], node.pos[1]], size: [node.size[0], node.size[1]] };
    return { version: 1, nodes };
  }
}
