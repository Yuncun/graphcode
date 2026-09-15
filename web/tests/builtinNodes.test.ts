import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { LoopNode } from "../app/daemon/protocol.ts";
import { buildDraft, draftProblems } from "../app/nodes/draft.ts";
import { validateNodeType, valuesForLoop } from "../app/nodes/registry.ts";
import { defaultValues } from "../app/nodes/widgets.ts";

const load = (type: string) => import(pathToFileURL(path.resolve(import.meta.dirname, "..", "nodes", `${type}.js`)).href);

const filled: Record<string, Record<string, unknown>> = {
  "agent/goal": { summary: "Write the changelog" },
  "agent/timed": { prompt: "tidy the worktrees" },
  "agent/main": {},
  "agent/turn": { instruction: "Start on the docs" },
  "group/composite": {},
};
const titles: Record<string, string> = { "group/composite": "Release group" };
const expectedType: Record<string, string> = { "agent/goal": "goalBased", "agent/timed": "timeBased", "agent/main": "sketch", "agent/turn": "turnBased", "group/composite": "proactive" };

describe("built-in node pack", () => {
  for (const type of Object.keys(filled)) {
    it(`${type} validates and builds a draft the browser's mirror of NodeDraft.isValid accepts`, async () => {
      const def = validateNodeType(type, await load(type));
      const values = { ...defaultValues(def.widgets), ...filled[type] };
      const draft = buildDraft(def, values, titles[type] ?? "", "ID");
      expect(draft.loopType).toBe(expectedType[type]);
      expect(draftProblems(draft)).toEqual([]);
      expect(draft.pausesBeforeWritesOnly).toBe(false);
    });
  }

  it("the timed loop defaults to no heartbeat and the goal loop to standard on Claude Code", async () => {
    const timed = validateNodeType("agent/timed", await load("agent/timed"));
    expect(buildDraft(timed, { ...defaultValues(timed.widgets), prompt: "p" }, "", "ID").heartbeatIntervalSeconds).toBeUndefined();
    expect(buildDraft(timed, { ...defaultValues(timed.widgets), prompt: "p", interval: 900 }, "", "ID").heartbeatIntervalSeconds).toBe(900);
    const goal = validateNodeType("agent/goal", await load("agent/goal"));
    const d = buildDraft(goal, { ...defaultValues(goal.widgets), summary: "s" }, "", "ID");
    expect(d.modelTier).toBe("standard");
    expect(d.backend).toBe("claudeCode");
    expect(d.goal).toEqual({ summary: "s", pollIntervalSeconds: 60, metricDirection: "maximize", skipsUnchangedWorkspace: false });
  });
});

const live = (extra: Partial<LoopNode>): LoopNode => ({ id: "L", title: "Live", loopType: "goalBased", state: { running: {} }, createdAt: 0, pausesBeforeWritesOnly: false, pilotState: "notPiloted", ...extra });

describe("fromLoop round trips", () => {
  it("agent/goal reads goal, predicate, model and backend back", async () => {
    const def = validateNodeType("agent/goal", await load("agent/goal"));
    const node = live({ loopType: "goalBased", goal: { summary: "Ship it", predicate: "make test" }, modelTier: "capable", backend: "codex" });
    const values = valuesForLoop(def, node);
    expect(values).toEqual({ summary: "Ship it", predicate: "make test", model: "capable", backend: "codex" });
    expect(buildDraft(def, values, node.title, node.id)).toMatchObject({ loopType: "goalBased", goal: { summary: "Ship it", predicate: "make test" }, modelTier: "capable", backend: "codex" });
    expect(valuesForLoop(def, live({ loopType: "goalBased" }))).toEqual({ summary: "", predicate: "", model: "standard", backend: "claudeCode" });
  });

  it("agent/timed reads prompt, interval, model and backend back; no interval stays empty", async () => {
    const def = validateNodeType("agent/timed", await load("agent/timed"));
    expect(valuesForLoop(def, live({ loopType: "timeBased", triggerPrompt: "/loop 1h tidy", heartbeatIntervalSeconds: 900 }))).toEqual({ prompt: "/loop 1h tidy", interval: 900, model: "standard", backend: "claudeCode" });
    const values = valuesForLoop(def, live({ loopType: "timeBased", triggerPrompt: "tidy" }));
    expect(values.interval).toBe(null);
    expect(buildDraft(def, values, "T", "ID")).not.toHaveProperty("heartbeatIntervalSeconds");
  });

  it("agent/main reads the first instruction and backend back", async () => {
    const def = validateNodeType("agent/main", await load("agent/main"));
    expect(valuesForLoop(def, live({ loopType: "sketch", firstInstruction: "Start here", backend: "pi" }))).toEqual({ note: "Start here", backend: "pi" });
  });

  it("agent/turn reads instruction, check, the pause toggle, model and backend back", async () => {
    const def = validateNodeType("agent/turn", await load("agent/turn"));
    expect(valuesForLoop(def, live({ loopType: "turnBased", firstInstruction: "Refactor", checkDescription: "Each step compiles", pausesBeforeWritesOnly: true, modelTier: "fast" })))
      .toEqual({ instruction: "Refactor", check: "Each step compiles", pauseWrites: true, model: "fast", backend: "claudeCode" });
  });

  it("group/composite has no values to read", async () => {
    const def = validateNodeType("group/composite", await load("group/composite"));
    expect(valuesForLoop(def, live({ loopType: "proactive" }))).toEqual({});
  });
});
