import { describe, expect, it } from "vitest";
import { canDetach, canStop, edgesFor, fieldsFor } from "../app/inspector/model.ts";
import { alphaGraph, ID } from "../e2e/fixture/graph.ts";

const graph = alphaGraph("/tmp/alpha");
const find = (id: string) => graph.nodes.find((n) => n.id === id)!;

describe("fieldsFor", () => {
  it("lists a goal loop's type, state, backend, model, goal and predicate, then when it was created", () => {
    const labels = fieldsFor(find(ID.build)).map((f) => f.label);
    expect(labels).toEqual(["Type", "State", "Backend", "Model", "Goal", "Done when", "Created"]);
    const values = Object.fromEntries(fieldsFor(find(ID.build)).map((f) => [f.label, f.value]));
    expect(values.Type).toBe("Goal");
    expect(values.State).toBe("running");
    expect(values["Done when"]).toBe("pnpm test");
    // ageLabel writes "2h 0m" for the fixture's two-hour-old loops (web/app/canvas/time.ts).
    expect(values.Created).toMatch(/^\d+h \d+m$/);
  });

  it("shows a timed loop's prompt, a turn loop's instruction and check, a stall reason, and the template relation", () => {
    expect(fieldsFor(find(ID.ci)).map((f) => f.label)).toContain("Prompt");
    const docs = Object.fromEntries(fieldsFor(find(ID.docs)).map((f) => [f.label, f.value]));
    expect(docs["First instruction"]).toBe("Update the docs for the new flag");
    expect(docs.Check).toBe("Each page renders");
    expect(docs["Stalled because"]).toBe("no output for 12 minutes");
    expect(Object.fromEntries(fieldsFor(find(ID.nightly)).map((f) => [f.label, f.value])).Template).toBe("followed");
    expect(fieldsFor(find(ID.plan)).map((f) => f.label)).not.toContain("Template");
    expect(Object.fromEntries(fieldsFor({ ...find(ID.plan), createdFromTemplateID: "T" }).map((f) => [f.label, f.value])).Template).toBe("snapshot");
  });
});

describe("edgesFor", () => {
  it("lists a node's edges in graph order with direction, kind, condition and the other card's title", () => {
    expect(edgesFor(graph, ID.build)).toEqual([
      { id: "E0000000-0000-4000-8000-000000000001", direction: "in", kind: "handoff", condition: "always", other: "Plan the release" },
      { id: "E0000000-0000-4000-8000-000000000002", direction: "out", kind: "handoff", condition: "onSuccess", other: "Review the branch" },
      { id: "E0000000-0000-4000-8000-000000000003", direction: "out", kind: "handoff", condition: "onFailure", other: "Flaky suite" },
    ]);
    expect(edgesFor(graph, "nobody")).toEqual([]);
  });

  it("falls back to the id when the other node is missing from the graph", () => {
    const g = { ...graph, edges: [{ id: "X", from: ID.build, to: "gone", kind: "message" as const, condition: "always" as const, fireCount: 0 }] };
    expect(edgesFor(g, ID.build)[0]!.other).toBe("gone");
  });
});

describe("canStop / canDetach", () => {
  it("allows Stop only while the loop is unresolved and running in some sense", () => {
    expect(canStop(find(ID.build))).toBe(true);
    expect(canStop(find(ID.review))).toBe(true);
    expect(canStop(find(ID.ci))).toBe(true);
    expect(canStop(find(ID.docs))).toBe(true);
    expect(canStop(find(ID.nightly))).toBe(true);
    expect(canStop(find(ID.plan))).toBe(false);
    expect(canStop(find(ID.ship))).toBe(false);
    expect(canStop(find(ID.flaky))).toBe(false);
    expect(canStop(find(ID.train))).toBe(false);
  });

  it("allows Detach only for a loop that follows a template", () => {
    expect(canDetach(find(ID.nightly))).toBe(true);
    expect(canDetach(find(ID.plan))).toBe(false);
  });
});
