import { reactive } from "vue";
import type { DaemonEvent, LoopGraph, ProjectRef } from "./protocol.ts";

export interface Store {
  projects: Map<string, LoopGraph>;
  order: string[];
  recent: ProjectRef[];
  errors: string[];
  applyEvent(event: DaemonEvent): void;
}

export function createStore(): Store {
  const store: Store = reactive({
    projects: new Map<string, LoopGraph>(),
    order: [],
    recent: [],
    errors: [],
    applyEvent(event: DaemonEvent) {
      if ("graphChanged" in event) {
        const graph = event.graphChanged._0;
        if (!store.order.includes(graph.project.path)) store.order.push(graph.project.path);
        store.projects.set(graph.project.path, graph);
      } else if ("nodesChanged" in event) {
        const { projectPath, revision, nodes } = event.nodesChanged;
        const graph = store.projects.get(projectPath);
        if (!graph || revision < graph.revision) return;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        store.projects.set(projectPath, {
          ...graph,
          revision,
          nodes: graph.nodes.map((n) => byId.get(n.id) ?? n),
        });
      } else if ("recentProjectsListed" in event) {
        store.recent = event.recentProjectsListed._0;
      } else if ("errorOccurred" in event) {
        store.errors.push(event.errorOccurred._0);
      }
    },
  });
  return store;
}
