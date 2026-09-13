import { afterEach, describe, expect, it } from "vitest";
import { DaemonClient } from "../server/daemonClient.ts";
import { startFakeDaemon, waitFor, type FakeDaemon } from "./fakeDaemon.ts";

let daemon: FakeDaemon;
afterEach(async () => { await daemon?.close(); });

describe("DaemonClient", () => {
  it("sends framed commands and receives framed events", async () => {
    daemon = await startFakeDaemon();
    const client = new DaemonClient(daemon.path);
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    await client.connect();
    client.send({ listRecentProjects: {} });
    await waitFor(() => daemon.received.length === 1);
    expect(daemon.received[0]).toEqual({ listRecentProjects: {} });
    daemon.send({ recentProjectsListed: { _0: [] } });
    await waitFor(() => events.length === 1);
    expect(events[0]).toEqual({ recentProjectsListed: { _0: [] } });
    client.close();
    await waitFor(() => daemon.clients() === 0);
  });

  it("rejects connect when the socket does not exist", async () => {
    const client = new DaemonClient("/nonexistent/graphcoded.sock");
    await expect(client.connect()).rejects.toThrow();
  });

  it("reports close when the daemon goes away", async () => {
    daemon = await startFakeDaemon();
    const client = new DaemonClient(daemon.path);
    let closed = false;
    client.onClose(() => { closed = true; });
    await client.connect();
    await daemon.close();
    await waitFor(() => closed);
  });
});
