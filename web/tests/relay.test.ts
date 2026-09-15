import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startBridge } from "../server/main.ts";
import { startFakeDaemon, waitFor, type FakeDaemon } from "./fakeDaemon.ts";

/** A raw request with a Host header `fetch` will not let a test set, to check the bridge's Host guard. */
function getWithHost(port: number, reqPath: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: reqPath, headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode!));
    });
    req.on("error", reject);
    req.end();
  });
}

let daemon: FakeDaemon;
let bridge: Awaited<ReturnType<typeof startBridge>>;
let blocker: net.Server | undefined;
afterEach(async () => {
  await bridge?.close();
  await daemon?.close();
  if (blocker) await new Promise<void>((resolve) => blocker!.close(() => resolve()));
});

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
    expect(await (await fetch(url)).json()).toEqual({ version: 2, nodes: {}, drafts: {}, draftEdges: [] });
    const doc = { version: 1, nodes: { "N-1": { pos: [1, 2] } } };
    const put = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
    expect(put.status).toBe(204);
    expect(await (await fetch(url)).json()).toEqual(doc);
    const bad = await fetch(`http://localhost:${bridge.port}/api/canvas?project=relative/path`);
    expect(bad.status).toBe(400);
  });

  it("refuses an /api/canvas request whose Host names another host, DNS rebinding's target", async () => {
    daemon = await startFakeDaemon();
    bridge = await startBridge({ port: 0, socketPath: daemon.path, distDir: null });
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-proj-"));
    expect(await getWithHost(bridge.port, `/api/canvas?project=${encodeURIComponent(project)}`, "evil.example:80")).toBe(403);
    expect((await fetch(`http://localhost:${bridge.port}/api/canvas?project=${encodeURIComponent(project)}`)).status).toBe(200);
  });

  it("refuses a WebSocket from a page on another origin, and one addressed to another host", async () => {
    daemon = await startFakeDaemon();
    bridge = await startBridge({ port: 0, socketPath: daemon.path, distDir: null });

    const refused = (options: WebSocket.ClientOptions) => new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${bridge.port}/ws`, options);
      ws.once("open", () => { ws.close(); reject(new Error("the bridge accepted the handshake")); });
      ws.once("error", (error) => resolve(error.message));
    });

    expect(await refused({ origin: "http://evil.example" })).toMatch(/401/);
    expect(await refused({ headers: { host: "graphcode.attacker.example" } })).toMatch(/401/);

    // A client that sends no Origin at all, such as this test, is still let in.
    const { ws } = await openSocket(bridge.port);
    await waitFor(() => daemon.received.length === 1);
    ws.close();
  });

  it("rejects startBridge when the port is already in use, instead of crashing the process", async () => {
    blocker = net.createServer();
    const port = await new Promise<number>((resolve) => {
      blocker!.listen(0, "127.0.0.1", () => resolve((blocker!.address() as net.AddressInfo).port));
    });
    await expect(startBridge({ port, socketPath: "/nonexistent/graphcoded.sock", distDir: null })).rejects.toThrow(/EADDRINUSE/);
  });
});
