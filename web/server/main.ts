import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { attachRelay } from "./relay.ts";
import { readCanvas, writeCanvas } from "./canvasFile.ts";
import { resolveSocketPath } from "./socketPath.ts";
import { serveStatic } from "./static.ts";

export interface BridgeOptions { port: number; socketPath: string; distDir: string | null }

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
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/canvas") {
      const project = projectFromQuery(req);
      if (!project) { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"project must be an absolute path to an existing directory"}'); return; }
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(await readCanvas(project))); return;
      }
      if (req.method === "PUT") {
        try { await writeCanvas(project, JSON.parse(await readBody(req))); res.writeHead(204); res.end(); }
        catch (error) { res.writeHead(400); res.end(String(error)); }
        return;
      }
      res.writeHead(405); res.end(); return;
    }
    if (serveApp) { serveApp(req, res); return; }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  attachRelay(wss, options.socketPath);
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
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
  });
}
