// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cachedTruncate, LoopCardNode } from "../app/canvas/LoopCardNode.ts";

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
