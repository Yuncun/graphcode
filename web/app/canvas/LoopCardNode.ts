import { LGraphBadge, LGraphNode, LiteGraph, type Size } from "@comfyorg/litegraph";
import type { EdgeCondition, EdgeKind, LoopNode, LoopStateName, LoopType } from "../daemon/protocol.ts";
import { LOOP_TYPE_LABEL, stateName } from "../daemon/protocol.ts";
import { ageLabel } from "./time.ts";
import { liveLine } from "./liveLine.ts";

export const CARD_WIDTH = 300;
/** Height under the slot rows for the live line and the meta row. */
export const TEXT_BLOCK = 52;

export interface OutputSlotDef { name: string; kind: EdgeKind; condition: EdgeCondition }

/** The card's outputs in slot order. A drag from one of them makes an edge of that kind and condition. */
export const OUTPUT_SLOTS: readonly OutputSlotDef[] = [
  { name: "handoff", kind: "handoff", condition: "always" },
  { name: "on success", kind: "handoff", condition: "onSuccess" },
  { name: "on failure", kind: "handoff", condition: "onFailure" },
  { name: "message", kind: "message", condition: "always" },
  { name: "spawn", kind: "spawn", condition: "always" },
];

/** The output slot that draws an edge of this kind and condition. Message and spawn have one slot each, whatever the condition. */
export function outputSlotFor(kind: EdgeKind, condition: EdgeCondition): number {
  const index = OUTPUT_SLOTS.findIndex((s) => s.kind === kind && (kind !== "handoff" || s.condition === condition));
  return index === -1 ? 0 : index;
}

/** litegraph draws slot i at (i + 0.7) × NODE_SLOT_HEIGHT; the text block sits under the longer slot column. */
export function cardHeight(inputCount: number): number {
  return LiteGraph.NODE_SLOT_HEIGHT * Math.max(OUTPUT_SLOTS.length, inputCount) + TEXT_BLOCK;
}

const typeColor: Record<LoopType, string> = { sketch: "#8a8f99", goalBased: "#2f8f6b", timeBased: "#b8860b", turnBased: "#8a5cc7", proactive: "#3b7dd8" };
const stateColor: Record<LoopStateName, string> = {
  idle: "#6b7079", running: "#3b82f6", awaitingInput: "#f59e0b", blocked: "#f59e0b", succeeded: "#22c55e",
  failed: "#ef4444", stalled: "#f59e0b", waiting: "#6b7079", stopped: "#6b7079",
};
const stateWord: Record<LoopStateName, string> = {
  idle: "IDLE", running: "RUNNING", awaitingInput: "NEEDS YOU", blocked: "BLOCKED", succeeded: "DONE",
  failed: "FAILED", stalled: "STALLED", waiting: "WAITING", stopped: "STOPPED",
};

/**
 * litegraph asks both nodes before it makes any connection, and it uses that one path for a
 * user dragging one slot onto another as well as for the adapter drawing the daemon's edges.
 * Phase 0 never writes back to the daemon, so a link a user drew would be an edge the canvas
 * shows and the daemon does not have. Only the adapter may connect, and it says so by putting
 * its own `connect` call inside `connectAsAdapter`.
 */
let adapterIsConnecting = false;

export function connectAsAdapter<T>(connect: () => T): T {
  adapterIsConnecting = true;
  try {
    return connect();
  } finally {
    adapterIsConnecting = false;
  }
}

/** One GraphCode loop drawn as a card: title bar in the type colour, state badge, live line, meta row. */
export class LoopCardNode extends LGraphNode {
  static override title = "Loop";
  /** litegraph reads this static for the title text (`this.constructor.title_text_color`); its default grey is faint on the type-coloured title bar. Not declared on LGraphNode, so no `override`. */
  static title_text_color = "#ffffff";
  loop: LoopNode | null = null;
  private live = "";
  private meta = "";
  private liveCache: TruncateCache | undefined;
  private metaCache: TruncateCache | undefined;

  constructor(title = "Loop") {
    super(title, "graphcode/loop");
    this.resizable = false;
    // The daemon owns the graph. A card cannot be deleted by litegraph (Delete key, node menu) nor
    // copied, cloned or pasted: the inspector's Delete sends `deleteNode` instead.
    this.block_delete = true;
    this.clonable = false;
    for (const slot of OUTPUT_SLOTS) this.addOutput(slot.name, slot.kind);
    this.setSize(this.computeSize());
  }

  /**
   * litegraph calls this whenever it may grow the node (`addInput` → `expandToFitContent`), so the
   * card's size follows one rule everywhere: the taller slot column plus the text block.
   */
  override computeSize(): Size {
    return [CARD_WIDTH, cardHeight(this.inputs?.length ?? 0)];
  }

  apply(node: LoopNode): void {
    this.loop = node;
    this.title = node.title;
    this.color = typeColor[node.loopType] ?? typeColor.sketch;
    this.bgcolor = "#23262c";
    const state = stateName(node);
    this.badges = [new LGraphBadge({ text: stateWord[state] ?? state, bgColor: stateColor[state] ?? "#6b7079", fgColor: "#ffffff" })];
    this.live = liveLine(node);
    this.meta = `${LOOP_TYPE_LABEL[node.loopType] ?? node.loopType} · ${ageLabel(node.createdAt)}${node.modelTier ? " · " + node.modelTier : ""}`;
    this.setDirtyCanvas(true, true);
  }

  override onConnectInput(): boolean {
    return adapterIsConnecting;
  }

  override onConnectOutput(): boolean {
    return adapterIsConnecting;
  }

  override onDrawForeground(ctx: CanvasRenderingContext2D): void {
    if (this.flags.collapsed) return;
    const pad = 12;
    const width = this.size[0] - pad * 2;
    const rows = Math.max(OUTPUT_SLOTS.length, this.inputs.length);
    const textTop = LiteGraph.NODE_SLOT_HEIGHT * rows + 6;
    ctx.save();
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "#c8cbd0";
    ctx.textBaseline = "top";
    this.liveCache = cachedTruncate(this.liveCache, ctx, this.live, width);
    ctx.fillText(this.liveCache.result, pad, textTop);
    ctx.fillStyle = "#8b909a";
    this.metaCache = cachedTruncate(this.metaCache, ctx, this.meta, width);
    ctx.fillText(this.metaCache.result, pad, this.size[1] - 20);
    ctx.restore();
  }
}

const TRUNCATE_INPUT_CAP = 200;

export interface TruncateCache { text: string; width: number; result: string }

function truncate(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut + "…";
}

/**
 * Truncates `text` to fit `width`, reusing `prev` when the (capped) text and width are unchanged.
 * `onDrawForeground` runs every frame, and the character-by-character measurement in `truncate`
 * is expensive on a long string, so this keeps it to one measurement pass per distinct (text, width).
 */
export function cachedTruncate(prev: TruncateCache | undefined, ctx: CanvasRenderingContext2D, text: string, width: number): TruncateCache {
  const capped = text.length > TRUNCATE_INPUT_CAP ? text.slice(0, TRUNCATE_INPUT_CAP) : text;
  if (prev && prev.text === capped && prev.width === width) return prev;
  return { text: capped, width, result: truncate(ctx, capped, width) };
}

export function registerLoopCardNode(): void {
  if (!LiteGraph.registered_node_types["graphcode/loop"]) LiteGraph.registerNodeType("graphcode/loop", LoopCardNode);
}
