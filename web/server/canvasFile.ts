import fs from "node:fs/promises";
import path from "node:path";

export interface CanvasNodeLayout { pos: [number, number]; size?: [number, number] }
/**
 * Version 1 (phases 0 and 1: layout only) or version 2 (phase 2: layout plus drafts and draft
 * wires). The app normalises the shape (`app/canvas/document.ts`, `readCanvasDoc`); the bridge only
 * keeps a well-formed file from being replaced by something that is not a document at all.
 */
export interface CanvasDoc { version: 1 | 2; nodes: Record<string, CanvasNodeLayout>; drafts?: Record<string, unknown>; draftEdges?: unknown[] }

const empty = (): CanvasDoc => ({ version: 2, nodes: {}, drafts: {}, draftEdges: [] });

export function isCanvasDoc(value: unknown): value is CanvasDoc {
  const v = value as { version?: unknown; nodes?: unknown } | null;
  // `typeof null === "object"`, and a null `nodes` reaches placement as a saved layout and throws
  // there, so the document has to carry a real object before it counts as one.
  return !!v && typeof v === "object" && (v.version === 1 || v.version === 2) && !!v.nodes && typeof v.nodes === "object" && !Array.isArray(v.nodes);
}

export function canvasFilePath(projectPath: string): string {
  return path.join(projectPath, ".graphcode", "canvas.json");
}

export async function readCanvas(projectPath: string): Promise<CanvasDoc> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(canvasFilePath(projectPath), "utf8"));
    return isCanvasDoc(parsed) ? parsed : empty();
  } catch {
    return empty();
  }
}

export async function writeCanvas(projectPath: string, doc: CanvasDoc): Promise<void> {
  if (!isCanvasDoc(doc)) throw new Error("not a canvas document");
  const file = canvasFilePath(projectPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n");
}
