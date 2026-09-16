import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { expect, it, vi } from "vitest";
import { startBridge } from "../server/main.ts";

it("closes a browser preconnection that has not sent an HTTP request", async () => {
  const createServer = vi.spyOn(http, "createServer");
  const bridge = await startBridge({ port: 0, socketPath: "/unused.sock", distDir: null });
  const server: http.Server = createServer.mock.results[0]!.value;
  createServer.mockRestore();
  const accepted = once(server, "connection");
  const socket = net.createConnection({ host: "127.0.0.1", port: bridge.port });
  const errors: NodeJS.ErrnoException[] = [];
  socket.on("error", (error) => errors.push(error));
  await accepted;
  const closing = bridge.close();
  try {
    await expect.poll(() => socket.destroyed, { timeout: 1_000 }).toBe(true);
    await closing;
    expect(errors.every((error) => error.code === "ECONNRESET")).toBe(true);
  } finally {
    socket.destroy();
    await closing;
  }
});
