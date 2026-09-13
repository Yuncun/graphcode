import fs from "node:fs/promises";
import path from "node:path";

export interface CanvasNodeLayout { pos: [number, number]; size?: [number, number] }
export interface CanvasDoc { version: 1; nodes: Record<string, CanvasNodeLayout> }

const empty = (): CanvasDoc => ({ version: 1, nodes: {} });

export function canvasFilePath(projectPath: string): string {
  return path.join(projectPath, ".graphcode", "canvas.json");
}

export async function readCanvas(projectPath: string): Promise<CanvasDoc> {
  try {
    const parsed = JSON.parse(await fs.readFile(canvasFilePath(projectPath), "utf8"));
    if (parsed && parsed.version === 1 && typeof parsed.nodes === "object") return parsed as CanvasDoc;
    return empty();
  } catch {
    return empty();
  }
}

export async function writeCanvas(projectPath: string, doc: CanvasDoc): Promise<void> {
  const file = canvasFilePath(projectPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n");
}
