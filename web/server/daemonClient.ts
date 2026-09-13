import net from "node:net";
import { encodeFrame, FrameDecoder } from "./framing.ts";

/** One connection to graphcoded. Commands out, events in, both as plain objects. */
export class DaemonClient {
  private socket: net.Socket | null = null;
  private readonly decoder = new FrameDecoder();
  private eventListeners: Array<(event: unknown) => void> = [];
  private closeListeners: Array<(error?: Error) => void> = [];

  constructor(private readonly socketPath: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;
      socket.once("connect", () => { settled = true; resolve(); });
      socket.on("error", (error) => {
        if (!settled) { settled = true; reject(error); return; }
        for (const cb of this.closeListeners) cb(error);
      });
      socket.on("data", (chunk) => {
        for (const event of this.decoder.push(chunk)) for (const cb of this.eventListeners) cb(event);
      });
      socket.on("close", (hadError) => { if (settled && !hadError) for (const cb of this.closeListeners) cb(); });
      this.socket = socket;
    });
  }

  send(command: unknown): void {
    if (!this.socket) throw new Error("DaemonClient.send before connect");
    this.socket.write(encodeFrame(command));
  }

  onEvent(cb: (event: unknown) => void): void { this.eventListeners.push(cb); }
  onClose(cb: (error?: Error) => void): void { this.closeListeners.push(cb); }

  close(): void { this.socket?.destroy(); this.socket = null; }
}
