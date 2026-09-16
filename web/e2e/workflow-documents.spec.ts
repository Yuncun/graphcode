import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launch, openApp, receivedCommands, receivedGraphCommands, type Harness } from "./fixture/harness.ts";

let h: Harness;
test.afterEach(async () => { await h?.close(); });

async function newWorkflow(page: Page): Promise<string> {
  const previous = await page.evaluate(() => window.__graphcode.active());
  await page.getByTestId("tab-add").click();
  await expect.poll(() => page.evaluate((old) => {
    const key = window.__graphcode.active();
    return key !== old && key?.startsWith("workflow:");
  }, previous)).toBe(true);
  return (await page.evaluate(() => window.__graphcode.active()))!;
}

async function draftGoal(page: Page, key: string): Promise<void> {
  await expect(page.getByTestId("node-type")).toHaveCount(5);
  await page.locator('[data-testid="node-type"][data-type="agent/goal"]').dragTo(page.locator("canvas"), { targetPosition: { x: 160, y: 110 } });
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.length, key)).toBe(1);
  const point = await page.evaluate((p) => {
    const w = window.__graphcode;
    const card = w.cards(p)![0]!;
    const box = w.widgetBox(p, card.id, "summary")!;
    const v = w.viewport()!;
    const rect = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: rect.x + (card.pos[0] + box[0] + 20 + v.offset[0]) * v.scale, y: rect.y + (card.pos[1] + box[1] + 15 + v.offset[1]) * v.scale };
  }, key);
  await page.mouse.click(point.x, point.y);
  await page.getByTestId("field-editor").fill("Review the proposed change");
  await page.getByTestId("field-editor").press("Control+Enter");
  await expect.poll(async () => {
    const response = await page.request.get(`${h.url}/api/documents/file?id=${key.slice(9)}`);
    const doc = await response.json();
    return Object.values(doc.canvas.drafts).some((card) => (card as { values: { summary?: string } }).values.summary === "Review the proposed change");
  }).toBe(true);
}

test("plus opens an autosaved workflow without a folder; reload and close preserve it", async ({ page }) => {
  h = await launch();
  await openApp(page, h);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  const key = await newWorkflow(page);
  expect(dialogs).toEqual([]);
  await expect(page.getByTestId("toolbar").getByRole("button")).toHaveCount(2);
  await expect(page.locator(".center .canvas-help")).toHaveCount(0);
  await draftGoal(page, key);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(key);
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.length, key)).toBe(1);
  const tab = page.getByTestId("tab").filter({ has: page.getByTestId("tab-name").filter({ hasText: "Untitled" }) });
  await tab.getByTestId("tab-close").click();
  expect(receivedCommands(h, "closeProject")).toEqual([]);
  expect((await page.request.get(`${h.url}/api/documents/file?id=${key.slice(9)}`)).status()).toBe(200);
  await page.getByTestId("sidebar-tab-workflows").click();
  await page.locator(`[data-testid="document-item"][data-id="${key.slice(9)}"]`).click();
  await expect(page.getByTestId("document-item").locator("small")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(key);
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.[0]?.values.summary, key)).toBe("Review the proposed change");
  expect(receivedGraphCommands(h, "createNode")).toEqual([]);
  expect(h.pageErrors).toEqual([]);
  await page.screenshot({ path: "e2e/out/workflow-document.png" });
});

test("Run on a folder-free workflow asks for a folder, then runs with that folder's packs, without importing unrelated project agents", async ({ page }) => {
  h = await launch({ before: ({ alpha }) => {
    const nodes = path.join(alpha, ".graphcode", "nodes", "agent");
    fs.mkdirSync(nodes, { recursive: true });
    fs.writeFileSync(path.join(nodes, "goal.js"), `import base from "/api/nodes/file?source=builtin&type=agent%2Fgoal";
export default { ...base, title: "Folder goal", toDraft(values) {
  const draft = base.toDraft(values);
  return { ...draft, goal: { ...draft.goal, summary: "folder: " + values.summary } };
} };`);
  } });
  await openApp(page, h);
  const key = await newWorkflow(page);
  await draftGoal(page, key);
  const alias = path.join(path.dirname(h.alpha), "alpha-alias");
  fs.symlinkSync(h.alpha, alias);
  page.once("dialog", (dialog) => dialog.accept(`${alias}/`));
  await page.getByTestId("run").click();
  await expect.poll(() => page.getByTestId("run").getAttribute("title")).toContain(h.alpha);
  // One press: the folder is attached, its pack loads, and the same Run goes on to create the node.
  await expect.poll(() => receivedGraphCommands(h, "createNode").length).toBe(1);
  expect(receivedGraphCommands(h, "createNode")[0]!.createNode._0.goal.summary).toBe("folder: Review the proposed change");
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.[0]?.mode, key)).toBe("live");
  expect(await page.evaluate((p) => window.__graphcode.cards(p)?.length, key)).toBe(1);
  expect(h.daemon!.graphs.get(h.alpha)!.nodes).toHaveLength(10);
  await expect.poll(async () => (await (await page.request.get(`${h.url}/api/documents/file?id=${key.slice(9)}`)).json()).canvas.drafts).toEqual({});
  await page.reload();
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.length, key)).toBe(1);
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.[0]?.mode, key)).toBe("live");
  expect(h.pageErrors).toEqual([]);
});

test("workflows copy across folder-free tabs and keep their renamed identity", async ({ page, context }) => {
  h = await launch();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openApp(page, h);
  const first = await newWorkflow(page);
  await draftGoal(page, first);
  await page.locator("canvas").focus();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).includes("Review the proposed change"))).toBe(true);
  const second = await newWorkflow(page);
  await expect.poll(() => page.evaluate((key) => window.__graphcode.cards(key)?.length, second)).toBe(0);
  await page.locator("canvas").focus();
  await page.keyboard.press("Meta+v");
  await expect.poll(() => page.evaluate((key) => window.__graphcode.cards(key)?.length, second)).toBe(1);
  const ids = await page.evaluate(([a, b]) => [window.__graphcode.cards(a)![0]!.id, window.__graphcode.cards(b)![0]!.id], [first, second] as const);
  expect(ids[0]).not.toBe(ids[1]);
  page.once("dialog", (dialog) => dialog.accept("Copied review"));
  await page.locator('[data-testid="tab-name"][aria-current="true"]').dblclick();
  await expect(page.locator('[data-testid="tab-name"][aria-current="true"]')).toHaveText("Copied review");
  await expect.poll(async () => (await (await page.request.get(`${h.url}/api/documents/file?id=${second.slice(9)}`)).json()).name).toBe("Copied review");
  expect(receivedCommands(h, "openProject")).toEqual([]);
  expect(receivedGraphCommands(h, "createNode")).toEqual([]);
  await page.reload();
  await expect(page.locator('[data-testid="tab-name"][aria-current="true"]')).toHaveText("Copied review");
  await expect.poll(() => page.evaluate((key) => window.__graphcode.cards(key)?.length, second)).toBe(1);
});

test("workflow authoring and autosave work while the daemon is unavailable", async ({ page }) => {
  h = await launch({ daemonUp: false });
  await page.goto(h.url);
  const key = await newWorkflow(page);
  await draftGoal(page, key);
  await page.reload();
  await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.length, key)).toBe(1);
  expect((await (await page.request.get(`${h.url}/api/documents/file?id=${key.slice(9)}`)).json()).project).toBe(null);
});

test("closing a workflow while folder confirmation is pending does not erase its saved cards", async ({ page }) => {
  h = await launch();
  let hold = false;
  let release!: () => void;
  let received!: () => void;
  const confirmation = new Promise<void>((resolve) => { received = resolve; });
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (hold && "graphChanged" in JSON.parse(String(message))) {
        release = () => socket.send(message);
        received();
      } else socket.send(message);
    });
  });
  await openApp(page, h);
  await expect(page.getByTestId("tab")).toHaveCount(2);
  await page.getByTestId("tab-close").nth(1).click();
  await page.getByTestId("tab-close").first().click();
  const key = await newWorkflow(page);
  await draftGoal(page, key);
  hold = true;
  page.once("dialog", (dialog) => dialog.accept(h.alpha));
  await page.getByTestId("run").click();
  await confirmation;
  await page.getByTestId("tab-close").click();
  await expect(page.locator("canvas")).toHaveCount(0);
  release();
  await expect.poll(async () => (await (await page.request.get(`${h.url}/api/documents/file?id=${key.slice(9)}`)).json()).project).toBe(h.alpha);
  const saved = await (await page.request.get(`${h.url}/api/documents/file?id=${key.slice(9)}`)).json();
  expect(Object.keys(saved.canvas.drafts)).toHaveLength(1);
  expect(receivedGraphCommands(h, "createNode")).toEqual([]);
});
