import type { EdgeRecord } from "../canvas/document.ts";
import type { NodeDraft } from "../daemon/protocol.ts";

/** A card as Start sees it. `draft()` is only called on a draft with no problems. */
export interface StartCard { id: string; mode: "draft" | "starting" | "live"; title: string; problems: string[]; draft(): NodeDraft }

export interface StartPlan {
  creates: Array<{ id: string; draft: NodeDraft }>;
  edges: EdgeRecord[];
  skipped: Array<{ id: string; title: string; problem: string }>;
}

/**
 * What Start sends, in order: `createNode` for each chosen draft that has no problems, then
 * `createEdge` for each draft wire whose two ends are live already or among those creates. A wire
 * with an end that is a draft not being started, or skipped, waits for that card's own Start; a wire
 * with an end still starting waits for the daemon's answer.
 */
export function planStart(cards: StartCard[], wires: EdgeRecord[], only?: string[]): StartPlan {
  const plan: StartPlan = { creates: [], edges: [], skipped: [] };
  for (const card of cards) {
    if (card.mode !== "draft" || (only && !only.includes(card.id))) continue;
    if (card.problems.length) {
      plan.skipped.push({ id: card.id, title: card.title, problem: card.problems[0]! });
      continue;
    }
    plan.creates.push({ id: card.id, draft: card.draft() });
  }
  const ready = new Set([...cards.filter((c) => c.mode === "live").map((c) => c.id), ...plan.creates.map((c) => c.id)]);
  plan.edges = wires.filter((w) => ready.has(w.from) && ready.has(w.to)).map((w) => ({ ...w }));
  return plan;
}
