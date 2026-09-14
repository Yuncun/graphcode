/** Mirrors of the GraphcodeKit Codable types, limited to what the web app reads or sends. */
export type LoopType = "sketch" | "goalBased" | "timeBased" | "turnBased" | "proactive";
export type LoopStateName = "idle" | "running" | "awaitingInput" | "blocked" | "succeeded" | "failed" | "stalled" | "waiting" | "stopped";
export type EdgeKind = "handoff" | "message" | "spawn";
export type EdgeCondition = "always" | "onSuccess" | "onFailure";
export type ModelTier = "fast" | "standard" | "capable";
/** `CLISessionBackendKind` raw values. */
export type BackendKind = "claudeCode" | "copilotCLI" | "codex" | "openCode" | "pi";

export const MODEL_TIERS: readonly ModelTier[] = ["fast", "standard", "capable"];
export const BACKENDS: readonly BackendKind[] = ["claudeCode", "copilotCLI", "codex", "openCode", "pi"];
/** The words a human sees for each type; `sketch` and `proactive` are the on-disk names of Main and Composite. */
export const LOOP_TYPE_LABEL: Record<LoopType, string> = { sketch: "Main", goalBased: "Goal", timeBased: "Timed", turnBased: "Turn", proactive: "Composite" };

export interface ProjectRef { path: string; name: string; lastOpenedAt?: number }

/** `GoalSpec` as the daemon decodes it. Every field but `summary` has a default there, but the app always sends the full shape. */
export interface GoalSpec {
  summary: string;
  predicate?: string;
  pollIntervalSeconds: number;
  stallAfterSeconds?: number;
  metricCommand?: string;
  metricDirection: "maximize" | "minimize";
  tokenBudget?: number;
  skipsUnchangedWorkspace: boolean;
}

export interface LoopNode {
  id: string;
  title: string;
  loopType: LoopType;
  /** `{"running":{}}`: the single key is the state name. Some states carry fields inside. */
  state: Record<string, unknown>;
  createdAt: number;
  pausesBeforeWritesOnly: boolean;
  pilotState: string;
  modelTier?: ModelTier;
  backend?: string;
  goal?: Partial<GoalSpec> & { summary: string };
  triggerPrompt?: string;
  heartbeatIntervalSeconds?: number;
  firstInstruction?: string;
  checkDescription?: string;
  activity?: string;
  stallReason?: string;
  summary?: unknown;
  presence?: { presence: string; confidence: string };
  usage?: { inputTokens: number; outputTokens: number; reportedAt: number };
  subGraph?: LoopGraph;
  createdFromTemplateID?: string;
  /** Present on a loop that follows a template file; absent on a snapshot or a loop made by hand. */
  templateFollow?: Record<string, unknown>;
}

export interface LoopEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  condition: EdgeCondition;
  fireCount: number;
}

export interface LoopGraph {
  id: string;
  /** Optional in the Swift LoopGraph, so a graph can arrive without one. */
  revision?: number;
  project: ProjectRef;
  nodes: LoopNode[];
  edges: LoopEdge[];
}

/** `NodeDraft` (GraphcodeKit/Sources/Domain/NodeDraft.swift). The daemon keeps `id`, so the app can place the card before the node is reported. */
export interface NodeDraft {
  id: string;
  title: string;
  loopType: LoopType;
  checkDescription?: string;
  triggerPrompt?: string;
  heartbeatIntervalSeconds?: number;
  firstInstruction?: string;
  pausesBeforeWritesOnly: boolean;
  goal?: GoalSpec;
  backend?: BackendKind;
  modelTier?: ModelTier;
}

/** `EdgeSpec` with the payload transform the plain edge editor never sets: `{"none":{}}` is Swift's encoding of `.none`. */
export interface EdgeSpec { kind: EdgeKind; condition: EdgeCondition; payloadTransform: { none: Record<string, never> } }

export function edgeSpec(kind: EdgeKind, condition: EdgeCondition): EdgeSpec {
  return { kind, condition, payloadTransform: { none: {} } };
}

export type GraphCommand =
  | { createNode: { _0: NodeDraft } }
  | { createEdge: { from: string; to: string; spec: EdgeSpec } }
  | { deleteNode: { _0: string } }
  | { deleteEdge: { _0: string } }
  | { renameNode: { _0: string; title: string } }
  | { stopNode: { _0: string } }
  | { restartNode: { _0: string } }
  | { detachTemplate: { _0: string } };

export type DaemonEvent =
  | { recentProjectsListed: { _0: ProjectRef[] } }
  | { graphChanged: { _0: LoopGraph } }
  | { nodesChanged: { projectPath: string; revision: number; nodes: LoopNode[] } }
  | { errorOccurred: { _0: string } }
  | { mailbox: unknown };

export type DaemonCommand =
  | { listRecentProjects: Record<string, never> }
  | { restoreOpenProjects: Record<string, never> }
  | { openProject: { path: string } }
  | { closeProject: { path: string } }
  | { graphCommand: { projectPath: string; command: GraphCommand } };

export function graphCommand(projectPath: string, command: GraphCommand): DaemonCommand {
  return { graphCommand: { projectPath, command } };
}

export function stateName(node: LoopNode): LoopStateName {
  return (Object.keys(node.state)[0] ?? "idle") as LoopStateName;
}
