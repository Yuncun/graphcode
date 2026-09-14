import { describe, expect, it } from "vitest";
import { cachedTruncate, cachedWrap, wrapLines } from "../app/canvas/textLayout.ts";

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

describe("wrapLines", () => {
  it("wraps at spaces so no line is wider than the width", () => {
    const { ctx } = fakeCtx(10);
    expect(wrapLines(ctx, "the quick brown fox jumps", 100)).toEqual(["the quick", "brown fox", "jumps"]);
  });

  it("starts a new line at each newline, keeping blank lines", () => {
    const { ctx } = fakeCtx(10);
    expect(wrapLines(ctx, "one\n\ntwo three", 60)).toEqual(["one", "", "two", "three"]);
  });

  it("cuts a word wider than the line where it stops fitting", () => {
    const { ctx } = fakeCtx(10);
    expect(wrapLines(ctx, "abcdefghijkl x", 50)).toEqual(["abcde", "fghij", "kl x"]);
  });

  it("is a single empty line for empty text", () => {
    const { ctx } = fakeCtx(10);
    expect(wrapLines(ctx, "", 50)).toEqual([""]);
  });
});

describe("cachedWrap", () => {
  it("measures once for the same text and width, and again when either changes", () => {
    const { ctx, calls } = fakeCtx(10);
    const a = cachedWrap(undefined, ctx, "one two", 50);
    const n = calls();
    expect(n).toBeGreaterThan(0);
    expect(cachedWrap(a, ctx, "one two", 50)).toBe(a);
    expect(calls()).toBe(n);
    expect(cachedWrap(a, ctx, "one two", 200)).not.toBe(a);
    expect(cachedWrap(a, ctx, "three", 50).lines).toEqual(["three"]);
  });
});
