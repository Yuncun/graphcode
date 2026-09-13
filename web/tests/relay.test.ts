import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startBridge } from "../server/main.ts";
import { startFakeDaemon, waitFor, type FakeDaemon } from "./fakeDaemon.ts";

let daemon: FakeDaemon;
let bridge: Awaited<ReturnType<typeof startBridge>>;
afterEach(async () => { await bridge?.close(); await daemon?.close(); });

function openSocket(port: number): Promise<{ ws: WebSocket; messages: unknown[] }> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const messages: unknown[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  return new Promise((resolve) => ws.once("open", () => resolve({ ws, messages })));
}

describe("bridge relay", () => {
  it("announces, forwards commands up and events down, verbatim", async () => {
    daemon = await startFakeDaemon();
    bridge = await startBridge({ port: 0, socketPath: daemon.path, distDir: null });
    const { ws, messages } = await openSocket(bridge.port);
    await waitFor(() => daemon.received.length === 1);
    expect(daemon.received[0]).toEqual({ announce: { capabilities: ["nodesChanged"] } });
    ws.send(JSON.stringify({ openProject: { path: "/tmp/p" } }));
    await waitFor(() => daemon.received.length === 2);
    expect(daemon.received[1]).toEqual({ openProject: { path: "/tmp/p" } });
    daemon.send({ graphChanged: { _0: { id: "G", revision: 1, nodes: [], edges: [], project: { path: "/tmp/p", name: "p" } } } });
    await waitFor(() => messages.length === 1);
    expect(messages[0]).toEqual({ graphChanged: { _0: { id: "G", revision: 1, nodes: [], edges: [], project: { path: "/tmp/p", name: "p" } } } });
    ws.close();
    await waitFor(() => daemon.clients() === 0);
  });

  it("tells the browser when the daemon is unreachable and closes", async () => {
    bridge = await startBridge({ port: 0, socketPath: "/nonexistent/graphcoded.sock", distDir: null });
    const { ws, messages } = await openSocket(bridge.port);
    await waitFor(() => ws.readyState === WebSocket.CLOSED);
    expect(messages).toHaveLength(1);
    expect((messages[0] as { errorOccurred: { _0: string } }).errorOccurred._0).toMatch(/^bridge: /);
  });

  it("serves and stores the canvas document", async () => {
    daemon = await startFakeDaemon();
    bridge = await startBridge({ port: 0, socketPath: daemon.path, distDir: null });
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-proj-"));
    const url = `http://localhost:${bridge.port}/api/canvas?project=${encodeURIComponent(project)}`;
    expect(await (await fetch(url)).json()).toEqual({ version: 1, nodes: {} });
    const doc = { version: 1, nodes: { "N-1": { pos: [1, 2] } } };
    const put = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
    expect(put.status).toBe(204);
    expect(await (await fetch(url)).json()).toEqual(doc);
    const bad = await fetch(`http://localhost:${bridge.port}/api/canvas?project=relative/path`);
    expect(bad.status).toBe(400);
  });
});
