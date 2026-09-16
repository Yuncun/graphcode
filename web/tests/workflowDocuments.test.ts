import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBridge } from "../server/main.ts";
import { getLayout, putLayout } from "../app/canvas/layoutClient.ts";
import { documentKey } from "../shared/workflowDocument.ts";
import { getWorkflowDocument, listWorkflowDocuments, patchWorkflowDocument, putWorkflowDocument } from "../app/canvas/documentClient.ts";

describe("folder-independent workflow documents", () => {
  let root: string;
  let dir: string;
  let bridge: Awaited<ReturnType<typeof startBridge>>;
  let base: string;
  const canvas = () => ({ version: 2, nodes: {}, drafts: {}, draftEdges: [] });
  const document = () => ({ version: 1, id: randomUUID(), name: "Untitled workflow", project: null, canvas: canvas() });
  const request = (url: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
    fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-docs-"));
    dir = path.join(root, "documents");
    bridge = await startBridge({ port: 0, socketPath: path.join(root, "absent.sock"), distDir: null, documentsDir: dir });
    base = `http://localhost:${bridge.port}`;
  });
  afterEach(async () => {
    await bridge.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates and restores a blank document without creating or requiring a project folder", async () => {
    const empty = await request("/api/documents");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ documents: [] });
    const doc = document();
    expect((await request(`/api/documents/file?id=${doc.id}`, "PUT", doc)).status).toBe(204);
    expect(await (await request(`/api/documents/file?id=${doc.id}`)).json()).toEqual(doc);
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${doc.id}.json`), "utf8"))).toEqual(doc);
    expect(fs.readdirSync(root)).toEqual(["documents"]);
    const listed = await (await request("/api/documents")).json();
    expect(listed.documents).toEqual([expect.objectContaining({ id: doc.id, name: doc.name, project: null })]);
  });

  it("saves positions, unknown node definitions and conditional edges without changing their meaning", async () => {
    const doc = document();
    await request(`/api/documents/file?id=${doc.id}`, "PUT", doc);
    const layout = {
      version: 2,
      nodes: { A: { pos: [1, 2], size: [400, 500] }, B: { pos: [600, 2] } },
      drafts: {
        A: { type: "custom/unavailable", title: "", values: { options: { count: 3 } } },
        B: { type: "agent/goal", title: "Review", values: { summary: "Review the result" } },
      },
      draftEdges: [{ from: "A", to: "B", kind: "message", condition: "onFailure" }],
    };
    expect((await request(`/api/documents/canvas?id=${doc.id}`, "PUT", layout)).status).toBe(204);
    expect(await (await request(`/api/documents/canvas?id=${doc.id}`)).json()).toEqual(layout);
    expect((await (await request(`/api/documents/file?id=${doc.id}`)).json()).canvas).toEqual(layout);
  });

  it("keeps a concurrent rename and canvas save, and binds a folder independently of node identifiers", async () => {
    const doc = document();
    await request(`/api/documents/file?id=${doc.id}`, "PUT", doc);
    const layout = { ...canvas(), nodes: { A: { pos: [3, 4] } } };
    const responses = await Promise.all([
      request(`/api/documents/file?id=${doc.id}`, "PATCH", { name: "Release review", project: root }),
      request(`/api/documents/canvas?id=${doc.id}`, "PUT", layout),
    ]);
    expect(responses.map((r) => r.status)).toEqual([204, 204]);
    expect(await (await request(`/api/documents/file?id=${doc.id}`)).json()).toEqual({ ...doc, name: "Release review", project: root, canvas: layout });
    expect(fs.readdirSync(dir)).toEqual([`${doc.id}.json`]);
  });

  it("routes workflow canvas saves by document identity rather than treating it as a project path", async () => {
    const doc = document();
    await request(`/api/documents/file?id=${doc.id}`, "PUT", doc);
    const localFetch: typeof fetch = (url, init) => fetch(new URL(String(url), base), init);
    const layout = { ...canvas(), version: 2 as const, nodes: { A: { pos: [12, 34] as [number, number] } } };
    await putLayout(documentKey(doc.id), layout, localFetch);
    expect(await getLayout(documentKey(doc.id), localFetch)).toEqual(layout);
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${doc.id}.json`), "utf8")).canvas).toEqual(layout);
    await expect(getLayout(documentKey(randomUUID()), localFetch)).rejects.toThrow("HTTP 404");
  });

  it("creates, lists, opens and renames documents through the browser client", async () => {
    const raw = document();
    const doc = { ...raw, version: 1 as const, canvas: { ...canvas(), version: 2 as const } };
    const localFetch: typeof fetch = (url, init) => fetch(new URL(String(url), base), init);
    await putWorkflowDocument(doc, localFetch);
    expect(await getWorkflowDocument(doc.id, localFetch)).toEqual(doc);
    expect((await listWorkflowDocuments(localFetch)).map((d) => d.id)).toEqual([doc.id]);
    await patchWorkflowDocument(doc.id, { name: "Renamed" }, localFetch);
    expect((await getWorkflowDocument(doc.id, localFetch)).name).toBe("Renamed");
    await expect(getWorkflowDocument(randomUUID(), localFetch)).rejects.toThrow("HTTP 404");
  });

  it("does not let a delayed older autosave overwrite a newer canvas edit", async () => {
    const doc = document();
    await request(`/api/documents/file?id=${doc.id}`, "PUT", doc);
    let releaseFirst!: () => void;
    const firstConnection = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondRequested = false;
    const delayedFetch: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.nodes.A.pos[0] === 1) await firstConnection;
      else secondRequested = true;
      return fetch(new URL(String(url), base), init);
    };
    const layout = (x: number) => ({ ...canvas(), version: 2 as const, nodes: { A: { pos: [x, 0] as [number, number] } } });
    const first = putLayout(documentKey(doc.id), layout(1), delayedFetch);
    const second = putLayout(documentKey(doc.id), layout(2), delayedFetch);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (secondRequested) await second;
    } finally {
      releaseFirst();
      await Promise.all([first, second]);
    }
    expect((await (await request(`/api/documents/canvas?id=${doc.id}`)).json()).nodes.A.pos).toEqual([2, 0]);
  });

  it("rejects invalid documents and metadata without overwriting an existing workflow", async () => {
    const doc = document();
    await request(`/api/documents/file?id=${doc.id}`, "PUT", doc);
    for (const bad of [
      { ...doc, id: randomUUID() },
      { ...doc, name: "" },
      { ...doc, project: "ssh://host/project" },
      { ...doc, canvas: { ...canvas(), nodes: { A: { pos: "broken" } } } },
      { ...doc, canvas: { ...canvas(), draftEdges: [{ from: "A", to: "B", kind: "unknown", condition: "always" }] } },
    ]) expect((await request(`/api/documents/file?id=${doc.id}`, "PUT", bad)).status).toBe(400);
    expect((await request(`/api/documents/file?id=${doc.id}`, "PATCH", { canvas: canvas() })).status).toBe(400);
    expect(await (await request(`/api/documents/file?id=${doc.id}`)).json()).toEqual(doc);
  });

  it("rejects path traversal, missing documents and cross-origin writes", async () => {
    const doc = document();
    expect((await request("/api/documents/file?id=..%2Foutside", "PUT", doc)).status).toBe(400);
    expect((await request(`/api/documents/file?id=${doc.id}`)).status).toBe(404);
    expect((await request(`/api/documents/canvas?id=${doc.id}`, "PUT", canvas())).status).toBe(404);
    expect((await request(`/api/documents/file?id=${doc.id}`, "PUT", doc, { origin: "https://untrusted.example" })).status).toBe(403);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("resolves a folder alias and trailing slash to the daemon's canonical project identity", async () => {
    const alias = path.join(root, "folder-alias");
    fs.symlinkSync(root, alias);
    const response = await request(`/api/projects/resolve?project=${encodeURIComponent(`${alias}/`)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ project: fs.realpathSync(root) });
    expect((await request(`/api/projects/resolve?project=${encodeURIComponent(path.join(root, "missing"))}`)).status).toBe(400);
  });

  it("reports a corrupted saved document rather than returning an empty replacement", async () => {
    const doc = document();
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `${doc.id}.json`), "{");
    expect((await request(`/api/documents/file?id=${doc.id}`)).status).toBe(500);
    expect(fs.readFileSync(path.join(dir, `${doc.id}.json`), "utf8")).toBe("{");
  });
});
