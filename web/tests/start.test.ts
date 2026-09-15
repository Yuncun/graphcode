import { describe, expect, it } from "vitest";
import { planStart, type StartCard } from "../app/nodes/start.ts";

const draftOf = (id: string) => ({ id, title: id, loopType: "goalBased" as const, pausesBeforeWritesOnly: false });
const draft = (id: string, problems: string[] = []): StartCard => ({ id, mode: "draft", title: id, problems, draft: () => draftOf(id) });
const starting = (id: string): StartCard => ({ id, mode: "starting", title: id, problems: [], draft: () => draftOf(id) });
const live = (id: string): StartCard => ({ id, mode: "live", title: id, problems: [], draft: () => { throw new Error("a live card has no draft"); } });
const wire = (from: string, to: string) => ({ from, to, kind: "handoff" as const, condition: "always" as const });

describe("planStart", () => {
  it("creates every draft, then the wires whose two ends are live or being created", () => {
    const plan = planStart([live("L"), draft("A"), draft("B")], [wire("A", "B"), wire("B", "L"), wire("L", "A")]);
    expect(plan.creates.map((c) => c.id)).toEqual(["A", "B"]);
    expect(plan.creates[0]!.draft).toEqual(draftOf("A"));
    expect(plan.edges).toEqual([wire("A", "B"), wire("B", "L"), wire("L", "A")]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a card with problems, and every wire that needs it", () => {
    const plan = planStart([live("L"), draft("A", ["Goal is required."]), draft("B")], [wire("A", "B"), wire("B", "L")]);
    expect(plan.creates.map((c) => c.id)).toEqual(["B"]);
    expect(plan.edges).toEqual([wire("B", "L")]);
    expect(plan.skipped).toEqual([{ id: "A", title: "A", problem: "Goal is required." }]);
  });

  it("with `only`, creates just those cards but still sends every wire that is ready", () => {
    const plan = planStart([live("L"), live("M"), draft("A"), draft("B")], [wire("A", "L"), wire("B", "L"), wire("L", "M")], ["A"]);
    expect(plan.creates.map((c) => c.id)).toEqual(["A"]);
    expect(plan.edges).toEqual([wire("A", "L"), wire("L", "M")]);
  });

  it("neither creates a starting card again nor counts it as ready", () => {
    const plan = planStart([starting("S"), draft("A")], [wire("S", "A")]);
    expect(plan.creates.map((c) => c.id)).toEqual(["A"]);
    expect(plan.edges).toEqual([]);
  });

  it("is empty when nothing is ready", () => {
    expect(planStart([live("L")], [])).toEqual({ creates: [], edges: [], skipped: [] });
  });
});
