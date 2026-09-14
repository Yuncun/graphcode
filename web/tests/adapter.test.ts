// @vitest-environment jsdom
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LGraph } from "@comfyorg/litegraph";
import { DRAFT_LINK_COLOR, GraphAdapter } from "../app/canvas/adapter.ts";
import { emptyCanvasDoc, type CanvasDoc } from "../app/canvas/document.ts";
import { connectAsAdapter, type CardHost, type LoopCardNode } from "../app/canvas/LoopCardNode.ts";
import type { LoopGraph, LoopNode } from "../app/daemon/protocol.ts";
import { validateNodeType, type NodeTypeEntry } from "../app/nodes/registry.ts";

const TYPES = ["agent/goal", "agent/timed", "agent/main", "agent/turn", "group/composite"];
let types: NodeTypeEntry[];
beforeAll(async () => {
  types = await Promise.all(TYPES.map(async (type) => ({
    type, source: "builtin", ok: true as const,
    def: validateNodeType(type, await import(pathToFileURL(path.resolve(import.meta.dirname, "..", "nodes", `${type}.js`)).href)),
  })));
});

const host = (): CardHost => ({ onChanged: vi.fn(), onAction: vi.fn(), onEditField: vi.fn(), onRename: vi.fn() });
let minted = 0;
const newID = () => `NEW-${++minted}`;
function make(): GraphAdapter {
  const adapter = new GraphAdapter(new LGraph(), host(), newID);
  adapter.types = types;
  return adapter;
}

const n = (id: string, title = id, extra: Partial<LoopNode> = {}): LoopNode => ({ id, title, loopType: "goalBased", state: { running: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted", goal: { summary: `goal ${id}` }, ...extra });
const g = (nodes: LoopNode[], edges: Array<[string, string, "handoff" | "message" | "spawn", ("always" | "onSuccess" | "onFailure")?]>): LoopGraph => ({
  id: "G", revision: 1, project: { path: "/p", name: "p" }, nodes,
  edges: edges.map(([from, to, kind, condition], i) => ({ id: `E${i}`, from, to, kind, condition: condition ?? "always", fireCount: 0 })),
});
const layout = (): CanvasDoc => emptyCanvasDoc();
const ids = (a: GraphAdapter) => a.cards().map((c) => String(c.id)).sort();

describe("GraphAdapter: the daemon's side", () => {
  it("mirrors nodes and edges, then removes what the daemon dropped", () => {
    const a = make();
    a.sync(g([n("A"), n("B"), n("C")], [["A", "B", "handoff"], ["A", "C", "message"], ["B", "C", "handoff"]]), layout());
    expect(ids(a)).toEqual(["A", "B", "C"]);
    expect(a.lgraph.links.size).toBe(3);
    expect(a.card("C")!.inputs.map((i) => i.name)).toEqual(["message", "handoff"]);
    expect(a.card("A")!.cardMode).toBe("live");
    expect(a.card("A")!.values.summary).toBe("goal A");
    a.sync(g([n("A"), n("B", "B renamed")], [["A", "B", "handoff"]]), layout());
    expect(ids(a)).toEqual(["A", "B"]);
    expect(a.lgraph.links.size).toBe(1);
    expect(a.card("B")!.title).toBe("B renamed");
    expect(a.card("C")).toBe(null);
  });

  it("refuses a link a user drags between two cards", () => {
    const a = make();
    a.sync(g([n("A"), n("B")], [["A", "B", "handoff"]]), layout());
    const b = a.card("B")!;
    b.addInput("handoff", "handoff");
    expect(a.card("A")!.connect(0, b, b.inputs.length - 1)).toBe(null);
    expect(a.lgraph.links.size).toBe(1);
  });

  it("adopts a link it did not draw as a draft wire rather than dropping it", () => {
    const a = make();
    const graph = g([n("A"), n("B")], [["A", "B", "handoff"]]);
    a.sync(graph, layout());
    const from = a.card("A")!;
    const to = a.card("B")!;
    to.addInput("message", "message");
    const link = connectAsAdapter(() => from.connect(3, to, to.inputs.length - 1))!;
    a.sync(graph, layout());
    expect(a.lgraph.links.size).toBe(2);
    expect(a.isDraftLink(link.id)).toBe(true);
    expect(link.color).toBe(DRAFT_LINK_COLOR);
    expect(a.draftEdges()).toEqual([{ from: "A", to: "B", kind: "message", condition: "always" }]);
  });

  it("applies saved positions and sizes and reports them back", () => {
    const a = make();
    a.sync(g([n("A")], []), { ...layout(), nodes: { A: { pos: [123, 456], size: [320, 400] } } });
    const card = a.card("A")!;
    expect([...card.pos]).toEqual([123, 456]);
    expect([...card.size]).toEqual([320, 400]);
    expect(card.userResized).toBe(true);
    expect(a.document().nodes.A).toEqual({ pos: [123, 456], size: [320, 400] });
  });

  it("keeps a stable edge id's link current: colour follows a condition change, and a retarget recreates the link", () => {
    const a = make();
    const base = { id: "G", revision: 1, project: { path: "/p", name: "p" }, nodes: [n("A"), n("B"), n("C")] };
    a.sync({ ...base, edges: [{ id: "E0", from: "A", to: "B", kind: "handoff", condition: "always", fireCount: 0 }] }, layout());
    expect([...a.lgraph.links.values()][0]!.color).toBe("#cfd3d8");
    a.sync({ ...base, edges: [{ id: "E0", from: "A", to: "B", kind: "handoff", condition: "onFailure", fireCount: 0 }] }, layout());
    expect(a.lgraph.links.size).toBe(1);
    expect([...a.lgraph.links.values()][0]!.color).toBe("#ef4444");
    expect([...a.lgraph.links.values()][0]!.origin_slot).toBe(2);
    a.sync({ ...base, edges: [{ id: "E0", from: "A", to: "C", kind: "handoff", condition: "onFailure", fireCount: 0 }] }, layout());
    expect(a.lgraph.links.size).toBe(1);
    expect([...a.lgraph.links.values()][0]!.target_id).toBe("C");
  });

  it("draws each edge from the output slot for its kind and condition", () => {
    const a = make();
    a.sync(g([n("A"), n("B"), n("C"), n("D"), n("E"), n("F")], [
      ["A", "B", "handoff"], ["A", "C", "handoff", "onSuccess"], ["A", "D", "handoff", "onFailure"], ["A", "E", "message"], ["A", "F", "spawn"],
    ]), layout());
    const slots = [...a.lgraph.links.values()].sort((x, y) => String(x.target_id).localeCompare(String(y.target_id))).map((l) => l.origin_slot);
    expect(slots).toEqual([0, 1, 2, 3, 4]);
  });

  it("prunes the input of an edge that went away", () => {
    const a = make();
    a.sync(g([n("A"), n("B"), n("Z")], [["A", "Z", "handoff"], ["B", "Z", "handoff"]]), layout());
    expect(a.card("Z")!.inputs).toHaveLength(2);
    a.sync(g([n("A"), n("Z")], [["A", "Z", "handoff"]]), layout());
    expect(a.card("Z")!.inputs).toHaveLength(1);
  });

  it("grows a card for many inputs and shrinks it back when they go, and none of that is a user resize", () => {
    const h = host();
    const a = new GraphAdapter(new LGraph(), h, newID);
    a.types = types;
    const many = g([n("A"), n("B"), n("C"), n("D"), n("E"), n("F"), n("G"), n("Z")], [["A", "Z", "handoff"], ["B", "Z", "handoff"], ["C", "Z", "handoff"], ["D", "Z", "handoff"], ["E", "Z", "handoff"], ["F", "Z", "handoff"], ["G", "Z", "handoff"]]);
    a.sync(many, layout());
    const z = a.card("Z")!;
    const tall = z.size[1];
    expect(z.inputs).toHaveLength(7);
    a.sync(g([n("A"), n("Z")], [["A", "Z", "handoff"]]), layout());
    expect(z.inputs).toHaveLength(1);
    expect(z.size[1]).toBeLessThan(tall);
    expect(z.userResized).toBe(false);
    expect(h.onChanged).not.toHaveBeenCalled();
  });
});

describe("GraphAdapter: the user's side", () => {
  it("makes a draft where it is dropped, keeps it across syncs, and removes it on request", () => {
    const a = make();
    a.sync(g([n("A")], []), layout());
    const draft = a.addDraft("agent/goal", [500, 40])!;
    expect(draft.cardMode).toBe("draft");
    expect(String(draft.id)).toMatch(/^NEW-/);
    expect([...draft.pos]).toEqual([500, 40]);
    a.sync(g([n("A")], []), layout());
    expect(ids(a)).toEqual(["A", String(draft.id)].sort());
    expect(a.drafts().map((c) => String(c.id))).toEqual([String(draft.id)]);
    expect(a.addDraft("nope/none", [0, 0])).toBe(null);
    a.removeDrafts([String(draft.id), "A"]);
    expect(ids(a)).toEqual(["A"]);
  });

  it("wires a draft to a live card as a draft wire, and sends nothing", () => {
    const a = make();
    a.sync(g([n("A")], []), layout());
    const draft = a.addDraft("agent/goal", [500, 40])!;
    const link = a.addDraftLink(draft, 1, a.card("A")!)!;
    expect(link.color).toBe(DRAFT_LINK_COLOR);
    expect(a.isDraftLink(link.id)).toBe(true);
    expect(a.edgeIDForLink(link.id)).toBe(null);
    expect(a.draftEdges()).toEqual([{ from: String(draft.id), to: "A", kind: "handoff", condition: "onSuccess" }]);
    expect(a.card("A")!.inputs.map((i) => i.name)).toEqual(["handoff"]);
    expect(a.addDraftLink(draft, 0, draft)).toBe(null);
    a.sync(g([n("A")], []), layout());
    expect(a.lgraph.links.size).toBe(1);
    expect(a.draftEdges()).toHaveLength(1);
  });

  it("hands a draft wire to the daemon once the daemon reports that edge", () => {
    const a = make();
    a.sync(g([n("A")], []), layout());
    const draft = a.addDraft("agent/goal", [500, 40], { title: "New", values: { summary: "x" } }, "NEW-FIXED")!;
    a.addDraftLink(draft, 0, a.card("A")!);
    a.markStarting(["NEW-FIXED"]);
    expect(draft.cardMode).toBe("starting");
    a.sync(g([n("A"), n("NEW-FIXED", "New")], [["NEW-FIXED", "A", "handoff"]]), layout());
    expect(draft.cardMode).toBe("live");
    expect(a.lgraph.links.size).toBe(1);
    expect(a.draftEdges()).toEqual([]);
    expect(a.edgeIDForLink([...a.lgraph.links.keys()][0]!)).toBe("E0");
    expect(a.card("A")!.inputs).toHaveLength(1);
  });

  it("reverts starting cards to draft, all of them or the ones named", () => {
    const a = make();
    a.sync(g([], []), layout());
    const x = a.addDraft("agent/goal", [0, 0], { values: { summary: "x" } })!;
    const y = a.addDraft("agent/goal", [0, 300], { values: { summary: "y" } })!;
    a.markStarting([String(x.id), String(y.id)]);
    expect(a.revertStarting([String(x.id)])).toEqual([String(x.id)]);
    expect(x.cardMode).toBe("draft");
    expect(y.cardMode).toBe("starting");
    expect(a.revertStarting()).toEqual([String(y.id)]);
    expect(a.revertStarting()).toEqual([]);
  });

  it("forgets a draft wire that litegraph removed (dropped on empty canvas)", () => {
    const a = make();
    a.sync(g([n("A")], []), layout());
    const draft = a.addDraft("agent/goal", [500, 40])!;
    const link = a.addDraftLink(draft, 0, a.card("A")!)!;
    a.lgraph.removeLink(link.id);
    a.sync(g([n("A")], []), layout());
    expect(a.draftEdges()).toEqual([]);
    expect(a.card("A")!.inputs).toHaveLength(0);
  });

  it("restores drafts and draft wires from the layout once the types are loaded, keeping orphans for the file", () => {
    const a = new GraphAdapter(new LGraph(), host(), newID);
    const saved: CanvasDoc = {
      version: 2,
      // Saved heights sit above a goal card's minimum, so a size that survives the sync proves the point.
      nodes: { A: { pos: [1, 2] }, D1: { pos: [500, 40], size: [300, 420] }, D2: { pos: [900, 40] }, ORPHAN: { pos: [0, 900] } },
      drafts: { D1: { type: "agent/goal", title: "One", values: { summary: "s1" } }, D2: { type: "agent/main", title: "Two", values: {} }, ORPHAN: { type: "gone/type", title: "Lost", values: { a: 1 } } },
      draftEdges: [{ from: "D1", to: "D2", kind: "handoff", condition: "onSuccess" }, { from: "D2", to: "A", kind: "message", condition: "always" }, { from: "ORPHAN", to: "A", kind: "spawn", condition: "always" }],
    };
    // Types not loaded yet: the live card appears, the drafts wait, and the document still carries them.
    a.sync(g([n("A")], []), saved);
    expect(ids(a)).toEqual(["A"]);
    expect(Object.keys(a.document().drafts).sort()).toEqual(["D1", "D2", "ORPHAN"]);
    expect(a.document().draftEdges).toHaveLength(3);
    a.types = types;
    a.sync(g([n("A")], []), saved);
    expect(ids(a)).toEqual(["A", "D1", "D2"]);
    expect(a.card("D1")!.title).toBe("One");
    expect(a.card("D1")!.values.summary).toBe("s1");
    expect([...a.card("D1")!.size]).toEqual([300, 420]);
    expect(a.draftEdges()).toEqual([{ from: "D1", to: "D2", kind: "handoff", condition: "onSuccess" }, { from: "D2", to: "A", kind: "message", condition: "always" }]);
    const doc = a.document();
    expect(doc.drafts.ORPHAN).toEqual({ type: "gone/type", title: "Lost", values: { a: 1 } });
    expect(doc.nodes.ORPHAN).toEqual({ pos: [0, 900] });
    expect(doc.draftEdges).toContainEqual({ from: "ORPHAN", to: "A", kind: "spawn", condition: "always" });
    expect(Object.keys(doc.drafts).sort()).toEqual(["D1", "D2", "ORPHAN"]);
    // A second sync with the same layout does not restore twice.
    a.sync(g([n("A")], []), saved);
    expect(ids(a)).toEqual(["A", "D1", "D2"]);
  });

  it("writes a workflow with every card as a definition and every wire, live or draft", () => {
    const a = make();
    a.sync(g([n("A", "A", { modelTier: "capable" }), n("B")], [["A", "B", "handoff", "onSuccess"]]), { ...layout(), nodes: { A: { pos: [10, 20], size: [300, 420] } } });
    const draft = a.addDraft("agent/main", [700, 20], { title: "Note", values: { note: "start here" } })!;
    a.addDraftLink(a.card("B")!, 3, draft);
    const file = a.workflow("pipe");
    expect(file.name).toBe("pipe");
    expect(Object.keys(file.cards).sort()).toEqual(["A", "B", String(draft.id)].sort());
    expect(file.cards.A).toEqual({ type: "agent/goal", title: "A", values: { summary: "goal A", predicate: "", model: "capable", backend: "claudeCode" }, pos: [10, 20], size: [300, 420] });
    expect(file.cards[String(draft.id)]).toMatchObject({ type: "agent/main", title: "Note", values: { note: "start here", backend: "claudeCode" }, pos: [700, 20] });
    expect(file.edges).toEqual([
      { from: "B", to: String(draft.id), kind: "message", condition: "always" },
      { from: "A", to: "B", kind: "handoff", condition: "onSuccess" },
    ]);
  });

  it("loads a workflow as drafts with fresh ids, wired, one gap right of the existing cards", () => {
    const a = make();
    a.sync(g([n("A")], []), { ...layout(), nodes: { A: { pos: [40, 40], size: [300, 420] } } });
    const source = make();
    source.sync(g([n("X"), n("Y")], [["X", "Y", "spawn"]]), { ...layout(), nodes: { X: { pos: [0, 0] }, Y: { pos: [340, 0] } } });
    const file = source.workflow("two");
    const made = a.loadWorkflow(file);
    expect(made).toHaveLength(2);
    expect(made.every((id) => id.startsWith("NEW-"))).toBe(true);
    const cards = made.map((id) => a.card(id)!);
    expect(cards.every((c) => c.cardMode === "draft")).toBe(true);
    expect(cards.map((c) => c.pos[0])).toEqual([380, 720]);
    expect(cards.map((c) => c.pos[1])).toEqual([40, 40]);
    expect(a.draftEdges()).toEqual([{ from: made[0]!, to: made[1]!, kind: "spawn", condition: "always" }]);
    expect(a.card("A")!.cardMode).toBe("live");
    // The same file again lands further right again, with new ids.
    const again = a.loadWorkflow(file);
    expect(again).not.toEqual(made);
    expect(a.card(again[0]!)!.pos[0]).toBeGreaterThan(720);
  });
});
