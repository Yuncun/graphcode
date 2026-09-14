import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveStatic } from "../server/static.ts";

let root: string;
let distDir: string;
let server: http.Server;
let port: number;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-static-"));
  distDir = path.join(root, "dist");
  fs.mkdirSync(distDir);
  fs.writeFileSync(path.join(distDir, "index.html"), "<h1>app</h1>");
  fs.writeFileSync(path.join(distDir, "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(root, "secret.txt"), "SECRET");
  const handler = serveStatic(distDir);
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * `fetch` runs its URL through the WHATWG parser, which resolves `..` and would refuse some of
 * the paths under test, so send the request line exactly as written instead.
 */
function get(rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("serveStatic", () => {
  it("serves a built file and falls back to index.html", async () => {
    expect(await get("/app.js")).toEqual({ status: 200, body: "console.log(1)" });
    expect((await get("/anything/else")).body).toBe("<h1>app</h1>");
  });

  it("answers 400 for a malformed percent-escape instead of throwing", async () => {
    const res = await get("/%");
    expect(res.status).toBe(400);
    // The handler must survive it: the next request is still answered.
    expect((await get("/app.js")).status).toBe(200);
  });

  it("cannot be walked out of the dist directory", async () => {
    for (const attempt of ["/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2f%2e%2e%2fsecret.txt"]) {
      const res = await get(attempt);
      expect(res.body).not.toContain("SECRET");
      expect([200, 403, 404]).toContain(res.status);
      if (res.status === 200) expect(res.body).toBe("<h1>app</h1>");
    }
  });
});
