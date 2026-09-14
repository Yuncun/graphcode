import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".map": "application/json",
};

/** Serves a built Vite dist directory; unknown paths fall back to index.html. */
export function serveStatic(distDir: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // The URL parser keeps a stray "%" in a pathname (GET /%) and decodeURIComponent throws on
    // it. This runs inside the bridge's async request handler, where the throw would become an
    // unhandled rejection and take the whole process down, so answer the bad request here.
    let requested: string;
    try {
      requested = path.normalize(decodeURIComponent(url.pathname));
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("bad request: the path is not a valid percent-encoded string");
      return;
    }
    let file = path.join(distDir, requested);
    if (!file.startsWith(distDir)) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); res.end("not built: run pnpm build"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  };
}
