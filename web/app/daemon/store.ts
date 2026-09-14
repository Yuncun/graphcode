import { reactive } from "vue";
import type { DaemonEvent, LoopGraph, ProjectRef } from "./protocol.ts";

export interface Store {
  projects: Map<string, LoopGraph>;
  order: string[];
  recent: ProjectRef[];
  errors: string[];
  pushError(message: string): void;
  applyEvent(event: DaemonEvent): void;
}

/**
 * With the daemon down the page appends a line every couple of seconds for as long as the tab
 * is open, and only the newest is ever shown, so the list keeps the newest this many.
 */
const MAX_ERRORS = 50;

export function createStore(): Store {
  const store: Store = reactive({
    projects: new Map<string, LoopGraph>(),
    order: [],
    recent: [],
    errors: [],
    pushError(message: string) {
      store.errors.push(message);
      if (store.errors.length > MAX_ERRORS) store.errors.splice(0, store.errors.length - MAX_ERRORS);
    },
    applyEvent(event: DaemonEvent) {
      if ("graphChanged" in event) {
        const graph = event.graphChanged._0;
        if (!store.order.includes(graph.project.path)) store.order.push(graph.project.path);
        store.projects.set(graph.project.path, graph);
      } else if ("nodesChanged" in event) {
        const { projectPath, revision, nodes } = event.nodesChanged;
        const graph = store.projects.get(projectPath);
        // The daemon's LoopGraph.revision is optional, and without one there is nothing to
        // order the update against, so it always applies.
        if (!graph || (graph.revision !== undefined && revision < graph.revision)) return;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        store.projects.set(projectPath, {
          ...graph,
          revision,
          nodes: graph.nodes.map((n) => byId.get(n.id) ?? n),
        });
      } else if ("recentProjectsListed" in event) {
        store.recent = event.recentProjectsListed._0;
      } else if ("errorOccurred" in event) {
        store.pushError(event.errorOccurred._0);
      }
    },
  });
  return store;
}
