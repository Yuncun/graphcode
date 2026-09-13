import { describe, expect, it } from "vitest";
import { resolveSocketPath } from "../server/socketPath.ts";

describe("resolveSocketPath", () => {
  const home = "/Users/eric";
  it("defaults to ~/.graphcode/graphcoded.sock", () => {
    expect(resolveSocketPath({}, home)).toBe("/Users/eric/.graphcode/graphcoded.sock");
  });
  it("honours GRAPHCODE_SUPPORT_DIR", () => {
    expect(resolveSocketPath({ GRAPHCODE_SUPPORT_DIR: "/Users/eric/.graphcode-fork" }, home))
      .toBe("/Users/eric/.graphcode-fork/graphcoded.sock");
  });
  it("GRAPHCODE_SOCKET wins and expands a leading tilde", () => {
    expect(resolveSocketPath({ GRAPHCODE_SOCKET: "~/x/d.sock", GRAPHCODE_SUPPORT_DIR: "/other" }, home))
      .toBe("/Users/eric/x/d.sock");
  });
  it("ignores a blank GRAPHCODE_SOCKET", () => {
    expect(resolveSocketPath({ GRAPHCODE_SOCKET: "  " }, home)).toBe("/Users/eric/.graphcode/graphcoded.sock");
  });
});
