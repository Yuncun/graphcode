import type { LoopGraph } from "../daemon/protocol.ts";
import { documentKey, type WorkflowDocument } from "../../shared/workflowDocument.ts";

/** A workflow owns its saved node IDs, not every loop running in its chosen folder. */
export function graphForDocument(document: WorkflowDocument, project: LoopGraph | null): LoopGraph | null {
  if (document.project && project?.project.path !== document.project) return null;
  const source = document.project ? project : null;
  const owned = new Set(Object.keys(document.canvas.nodes));
  return {
    ...(source ?? {}),
    id: document.id,
    project: { path: documentKey(document.id), name: document.name },
    nodes: source?.nodes.filter((node) => owned.has(node.id)) ?? [],
    edges: source?.edges.filter((edge) => owned.has(edge.from) && owned.has(edge.to)) ?? [],
  };
}
