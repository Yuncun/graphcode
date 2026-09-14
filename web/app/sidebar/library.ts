import type { NodeTypeEntry } from "../nodes/registry.ts";

/** The drag payload type: the node type's name travels under this, and only the canvas accepts it. */
export const NODE_TYPE_MIME = "application/x-graphcode-node-type";

export type LoadedEntry = Extract<NodeTypeEntry, { ok: true }>;
export type BrokenEntry = Extract<NodeTypeEntry, { ok: false }>;

export interface LibraryGroup { category: string; items: LoadedEntry[] }

/** Working entries by category, filtered by a search over title, type and description. */
export function groupByCategory(entries: NodeTypeEntry[], query = ""): LibraryGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (e: LoadedEntry) => !q || [e.def.title, e.type, e.def.description].some((s) => s.toLowerCase().includes(q));
  const groups = new Map<string, LoadedEntry[]>();
  for (const e of entries) {
    if (!e.ok || !matches(e)) continue;
    const list = groups.get(e.def.category) ?? [];
    list.push(e);
    groups.set(e.def.category, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({ category, items: items.sort((a, b) => a.def.title.localeCompare(b.def.title)) }));
}

export function brokenEntries(entries: NodeTypeEntry[]): BrokenEntry[] {
  return entries.filter((e): e is BrokenEntry => !e.ok);
}
