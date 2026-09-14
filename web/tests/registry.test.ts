import { describe, expect, it } from "vitest";
import { loadNodeTypes, validateNodeType } from "../app/nodes/registry.ts";

const good = { default: { title: "Goal loop", category: "agent", description: "d", widgets: [{ name: "summary", type: "text", required: true }], toDraft: () => ({ loopType: "goalBased" }) } };

describe("validateNodeType", () => {
  it("accepts a well-formed module and fills the optional fields", () => {
    const def = validateNodeType("agent/goal", good);
    expect(def.type).toBe("agent/goal");
    expect(def.title).toBe("Goal loop");
    expect(def.inputs).toEqual([]);
    expect(def.outputs).toEqual([]);
    expect(def.widgets).toHaveLength(1);
  });

  it("checks the module's own type against its file name", () => {
    expect(() => validateNodeType("agent/goal", { default: { ...good.default, type: "agent/other" } })).toThrow('module says type "agent/other" but its file is agent/goal');
    expect(validateNodeType("agent/goal", { default: { ...good.default, type: "agent/goal" } }).type).toBe("agent/goal");
  });

  it("refuses modules without a default export object, title, category or toDraft", () => {
    expect(() => validateNodeType("a/b", {})).toThrow("module has no default export object");
    expect(() => validateNodeType("a/b", { default: 3 })).toThrow("module has no default export object");
    expect(() => validateNodeType("a/b", { default: { ...good.default, title: "" } })).toThrow("title must be a non-empty string");
    expect(() => validateNodeType("a/b", { default: { ...good.default, category: undefined } })).toThrow("category must be a non-empty string");
    expect(() => validateNodeType("a/b", { default: { ...good.default, toDraft: "x" } })).toThrow("toDraft must be a function");
    expect(() => validateNodeType("a/b", { default: { ...good.default, outputs: [{ name: "x", type: "wire" }] } })).toThrow('outputs[0] has unknown slot type "wire"');
  });
});

describe("loadNodeTypes", () => {
  const listing = { types: [
    { type: "agent/goal", source: "builtin", url: "/api/nodes/file?source=builtin&type=agent%2Fgoal" },
    { type: "bad/broken", source: "project", url: "/api/nodes/file?source=project&type=bad%2Fbroken&project=%2Fp" },
    { type: "bad/shape", source: "user", url: "/api/nodes/file?source=user&type=bad%2Fshape" },
  ] };
  const fetchFn = (async (url: string) => {
    expect(url).toBe("/api/nodes?project=%2Fp");
    return { ok: true, status: 200, json: async () => listing } as unknown as Response;
  }) as unknown as typeof fetch;
  const seen: string[] = [];
  const importer = async (url: string) => {
    seen.push(url);
    if (url.includes("agent%2Fgoal")) return good;
    if (url.includes("bad%2Fbroken")) throw new SyntaxError("Unexpected end of input");
    return { default: { title: "no category", toDraft() {} } };
  };

  it("imports every listed module through a fresh url and keeps broken ones with their error", async () => {
    const entries = await loadNodeTypes("/p", importer, fetchFn);
    expect(entries.map((e) => [e.type, e.source, e.ok])).toEqual([["agent/goal", "builtin", true], ["bad/broken", "project", false], ["bad/shape", "user", false]]);
    expect(entries[1]).toMatchObject({ ok: false, error: "Unexpected end of input" });
    expect(entries[2]).toMatchObject({ ok: false, error: "category must be a non-empty string" });
    expect(seen).toHaveLength(3);
    for (const url of seen) expect(url).toMatch(/&v=\d+$/);
  });

  it("asks for the built-in and user packs alone when no project is open", async () => {
    const noProject = (async (url: string) => { expect(url).toBe("/api/nodes"); return { ok: true, status: 200, json: async () => ({ types: [] }) } as unknown as Response; }) as unknown as typeof fetch;
    expect(await loadNodeTypes(null, importer, noProject)).toEqual([]);
  });

  it("throws when the listing itself fails", async () => {
    const failing = (async () => ({ ok: false, status: 500 }) as unknown as Response) as unknown as typeof fetch;
    await expect(loadNodeTypes("/p", importer, failing)).rejects.toThrow("node type listing failed: HTTP 500");
  });
});
