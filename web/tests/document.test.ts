import { describe, expect, it } from "vitest";
import { emptyCanvasDoc, instantiate, loadOffset, readCanvasDoc, readWorkflowFile, workflowFile, type CardSnapshot, type WorkflowFile } from "../app/canvas/document.ts";

const card = (id: string, x: number, y: number, size?: [number, number]): CardSnapshot => ({
  id, record: { type: "agent/goal", title: id, values: { summary: `goal ${id}` } }, placed: { pos: [x, y], ...(size ? { size } : {}) },
});

describe("readCanvasDoc", () => {
  it("reads a version 1 file as version 2 with no drafts", () => {
    expect(readCanvasDoc({ version: 1, nodes: { A: { pos: [1, 2], size: [300, 200] }, B: { pos: [3, 4] } } }))
      .toEqual({ version: 2, nodes: { A: { pos: [1, 2], size: [300, 200] }, B: { pos: [3, 4] } }, drafts: {}, draftEdges: [] });
  });

  it("reads a version 2 file, dropping entries that are not well formed", () => {
    const doc = readCanvasDoc({
      version: 2,
      nodes: { A: { pos: [1, 2] }, bad: { pos: "no" }, worse: null },
      drafts: { A: { type: "agent/goal", title: "A", values: { summary: "x" } }, bad: { type: 1 } },
      draftEdges: [{ from: "A", to: "B", kind: "handoff", condition: "always" }, { from: "A", to: "B", kind: "nope", condition: "always" }, 7],
    });
    expect(doc).toEqual({
      version: 2,
      nodes: { A: { pos: [1, 2] } },
      drafts: { A: { type: "agent/goal", title: "A", values: { summary: "x" } } },
      draftEdges: [{ from: "A", to: "B", kind: "handoff", condition: "always" }],
    });
  });

  it("is the empty document for anything else", () => {
    for (const raw of [null, 3, "x", {}, { version: 3, nodes: {} }, { version: 2, nodes: null }, { version: 2, nodes: [] }]) {
      expect(readCanvasDoc(raw)).toEqual(emptyCanvasDoc());
    }
  });

  it("returns fresh objects, never the input", () => {
    const raw = { version: 2, nodes: { A: { pos: [1, 2] } }, drafts: {}, draftEdges: [] };
    const doc = readCanvasDoc(raw);
    doc.nodes.A!.pos[0] = 99;
    expect(raw.nodes.A.pos[0]).toBe(1);
  });
});

describe("readWorkflowFile", () => {
  const good: WorkflowFile = {
    version: 1, name: "pipeline",
    cards: { a: { type: "agent/goal", title: "A", values: { summary: "x" }, pos: [0, 0], size: [300, 220] }, b: { type: "agent/goal", title: "B", values: {}, pos: [340, 0] } },
    edges: [{ from: "a", to: "b", kind: "handoff", condition: "onSuccess" }],
  };

  it("accepts a well-formed file as a fresh copy", () => {
    const file = readWorkflowFile(JSON.parse(JSON.stringify(good)));
    expect(file).toEqual(good);
  });

  it("refuses files that are not workflows, naming the part", () => {
    expect(() => readWorkflowFile({ version: 2, name: "x", cards: {}, edges: [] })).toThrow("not a workflow file");
    expect(() => readWorkflowFile({ ...good, cards: { a: { type: "agent/goal" } } })).toThrow("card a is not well formed");
    expect(() => readWorkflowFile({ ...good, edges: [{ from: "a", to: "zzz", kind: "handoff", condition: "always" }] })).toThrow("edge 0 is not well formed");
  });
});

describe("workflowFile", () => {
  it("collects cards with their layout and keeps only the wires between them", () => {
    const file = workflowFile("pipe", [card("A", 10, 20, [300, 200]), card("B", 350, 20)], [
      { from: "A", to: "B", kind: "handoff", condition: "always" },
      { from: "A", to: "GONE", kind: "message", condition: "always" },
    ]);
    expect(file).toEqual({
      version: 1, name: "pipe",
      cards: {
        A: { type: "agent/goal", title: "A", values: { summary: "goal A" }, pos: [10, 20], size: [300, 200] },
        B: { type: "agent/goal", title: "B", values: { summary: "goal B" }, pos: [350, 20] },
      },
      edges: [{ from: "A", to: "B", kind: "handoff", condition: "always" }],
    });
  });
});

describe("instantiate", () => {
  it("mints fresh ids, rewires the edges to them, and shifts positions by the offset", () => {
    const file = workflowFile("pipe", [card("A", 10, 20, [300, 200]), card("B", 350, 20)], [{ from: "A", to: "B", kind: "spawn", condition: "always" }]);
    let n = 0;
    const out = instantiate(file, () => `NEW-${++n}`, [100, 5]);
    expect(out.cards.map((c) => c.id)).toEqual(["NEW-1", "NEW-2"]);
    expect(out.cards[0]!.placed).toEqual({ pos: [110, 25], size: [300, 200] });
    expect(out.cards[1]!.placed).toEqual({ pos: [450, 25] });
    expect(out.cards[0]!.record).toEqual({ type: "agent/goal", title: "A", values: { summary: "goal A" } });
    expect(out.edges).toEqual([{ from: "NEW-1", to: "NEW-2", kind: "spawn", condition: "always" }]);
    // The file's own values are not shared with the new cards.
    out.cards[0]!.record.values.summary = "changed";
    expect(file.cards.A!.values.summary).toBe("goal A");
  });
});

describe("loadOffset", () => {
  it("is zero on an empty canvas or for an empty file", () => {
    expect(loadOffset([], [{ pos: [5, 5] }])).toEqual([0, 0]);
    expect(loadOffset([{ pos: [5, 5] }], [])).toEqual([0, 0]);
  });

  it("puts the file one gap right of the widest existing card, top aligned with the highest one", () => {
    const existing = [{ pos: [40, 100] as [number, number], size: [300, 200] as [number, number] }, { pos: [400, 40] as [number, number] }];
    const incoming = [{ pos: [-50, 10] as [number, number] }, { pos: [300, 90] as [number, number] }];
    // Right edge: max(40 + 300, 400 + 300 default) = 700; gap 40; incoming's left is -50, so shift x by 790.
    // Top: existing 40, incoming 10, so shift y by 30.
    expect(loadOffset(existing, incoming)).toEqual([790, 30]);
  });
});
