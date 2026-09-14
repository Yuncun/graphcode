import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDraft, draftProblems } from "../app/nodes/draft.ts";
import { validateNodeType } from "../app/nodes/registry.ts";
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
    it(`${type} validates and builds a draft the daemon would accept`, async () => {
      const def = validateNodeType(type, await load(type));
      const values = { ...defaultValues(def.widgets), ...filled[type] };
      const draft = buildDraft(def, values, titles[type] ?? "", "ID");
      expect(draft.loopType).toBe(expectedType[type]);
      expect(draftProblems(draft)).toEqual([]);
      expect(draft.pausesBeforeWritesOnly).toBe(false);
    });
  }

  it("the timed loop defaults to an hourly heartbeat and the goal loop to standard on Claude Code", async () => {
    const timed = validateNodeType("agent/timed", await load("agent/timed"));
    expect(buildDraft(timed, { ...defaultValues(timed.widgets), prompt: "p" }, "", "ID").heartbeatIntervalSeconds).toBe(3600);
    const goal = validateNodeType("agent/goal", await load("agent/goal"));
    const d = buildDraft(goal, { ...defaultValues(goal.widgets), summary: "s" }, "", "ID");
    expect(d.modelTier).toBe("standard");
    expect(d.backend).toBe("claudeCode");
    expect(d.goal).toEqual({ summary: "s", pollIntervalSeconds: 60, metricDirection: "maximize", skipsUnchangedWorkspace: false });
  });
});
