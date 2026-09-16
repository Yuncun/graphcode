import type { LGraphNode } from "@comfyorg/litegraph";
import type { EdgeCondition, EdgeKind } from "../daemon/protocol.ts";
import { LoopCardNode } from "./LoopCardNode.ts";

export interface LinkRequest { from: string; to: string; kind: EdgeKind; condition: EdgeCondition }

/** The parts of litegraph's render links this reads; a drag that started at an output has `toType: "input"`. */
export interface DraggedLink { node: LGraphNode; fromSlotIndex?: number; toType: string }

/**
 * A link dropped on a card's body, read off litegraph's link connector before it connects anything:
 * the source card and output slot say which edge kind and condition the user asked for.
 */
export function linkRequestFrom(renderLinks: ReadonlyArray<DraggedLink>, target: LGraphNode): LinkRequest | null {
  const link = renderLinks[0];
  if (!link || link.toType !== "input" || typeof link.fromSlotIndex !== "number") return null;
  if (link.node === target) return null;
  const slot = link.node instanceof LoopCardNode ? link.node.outputDefinition(link.fromSlotIndex) : undefined;
  if (!slot) return null;
  return { from: String(link.node.id), to: String(target.id), kind: slot.kind, condition: slot.condition };
}
