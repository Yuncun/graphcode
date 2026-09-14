import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { attachRelay } from "./relay.ts";
import { readCanvas, writeCanvas } from "./canvasFile.ts";
import { defaultNodeTypeRoots, listNodeTypes, NODE_TYPE_SOURCES, nodeTypeFile, type NodeTypeRoots, type NodeTypeSource } from "./nodeTypes.ts";
import { resolveSocketPath } from "./socketPath.ts";
import { serveStatic } from "./static.ts";

export interface BridgeOptions { port: number; socketPath: string; distDir: string | null; /** Default: the repo's `web/nodes` and `~/.graphcode/nodes`. */ nodeTypeRoots?: NodeTypeRoots }

/** Where `pnpm dev` serves the app from; it proxies /ws and /api through to the bridge. */
const VITE_DEV_ORIGIN = "http://localhost:5173";

/** The built-in pack ships in the repo next to `server/`. */
const BUILTIN_NODES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "nodes");

/**
 * WebSockets are exempt from the browser's same-origin policy, so without this check any page
 * the developer happens to have open could open ws://localhost:4747/ws and send the daemon
 * whatever it liked. Accept a handshake that carries no Origin at all (a non-browser client,
 * such as a test), and otherwise only the bridge's own page or the Vite dev server. Checking
 * Host as well closes DNS rebinding, where a name the attacker owns resolves to 127.0.0.1 and
 * so reaches the bridge with an Origin of its own.
 */
export function acceptsHandshake(req: http.IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return false;
  const origin = req.headers.origin;
  return origin === undefined
    || origin === `http://localhost:${port}`
    || origin === `http://127.0.0.1:${port}`
    || origin === VITE_DEV_ORIGIN;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function projectFromQuery(req: http.IncomingMessage): string | null {
  const project = new URL(req.url ?? "/", "http://localhost").searchParams.get("project") ?? "";
  if (!path.isAbsolute(project)) return null;
  try { return fs.statSync(project).isDirectory() ? project : null; } catch { return null; }
}

export async function startBridge(options: BridgeOptions): Promise<{ port: number; close(): Promise<void> }> {
  const serveApp = options.distDir ? serveStatic(options.distDir) : null;
  const nodeTypeRoots = options.nodeTypeRoots ?? defaultNodeTypeRoots(BUILTIN_NODES_DIR);
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api/canvas") {
        const project = projectFromQuery(req);
        if (!project) { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"project must be an absolute path to an existing directory"}'); return; }
        if (req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(await readCanvas(project))); return;
        }
        if (req.method === "PUT") {
          // A fixed message: the thrown error names the file it could not write, and that is a
          // path on this machine that the caller has no business being told.
          try { await writeCanvas(project, JSON.parse(await readBody(req))); res.writeHead(204); res.end(); }
          catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"the canvas document could not be stored"}'); }
          return;
        }
        res.writeHead(405); res.end(); return;
      }
      if (url.pathname === "/api/nodes") {
        if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
        // `project` is optional here: with none, only the built-in and user packs are listed.
        const project = projectFromQuery(req);
        if (url.searchParams.has("project") && !project) { json(res, 400, { error: "project must be an absolute path to an existing directory" }); return; }
        const types = await listNodeTypes(nodeTypeRoots, project);
        const projectQuery = project ? `&project=${encodeURIComponent(project)}` : "";
        json(res, 200, { types: types.map((t) => ({ ...t, url: `/api/nodes/file?source=${t.source}&type=${encodeURIComponent(t.type)}${projectQuery}` })) });
        return;
      }
      if (url.pathname === "/api/nodes/file") {
        if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
        const source = url.searchParams.get("source") as NodeTypeSource | null;
        const type = url.searchParams.get("type") ?? "";
        const project = projectFromQuery(req);
        if (!source || !NODE_TYPE_SOURCES.includes(source) || (source === "project" && !project)) { json(res, 400, { error: "source must be builtin, user, or project (with a project path)" }); return; }
        const file = await nodeTypeFile(nodeTypeRoots, project, source, type);
        if (!file) { res.writeHead(404); res.end(); return; }
        // Read before writing the header: `nodeTypeFile` only just stat'd the file, and it could
        // be removed between that stat and this read (TOCTOU) — treat a failed read the same as
        // a missing file rather than sending a 200 header we then can't back up with a body.
        let body: Buffer;
        try { body = await fs.promises.readFile(file); }
        catch { res.writeHead(404); res.end(); return; }
        // no-store: the browser imports each module through a fresh URL anyway, and an edited pack must never be served stale.
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(body);
        return;
      }
      if (serveApp) { serveApp(req, res); return; }
      res.writeHead(404); res.end();
    } catch (error) {
      console.error("graphcode-web:", error);
      // Headers may already be on the wire (the /api/nodes/file body streamed, say); in that
      // case the response can only be ended, not restarted with a fresh status.
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"the bridge could not handle the request"}'); }
      else res.end();
    }
  });
  // The bound port is only known once `listen` has answered (callers pass 0 to take any free
  // port), and the handshake check needs it, so it is read at handshake time rather than here.
  let boundPort = options.port;
  const wss = new WebSocketServer({ server, path: "/ws", verifyClient: ({ req }: { req: http.IncomingMessage }) => acceptsHandshake(req, boundPort) });
  attachRelay(wss, options.socketPath);
  await new Promise<void>((resolve, reject) => {
    // ws's WebSocketServer re-emits the underlying http.Server's "error" event on
    // itself (see ws/lib/websocket-server.js), so a bind failure such as EADDRINUSE
    // surfaces on both emitters; without a listener on each, Node treats the second
    // one as an unhandled "error" event and crashes the process even though the
    // first was handled here.
    const onListenError = (error: Error) => reject(error);
    server.once("error", onListenError);
    wss.once("error", onListenError);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", onListenError);
      wss.off("error", onListenError);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  boundPort = port;
  return {
    port,
    close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => resolve()); }),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const socketPath = resolveSocketPath(process.env, os.homedir());
  const port = Number(process.env.GRAPHCODE_WEB_PORT ?? 4747);
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  startBridge({ port, socketPath, distDir }).then((bridge) => {
    console.log(`graphcode-web: http://localhost:${bridge.port}  daemon ${socketPath}`);
  }).catch((error: Error) => {
    console.error(`graphcode-web: ${error.message}`);
    process.exit(1);
  });
}
