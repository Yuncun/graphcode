import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EDGE, ID } from "./fixture/graph.ts";
import { launch, openApp, receivedCommands, receivedGraphCommands, shot, type Harness } from "./fixture/harness.ts";
import { REJECTED_TITLE } from "./fixture/scriptedDaemon.ts";
import type { GraphcodeWindow } from "./fixture/window.ts";

declare global {
  interface Window { __graphcode: GraphcodeWindow }
}

/** Card geometry from Task 4. */
const CARD_WIDTH = 300;
const SLOT_HEIGHT = 20;
const OUTPUT_SLOT_X = CARD_WIDTH - 9;
const outputSlotY = (index: number) => (index + 0.7) * SLOT_HEIGHT;
/** A point on the card body that is neither a slot nor the title: the text block under five slot rows. */
const BODY: [number, number] = [CARD_WIDTH / 2, 120];

const graphOf = (page: Page, project: string) => page.evaluate((p) => {
  const g = window.__graphcode.store.projects.get(p)!;
  return { nodes: g.nodes, edges: g.edges };
}, project);
const nodeCount = async (page: Page, project: string) => (await graphOf(page, project)).nodes.length;
const edgeCount = async (page: Page, project: string) => (await graphOf(page, project)).edges.length;

/** Screen point of (dx, dy) from a card's top-left, using the live card position and the canvas transform. */
async function cardPoint(page: Page, project: string, id: string, [dx, dy]: [number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate(([p, i, x, y]) => {
    const g = window.__graphcode;
    const pos = g.positions(p)![i]!.pos;
    const v = g.viewport()!;
    const rect = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: rect.left + (pos[0] + x + v.offset[0]) * v.scale, y: rect.top + (pos[1] + y + v.offset[1]) * v.scale };
  }, [project, id, dx, dy] as const);
}

/** Screen point of a card's title bar (30 px above its top-left). */
const titlePoint = (page: Page, project: string, id: string) => cardPoint(page, project, id, [40, -15]);

async function dragLink(page: Page, project: string, fromID: string, slot: number, toID: string): Promise<void> {
  const from = await cardPoint(page, project, fromID, [OUTPUT_SLOT_X, outputSlotY(slot)]);
  const to = await cardPoint(page, project, toID, BODY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

async function dropType(page: Page, type: string, at: { x: number; y: number }): Promise<void> {
  const item = page.locator(`[data-testid="node-type"][data-type="${type}"]`);
  await item.dragTo(page.locator("canvas"), { targetPosition: await canvasLocal(page, at) });
}

/** dragTo wants a point relative to the target's top-left. */
async function canvasLocal(page: Page, at: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const rect = (await page.locator("canvas").boundingBox())!;
  return { x: at.x - rect.x, y: at.y - rect.y };
}

/** A screen point on empty canvas: the bottom-left corner, inside the fit padding. */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const rect = (await page.locator("canvas").boundingBox())!;
  return { x: rect.x + 12, y: rect.y + rect.height - 12 };
}

async function selectCard(page: Page, project: string, id: string): Promise<void> {
  const p = await titlePoint(page, project, id);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__graphcode.selected())).toBe(id);
}

async function openAlpha(page: Page, h: Harness): Promise<void> {
  await openApp(page, h);
  await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
  await expect(page.getByTestId("node-type")).toHaveCount(5);
}

async function openBeta(page: Page, h: Harness): Promise<void> {
  await openApp(page, h);
  await page.getByTestId("tab-name").nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
  await expect.poll(() => page.evaluate((p) => Object.keys(window.__graphcode.positions(p) ?? {}).length, h.beta)).toBe(2);
  await expect(page.getByTestId("node-type")).toHaveCount(5);
}

test.describe("phase 1 surface", () => {
  let h: Harness;
  test.afterEach(async () => { await h?.close(); });

  test("P1-01 the Nodes tab lists the built-in pack by category, and Reload keeps it", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const categories = page.getByTestId("node-category");
    await expect(categories).toHaveCount(2);
    await expect(categories.nth(0)).toHaveAttribute("data-category", "agent");
    await expect(categories.nth(0).getByTestId("node-type")).toHaveCount(4);
    await expect(categories.nth(1)).toHaveAttribute("data-category", "group");
    await expect(categories.nth(1).getByTestId("node-type")).toHaveCount(1);
    await expect(page.getByTestId("node-type")).toHaveText([/Goal loop/, /Main loop/, /Timed loop/, /Turn loop/, /Composite/]);
    await expect(page.getByTestId("node-type-error")).toHaveCount(0);
    await page.getByTestId("nodes-reload").click();
    await expect(page.getByTestId("node-type")).toHaveCount(5);
    await shot(page, "P1-01-nodes-tab");
    expect(h.pageErrors).toEqual([]);
  });

  test("P1-02 search filters the library", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await page.getByTestId("node-search").fill("tim");
    await expect(page.getByTestId("node-type")).toHaveCount(1);
    await expect(page.getByTestId("node-type").first()).toContainText("Timed loop");
    await shot(page, "P1-02-search");
    await page.getByTestId("node-search").fill("zzz");
    await expect(page.getByTestId("node-type")).toHaveCount(0);
    await expect(page.getByTestId("sidebar")).toContainText("No node types match");
  });

  test("P1-03 a project pack can override a built-in, and a broken module is listed with its error", async ({ page }) => {
    h = await launch({ before: ({ alpha }) => {
      const pack = path.join(alpha, ".graphcode", "nodes");
      fs.mkdirSync(path.join(pack, "agent"), { recursive: true });
      fs.mkdirSync(path.join(pack, "bad"), { recursive: true });
      fs.writeFileSync(path.join(pack, "agent", "goal.js"), 'export default { title: "Goal loop (alpha)", category: "agent", widgets: [], toDraft() { return { loopType: "goalBased" }; } };');
      fs.writeFileSync(path.join(pack, "bad", "broken.js"), "export default {");
    } });
    await openAlpha(page, h);
    await expect(page.locator('[data-testid="node-type"][data-type="agent/goal"]')).toContainText("Goal loop (alpha)");
    await expect(page.locator('[data-testid="node-type"][data-type="agent/goal"]')).toContainText("project");
    await expect(page.getByTestId("node-type-error")).toHaveCount(1);
    await expect(page.getByTestId("node-type-error")).toContainText("bad/broken");
    await shot(page, "P1-03-project-pack");
    await page.getByTestId("tab-name").nth(1).click();
    await expect(page.locator('[data-testid="node-type"][data-type="agent/goal"]')).toContainText("Goal loop");
    await expect(page.locator('[data-testid="node-type"][data-type="agent/goal"]')).not.toContainText("(alpha)");
    await expect(page.getByTestId("node-type-error")).toHaveCount(0);
  });

  test("P1-04 dropping a node type opens its brief; Cancel sends nothing", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await dropType(page, "agent/goal", await emptyPoint(page));
    await expect(page.getByTestId("inspector-heading")).toHaveText("New Goal loop");
    await expect(page.getByTestId("widget-summary")).toBeVisible();
    await expect(page.getByTestId("widget-predicate")).toBeVisible();
    await expect(page.getByTestId("widget-model")).toHaveValue("standard");
    await expect(page.getByTestId("widget-backend")).toHaveValue("claudeCode");
    await expect(page.getByTestId("inspector-create")).toBeDisabled();
    await expect(page.getByTestId("inspector-problems")).toContainText("Goal is required");
    await shot(page, "P1-04-brief-open");
    await page.getByTestId("inspector-cancel").click();
    await expect(page.getByTestId("inspector-hint")).toBeVisible();
    expect(receivedGraphCommands(h, "createNode")).toEqual([]);
  });

  test("P1-05 confirming the brief sends the full draft and the card lands where it was dropped", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const at = await emptyPoint(page);
    await dropType(page, "agent/goal", at);
    await page.getByTestId("widget-summary").fill("Write the changelog");
    await page.getByTestId("widget-predicate").fill("test -f CHANGELOG.md");
    await page.getByTestId("widget-model").selectOption("capable");
    await page.getByTestId("inspector-title").fill("Changelog");
    await expect(page.getByTestId("inspector-create")).toBeEnabled();
    await page.getByTestId("inspector-create").click();
    await expect.poll(() => receivedGraphCommands(h, "createNode").length).toBe(1);
    const draft = receivedGraphCommands(h, "createNode")[0]!.createNode._0;
    expect(draft).toEqual({
      id: expect.stringMatching(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/),
      title: "Changelog",
      loopType: "goalBased",
      pausesBeforeWritesOnly: false,
      modelTier: "capable",
      backend: "claudeCode",
      goal: { summary: "Write the changelog", predicate: "test -f CHANGELOG.md", pollIntervalSeconds: 60, metricDirection: "maximize", skipsUnchangedWorkspace: false },
    });
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(10);
    await expect(page.getByTestId("inspector-hint")).toBeVisible();
    // The drop point in graph space, from the viewport the page had at drop time.
    const expected = await page.evaluate(([x, y]) => {
      const v = window.__graphcode.viewport()!;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return [(x - rect.left) / v.scale - v.offset[0], (y - rect.top) / v.scale - v.offset[1]];
    }, [at.x, at.y] as const);
    const pos = await page.evaluate(([p, id]) => window.__graphcode.positions(p)![id]!.pos, [h.alpha, draft.id] as const);
    expect(Math.abs(pos[0] - expected[0]!)).toBeLessThan(2);
    expect(Math.abs(pos[1] - expected[1]!)).toBeLessThan(2);
    const file = path.join(h.alpha, ".graphcode", "canvas.json");
    await expect.poll(() => fs.existsSync(file) && draft.id in (JSON.parse(fs.readFileSync(file, "utf8")) as { nodes: Record<string, unknown> }).nodes, { timeout: 5_000 }).toBe(true);
    await shot(page, "P1-05-created");
    expect(h.pageErrors).toEqual([]);
  });

  test("P1-06 a draft the daemon refuses shows its error and adds no card", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await dropType(page, "agent/main", await emptyPoint(page));
    await page.getByTestId("inspector-title").fill(REJECTED_TITLE);
    await page.getByTestId("inspector-create").click();
    await expect(page.getByTestId("status")).toContainText("draft rejected");
    await page.waitForTimeout(300);
    expect(await nodeCount(page, h.alpha)).toBe(9);
    await shot(page, "P1-06-rejected");
  });

  test("P1-07 a timed loop carries the default hourly heartbeat", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await dropType(page, "agent/timed", await emptyPoint(page));
    await expect(page.getByTestId("widget-interval")).toHaveValue("3600");
    await page.getByTestId("widget-prompt").fill("tidy the worktrees");
    await page.getByTestId("inspector-create").click();
    await expect.poll(() => receivedGraphCommands(h, "createNode").length).toBe(1);
    expect(receivedGraphCommands(h, "createNode")[0]!.createNode._0).toMatchObject({ loopType: "timeBased", triggerPrompt: "tidy the worktrees", heartbeatIntervalSeconds: 3600 });
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(10);
    await shot(page, "P1-07-timed-created");
  });

  test("P1-08 a composite needs a name before Create is enabled", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await dropType(page, "group/composite", await emptyPoint(page));
    await expect(page.getByTestId("inspector-problems")).toContainText("A composite needs a name.");
    await expect(page.getByTestId("inspector-create")).toBeDisabled();
    await page.getByTestId("inspector-title").fill("Release group");
    await expect(page.getByTestId("inspector-create")).toBeEnabled();
    await shot(page, "P1-08-composite-named");
    await page.getByTestId("inspector-create").click();
    await expect.poll(() => receivedGraphCommands(h, "createNode").length).toBe(1);
    expect(receivedGraphCommands(h, "createNode")[0]!.createNode._0).toMatchObject({ loopType: "proactive", title: "Release group" });
  });

  const slots: Array<{ row: string; slot: number; kind: string; condition: string; slug: string }> = [
    { row: "P1-09", slot: 0, kind: "handoff", condition: "always", slug: "link-handoff" },
    { row: "P1-10", slot: 1, kind: "handoff", condition: "onSuccess", slug: "link-on-success" },
    { row: "P1-11", slot: 2, kind: "handoff", condition: "onFailure", slug: "link-on-failure" },
    { row: "P1-12", slot: 3, kind: "message", condition: "always", slug: "link-message" },
    { row: "P1-13", slot: 4, kind: "spawn", condition: "always", slug: "link-spawn" },
  ];
  for (const s of slots) {
    test(`${s.row} dragging from the "${s.kind} ${s.condition}" output onto a card creates that edge`, async ({ page }) => {
      h = await launch();
      await openBeta(page, h);
      await dragLink(page, h.beta, ID.betaTwo, s.slot, ID.betaOne);
      await expect.poll(() => receivedGraphCommands(h, "createEdge").length).toBe(1);
      expect(receivedGraphCommands(h, "createEdge")[0]!.createEdge).toEqual({
        from: ID.betaTwo, to: ID.betaOne,
        spec: { kind: s.kind, condition: s.condition, payloadTransform: { none: {} } },
      });
      await expect.poll(() => edgeCount(page, h.beta)).toBe(2);
      await shot(page, `${s.row}-${s.slug}`);
      expect(h.pageErrors).toEqual([]);
    });
  }

  test("P1-14 a link dropped on empty canvas sends nothing and opens no menu", async ({ page }) => {
    h = await launch();
    await openBeta(page, h);
    const from = await cardPoint(page, h.beta, ID.betaTwo, [OUTPUT_SLOT_X, outputSlotY(0)]);
    const to = await emptyPoint(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(receivedGraphCommands(h, "createEdge")).toEqual([]);
    await expect(page.locator(".litecontextmenu, .litesearchbox")).toHaveCount(0);
    expect(await edgeCount(page, h.beta)).toBe(1);
    await shot(page, "P1-14-drop-on-canvas");
  });

  test("P1-15 the Delete key on a selected card sends nothing", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.plan);
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    expect(receivedGraphCommands(h, "deleteNode")).toEqual([]);
    expect(await nodeCount(page, h.alpha)).toBe(9);
    await shot(page, "P1-15-delete-key");
  });

  test("P1-16 clicking a card shows its brief and edges; clicking empty canvas clears it", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.build);
    await expect(page.getByTestId("inspector-node-title")).toHaveValue("Build the feature");
    await expect(page.getByTestId("inspector-fields")).toContainText("Goal");
    await expect(page.getByTestId("inspector-fields")).toContainText("Build the feature behind a flag");
    await expect(page.getByTestId("inspector-fields")).toContainText("pnpm test");
    await expect(page.getByTestId("edge-row")).toHaveCount(3);
    await expect(page.getByTestId("edge-row").nth(0)).toContainText("Plan the release");
    await expect(page.getByTestId("edge-row").nth(1)).toContainText("onSuccess");
    await expect(page.getByTestId("edge-row").nth(2)).toContainText("Flaky suite");
    await shot(page, "P1-16-selected");
    const empty = await emptyPoint(page);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId("inspector-hint")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__graphcode.selected())).toBe(null);
  });

  test("P1-17 Rename sends renameNode and the title follows the daemon", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.plan);
    await expect(page.getByTestId("inspector-rename")).toBeDisabled();
    await page.getByTestId("inspector-node-title").fill("Plan v2");
    await expect(page.getByTestId("inspector-rename")).toBeEnabled();
    await page.getByTestId("inspector-rename").click();
    await expect.poll(() => receivedGraphCommands(h, "renameNode").length).toBe(1);
    expect(receivedGraphCommands(h, "renameNode")[0]!.renameNode).toEqual({ _0: ID.plan, title: "Plan v2" });
    await expect.poll(async () => (await graphOf(page, h.alpha)).nodes.find((n) => n.id === ID.plan)!.title).toBe("Plan v2");
    await expect(page.getByTestId("inspector-rename")).toBeDisabled();
    await shot(page, "P1-17-renamed");
  });

  test("P1-18 Stop, Restart and Detach send their commands; disabled where they do not apply", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.build);
    await expect(page.getByTestId("action-stop")).toBeEnabled();
    await expect(page.getByTestId("action-detach")).toBeDisabled();
    await page.getByTestId("action-stop").click();
    await expect.poll(() => receivedGraphCommands(h, "stopNode").length).toBe(1);
    await expect.poll(async () => Object.keys((await graphOf(page, h.alpha)).nodes.find((n) => n.id === ID.build)!.state)[0]).toBe("stopped");
    await expect(page.getByTestId("action-stop")).toBeDisabled();
    await shot(page, "P1-18a-stopped");
    await page.getByTestId("action-restart").click();
    await expect.poll(() => receivedGraphCommands(h, "restartNode").length).toBe(1);
    await expect.poll(async () => Object.keys((await graphOf(page, h.alpha)).nodes.find((n) => n.id === ID.build)!.state)[0]).toBe("running");
    await selectCard(page, h.alpha, ID.nightly);
    await expect(page.getByTestId("action-detach")).toBeEnabled();
    await page.getByTestId("action-detach").click();
    await expect.poll(() => receivedGraphCommands(h, "detachTemplate").length).toBe(1);
    expect(receivedGraphCommands(h, "detachTemplate")[0]!.detachTemplate._0).toBe(ID.nightly);
    await expect(page.getByTestId("action-detach")).toBeDisabled();
    await shot(page, "P1-18b-detached");
    await selectCard(page, h.alpha, ID.plan);
    await expect(page.getByTestId("action-stop")).toBeDisabled();
  });

  test("P1-19 Delete asks first; accepting removes the card and its edges", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.build);
    page.once("dialog", (d) => d.dismiss());
    await page.getByTestId("action-delete").click();
    await page.waitForTimeout(300);
    expect(receivedGraphCommands(h, "deleteNode")).toEqual([]);
    page.once("dialog", (d) => {
      expect(d.message()).toContain('Delete "Build the feature"?');
      void d.accept();
    });
    await page.getByTestId("action-delete").click();
    await expect.poll(() => receivedGraphCommands(h, "deleteNode").length).toBe(1);
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(8);
    expect(await edgeCount(page, h.alpha)).toBe(4);
    await expect(page.getByTestId("inspector-hint")).toBeVisible();
    await shot(page, "P1-19-deleted");
  });

  test("P1-20 deleting an edge from the inspector sends deleteEdge", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.build);
    await page.locator(`[data-testid="edge-row"][data-edge="${EDGE.buildToReview}"]`).getByTestId("edge-delete").click();
    await expect.poll(() => receivedGraphCommands(h, "deleteEdge").length).toBe(1);
    expect(receivedGraphCommands(h, "deleteEdge")[0]!.deleteEdge._0).toBe(EDGE.buildToReview);
    await expect.poll(() => edgeCount(page, h.alpha)).toBe(6);
    await expect(page.getByTestId("edge-row")).toHaveCount(2);
    await shot(page, "P1-20-edge-deleted");
  });

  test("P1-21 the Workflows tab lists recents and opens them", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await page.getByTestId("sidebar-tab-workflows").click();
    await expect(page.getByTestId("recent-project")).toHaveCount(3);
    await page.getByTestId("recent-project").nth(2).click();
    await expect(page.getByTestId("status")).toContainText(`no project at ${h.gamma}`);
    await page.getByTestId("recent-project").nth(1).click();
    await expect.poll(() => receivedCommands(h, "openProject").length).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
    await shot(page, "P1-21-workflows");
  });

  test("P1-22 the view fits the graph on first show, and a pan survives a tab switch", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const fits = await page.evaluate((p) => {
      const g = window.__graphcode;
      const v = g.viewport()!;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      const inside = Object.values(g.positions(p)!).every(({ pos }) => {
        const left = (pos[0] + v.offset[0]) * v.scale;
        const top = (pos[1] - 30 + v.offset[1]) * v.scale;
        const right = (pos[0] + 300 + v.offset[0]) * v.scale;
        const bottom = (pos[1] + 160 + v.offset[1]) * v.scale;
        return left >= 0 && top >= 0 && right <= rect.width && bottom <= rect.height;
      });
      return { inside, scale: v.scale };
    }, h.alpha);
    expect(fits.inside).toBe(true);
    expect(fits.scale).toBeLessThanOrEqual(1);
    expect(fits.scale).toBeGreaterThanOrEqual(0.6);
    await shot(page, "P1-22a-fitted");
    const before = (await page.evaluate(() => window.__graphcode.viewport()!.offset)) as [number, number];
    const empty = await emptyPoint(page);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 90, empty.y - 60, { steps: 8 });
    await page.mouse.up();
    const panned = (await page.evaluate(() => window.__graphcode.viewport()!.offset)) as [number, number];
    expect(panned).not.toEqual(before);
    await page.getByTestId("tab-name").nth(1).click();
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
    await page.getByTestId("tab-name").nth(0).click();
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.alpha);
    expect(await page.evaluate(() => window.__graphcode.viewport()!.offset)).toEqual(panned);
    await shot(page, "P1-22b-pan-restored");
  });

  test("P1-23 switching tabs clears the selection", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await selectCard(page, h.alpha, ID.build);
    await page.getByTestId("tab-name").nth(1).click();
    await expect(page.getByTestId("inspector-hint")).toBeVisible();
    expect(await page.evaluate(() => window.__graphcode.selected())).toBe(null);
    await shot(page, "P1-23-tab-switch");
  });
});
