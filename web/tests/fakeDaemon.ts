import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { encodeFrame, FrameDecoder } from "../server/framing.ts";

export interface FakeDaemon {
  path: string;
  received: unknown[];
  clients: () => number;
  send: (event: unknown) => void;
  close: () => Promise<void>;
}

export async function startFakeDaemon(): Promise<FakeDaemon> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcw-"));
  const socketPath = path.join(dir, "d.sock");
  const received: unknown[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => received.push(...decoder.push(chunk)));
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    path: socketPath,
    received,
    clients: () => sockets.size,
    send: (event) => { for (const s of sockets) s.write(encodeFrame(event)); },
    close: () => new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      });
    }),
  };
}

export function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}
