import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listNodeTypes, nodeTypeFile, TYPE_NAME } from "../server/nodeTypes.ts";
import { startBridge } from "../server/main.ts";

function roots() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-nodes-"));
  const builtin = path.join(dir, "builtin"); const user = path.join(dir, "user"); const project = path.join(dir, "project");
  const write = (root: string, rel: string, body = "export default {}") => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write(builtin, "agent/goal.js", "export default { title: 'Goal (builtin)' }");
  write(builtin, "agent/timed.js");
  write(builtin, "agent/README.md");
  write(user, "agent/goal.js", "export default { title: 'Goal (user)' }");
  write(user, "agent/bad name.js");
  write(user, "loose.js");
  write(project, ".graphcode/nodes/group/x.js");
  write(project, ".graphcode/nodes/agent/goal.js", "export default { title: 'Goal (project)' }");
  return { dir, builtin, user, project };
}

const cleanup: string[] = [];
afterEach(() => { for (const d of cleanup.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("TYPE_NAME", () => {
  it("accepts pack/name and refuses anything else", () => {
    expect(TYPE_NAME.test("agent/goal")).toBe(true);
    expect(TYPE_NAME.test("my-pack/node_1")).toBe(true);
    for (const bad of ["goal", "a/b/c", "../x", "agent/../etc", "agent/bad name", "", "agent/"]) expect(TYPE_NAME.test(bad)).toBe(false);
  });
});

describe("listNodeTypes", () => {
  it("lists pack/name.js files from every root, later roots winning the same name, sorted by type", async () => {
    const r = roots(); cleanup.push(r.dir);
    const listed = await listNodeTypes({ builtin: r.builtin, user: r.user }, r.project);
    expect(listed).toEqual([
      { type: "agent/goal", source: "project" },
      { type: "agent/timed", source: "builtin" },
      { type: "group/x", source: "project" },
    ]);
  });

  it("uses only the built-in and user roots without a project, and tolerates missing roots", async () => {
    const r = roots(); cleanup.push(r.dir);
    expect(await listNodeTypes({ builtin: r.builtin, user: r.user }, null)).toEqual([
      { type: "agent/goal", source: "user" },
      { type: "agent/timed", source: "builtin" },
    ]);
    expect(await listNodeTypes({ builtin: path.join(r.dir, "nope"), user: path.join(r.dir, "nope2") }, null)).toEqual([]);
  });
});

describe("nodeTypeFile", () => {
  it("resolves a type inside one root and refuses bad names, unknown sources and missing files", async () => {
    const r = roots(); cleanup.push(r.dir);
    const rt = { builtin: r.builtin, user: r.user };
    expect(await nodeTypeFile(rt, r.project, "project", "agent/goal")).toBe(path.join(r.project, ".graphcode", "nodes", "agent", "goal.js"));
    expect(await nodeTypeFile(rt, null, "builtin", "agent/goal")).toBe(path.join(r.builtin, "agent", "goal.js"));
    expect(await nodeTypeFile(rt, null, "project", "agent/goal")).toBe(null);
    expect(await nodeTypeFile(rt, null, "builtin", "../etc/passwd")).toBe(null);
    expect(await nodeTypeFile(rt, null, "builtin", "agent/missing")).toBe(null);
    expect(await nodeTypeFile(rt, null, "user", "agent/timed")).toBe(null);
  });
});

describe("GET /api/nodes and /api/nodes/file", () => {
  it("lists types with fetchable urls, serves a module as JavaScript, and refuses bad requests", async () => {
    const r = roots(); cleanup.push(r.dir);
    const bridge = await startBridge({ port: 0, socketPath: path.join(r.dir, "absent.sock"), distDir: null, nodeTypeRoots: { builtin: r.builtin, user: r.user } });
    try {
      const base = `http://127.0.0.1:${bridge.port}`;
      const listing = await fetch(`${base}/api/nodes?project=${encodeURIComponent(r.project)}`);
      expect(listing.status).toBe(200);
      const { types } = (await listing.json()) as { types: Array<{ type: string; source: string; url: string }> };
      expect(types.map((t) => [t.type, t.source])).toEqual([["agent/goal", "project"], ["agent/timed", "builtin"], ["group/x", "project"]]);
      const file = await fetch(base + types[0]!.url);
      expect(file.status).toBe(200);
      expect(file.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(file.headers.get("cache-control")).toBe("no-store");
      expect(await file.text()).toContain("Goal (project)");
      const noProject = await fetch(`${base}/api/nodes`);
      expect(((await noProject.json()) as { types: unknown[] }).types).toHaveLength(2);
      expect((await fetch(`${base}/api/nodes?project=/definitely/not/here`)).status).toBe(400);
      expect((await fetch(`${base}/api/nodes/file?source=builtin&type=agent%2Fmissing`)).status).toBe(404);
      expect((await fetch(`${base}/api/nodes/file?source=elsewhere&type=agent%2Fgoal`)).status).toBe(400);
      expect((await fetch(`${base}/api/nodes/file?source=project&type=agent%2Fgoal`)).status).toBe(400);
      expect((await fetch(`${base}/api/nodes/file?source=builtin&type=..%2Fetc%2Fpasswd`)).status).toBe(404);
      expect((await fetch(`${base}/api/nodes`, { method: "POST" })).status).toBe(405);
    } finally {
      await bridge.close();
    }
  });

  it("answers 404, not a crash, when a listed file is removed before it is fetched", async () => {
    const r = roots(); cleanup.push(r.dir);
    const bridge = await startBridge({ port: 0, socketPath: path.join(r.dir, "absent.sock"), distDir: null, nodeTypeRoots: { builtin: r.builtin, user: r.user } });
    try {
      const base = `http://127.0.0.1:${bridge.port}`;
      const before = (await (await fetch(`${base}/api/nodes`)).json()) as { types: Array<{ type: string; url: string }> };
      const timed = before.types.find((t) => t.type === "agent/timed")!;
      fs.rmSync(path.join(r.builtin, "agent", "timed.js"));
      expect((await fetch(base + timed.url)).status).toBe(404);
      const after = (await (await fetch(`${base}/api/nodes`)).json()) as { types: unknown[] };
      expect(after.types).toHaveLength(before.types.length - 1);
    } finally {
      await bridge.close();
    }
  });
});
