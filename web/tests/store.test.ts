import { describe, expect, it } from "vitest";
import { createStore } from "../app/daemon/store.ts";
import type { LoopGraph, LoopNode } from "../app/daemon/protocol.ts";

const node = (id: string, title: string): LoopNode => ({
  id, title, loopType: "goalBased", state: { running: {} }, createdAt: 810996584.6, pausesBeforeWritesOnly: false, pilotState: "notPiloted",
});
const graph = (path: string, revision: number, nodes: LoopNode[]): LoopGraph => ({
  id: "G-" + path, revision, project: { path, name: path.split("/").pop() ?? path }, nodes, edges: [],
});

describe("store", () => {
  it("adds a project on graphChanged and keeps first-seen order", () => {
    const s = createStore();
    s.applyEvent({ graphChanged: { _0: graph("/p/b", 1, []) } });
    s.applyEvent({ graphChanged: { _0: graph("/p/a", 1, []) } });
    s.applyEvent({ graphChanged: { _0: graph("/p/b", 2, [node("N1", "one")]) } });
    expect(s.order).toEqual(["/p/b", "/p/a"]);
    expect(s.projects.get("/p/b")?.revision).toBe(2);
    expect(s.projects.get("/p/b")?.nodes[0]?.title).toBe("one");
  });

  it("patches nodes from nodesChanged only when the revision is not older", () => {
    const s = createStore();
    s.applyEvent({ graphChanged: { _0: graph("/p/a", 5, [node("N1", "old"), node("N2", "two")]) } });
    s.applyEvent({ nodesChanged: { projectPath: "/p/a", revision: 4, nodes: [node("N1", "stale")] } });
    expect(s.projects.get("/p/a")?.nodes[0]?.title).toBe("old");
    s.applyEvent({ nodesChanged: { projectPath: "/p/a", revision: 6, nodes: [node("N1", "new")] } });
    expect(s.projects.get("/p/a")?.nodes.map((n) => n.title)).toEqual(["new", "two"]);
    expect(s.projects.get("/p/a")?.revision).toBe(6);
  });

  it("applies nodesChanged to a graph that arrived without a revision", () => {
    const s = createStore();
    const withoutRevision: LoopGraph = { id: "G", project: { path: "/p/a", name: "a" }, nodes: [node("N1", "old")], edges: [] };
    s.applyEvent({ graphChanged: { _0: withoutRevision } });
    s.applyEvent({ nodesChanged: { projectPath: "/p/a", revision: 1, nodes: [node("N1", "new")] } });
    expect(s.projects.get("/p/a")?.nodes[0]?.title).toBe("new");
  });

  it("keeps only the 50 newest errors", () => {
    const s = createStore();
    for (let i = 0; i < 60; i++) s.applyEvent({ errorOccurred: { _0: `boom ${i}` } });
    expect(s.errors).toHaveLength(50);
    expect(s.errors[0]).toBe("boom 10");
    expect(s.errors[49]).toBe("boom 59");
  });

  it("records recent projects and errors", () => {
    const s = createStore();
    s.applyEvent({ recentProjectsListed: { _0: [{ path: "/p/a", name: "a", lastOpenedAt: 1 }] } });
    s.applyEvent({ errorOccurred: { _0: "boom" } });
    expect(s.recent[0]?.name).toBe("a");
    expect(s.errors).toEqual(["boom"]);
  });
});
