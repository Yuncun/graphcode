import type { EdgeCondition, EdgeKind, LoopNode, LoopType, NodeDraft } from "../daemon/protocol.ts";
import { defaultValues, validateWidgets, type WidgetDef, type WidgetValues } from "./widgets.ts";

export interface SlotDef { name: string; type: EdgeKind; condition?: EdgeCondition }

/** A node type after validation: what the Nodes tab lists and the inspector builds a brief from. */
export interface NodeTypeDef {
  type: string;
  title: string;
  category: string;
  description: string;
  inputs: SlotDef[];
  outputs: SlotDef[];
  widgets: WidgetDef[];
  toDraft(values: WidgetValues): Partial<NodeDraft>;
  /** Widget values for a loop the daemon reports, so a live card shows what it was given. Optional. */
  fromLoop?(node: LoopNode): WidgetValues;
}

export type NodeTypeEntry =
  | { type: string; source: string; ok: true; def: NodeTypeDef }
  | { type: string; source: string; ok: false; error: string };

export type ModuleImporter = (url: string) => Promise<unknown>;

/** The browser's own dynamic import; `@vite-ignore` because the URL is only known at run time. */
export const defaultImporter: ModuleImporter = (url) => import(/* @vite-ignore */ url);

const SLOT_TYPES: readonly EdgeKind[] = ["handoff", "message", "spawn"];

function slots(raw: unknown, field: "inputs" | "outputs"): SlotDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${field} must be an array`);
  return raw.map((item, i) => {
    const s = item as Record<string, unknown>;
    if (typeof s?.name !== "string") throw new Error(`${field}[${i}] needs a name`);
    if (!SLOT_TYPES.includes(s.type as EdgeKind)) throw new Error(`${field}[${i}] has unknown slot type "${String(s.type)}"`);
    if (s.condition !== undefined && s.condition !== "always" && s.condition !== "onSuccess" && s.condition !== "onFailure") throw new Error(`${field}[${i}] has unknown condition "${String(s.condition)}"`);
    return s as unknown as SlotDef;
  });
}

/** Checks a loaded module against the contract in CANVAS-SPEC.md section 6. Throws with a message fit for the Nodes tab. */
export function validateNodeType(type: string, mod: unknown): NodeTypeDef {
  const d = (mod as { default?: unknown } | null)?.default;
  if (!d || typeof d !== "object") throw new Error("module has no default export object");
  const m = d as Record<string, unknown>;
  if (m.type !== undefined && m.type !== type) throw new Error(`module says type "${String(m.type)}" but its file is ${type}`);
  if (typeof m.title !== "string" || !m.title.trim()) throw new Error("title must be a non-empty string");
  if (typeof m.category !== "string" || !m.category.trim()) throw new Error("category must be a non-empty string");
  if (typeof m.toDraft !== "function") throw new Error("toDraft must be a function");
  if (m.fromLoop !== undefined && typeof m.fromLoop !== "function") throw new Error("fromLoop must be a function");
  return {
    type,
    title: m.title,
    category: m.category,
    description: typeof m.description === "string" ? m.description : "",
    inputs: slots(m.inputs, "inputs"),
    outputs: slots(m.outputs, "outputs"),
    widgets: validateWidgets(m.widgets),
    toDraft: m.toDraft as NodeTypeDef["toDraft"],
    fromLoop: m.fromLoop as NodeTypeDef["fromLoop"],
  };
}

/**
 * Lists the packs the bridge knows for this project and imports each module. A module that fails to
 * load or to validate stays in the list with its error, the way ComfyUI shows a broken extension.
 */
export async function loadNodeTypes(project: string | null, importer: ModuleImporter = defaultImporter, fetchFn: typeof fetch = fetch): Promise<NodeTypeEntry[]> {
  const query = project ? `?project=${encodeURIComponent(project)}` : "";
  const res = await fetchFn(`/api/nodes${query}`);
  if (!res.ok) throw new Error(`node type listing failed: HTTP ${res.status}`);
  const { types } = (await res.json()) as { types: Array<{ type: string; source: string; url: string }> };
  // A new URL per load: the browser caches modules by URL, and an edited pack must show its edit on the next Reload.
  const stamp = Date.now();
  return Promise.all(types.map(async (t) => {
    try {
      return { type: t.type, source: t.source, ok: true as const, def: validateNodeType(t.type, await importer(`${t.url}&v=${stamp}`)) };
    } catch (error) {
      return { type: t.type, source: t.source, ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}

/** The built-in type a live loop is drawn as. A user or project pack that overrides the name is used instead (pack precedence). */
export const TYPE_FOR_LOOP_TYPE: Record<LoopType, string> = {
  goalBased: "agent/goal",
  timeBased: "agent/timed",
  sketch: "agent/main",
  turnBased: "agent/turn",
  proactive: "group/composite",
};

export function defByName(entries: NodeTypeEntry[], type: string): NodeTypeDef | null {
  const entry = entries.find((e) => e.type === type);
  return entry && entry.ok ? entry.def : null;
}

export function typeForLoop(entries: NodeTypeEntry[], loopType: LoopType): NodeTypeDef | null {
  return defByName(entries, TYPE_FOR_LOOP_TYPE[loopType]);
}

/** Widget values for a live loop: the type's defaults under whatever its `fromLoop` reports. */
export function valuesForLoop(def: NodeTypeDef, node: LoopNode): WidgetValues {
  return { ...defaultValues(def.widgets), ...(def.fromLoop ? def.fromLoop(node) : {}) };
}
