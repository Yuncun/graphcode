import { BACKENDS, LOOP_TYPES, MODEL_TIERS, type BackendKind, type GoalSpec, type LoopType, type NodeDraft } from "../daemon/protocol.ts";
import type { NodeTypeDef } from "./registry.ts";
import type { WidgetValues } from "./widgets.ts";

/** The GoalSpec defaults the daemon would apply; sent explicitly so the wire shape is always complete. */
export const DEFAULT_GOAL: Omit<GoalSpec, "summary" | "predicate"> = { pollIntervalSeconds: 60, metricDirection: "maximize", skipsUnchangedWorkspace: false };

/** `BackendCapabilities` rows whose `supportsSubAgents` is true: the only backends a composite can run on. */
export const BACKENDS_WITH_SUB_AGENTS: readonly BackendKind[] = ["claudeCode", "copilotCLI"];
/** `BackendCapabilities` rows whose `supportsInSessionRecurrence` is true: a bare prompt is enough for a timed loop on these. */
export const BACKENDS_WITH_IN_SESSION_RECURRENCE: readonly BackendKind[] = ["claudeCode", "copilotCLI"];

/** Mirrors `CLISessionBackendKind.canHost` (BackendCapabilities.swift): every backend hosts every loop type except a composite, which needs sub-agent support. */
export function backendCanHost(backend: BackendKind, loopType: LoopType): boolean {
  return loopType !== "proactive" || BACKENDS_WITH_SUB_AGENTS.includes(backend);
}

/** Upper-case, the form Foundation writes, so the id the daemon echoes matches the one the layout was saved under. */
export function newNodeID(): string {
  return crypto.randomUUID().toUpperCase();
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Turns a node type's `toDraft` result into the complete NodeDraft the daemon decodes. */
export function buildDraft(def: NodeTypeDef, values: WidgetValues, title: string, id = newNodeID()): NodeDraft {
  const result = def.toDraft(values);
  if (!result || typeof result !== "object") throw new Error(`${def.type}: toDraft returned no object`);
  const partial = stripUndefined(result);
  if (!partial.loopType || !LOOP_TYPES.includes(partial.loopType)) {
    throw new Error(`${def.type}: toDraft returned unknown loopType "${String(partial.loopType)}"`);
  }
  if (partial.backend !== undefined && !BACKENDS.includes(partial.backend)) {
    throw new Error(`${def.type}: toDraft returned unknown backend "${String(partial.backend)}"`);
  }
  if (partial.modelTier !== undefined && !MODEL_TIERS.includes(partial.modelTier)) {
    throw new Error(`${def.type}: toDraft returned unknown modelTier "${String(partial.modelTier)}"`);
  }
  // The caller's id and title always win over anything a module's toDraft happens to return.
  const draft: NodeDraft = { pausesBeforeWritesOnly: false, ...partial, id, title: title.trim(), loopType: partial.loopType };
  if (draft.loopType === "proactive" && !draft.title) draft.title = def.title;
  if (partial.goal) draft.goal = { ...DEFAULT_GOAL, ...stripUndefined(partial.goal) } as GoalSpec;
  return draft;
}

/**
 * Mirrors `NodeDraft.isValid` in GraphcodeKit, so the form refuses what the daemon would refuse, with
 * a reason: `canHost` (via `backendCanHost`) and the backend-dependent timed-loop rule. It does not
 * mirror `GraphStore`'s own refusal of a heartbeat interval on a backend without daemon recurrence
 * unless Settings' "Daemon heartbeat" experiment is on — the daemon reports that one through its own
 * `errorOccurred` message instead, since the form has no way to read the experiment flag.
 */
export function draftProblems(draft: NodeDraft): string[] {
  const problems: string[] = [];
  const backend: BackendKind = draft.backend ?? "claudeCode";
  if (!backendCanHost(backend, draft.loopType)) {
    problems.push("A composite needs Claude Code or Copilot CLI (a backend with sub-agents).");
    return problems;
  }
  switch (draft.loopType) {
    case "goalBased":
      if (!draft.goal?.summary?.trim()) problems.push("A goal loop needs a goal.");
      break;
    case "timeBased": {
      const prompt = (draft.triggerPrompt ?? "").trim();
      if (!prompt) problems.push("A timed loop needs a prompt.");
      if (draft.heartbeatIntervalSeconds !== undefined) {
        if (!(Number.isFinite(draft.heartbeatIntervalSeconds) && draft.heartbeatIntervalSeconds > 0)) problems.push("The interval must be a positive number of seconds.");
      } else if (!BACKENDS_WITH_IN_SESSION_RECURRENCE.includes(backend) && !/\/(loop|schedule)\b/.test(prompt)) {
        problems.push("On Codex, OpenCode or Pi give an interval, or put a /loop directive in the prompt.");
      }
      break;
    }
    case "turnBased":
      if (!draft.firstInstruction?.trim()) problems.push("A turn loop needs a first instruction.");
      break;
    case "proactive":
      if (!draft.title.trim()) problems.push("A composite needs a name.");
      break;
    case "sketch":
      break;
  }
  return problems;
}
