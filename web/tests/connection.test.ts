import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonConnection } from "../app/daemon/connection.ts";

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe("DaemonConnection reopen race", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ignores a stale socket's close so it can't schedule a duplicate reconnect", () => {
    const conn = new DaemonConnection("ws://x");
    conn.open();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const stale = FakeWebSocket.instances[0]!;

    conn.open(); // reopen before the first socket's own close ever fires
    expect(FakeWebSocket.instances).toHaveLength(2);

    stale.onclose?.(); // the orphaned socket firing late must be a no-op
    vi.advanceTimersByTime(2100); // past the 2 s reconnect window

    expect(FakeWebSocket.instances).toHaveLength(2); // no third instance created
  });
});
