import type { LoopNode } from "../daemon/protocol.ts";

function summaryText(summary: unknown): string {
  if (!summary || typeof summary !== "object") return "";
  const s = summary as { text?: unknown; latest?: { text?: unknown }; beats?: Array<{ text?: unknown }> };
  if (typeof s.text === "string") return s.text;
  if (typeof s.latest?.text === "string") return s.latest.text;
  const last = s.beats?.[s.beats.length - 1];
  return typeof last?.text === "string" ? last.text : "";
}

/**
 * The one line of live text on a card: the stall reason the daemon set, else the latest summary
 * beat, else the current activity. The Swift app's LoopCardPresentation is not this. It shows a
 * stall reason only while the loop is actually stalled, and where this returns nothing it falls
 * back to what the loop was handed: the goal summary, the trigger prompt, or the first
 * instruction. Phase 0 asked for the simpler line.
 */
export function liveLine(node: LoopNode): string {
  return node.stallReason || summaryText(node.summary) || node.activity || "";
}
