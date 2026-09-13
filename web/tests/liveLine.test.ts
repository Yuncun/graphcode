import { describe, expect, it } from "vitest";
import { liveLine } from "../app/canvas/liveLine.ts";
import type { LoopNode } from "../app/daemon/protocol.ts";

const base: LoopNode = { id: "N", title: "t", loopType: "goalBased", state: { idle: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted" };

describe("liveLine", () => {
  it("prefers the stall reason", () => {
    expect(liveLine({ ...base, stallReason: "no predicate", activity: "working" })).toBe("no predicate");
  });
  it("then the newest summary beat, whichever shape the summary takes", () => {
    expect(liveLine({ ...base, summary: { text: "beat A" }, activity: "working" })).toBe("beat A");
    expect(liveLine({ ...base, summary: { latest: { text: "beat B" } } })).toBe("beat B");
    expect(liveLine({ ...base, summary: { beats: [{ text: "old" }, { text: "beat C" }] } })).toBe("beat C");
  });
  it("then activity, then empty", () => {
    expect(liveLine({ ...base, activity: "running tests" })).toBe("running tests");
    expect(liveLine(base)).toBe("");
  });
});
