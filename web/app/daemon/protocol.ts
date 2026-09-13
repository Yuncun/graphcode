/** Mirrors of the GraphcodeKit Codable types, limited to what the web app reads or sends. */
export type LoopType = "sketch" | "goalBased" | "timeBased" | "turnBased" | "proactive";
export type LoopStateName = "idle" | "running" | "awaitingInput" | "blocked" | "succeeded" | "failed" | "stalled" | "waiting" | "stopped";
export type EdgeKind = "handoff" | "message" | "spawn";
export type EdgeCondition = "always" | "onSuccess" | "onFailure";
export type ModelTier = "fast" | "standard" | "capable";

export interface ProjectRef { path: string; name: string; lastOpenedAt?: number }

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
  goal?: { summary: string; predicate?: string };
  triggerPrompt?: string;
  firstInstruction?: string;
  activity?: string;
  stallReason?: string;
  summary?: unknown;
  presence?: { presence: string; confidence: string };
  usage?: { inputTokens: number; outputTokens: number; reportedAt: number };
  subGraph?: LoopGraph;
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
  revision: number;
  project: ProjectRef;
  nodes: LoopNode[];
  edges: LoopEdge[];
}

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
  | { closeProject: { path: string } };

export function stateName(node: LoopNode): LoopStateName {
  return (Object.keys(node.state)[0] ?? "idle") as LoopStateName;
}
