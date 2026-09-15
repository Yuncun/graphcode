import { describe, expect, it } from "vitest";
import { buildDraft, DEFAULT_GOAL, draftProblems, newNodeID } from "../app/nodes/draft.ts";
import type { NodeTypeDef } from "../app/nodes/registry.ts";

const def = (toDraft: NodeTypeDef["toDraft"]): NodeTypeDef => ({ type: "t/t", title: "T", category: "t", description: "", inputs: [], outputs: [], widgets: [], toDraft });

describe("newNodeID", () => {
  it("is an upper-case UUID, the form Foundation writes", () => {
    const id = newNodeID();
    expect(id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    expect(newNodeID()).not.toBe(id);
  });
});

describe("buildDraft", () => {
  it("completes a goal draft: id, trimmed title, pausesBeforeWritesOnly, and the full GoalSpec", () => {
    const d = buildDraft(def(() => ({ loopType: "goalBased", modelTier: "fast", goal: { summary: "s", predicate: undefined } as never })), {}, "  Title ", "ID-1");
    expect(d).toEqual({ id: "ID-1", title: "Title", loopType: "goalBased", pausesBeforeWritesOnly: false, modelTier: "fast", goal: { summary: "s", ...DEFAULT_GOAL } });
  });

  it("drops undefined fields so the JSON stays minimal, and keeps pausesBeforeWritesOnly when the type sets it", () => {
    const d = buildDraft(def(() => ({ loopType: "turnBased", firstInstruction: "go", checkDescription: undefined, pausesBeforeWritesOnly: true })), {}, "", "ID-2");
    expect(d).toEqual({ id: "ID-2", title: "", loopType: "turnBased", firstInstruction: "go", pausesBeforeWritesOnly: true });
    expect("checkDescription" in d).toBe(false);
  });

  it("refuses a toDraft that returns no object", () => {
    expect(() => buildDraft(def(() => undefined as never), {}, "", "ID-3")).toThrow("t/t: toDraft returned no object");
  });

  it("refuses a toDraft whose loopType is missing or not a real LoopType", () => {
    expect(() => buildDraft(def(() => ({})), {}, "", "ID-3")).toThrow('t/t: toDraft returned unknown loopType "undefined"');
    expect(() => buildDraft(def(() => ({ loopType: "banana" }) as never), {}, "", "ID-4")).toThrow('t/t: toDraft returned unknown loopType "banana"');
  });

  it("keeps the caller's id and title even when toDraft's result includes its own", () => {
    const d = buildDraft(def(() => ({ loopType: "sketch", id: "EVIL", title: "Evil" }) as never), {}, "Given Title", "ID-5");
    expect(d.id).toBe("ID-5");
    expect(d.title).toBe("Given Title");
  });

  it("refuses a toDraft whose backend is not a real BackendKind", () => {
    expect(() => buildDraft(def(() => ({ loopType: "sketch", backend: "banana" }) as never), {}, "", "ID-6")).toThrow('t/t: toDraft returned unknown backend "banana"');
  });

  it("refuses a toDraft whose modelTier is not a real ModelTier", () => {
    expect(() => buildDraft(def(() => ({ loopType: "sketch", modelTier: "banana" }) as never), {}, "", "ID-7")).toThrow('t/t: toDraft returned unknown modelTier "banana"');
  });
});

describe("draftProblems", () => {
  const base = { id: "X", title: "", pausesBeforeWritesOnly: false } as const;
  it("mirrors NodeDraft.isValid for each type", () => {
    expect(draftProblems({ ...base, loopType: "sketch" })).toEqual([]);
    expect(draftProblems({ ...base, loopType: "goalBased" })).toEqual(["A goal loop needs a goal."]);
    expect(draftProblems({ ...base, loopType: "goalBased", goal: { summary: "s", ...DEFAULT_GOAL } })).toEqual([]);
    expect(draftProblems({ ...base, loopType: "turnBased" })).toEqual(["A turn loop needs a first instruction."]);
    expect(draftProblems({ ...base, loopType: "proactive" })).toEqual(["A composite needs a name."]);
    expect(draftProblems({ ...base, loopType: "proactive", title: "Group" })).toEqual([]);
  });

  it("asks a timed loop for a prompt, and a backend without in-session recurrence for an interval or a /loop directive", () => {
    expect(draftProblems({ ...base, loopType: "timeBased", backend: "codex" })).toEqual(["A timed loop needs a prompt.", "On Codex, OpenCode or Pi give an interval, or put a /loop directive in the prompt."]);
    expect(draftProblems({ ...base, loopType: "timeBased", backend: "codex", triggerPrompt: "tidy" })).toEqual(["On Codex, OpenCode or Pi give an interval, or put a /loop directive in the prompt."]);
    expect(draftProblems({ ...base, loopType: "timeBased", backend: "codex", triggerPrompt: "/loop 10m tidy" })).toEqual([]);
    expect(draftProblems({ ...base, loopType: "timeBased", triggerPrompt: "tidy", heartbeatIntervalSeconds: 60 })).toEqual([]);
    expect(draftProblems({ ...base, loopType: "timeBased", triggerPrompt: "tidy", heartbeatIntervalSeconds: 0 })).toEqual(["The interval must be a positive number of seconds."]);
    expect(draftProblems({ ...base, loopType: "timeBased", triggerPrompt: "tidy", heartbeatIntervalSeconds: Number.NaN })).toEqual(["The interval must be a positive number of seconds."]);
  });

  it("accepts a bare prompt for a timed loop on the default backend, which keeps its own cadence in-session", () => {
    expect(draftProblems({ ...base, loopType: "timeBased", triggerPrompt: "tidy" })).toEqual([]);
  });

  it("refuses a composite on a backend without sub-agents, and accepts one on Claude Code", () => {
    expect(draftProblems({ ...base, loopType: "proactive", title: "G", backend: "pi" })).toEqual(["A composite needs Claude Code or Copilot CLI (a backend with sub-agents)."]);
    expect(draftProblems({ ...base, loopType: "proactive", title: "G", backend: "claudeCode" })).toEqual([]);
  });
});
