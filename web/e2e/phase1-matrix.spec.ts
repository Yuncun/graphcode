import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ID } from "./fixture/graph.ts";
import { launch, openApp, receivedGraphCommands, shot, type Harness } from "./fixture/harness.ts";
import type { GraphcodeWindow } from "./fixture/window.ts";

declare global {
  interface Window { __graphcode: GraphcodeWindow }
}

/** Card geometry from Task 4. */
const CARD_WIDTH = 300;
const SLOT_HEIGHT = 20;
const OUTPUT_SLOT_X = CARD_WIDTH - 9;
const outputSlotY = (index: number) => (index + 0.7) * SLOT_HEIGHT;

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

  test("P1-14 a link dropped on empty canvas makes no wire, sends nothing and opens no menu", async ({ page }) => {
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
    expect(await page.evaluate(() => window.__graphcode.counts())).toEqual({ drafts: 0, wires: 0 });
    await shot(page, "P1-14-drop-on-canvas");
  });

  test("P1-22 the view fits the graph on first show, and a pan survives a tab switch", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const fits = await page.evaluate((p) => {
      const g = window.__graphcode;
      const v = g.viewport()!;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      const inside = Object.values(g.positions(p)!).every(({ pos, size }) => {
        const left = (pos[0] + v.offset[0]) * v.scale;
        const top = (pos[1] - 30 + v.offset[1]) * v.scale;
        const right = (pos[0] + size![0] + v.offset[0]) * v.scale;
        const bottom = (pos[1] + size![1] + v.offset[1]) * v.scale;
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
    expect(await page.evaluate(() => window.__graphcode.selected())).toBe(null);
    await shot(page, "P1-23-tab-switch");
  });
});
