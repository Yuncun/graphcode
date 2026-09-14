import type { EdgeCondition, EdgeKind, LoopGraph, LoopNode, LoopStateName } from "../daemon/protocol.ts";
import { LOOP_TYPE_LABEL, stateName } from "../daemon/protocol.ts";
import { ageLabel } from "../canvas/time.ts";

export interface Field { label: string; value: string }

/** The loop's brief as label and value rows, only the fields it has. */
export function fieldsFor(node: LoopNode): Field[] {
  const fields: Field[] = [
    { label: "Type", value: LOOP_TYPE_LABEL[node.loopType] ?? node.loopType },
    { label: "State", value: stateName(node) },
  ];
  const add = (label: string, value: string | number | undefined) => { if (value !== undefined && value !== "") fields.push({ label, value: String(value) }); };
  add("Backend", node.backend);
  add("Model", node.modelTier);
  add("Goal", node.goal?.summary);
  add("Done when", node.goal?.predicate);
  add("Prompt", node.triggerPrompt);
  add("Every", node.heartbeatIntervalSeconds ? `${node.heartbeatIntervalSeconds} s` : undefined);
  add("First instruction", node.firstInstruction);
  add("Check", node.checkDescription);
  add("Stalled because", node.stallReason);
  add("Created", ageLabel(node.createdAt));
  if (node.templateFollow) add("Template", "followed");
  else if (node.createdFromTemplateID) add("Template", "snapshot");
  return fields;
}

export interface EdgeRow { id: string; direction: "in" | "out"; kind: EdgeKind; condition: EdgeCondition; other: string }

export function edgesFor(graph: LoopGraph, nodeID: string): EdgeRow[] {
  const titles = new Map(graph.nodes.map((n) => [n.id, n.title]));
  return graph.edges
    .filter((e) => e.from === nodeID || e.to === nodeID)
    .map((e) => {
      const direction = e.from === nodeID ? "out" : "in";
      const otherID = direction === "out" ? e.to : e.from;
      return { id: e.id, direction, kind: e.kind, condition: e.condition, other: titles.get(otherID) ?? otherID };
    });
}

const STOPPABLE: readonly LoopStateName[] = ["running", "awaitingInput", "blocked", "stalled", "waiting"];

/** `stopNode` resolves an unresolved loop; a loop that is idle, done, failed or already stopped has nothing to stop. */
export function canStop(node: LoopNode): boolean {
  return STOPPABLE.includes(stateName(node));
}

export function canDetach(node: LoopNode): boolean {
  return node.templateFollow != null;
}
