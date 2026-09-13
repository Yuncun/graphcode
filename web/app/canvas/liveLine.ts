import type { LoopNode } from "../daemon/protocol.ts";

function summaryText(summary: unknown): string {
  if (!summary || typeof summary !== "object") return "";
  const s = summary as { text?: unknown; latest?: { text?: unknown }; beats?: Array<{ text?: unknown }> };
  if (typeof s.text === "string") return s.text;
  if (typeof s.latest?.text === "string") return s.latest.text;
  const last = s.beats?.[s.beats.length - 1];
  return typeof last?.text === "string" ? last.text : "";
}

/** Same priority as the Swift app's LoopCardPresentation: stall reason, summary beat, activity. */
export function liveLine(node: LoopNode): string {
  return node.stallReason || summaryText(node.summary) || node.activity || "";
}
