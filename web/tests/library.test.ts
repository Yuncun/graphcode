import { describe, expect, it } from "vitest";
import { brokenEntries, groupByCategory, NODE_TYPE_MIME } from "../app/sidebar/library.ts";
import type { NodeTypeEntry } from "../app/nodes/registry.ts";

const ok = (type: string, title: string, category: string, description = ""): NodeTypeEntry =>
  ({ type, source: "builtin", ok: true, def: { type, title, category, description, inputs: [], outputs: [], widgets: [], toDraft: () => ({}) } });
const entries: NodeTypeEntry[] = [
  ok("agent/turn", "Turn loop", "agent"),
  ok("group/composite", "Composite", "group", "A group of loops"),
  ok("agent/goal", "Goal loop", "agent", "Runs until done"),
  { type: "bad/broken", source: "project", ok: false, error: "Unexpected token" },
];

describe("groupByCategory", () => {
  it("groups working entries by category, both sorted, and leaves broken ones out", () => {
    expect(groupByCategory(entries).map((g) => [g.category, g.items.map((i) => i.def.title)])).toEqual([["agent", ["Goal loop", "Turn loop"]], ["group", ["Composite"]]]);
  });

  it("filters by title, type or description, ignoring case, and drops empty groups", () => {
    expect(groupByCategory(entries, "TURN").flatMap((g) => g.items.map((i) => i.type))).toEqual(["agent/turn"]);
    expect(groupByCategory(entries, "group/").flatMap((g) => g.items.map((i) => i.type))).toEqual(["group/composite"]);
    expect(groupByCategory(entries, "until done").flatMap((g) => g.items.map((i) => i.type))).toEqual(["agent/goal"]);
    expect(groupByCategory(entries, "zzz")).toEqual([]);
  });
});

describe("brokenEntries", () => {
  it("returns only the entries that failed to load", () => {
    expect(brokenEntries(entries)).toEqual([{ type: "bad/broken", source: "project", ok: false, error: "Unexpected token" }]);
  });
});

describe("NODE_TYPE_MIME", () => {
  it("is a vendor type no other drop target claims", () => {
    expect(NODE_TYPE_MIME).toBe("application/x-graphcode-node-type");
  });
});
