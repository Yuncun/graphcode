import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBridge } from "../server/main.ts";
import { listWorkflows, readWorkflow, writeWorkflow } from "../server/workflowFiles.ts";
import { WORKFLOW_NAME } from "../shared/workflowName.ts";

describe("WORKFLOW_NAME", () => {
  it("accepts file-safe names and refuses the rest", () => {
    for (const ok of ["pipeline", "Recreate an app", "m2_pass-1.v2", "a"]) expect(WORKFLOW_NAME.test(ok)).toBe(true);
    for (const bad of ["", ".hidden", " lead", "a/b", "a\\b", "x".repeat(65), "no:colon", "tab\tname"]) expect(WORKFLOW_NAME.test(bad)).toBe(false);
  });
});

describe("workflow files", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gcw-wf-")), "workflows");

  it("lists nothing for a missing directory", async () => {
    expect(await listWorkflows(dir)).toEqual([]);
  });

  it("writes, lists newest first, and reads back", async () => {
    await writeWorkflow(dir, "older", { version: 1, name: "older", cards: {}, edges: [] });
    const older = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(dir, "older.json"), older, older);
    await writeWorkflow(dir, "newer", { version: 1, name: "newer", cards: {}, edges: [] });
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
    fs.writeFileSync(path.join(dir, ".hidden.json"), "{}");
    const listed = await listWorkflows(dir);
    expect(listed.map((w) => w.name)).toEqual(["newer", "older"]);
    expect(listed[0]!.savedAt).toBeGreaterThan(listed[1]!.savedAt);
    expect(await readWorkflow(dir, "older")).toEqual({ version: 1, name: "older", cards: {}, edges: [] });
  });

  it("answers null for a malformed name, a missing file, or a file that is not JSON", async () => {
    expect(await readWorkflow(dir, "../etc/passwd")).toBe(null);
    expect(await readWorkflow(dir, "missing")).toBe(null);
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    expect(await readWorkflow(dir, "broken")).toBe(null);
  });

  it("refuses to write a malformed name or a body that is not an object", async () => {
    await expect(writeWorkflow(dir, "a/b", {})).rejects.toThrow("malformed workflow name");
    await expect(writeWorkflow(dir, "fine", [])).rejects.toThrow("a workflow is a JSON object");
    await expect(writeWorkflow(dir, "fine", "text")).rejects.toThrow("a workflow is a JSON object");
  });
});

describe("GET /api/workflows and GET|PUT /api/workflows/file", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gcw-wf-http-")), "workflows");
  let bridge: Awaited<ReturnType<typeof startBridge>>;
  let base: string;
  const headers = (port: number) => ({ host: `localhost:${port}` });

  beforeAll(async () => {
    bridge = await startBridge({ port: 0, socketPath: path.join(os.tmpdir(), "absent.sock"), distDir: null, workflowsDir: dir });
    base = `http://127.0.0.1:${bridge.port}`;
  });
  afterAll(async () => { await bridge.close(); });

  it("stores a file, lists it, serves it, and refuses bad names and bodies", async () => {
    const file = { version: 1, name: "pipe", cards: {}, edges: [] };
    const put = await fetch(`${base}/api/workflows/file?name=pipe`, { method: "PUT", headers: headers(bridge.port), body: JSON.stringify(file) });
    expect(put.status).toBe(204);
    const list = await (await fetch(`${base}/api/workflows`, { headers: headers(bridge.port) })).json() as { workflows: Array<{ name: string; savedAt: number }> };
    expect(list.workflows.map((w) => w.name)).toEqual(["pipe"]);
    expect(await (await fetch(`${base}/api/workflows/file?name=pipe`, { headers: headers(bridge.port) })).json()).toEqual(file);
    expect((await fetch(`${base}/api/workflows/file?name=missing`, { headers: headers(bridge.port) })).status).toBe(404);
    expect((await fetch(`${base}/api/workflows/file?name=..%2Fx`, { headers: headers(bridge.port) })).status).toBe(400);
    expect((await fetch(`${base}/api/workflows/file?name=pipe`, { method: "PUT", headers: headers(bridge.port), body: "[]" })).status).toBe(400);
    expect((await fetch(`${base}/api/workflows/file?name=pipe`, { method: "DELETE", headers: headers(bridge.port) })).status).toBe(405);
    expect((await fetch(`${base}/api/workflows`, { method: "POST", headers: headers(bridge.port) })).status).toBe(405);
  });

  it("refuses a request whose Host names another host", async () => {
    // `fetch` treats Host as a forbidden header and silently sends the real one instead, so this
    // needs a raw request (same pattern as tests/nodeTypes.test.ts's getWithHost).
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: bridge.port, path: "/api/workflows", headers: { host: "evil.example:1" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
