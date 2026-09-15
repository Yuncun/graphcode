import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCanvasDoc, readCanvas, writeCanvas } from "../server/canvasFile.ts";

const EMPTY = { version: 2, nodes: {}, drafts: {}, draftEdges: [] };

describe("canvas file", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-proj-"));

  it("reads an empty version 2 document when the file is missing", async () => {
    expect(await readCanvas(project)).toEqual(EMPTY);
  });

  it("writes into <project>/.graphcode/canvas.json and reads it back", async () => {
    const doc = {
      version: 2 as const,
      nodes: { "A-1": { pos: [10, 20] as [number, number], size: [250, 106] as [number, number] } },
      drafts: { "A-1": { type: "agent/goal", title: "A", values: { summary: "x" } } },
      draftEdges: [{ from: "A-1", to: "B-2", kind: "handoff", condition: "always" }],
    };
    await writeCanvas(project, doc);
    expect(fs.existsSync(path.join(project, ".graphcode", "canvas.json"))).toBe(true);
    expect(await readCanvas(project)).toEqual(doc);
  });

  it("still reads a version 1 file as it is; the app upgrades the shape", async () => {
    fs.writeFileSync(path.join(project, ".graphcode", "canvas.json"), '{"version":1,"nodes":{"A":{"pos":[1,2]}}}');
    expect(await readCanvas(project)).toEqual({ version: 1, nodes: { A: { pos: [1, 2] } } });
  });

  it("treats a document whose nodes are null, or a corrupt file, as empty", async () => {
    fs.writeFileSync(path.join(project, ".graphcode", "canvas.json"), '{"version":2,"nodes":null}');
    expect(await readCanvas(project)).toEqual(EMPTY);
    fs.writeFileSync(path.join(project, ".graphcode", "canvas.json"), "{not json");
    expect(await readCanvas(project)).toEqual(EMPTY);
  });

  it("refuses to write something that is not a document", async () => {
    await expect(writeCanvas(project, { version: 3, nodes: {} } as never)).rejects.toThrow("not a canvas document");
    await expect(writeCanvas(project, null as never)).rejects.toThrow("not a canvas document");
    expect(isCanvasDoc({ version: 1, nodes: {} })).toBe(true);
    expect(isCanvasDoc({ version: 2, nodes: [] })).toBe(false);
  });
});
