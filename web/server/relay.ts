import type { WebSocket, WebSocketServer } from "ws";
import { DaemonClient } from "./daemonClient.ts";

/** One daemon connection per browser socket; bytes are relayed as JSON text, never rewritten. */
export function attachRelay(wss: WebSocketServer, socketPath: string): void {
  wss.on("connection", (ws: WebSocket) => {
    const daemon = new DaemonClient(socketPath);
    const fail = (reason: string) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ errorOccurred: { _0: `bridge: ${reason}` } }));
      ws.close();
      daemon.close();
    };
    daemon.onEvent((event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)); });
    daemon.onClose((error) => fail(error ? `daemon connection error: ${error.message}` : "daemon closed the connection"));
    ws.on("message", (data) => {
      let command: unknown;
      try { command = JSON.parse(data.toString()); } catch { return; }
      try { daemon.send(command); } catch (error) { fail((error as Error).message); }
    });
    ws.on("close", () => daemon.close());
    daemon.connect()
      .then(() => daemon.send({ announce: { capabilities: ["nodesChanged"] } }))
      .catch((error: Error) => fail(`cannot reach graphcoded at ${socketPath} (${error.message})`));
  });
}
