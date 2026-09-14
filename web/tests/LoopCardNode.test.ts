// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cachedTruncate, LoopCardNode } from "../app/canvas/LoopCardNode.ts";
import { CARD_WIDTH, cardHeight, OUTPUT_SLOTS, outputSlotFor, TEXT_BLOCK } from "../app/canvas/LoopCardNode.ts";
import { LiteGraph } from "@comfyorg/litegraph";

function fakeCtx(charWidth = 6) {
  let calls = 0;
  const ctx = {
    measureText(text: string) {
      calls++;
      return { width: text.length * charWidth } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls: () => calls };
}

describe("cachedTruncate", () => {
  it("measures once for repeated draws with the same text and width", () => {
    const { ctx, calls } = fakeCtx();
    const first = cachedTruncate(undefined, ctx, "hello world", 200);
    const callsAfterFirst = calls();
    expect(callsAfterFirst).toBeGreaterThan(0);
    const second = cachedTruncate(first, ctx, "hello world", 200);
    expect(calls()).toBe(callsAfterFirst);
    expect(second).toBe(first);
    expect(second.result).toBe("hello world");
  });

  it("re-measures when the text changes", () => {
    const { ctx, calls } = fakeCtx();
    const first = cachedTruncate(undefined, ctx, "hello", 200);
    const callsAfterFirst = calls();
    const second = cachedTruncate(first, ctx, "goodbye", 200);
    expect(calls()).toBeGreaterThan(callsAfterFirst);
    expect(second).not.toBe(first);
  });

  it("re-measures when the width changes", () => {
    const { ctx, calls } = fakeCtx();
    const first = cachedTruncate(undefined, ctx, "hello", 200);
    const callsAfterFirst = calls();
    const second = cachedTruncate(first, ctx, "hello", 50);
    expect(calls()).toBeGreaterThan(callsAfterFirst);
    expect(second).not.toBe(first);
  });

  it("caps the input at 200 characters before measuring", () => {
    const { ctx } = fakeCtx(1);
    const long = "x".repeat(500);
    const result = cachedTruncate(undefined, ctx, long, 1000);
    expect(result.text.length).toBe(200);
  });

  it("truncates with an ellipsis when the text is too wide", () => {
    const { ctx } = fakeCtx(10);
    const result = cachedTruncate(undefined, ctx, "hello world", 55);
    expect(result.result.endsWith("…")).toBe(true);
    expect(result.result.length).toBeLessThan("hello world".length);
  });
});

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
