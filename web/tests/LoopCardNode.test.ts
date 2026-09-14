// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LoopCardNode, onUserLinkDrop, type UserLinkDrop } from "../app/canvas/LoopCardNode.ts";
import { CARD_WIDTH, cardHeight, OUTPUT_SLOTS, outputSlotFor, TEXT_BLOCK } from "../app/canvas/LoopCardNode.ts";
import { LGraph, LiteGraph } from "@comfyorg/litegraph";

describe("LoopCardNode", () => {
  it("cannot be deleted or cloned, because phase 0 only mirrors the daemon", () => {
    const card = new LoopCardNode();
    expect(card.block_delete).toBe(true);
    expect(card.clonable).toBe(false);
  });
});

describe("card slots and size", () => {
  it("has one output per edge kind and handoff condition, in a fixed order", () => {
    const card = new LoopCardNode();
    expect(card.outputs.map((o) => o.name)).toEqual(["handoff", "on success", "on failure", "message", "spawn"]);
    expect(card.outputs.map((o) => o.type)).toEqual(["handoff", "handoff", "handoff", "message", "spawn"]);
    expect(card.inputs).toEqual([]);
  });

  it("maps an edge's kind and condition to its output slot", () => {
    expect(outputSlotFor("handoff", "always")).toBe(0);
    expect(outputSlotFor("handoff", "onSuccess")).toBe(1);
    expect(outputSlotFor("handoff", "onFailure")).toBe(2);
    expect(outputSlotFor("message", "always")).toBe(3);
    expect(outputSlotFor("message", "onSuccess")).toBe(3);
    expect(outputSlotFor("spawn", "always")).toBe(4);
    expect(OUTPUT_SLOTS[outputSlotFor("handoff", "onFailure")]).toEqual({ name: "on failure", kind: "handoff", condition: "onFailure" });
  });

  it("is as tall as its longer slot column plus the text block", () => {
    expect(cardHeight(0)).toBe(LiteGraph.NODE_SLOT_HEIGHT * 5 + TEXT_BLOCK);
    expect(cardHeight(5)).toBe(cardHeight(0));
    expect(cardHeight(7)).toBe(LiteGraph.NODE_SLOT_HEIGHT * 7 + TEXT_BLOCK);
    const card = new LoopCardNode();
    expect([card.size[0], card.size[1]]).toEqual([CARD_WIDTH, cardHeight(0)]);
    for (let i = 0; i < 7; i++) card.addInput("handoff", "handoff");
    expect(card.size[1]).toBe(cardHeight(7));
  });
});

describe("onUserLinkDrop", () => {
  it("reports a user's drag onto a card's input dot, and never actually connects it", () => {
    const lgraph = new LGraph();
    const a = new LoopCardNode(); a.id = "A"; lgraph.add(a);
    const b = new LoopCardNode(); b.id = "B"; b.addInput("handoff", "handoff"); lgraph.add(b);
    const sizeBefore = lgraph.links.size;
    const drops: UserLinkDrop[] = [];
    onUserLinkDrop((drop) => drops.push(drop));
    try {
      expect(a.connect(1, b, 0)).toBe(null);
      expect(lgraph.links.size).toBe(sizeBefore);
      expect(drops).toEqual([{ from: a, to: b, fromSlotIndex: 1 }]);
    } finally {
      onUserLinkDrop(null);
    }
  });
});
