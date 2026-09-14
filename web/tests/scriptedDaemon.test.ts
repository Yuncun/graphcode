import { describe, expect, it } from "vitest";
import { applyGraphCommand, REJECTED_TITLE, startScriptedDaemon } from "../e2e/fixture/scriptedDaemon.ts";
import { alphaGraph, EDGE, ID } from "../e2e/fixture/graph.ts";
import { DaemonClient } from "../server/daemonClient.ts";
import { waitFor } from "./fakeDaemon.ts";

const graph = () => alphaGraph("/tmp/alpha");

describe("applyGraphCommand", () => {
  it("creates a goal loop already running, with the draft's own id", () => {
    const next = applyGraphCommand(graph(), { createNode: { _0: { id: "N", title: "New", loopType: "goalBased", pausesBeforeWritesOnly: false, goal: { summary: "s" } } } });
    expect(typeof next).toBe("object");
    const g = next as ReturnType<typeof graph>;
    expect(g.revision).toBe(2);
    const node = g.nodes.find((n) => n.id === "N")!;
    expect(node.state).toEqual({ running: {} });
    expect(node.title).toBe("New");
  });

  it("creates every other type idle and falls back to NewNode for an empty title", () => {
    const g = applyGraphCommand(graph(), { createNode: { _0: { id: "N", title: "  ", loopType: "sketch", pausesBeforeWritesOnly: false } } }) as ReturnType<typeof graph>;
    expect(g.nodes.find((n) => n.id === "N")).toMatchObject({ title: "NewNode", state: { idle: {} } });
  });

  it("rejects the sentinel title with an error string", () => {
    expect(applyGraphCommand(graph(), { createNode: { _0: { id: "N", title: REJECTED_TITLE, loopType: "sketch", pausesBeforeWritesOnly: false } } })).toBe("scripted daemon: draft rejected");
  });

  it("creates an edge from the spec and refuses unknown nodes", () => {
    const g = applyGraphCommand(graph(), { createEdge: { from: ID.plan, to: ID.ci, spec: { kind: "message", condition: "always", payloadTransform: { none: {} } } } }) as ReturnType<typeof graph>;
    expect(g.edges).toHaveLength(8);
    expect(g.edges[7]).toMatchObject({ from: ID.plan, to: ID.ci, kind: "message", condition: "always", fireCount: 0 });
    expect(g.edges[7]!.id).toMatch(/^[0-9A-F-]{36}$/);
    expect(applyGraphCommand(graph(), { createEdge: { from: ID.plan, to: "nope", spec: { kind: "handoff", condition: "always", payloadTransform: { none: {} } } } })).toBe("scripted daemon: unknown node");
  });

  it("deletes a node together with every edge touching it", () => {
    const g = applyGraphCommand(graph(), { deleteNode: { _0: ID.build } }) as ReturnType<typeof graph>;
    expect(g.nodes.some((n) => n.id === ID.build)).toBe(false);
    expect(g.edges.map((e) => e.id)).not.toContain(EDGE.planToBuild);
    expect(g.edges.map((e) => e.id)).not.toContain(EDGE.buildToReview);
    expect(g.edges).toHaveLength(4);
  });

  it("deletes one edge, renames, stops, restarts and detaches", () => {
    let g = applyGraphCommand(graph(), { deleteEdge: { _0: EDGE.ciToShip } }) as ReturnType<typeof graph>;
    expect(g.edges).toHaveLength(6);
    g = applyGraphCommand(g, { renameNode: { _0: ID.plan, title: "Plan v2" } }) as ReturnType<typeof graph>;
    expect(g.nodes.find((n) => n.id === ID.plan)!.title).toBe("Plan v2");
    expect(applyGraphCommand(g, { renameNode: { _0: ID.plan, title: " " } })).toBe("scripted daemon: empty title refused");
    g = applyGraphCommand(g, { stopNode: { _0: ID.build } }) as ReturnType<typeof graph>;
    expect(g.nodes.find((n) => n.id === ID.build)!.state).toEqual({ stopped: {} });
    g = applyGraphCommand(g, { restartNode: { _0: ID.build } }) as ReturnType<typeof graph>;
    expect(g.nodes.find((n) => n.id === ID.build)!.state).toEqual({ running: {} });
    g = applyGraphCommand(g, { detachTemplate: { _0: ID.nightly } }) as ReturnType<typeof graph>;
    expect(g.nodes.find((n) => n.id === ID.nightly)!.templateFollow).toBeUndefined();
  });

  it("names a graph command it does not script", () => {
    expect(applyGraphCommand(graph(), { pilotComposite: { _0: ID.train } })).toBe("scripted daemon: unhandled graph command pilotComposite");
  });
});

describe("startScriptedDaemon over the socket", () => {
  it("answers restore, open, and a graph command, and reports an unknown project", async () => {
    const daemon = await startScriptedDaemon({ graphs: [graph()] });
    const client = new DaemonClient(daemon.path);
    const events: Record<string, unknown>[] = [];
    client.onEvent((e) => events.push(e as Record<string, unknown>));
    try {
      await client.connect();
      client.send({ restoreOpenProjects: {} });
      await waitFor(() => events.length === 1);
      expect(events[0]).toHaveProperty("graphChanged");
      client.send({ openProject: { path: "/nowhere" } });
      await waitFor(() => events.length === 2);
      expect(events[1]).toEqual({ errorOccurred: { _0: "no project at /nowhere" } });
      client.send({ graphCommand: { projectPath: "/tmp/alpha", command: { deleteEdge: { _0: EDGE.ciToShip } } } });
      await waitFor(() => events.length === 3);
      const changed = events[2] as { graphChanged: { _0: { revision: number; edges: unknown[] } } };
      expect(changed.graphChanged._0.revision).toBe(2);
      expect(changed.graphChanged._0.edges).toHaveLength(6);
      expect(daemon.received).toHaveLength(3);
    } finally {
      client.close();
      await daemon.close();
    }
  });
});
