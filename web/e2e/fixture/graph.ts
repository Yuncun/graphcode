import type { EdgeCondition, EdgeKind, LoopEdge, LoopGraph, LoopNode, LoopType } from "../../app/daemon/protocol.ts";

export const APPLE_EPOCH_OFFSET = 978307200;
/** Now, in the daemon's units (seconds since 2001-01-01). */
export function appleNow(): number { return Date.now() / 1000 - APPLE_EPOCH_OFFSET; }

/** Fixed ids so a test can address a card by name. Upper-case, like the strings the daemon writes. */
export const ID = {
  plan: "A0000000-0000-4000-8000-000000000001",
  build: "A0000000-0000-4000-8000-000000000002",
  review: "A0000000-0000-4000-8000-000000000003",
  ci: "A0000000-0000-4000-8000-000000000004",
  ship: "A0000000-0000-4000-8000-000000000005",
  flaky: "A0000000-0000-4000-8000-000000000006",
  docs: "A0000000-0000-4000-8000-000000000007",
  nightly: "A0000000-0000-4000-8000-000000000008",
  train: "A0000000-0000-4000-8000-000000000009",
  betaOne: "B0000000-0000-4000-8000-000000000001",
  betaTwo: "B0000000-0000-4000-8000-000000000002",
  template: "C0000000-0000-4000-8000-000000000001",
} as const;

export const EDGE = {
  planToBuild: "E0000000-0000-4000-8000-000000000001",
  buildToReview: "E0000000-0000-4000-8000-000000000002",
  buildToFlaky: "E0000000-0000-4000-8000-000000000003",
  reviewToShip: "E0000000-0000-4000-8000-000000000004",
  reviewToDocs: "E0000000-0000-4000-8000-000000000005",
  trainToNightly: "E0000000-0000-4000-8000-000000000006",
  ciToShip: "E0000000-0000-4000-8000-000000000007",
  betaOneToTwo: "E0000000-0000-4000-8000-000000000011",
} as const;

function node(id: string, title: string, loopType: LoopType, state: string, extra: Partial<LoopNode> = {}): LoopNode {
  return {
    id, title, loopType,
    state: { [state]: {} },
    createdAt: appleNow() - 7200,
    pausesBeforeWritesOnly: false,
    pilotState: "notPiloted",
    backend: "claudeCode",
    ...extra,
  };
}

function edge(id: string, from: string, to: string, kind: EdgeKind, condition: EdgeCondition): LoopEdge {
  return { id, from, to, kind, condition, fireCount: 0 };
}

/** The big fixture: every loop state, every loop type, every edge kind and condition, and each live-line source. */
export function alphaGraph(projectPath: string): LoopGraph {
  return {
    id: "FIXTURE-ALPHA",
    revision: 1,
    project: { path: projectPath, name: "alpha" },
    nodes: [
      node(ID.plan, "Plan the release", "sketch", "idle", { firstInstruction: "Sketch the release plan" }),
      node(ID.build, "Build the feature", "goalBased", "running", {
        activity: "editing src/app.ts",
        goal: { summary: "Build the feature behind a flag", predicate: "pnpm test" },
        modelTier: "standard",
      }),
      node(ID.review, "Review the branch", "goalBased", "awaitingInput", {
        goal: { summary: "Review the branch against the checklist" },
        modelTier: "capable",
      }),
      node(ID.ci, "Wait for CI", "timeBased", "blocked", { triggerPrompt: "/loop 10m check the CI run" }),
      node(ID.ship, "Ship it", "goalBased", "succeeded", { goal: { summary: "Tag and publish" } }),
      node(ID.flaky, "Flaky suite", "goalBased", "failed", { summary: { text: "3 tests failed in the auth suite" } }),
      node(ID.docs, "Docs pass", "turnBased", "stalled", {
        stallReason: "no output for 12 minutes",
        firstInstruction: "Update the docs for the new flag",
        checkDescription: "Each page renders",
      }),
      node(ID.nightly, "Nightly cleanup", "timeBased", "waiting", {
        triggerPrompt: "/loop 24h tidy the worktrees",
        createdFromTemplateID: ID.template,
        templateFollow: { templateID: ID.template, path: "~/.graphcode/templates/nightly.md" },
      }),
      node(ID.train, "Release train", "proactive", "stopped", { modelTier: "fast" }),
    ],
    edges: [
      edge(EDGE.planToBuild, ID.plan, ID.build, "handoff", "always"),
      edge(EDGE.buildToReview, ID.build, ID.review, "handoff", "onSuccess"),
      edge(EDGE.buildToFlaky, ID.build, ID.flaky, "handoff", "onFailure"),
      edge(EDGE.reviewToShip, ID.review, ID.ship, "handoff", "onSuccess"),
      edge(EDGE.reviewToDocs, ID.review, ID.docs, "message", "always"),
      edge(EDGE.trainToNightly, ID.train, ID.nightly, "spawn", "always"),
      edge(EDGE.ciToShip, ID.ci, ID.ship, "handoff", "always"),
    ],
  };
}

/** A second, small project so the tab strip has two tabs. */
export function betaGraph(projectPath: string): LoopGraph {
  return {
    id: "FIXTURE-BETA",
    revision: 1,
    project: { path: projectPath, name: "beta" },
    nodes: [
      node(ID.betaOne, "Beta one", "sketch", "idle"),
      node(ID.betaTwo, "Beta two", "goalBased", "running", { goal: { summary: "Second project's loop" } }),
    ],
    edges: [edge(EDGE.betaOneToTwo, ID.betaOne, ID.betaTwo, "handoff", "always")],
  };
}
