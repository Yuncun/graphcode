import { describe, expect, it } from "vitest";
import { mergeReserved, RESERVE_TTL_MS, type Reservation } from "../app/canvas/reserved.ts";

const doc = () => ({ version: 1 as const, nodes: { A: { pos: [1, 2] as [number, number] } } });

describe("mergeReserved", () => {
  it("writes a live reservation, forgets one whose card exists, drops one that expired", () => {
    const now = 1_000_000;
    const pending = new Map<string, Reservation>([
      ["A", { pos: [9, 9], at: now }],
      ["B", { pos: [30, 40], at: now - 10 }],
      ["C", { pos: [50, 60], at: now - RESERVE_TTL_MS - 1 }],
    ]);
    const out = mergeReserved(doc(), pending, now);
    expect(out.nodes).toEqual({ A: { pos: [1, 2] }, B: { pos: [30, 40] } });
    expect([...pending.keys()]).toEqual(["B"]);
  });

  it("is a no-op with nothing pending", () => {
    const pending = new Map<string, Reservation>();
    expect(mergeReserved(doc(), pending).nodes).toEqual({ A: { pos: [1, 2] } });
  });
});
