// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LGraphNode } from "@comfyorg/litegraph";
import { linkRequestFrom } from "../app/canvas/linkRequest.ts";

const node = (id: string) => ({ id }) as unknown as LGraphNode;
const drag = (from: LGraphNode, fromSlotIndex: number, toType = "input") => ({ node: from, fromSlotIndex, toType });

describe("linkRequestFrom", () => {
  it("turns a drag from each output slot onto another card into an edge request", () => {
    const a = node("A"); const b = node("B");
    expect(linkRequestFrom([drag(a, 0)], b)).toEqual({ from: "A", to: "B", kind: "handoff", condition: "always" });
    expect(linkRequestFrom([drag(a, 1)], b)).toEqual({ from: "A", to: "B", kind: "handoff", condition: "onSuccess" });
    expect(linkRequestFrom([drag(a, 2)], b)).toEqual({ from: "A", to: "B", kind: "handoff", condition: "onFailure" });
    expect(linkRequestFrom([drag(a, 3)], b)).toEqual({ from: "A", to: "B", kind: "message", condition: "always" });
    expect(linkRequestFrom([drag(a, 4)], b)).toEqual({ from: "A", to: "B", kind: "spawn", condition: "always" });
  });

  it("ignores a drop on the source card, a drag that started at an input, an unknown slot, and an empty drag", () => {
    const a = node("A"); const b = node("B");
    expect(linkRequestFrom([drag(a, 0)], a)).toBe(null);
    expect(linkRequestFrom([drag(a, 0, "output")], b)).toBe(null);
    expect(linkRequestFrom([drag(a, 9)], b)).toBe(null);
    expect(linkRequestFrom([], b)).toBe(null);
  });

  it("uses only the first link of a multi-link drag", () => {
    const a = node("A"); const b = node("B"); const c = node("C");
    expect(linkRequestFrom([drag(a, 3), drag(c, 0)], b)).toEqual({ from: "A", to: "B", kind: "message", condition: "always" });
  });
});
