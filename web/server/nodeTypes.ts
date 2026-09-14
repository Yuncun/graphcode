import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type NodeTypeSource = "builtin" | "user" | "project";
export interface NodeTypeRoots { builtin: string; user: string }
export interface NodeTypeListing { type: string; source: NodeTypeSource }

/** `<pack>/<name>`: exactly one slash, letters, digits, `_` and `-`. Refused before any path is built from it. */
export const TYPE_NAME = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

export const NODE_TYPE_SOURCES: readonly NodeTypeSource[] = ["builtin", "user", "project"];

export function defaultNodeTypeRoots(builtinDir: string, home = os.homedir()): NodeTypeRoots {
  return { builtin: builtinDir, user: path.join(home, ".graphcode", "nodes") };
}

/** The roots in precedence order, lowest first: a project's own pack wins over the user's, which wins over the built-ins. */
export function rootsFor(roots: NodeTypeRoots, project: string | null): Array<{ source: NodeTypeSource; dir: string }> {
  const list: Array<{ source: NodeTypeSource; dir: string }> = [
    { source: "builtin", dir: roots.builtin },
    { source: "user", dir: roots.user },
  ];
  if (project) list.push({ source: "project", dir: path.join(project, ".graphcode", "nodes") });
  return list;
}

async function entries(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir)).sort(); } catch { return []; }
}

/** Every `<pack>/<name>.js` under the roots, one entry per type name, sorted by type. */
export async function listNodeTypes(roots: NodeTypeRoots, project: string | null): Promise<NodeTypeListing[]> {
  const byType = new Map<string, NodeTypeListing>();
  for (const root of rootsFor(roots, project)) {
    for (const pack of await entries(root.dir)) {
      for (const file of await entries(path.join(root.dir, pack))) {
        if (!file.endsWith(".js")) continue;
        const type = `${pack}/${file.slice(0, -".js".length)}`;
        if (!TYPE_NAME.test(type)) continue;
        byType.set(type, { type, source: root.source });
      }
    }
  }
  return [...byType.values()].sort((a, b) => a.type.localeCompare(b.type));
}

/** Absolute path of `type`'s module inside `source`, or null when the name is malformed, the source is not available, or the file is missing. */
export async function nodeTypeFile(roots: NodeTypeRoots, project: string | null, source: NodeTypeSource, type: string): Promise<string | null> {
  if (!TYPE_NAME.test(type)) return null;
  const root = rootsFor(roots, project).find((r) => r.source === source);
  if (!root) return null;
  const file = path.join(root.dir, `${type}.js`);
  try { return (await fs.stat(file)).isFile() ? file : null; } catch { return null; }
}
