import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCanvas, writeCanvas } from "../server/canvasFile.ts";

describe("canvas file", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-proj-"));

  it("reads an empty document when the file is missing", async () => {
    expect(await readCanvas(project)).toEqual({ version: 1, nodes: {} });
  });

  it("writes into <project>/.graphcode/canvas.json and reads it back", async () => {
    const doc = { version: 1 as const, nodes: { "A-1": { pos: [10, 20] as [number, number], size: [250, 106] as [number, number] } } };
    await writeCanvas(project, doc);
    expect(fs.existsSync(path.join(project, ".graphcode", "canvas.json"))).toBe(true);
    expect(await readCanvas(project)).toEqual(doc);
  });

  it("treats a corrupt file as empty", async () => {
    fs.writeFileSync(path.join(project, ".graphcode", "canvas.json"), "{not json");
    expect(await readCanvas(project)).toEqual({ version: 1, nodes: {} });
  });
});
