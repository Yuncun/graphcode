import type { CanvasDoc } from "./document.ts";

export interface Reservation { pos: [number, number]; at: number }

/** How long a reserved position waits for its card. A draft the daemon refused never gets one, and its entry must not live in canvas.json for good. */
export const RESERVE_TTL_MS = 60_000;

/**
 * Folds pending reservations into a layout about to be saved: a reservation whose card now exists is
 * forgotten (the card's own position wins), a live one is written under its id, an expired one is dropped.
 * Mutates `pending`; returns `doc`.
 */
export function mergeReserved(doc: CanvasDoc, pending: Map<string, Reservation>, now = Date.now()): CanvasDoc {
  for (const [id, r] of pending) {
    if (doc.nodes[id] || now - r.at > RESERVE_TTL_MS) pending.delete(id);
    else doc.nodes[id] = { pos: r.pos };
  }
  return doc;
}
