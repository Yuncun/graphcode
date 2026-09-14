import { randomUUID } from "node:crypto";
import type { LoopGraph, LoopNode, ProjectRef } from "../../app/daemon/protocol.ts";
import { startFakeDaemon, type FakeDaemon } from "../../tests/fakeDaemon.ts";
import { appleNow } from "./graph.ts";

export interface ScriptedDaemonOptions {
  graphs: LoopGraph[];
  /** Project paths reported by `restoreOpenProjects`. Default: every graph. */
  open?: string[];
  /** Answer to `listRecentProjects`. Default: every graph's project. */
  recents?: ProjectRef[];
}

export interface ScriptedDaemon extends FakeDaemon {
  graphs: Map<string, LoopGraph>;
  open: Set<string>;
}

/** A draft with this title is refused, so a test can see the app handle a daemon error on create. */
export const REJECTED_TITLE = "reject me";

type Body = Record<string, any>;

function head(command: unknown): [string, Body] {
  const entries = Object.entries(command as Record<string, Body>);
  return entries[0] ?? ["", {}];
}

/**
 * The daemon's graph commands, scripted just far enough for the UI matrix: each returns the next
 * graph with the revision bumped, or the error text the daemon should send back.
 */
export function applyGraphCommand(graph: LoopGraph, command: Body): LoopGraph | string {
  const [name, body] = head(command);
  const revision = (graph.revision ?? 0) + 1;
  const has = (id: string) => graph.nodes.some((n) => n.id === id);
  const next = (nodes: LoopNode[], edges = graph.edges): LoopGraph => ({ ...graph, revision, nodes, edges });
  const setState = (id: string, state: string) => next(graph.nodes.map((n) => (n.id === id ? { ...n, state: { [state]: {} } } : n)));
  switch (name) {
    case "createNode": {
      const d = body._0;
      if (d.title === REJECTED_TITLE) return "scripted daemon: draft rejected";
      const node: LoopNode = {
        id: d.id,
        title: typeof d.title === "string" && d.title.trim() ? d.title : "NewNode",
        loopType: d.loopType,
        state: d.loopType === "goalBased" ? { running: {} } : { idle: {} },
        createdAt: appleNow(),
        pausesBeforeWritesOnly: d.pausesBeforeWritesOnly ?? false,
        pilotState: "notPiloted",
        backend: d.backend ?? "claudeCode",
        modelTier: d.modelTier,
        goal: d.goal,
        triggerPrompt: d.triggerPrompt,
        firstInstruction: d.firstInstruction,
        checkDescription: d.checkDescription,
      };
      return next([...graph.nodes, node]);
    }
    case "createEdge": {
      const { from, to, spec } = body;
      if (!has(from) || !has(to)) return "scripted daemon: unknown node";
      return next(graph.nodes, [...graph.edges, { id: randomUUID().toUpperCase(), from, to, kind: spec.kind, condition: spec.condition, fireCount: 0 }]);
    }
    case "deleteNode": {
      const id = body._0;
      return next(graph.nodes.filter((n) => n.id !== id), graph.edges.filter((e) => e.from !== id && e.to !== id));
    }
    case "deleteEdge":
      return next(graph.nodes, graph.edges.filter((e) => e.id !== body._0));
    case "renameNode": {
      if (typeof body.title !== "string" || !body.title.trim()) return "scripted daemon: empty title refused";
      return next(graph.nodes.map((n) => (n.id === body._0 ? { ...n, title: body.title } : n)));
    }
    case "stopNode": return setState(body._0, "stopped");
    case "restartNode": return setState(body._0, "running");
    case "detachTemplate":
      return next(graph.nodes.map((n) => (n.id === body._0 ? { ...n, templateFollow: undefined } : n)));
    default:
      return `scripted daemon: unhandled graph command ${name}`;
  }
}

export async function startScriptedDaemon(options: ScriptedDaemonOptions): Promise<ScriptedDaemon> {
  const graphs = new Map(options.graphs.map((g) => [g.project.path, g]));
  const open = new Set(options.open ?? [...graphs.keys()]);
  const recents = options.recents ?? [...graphs.values()].map((g) => g.project);
  let daemon: FakeDaemon | undefined;
  const handle = (command: unknown, reply: (event: unknown) => void) => {
    const [name, body] = head(command);
    switch (name) {
      case "announce": return;
      case "listRecentProjects": reply({ recentProjectsListed: { _0: recents } }); return;
      case "restoreOpenProjects": for (const p of open) reply({ graphChanged: { _0: graphs.get(p) } }); return;
      case "openProject": {
        const g = graphs.get(body.path);
        if (!g) { reply({ errorOccurred: { _0: `no project at ${body.path}` } }); return; }
        open.add(body.path);
        reply({ graphChanged: { _0: g } });
        return;
      }
      case "closeProject": open.delete(body.path); return;
      case "graphCommand": {
        const g = graphs.get(body.projectPath);
        if (!g) { reply({ errorOccurred: { _0: `no project at ${body.projectPath}` } }); return; }
        const result = applyGraphCommand(g, body.command);
        if (typeof result === "string") { reply({ errorOccurred: { _0: result } }); return; }
        graphs.set(body.projectPath, result);
        // The real daemon tells every joined client; the fixture tells every client.
        daemon?.send({ graphChanged: { _0: result } });
        return;
      }
      default: reply({ errorOccurred: { _0: `scripted daemon: unhandled command ${name}` } });
    }
  };
  daemon = await startFakeDaemon({ onCommand: handle });
  return Object.assign(daemon, { graphs, open });
}
