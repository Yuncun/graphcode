import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { alphaGraph, ID } from "./fixture/graph.ts";
import { launch, openApp, receivedCommands, shot, type Harness } from "./fixture/harness.ts";
import type { GraphcodeWindow } from "./fixture/window.ts";

declare global {
  interface Window { __graphcode: GraphcodeWindow }
}

const nodeCount = (page: Page, project: string) =>
  page.evaluate((p) => window.__graphcode.store.projects.get(p)?.nodes.length ?? -1, project);
const nodeState = (page: Page, project: string, id: string) =>
  page.evaluate(([p, i]) => Object.keys(window.__graphcode.store.projects.get(p)!.nodes.find((n) => n.id === i)!.state)[0], [project, id] as const);

/** Screen point of a card's title bar, from the live card position and the canvas transform. */
async function cardTitlePoint(page: Page, project: string, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate(([p, i]) => {
    const g = window.__graphcode;
    const pos = g.positions(p)![i]!.pos;
    const v = g.viewport()!;
    const rect = document.querySelector("canvas")!.getBoundingClientRect();
    // The title bar sits 30 px above pos; aim 15 px into it, 40 px in from the left edge.
    return { x: rect.left + (pos[0] + 40 + v.offset[0]) * v.scale, y: rect.top + (pos[1] - 15 + v.offset[1]) * v.scale };
  }, [project, id] as const);
}

test.describe("phase 0 surface", () => {
  let h: Harness;
  test.afterEach(async () => { await h?.close(); });

  test("P0-01 daemon down at boot", async ({ page }) => {
    h = await launch({ daemonUp: false });
    await page.goto(h.url);
    await expect(page.getByTestId("status")).toContainText("bridge:", { timeout: 15_000 });
    await expect(page.getByTestId("empty")).toContainText("Press + for a blank workflow");
    await shot(page, "P0-01-daemon-down");
  });

  test("P0-02 boot restores two projects and shows every card", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await expect(page.getByTestId("tab")).toHaveCount(2);
    await expect(page.getByTestId("tab-name").first()).toHaveAttribute("aria-current", "true");
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
    expect(await page.evaluate(() => window.__graphcode.active())).toBe(h.alpha);
    await shot(page, "P0-02-two-tabs-all-states");
    expect(h.pageErrors).toEqual([]);
  });

  test("P0-03 selecting a tab switches the canvas", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await page.getByTestId("tab-name").nth(1).click();
    await expect(page.getByTestId("tab-name").nth(1)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("tab-name").nth(0)).not.toHaveAttribute("aria-current", "true");
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
    await expect.poll(() => page.evaluate(() => Object.keys(window.__graphcode.positions(window.__graphcode.active()!) ?? {}).length)).toBe(2);
    await shot(page, "P0-03-second-tab");
  });

  test("P0-04 closing tabs tells the daemon and empties the page", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await page.getByTestId("tab-close").nth(1).click();
    await expect.poll(() => receivedCommands(h, "closeProject").length).toBe(1);
    expect(receivedCommands(h, "closeProject")[0]!.closeProject.path).toBe(h.beta);
    await expect(page.getByTestId("tab")).toHaveCount(1);
    expect(await page.evaluate(() => window.__graphcode.active())).toBe(h.alpha);
    await page.getByTestId("tab-close").first().click();
    await expect(page.getByTestId("tab")).toHaveCount(0);
    await expect(page.getByTestId("empty")).toContainText("Press + for a blank workflow");
    await shot(page, "P0-04-all-closed");
  });

  test("P0-05 Projects opens a project by path", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await page.getByTestId("tab-close").nth(1).click();
    await expect(page.getByTestId("tab")).toHaveCount(1);
    page.once("dialog", (d) => d.accept(h.beta));
    await page.getByTestId("sidebar-tab-projects").click();
    await page.getByTestId("open-project").click();
    await expect(page.getByTestId("tab")).toHaveCount(2);
    await expect.poll(() => receivedCommands(h, "openProject").length).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
    await shot(page, "P0-05-opened-by-path");
  });

  test("P0-06 opening a path the daemon rejects shows its error", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    page.once("dialog", (d) => d.accept("/nonexistent/project"));
    await page.getByTestId("sidebar-tab-projects").click();
    await page.getByTestId("open-project").click();
    await expect(page.getByTestId("status")).toContainText("no project at /nonexistent/project");
    await expect(page.getByTestId("tab")).toHaveCount(2);
    await expect(page.getByTestId("tab-name").first()).toHaveAttribute("aria-current", "true");
    await expect(page.locator("canvas")).toBeVisible();
    await shot(page, "P0-06-open-rejected");
  });

  test("remote projects do not break local startup or send local file requests", async ({ page }) => {
    h = await launch();
    const remote = "codespace://example/workspaces/project";
    const daemon = h.daemon!;
    const graph = alphaGraph(remote);
    graph.project.name = "Remote project";
    daemon.graphs.set(remote, graph);
    daemon.open.clear();
    daemon.open.add(remote);
    daemon.open.add(h.alpha);
    const remoteRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).searchParams.get("project") === remote) remoteRequests.push(request.url());
    });
    await openApp(page, h);
    await expect(page.getByTestId("node-type")).toHaveCount(5);
    await expect(page.getByTestId("tab-name")).toHaveCount(1);
    await expect(page.getByTestId("tab-name")).toHaveText("alpha");
    await expect(page.getByTestId("status")).not.toContainText("HTTP 400");
    expect(remoteRequests).toEqual([]);
    expect(receivedCommands(h, "closeProject")).toEqual([]);
    expect(h.pageErrors).toEqual([]);

    daemon.send({ recentProjectsListed: { _0: [graph.project, { path: h.alpha, name: "alpha" }] } });
    await page.getByTestId("sidebar-tab-projects").click();
    await expect(page.getByTestId("recent-project").filter({ hasText: "Remote project" })).toBeDisabled();
    await expect(page.getByTestId("recent-project").filter({ hasText: "alpha" })).toBeEnabled();
    await page.evaluate((p) => window.__graphcode.openProject(p), remote);
    await expect(page.getByTestId("status")).toContainText("local folders only");
    expect(receivedCommands(h, "openProject")).toEqual([]);
    await expect(page.getByTestId("tab-name")).toHaveAttribute("aria-current", "true");
  });

  test("P0-07 dragging a card persists its position across a reload", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await expect.poll(() => page.evaluate(([project, id]) => window.__graphcode.positions(project)?.[id], [h.alpha, ID.plan] as const)).toBeTruthy();
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
    const before = (await page.evaluate(([p, id]) => window.__graphcode.positions(p)![id]!.pos, [h.alpha, ID.plan] as const)) as [number, number];
    const from = await cardTitlePoint(page, h.alpha, ID.plan);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y + 80, { steps: 12 });
    await page.mouse.up();
    const file = path.join(h.alpha, ".graphcode", "canvas.json");
    await expect.poll(() => fs.existsSync(file), { timeout: 5_000 }).toBe(true);
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { nodes: Record<string, { pos: [number, number] }> };
    const moved = saved.nodes[ID.plan]!.pos;
    expect(moved[0]).toBeGreaterThan(before[0] + 50);
    expect(moved[1]).toBeGreaterThan(before[1] + 30);
    await page.reload();
    await expect(page.getByTestId("status")).toContainText("open", { timeout: 15_000 });
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
    await expect.poll(() => page.evaluate(([p, id]) => window.__graphcode.positions(p)?.[id]?.pos, [h.alpha, ID.plan] as const)).toEqual(moved);
    await shot(page, "P0-07-moved-and-reloaded");
  });

  test("P0-08 losing the daemon mid-session shows the error, then reconnects", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await expect(page.getByTestId("tab")).toHaveCount(2);
    h.daemon!.dropConnections();
    await expect(page.getByTestId("status")).toContainText("bridge:", { timeout: 10_000 });
    await shot(page, "P0-08a-daemon-lost");
    // The app redials after two seconds and asks for its projects again.
    await expect(page.getByTestId("status")).toContainText("open", { timeout: 15_000 });
    await expect.poll(() => receivedCommands(h, "restoreOpenProjects").length).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("tab")).toHaveCount(2);
    await shot(page, "P0-08b-reconnected");
  });

  test("P0-09 a nodesChanged frame updates one card's state", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
    const build = alphaGraph(h.alpha).nodes.find((n) => n.id === ID.build)!;
    h.daemon!.send({ nodesChanged: { projectPath: h.alpha, revision: 2, nodes: [{ ...build, state: { succeeded: {} } }] } });
    await expect.poll(() => nodeState(page, h.alpha, ID.build)).toBe("succeeded");
    await shot(page, "P0-09-node-state-updated");
  });

  test("P0-10 a stale nodesChanged frame is ignored", async ({ page }) => {
    h = await launch();
    await openApp(page, h);
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
    const build = alphaGraph(h.alpha).nodes.find((n) => n.id === ID.build)!;
    h.daemon!.send({ nodesChanged: { projectPath: h.alpha, revision: 0, nodes: [{ ...build, state: { failed: {} } }] } });
    // Give the frame time to arrive, then confirm nothing moved.
    await page.waitForTimeout(500);
    expect(await nodeState(page, h.alpha, ID.build)).toBe("running");
    await shot(page, "P0-10-stale-ignored");
  });
});
