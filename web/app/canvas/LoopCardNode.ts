import { LGraphBadge, LGraphNode, LiteGraph } from "@comfyorg/litegraph";
import type { LoopNode, LoopStateName, LoopType } from "../daemon/protocol.ts";
import { stateName } from "../daemon/protocol.ts";
import { ageLabel } from "./time.ts";
import { liveLine } from "./liveLine.ts";

export const CARD_SIZE: [number, number] = [250, 106];

const typeLabel: Record<LoopType, string> = { sketch: "Main", goalBased: "Goal", timeBased: "Timed", turnBased: "Turn", proactive: "Composite" };
const typeColor: Record<LoopType, string> = { sketch: "#8a8f99", goalBased: "#2f8f6b", timeBased: "#b8860b", turnBased: "#8a5cc7", proactive: "#3b7dd8" };
const stateColor: Record<LoopStateName, string> = {
  idle: "#6b7079", running: "#3b82f6", awaitingInput: "#f59e0b", blocked: "#f59e0b", succeeded: "#22c55e",
  failed: "#ef4444", stalled: "#f59e0b", waiting: "#6b7079", stopped: "#6b7079",
};
const stateWord: Record<LoopStateName, string> = {
  idle: "IDLE", running: "RUNNING", awaitingInput: "NEEDS YOU", blocked: "BLOCKED", succeeded: "DONE",
  failed: "FAILED", stalled: "STALLED", waiting: "WAITING", stopped: "STOPPED",
};

/** One GraphCode loop drawn as a card: title bar in the type colour, state badge, live line, meta row. */
export class LoopCardNode extends LGraphNode {
  static override title = "Loop";
  loop: LoopNode | null = null;
  private live = "";
  private meta = "";

  constructor(title = "Loop") {
    super(title, "graphcode/loop");
    this.size = [...CARD_SIZE];
    this.resizable = false;
    this.addOutput("handoff", "handoff");
    this.addOutput("message", "message");
    this.addOutput("spawn", "spawn");
  }

  apply(node: LoopNode): void {
    this.loop = node;
    this.title = node.title;
    this.color = typeColor[node.loopType] ?? typeColor.sketch;
    this.bgcolor = "#23262c";
    const state = stateName(node);
    this.badges = [new LGraphBadge({ text: stateWord[state] ?? state, bgColor: stateColor[state] ?? "#6b7079", fgColor: "#ffffff" })];
    this.live = liveLine(node);
    this.meta = `${typeLabel[node.loopType] ?? node.loopType} · ${ageLabel(node.createdAt)}${node.modelTier ? " · " + node.modelTier : ""}`;
    this.setDirtyCanvas(true, true);
  }

  override onDrawForeground(ctx: CanvasRenderingContext2D): void {
    if (this.flags.collapsed) return;
    const pad = 12;
    const width = this.size[0] - pad * 2;
    ctx.save();
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "#c8cbd0";
    ctx.textBaseline = "top";
    ctx.fillText(truncate(ctx, this.live, width), pad, 12);
    ctx.fillStyle = "#8b909a";
    ctx.fillText(truncate(ctx, this.meta, width), pad, this.size[1] - 22);
    ctx.restore();
  }
}

function truncate(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut + "…";
}

export function registerLoopCardNode(): void {
  if (!LiteGraph.registered_node_types["graphcode/loop"]) LiteGraph.registerNodeType("graphcode/loop", LoopCardNode);
}
