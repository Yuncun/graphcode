import os from "node:os";
import { expect, test } from "@playwright/test";
import { DaemonClient } from "../server/daemonClient.ts";
import { resolveSocketPath } from "../server/socketPath.ts";

const PROJECT = "/Users/ericshen/Claude/twodrive";

async function nodeCountFromDaemon(): Promise<number> {
  const client = new DaemonClient(resolveSocketPath(process.env, os.homedir()));
  try {
    await client.connect();
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`daemon did not answer openProject for ${PROJECT} within 10 s`));
      }, 10_000);
      client.onEvent((event) => {
        const e = event as { graphChanged?: { _0: { project: { path: string }; nodes: unknown[] } } };
        if (e.graphChanged?._0.project.path === PROJECT) {
          clearTimeout(timer);
          resolve(e.graphChanged._0.nodes.length);
        }
      });
      client.send({ openProject: { path: PROJECT } });
    });
  } finally {
    client.close();
  }
}

test("the canvas shows every node the daemon reports for twodrive", async ({ page }) => {
  const expected = await nodeCountFromDaemon();
  // Without this the comparison below passes for free if the daemon reports an empty project.
  expect(expected).toBeGreaterThan(0);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4790");
  // openProject refuses to send while the bridge's WebSocket is not open yet, so wait
  // for the status footer to say so before calling it.
  await expect(page.locator(".status")).toContainText("open", { timeout: 15_000 });
  await page.evaluate((path) => {
    (window as unknown as { __graphcode: { openProject(path: string): void } }).__graphcode.openProject(path);
  }, PROJECT);
  await expect.poll(async () =>
    page.evaluate((path) => {
      const w = window as unknown as { __graphcode: { store: { projects: Map<string, { nodes: unknown[] }> } } };
      return w.__graphcode.store.projects.get(path)?.nodes.length ?? -1;
    }, PROJECT), { timeout: 15_000 }).toBe(expected);
  await page.screenshot({ path: "e2e/out/smoke.png" });
  expect(errors).toEqual([]);
});
