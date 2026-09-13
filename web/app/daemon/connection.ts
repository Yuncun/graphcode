import type { DaemonCommand, DaemonEvent } from "./protocol.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

/** WebSocket to the bridge. Commands out, events in, reconnect after 2 s. */
export class DaemonConnection {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private eventListeners: Array<(event: DaemonEvent) => void> = [];
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];
  private stopped = false;

  constructor(url: string) {
    this.url = url;
  }

  open(): void {
    this.stopped = false;
    if (this.ws) this.detach(this.ws);
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    ws.onopen = () => { if (this.ws !== ws) return; this.setStatus("open"); };
    ws.onmessage = (m) => {
      if (this.ws !== ws) return;
      const event = JSON.parse(String(m.data)) as DaemonEvent;
      for (const cb of this.eventListeners) cb(event);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setStatus("closed");
      if (!this.stopped) setTimeout(() => this.open(), 2000);
    };
    this.ws = ws;
  }

  close(): void {
    this.stopped = true;
    if (this.ws) this.detach(this.ws);
  }

  /** Strip handlers from a socket we're abandoning and close it, so its stale events can't reach us. */
  private detach(ws: WebSocket): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.close();
    if (this.ws === ws) this.ws = null;
  }

  send(command: DaemonCommand): void {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("not connected");
    this.ws.send(JSON.stringify(command));
  }

  onEvent(cb: (event: DaemonEvent) => void): void { this.eventListeners.push(cb); }
  onStatus(cb: (status: ConnectionStatus) => void): void { this.statusListeners.push(cb); }
  private setStatus(status: ConnectionStatus): void { for (const cb of this.statusListeners) cb(status); }
}
