import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EDGE, ID } from "./fixture/graph.ts";
import { launch, openApp, receivedCommands, receivedGraphCommands, shot, type Harness } from "./fixture/harness.ts";
import { REJECTED_TITLE } from "./fixture/scriptedDaemon.ts";
import type { CardView, GraphcodeWindow } from "./fixture/window.ts";

declare global {
  interface Window { __graphcode: GraphcodeWindow }
}

const CARD_WIDTH = 300;
const SLOT_HEIGHT = 20;
const OUTPUT_SLOT_X = CARD_WIDTH - 9;
const INPUT_SLOT_X = 10;
const slotY = (index: number) => (index + 0.7) * SLOT_HEIGHT;
const TITLE_FIELD = "__title";

const g = (page: Page) => page.evaluate(() => window.__graphcode.counts());
const graphOf = (page: Page, project: string) => page.evaluate((p) => {
  const graph = window.__graphcode.store.projects.get(p)!;
  return { nodes: graph.nodes, edges: graph.edges };
}, project);
const nodeCount = async (page: Page, project: string) => (await graphOf(page, project)).nodes.length;
const edgeCount = async (page: Page, project: string) => (await graphOf(page, project)).edges.length;
const cards = (page: Page, project: string) => page.evaluate((p) => window.__graphcode.cards(p) ?? [], project);
const cardByID = async (page: Page, project: string, id: string): Promise<CardView | undefined> => (await cards(page, project)).find((c) => c.id === id);
const drafts = async (page: Page, project: string) => (await cards(page, project)).filter((c) => c.mode !== "live");

/** Screen point of (dx, dy) from a card's top-left, using the live card position and the canvas transform. */
async function cardPoint(page: Page, project: string, id: string, [dx, dy]: [number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate(([p, i, x, y]) => {
    const w = window.__graphcode;
    const pos = w.positions(p)![i]!.pos;
    const v = w.viewport()!;
    const rect = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: rect.left + (pos[0] + x + v.offset[0]) * v.scale, y: rect.top + (pos[1] + y + v.offset[1]) * v.scale };
  }, [project, id, dx, dy] as const);
}
/** Screen point of a card's title bar (30 px above its top-left). */
const titlePoint = (page: Page, project: string, id: string) => cardPoint(page, project, id, [40, -15]);
/** Screen centre of a widget's box on a card. */
async function widgetPoint(page: Page, project: string, id: string, name: string): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(([p, i, n]) => window.__graphcode.widgetBox(p, i, n), [project, id, name] as const);
  if (!box) throw new Error(`no widget ${name} on ${id}`);
  return cardPoint(page, project, id, [box[0] + box[2] / 2, box[1] + box[3] / 2]);
}
async function buttonPoint(page: Page, project: string, id: string, label: string): Promise<{ x: number; y: number }> {
  const box = await page.evaluate(([p, i, l]) => window.__graphcode.buttonBox(p, i, l), [project, id, label] as const);
  if (!box) throw new Error(`no button ${label} on ${id}`);
  return cardPoint(page, project, id, [box[0] + box[2] / 2, box[1] + box[3] / 2]);
}

async function dragLink(page: Page, project: string, fromID: string, slot: number, toID: string): Promise<void> {
  const from = await cardPoint(page, project, fromID, [OUTPUT_SLOT_X, slotY(slot)]);
  // The target's title bar: never a slot, never a widget.
  const to = await titlePoint(page, project, toID);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}
/**
 * Picks the wire off a card's input dot and drops it on empty canvas. Targets `emptyPoint2`, not
 * `emptyPoint`: a card dropped there earlier in the same row (P2-10) occupies `emptyPoint` itself,
 * and dropping the wire back onto that card's own body would be a `dropped-on-node`, not a discard.
 */
async function dragOffInput(page: Page, project: string, id: string, index: number): Promise<void> {
  const from = await cardPoint(page, project, id, [INPUT_SLOT_X, slotY(index)]);
  const to = await emptyPoint2(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}
/** Picks the wire off a card's input dot and drops it on another card's title bar: a move. */
async function dragInputTo(page: Page, project: string, id: string, index: number, toID: string): Promise<void> {
  const from = await cardPoint(page, project, id, [INPUT_SLOT_X, slotY(index)]);
  const to = await titlePoint(page, project, toID);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
}

async function dropType(page: Page, type: string, at: { x: number; y: number }): Promise<string> {
  const before = new Set((await cards(page, await page.evaluate(() => window.__graphcode.active()!))).map((c) => c.id));
  const item = page.locator(`[data-testid="node-type"][data-type="${type}"]`);
  await item.dragTo(page.locator("canvas"), { targetPosition: await canvasLocal(page, at) });
  const project = await page.evaluate(() => window.__graphcode.active()!);
  await expect.poll(async () => (await cards(page, project)).length).toBe(before.size + 1);
  return (await cards(page, project)).find((c) => !before.has(c.id))!.id;
}

/** dragTo wants a point relative to the target's top-left. */
async function canvasLocal(page: Page, at: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const rect = (await page.locator("canvas").boundingBox())!;
  return { x: at.x - rect.x, y: at.y - rect.y };
}

/**
 * A screen point on empty canvas: near the top-left corner, inside the fit padding. A full card is
 * taller than the phase 1 placeholder this was written against (fields, buttons and a status line
 * all draw on it now), so the drop point leaves headroom below it; the bottom-left corner used in
 * phase 1 left a card's lower fields off the bottom of the window. The 50 px inset (rather than 12)
 * leaves room above the drop point too, so the title bar (drawn above a card's `pos`) is not
 * clipped by the top edge of the canvas.
 */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const rect = (await page.locator("canvas").boundingBox())!;
  return { x: rect.x + 12, y: rect.y + 50 };
}
/** Empty canvas near the top, some way right of `emptyPoint`, for a second card. */
async function emptyPoint2(page: Page): Promise<{ x: number; y: number }> {
  const p = await emptyPoint(page);
  return { x: p.x + 360, y: p.y };
}

async function selectCard(page: Page, project: string, id: string): Promise<void> {
  const p = await titlePoint(page, project, id);
  await page.mouse.click(p.x, p.y);
  try {
    await expect.poll(() => page.evaluate(() => window.__graphcode.selected()), { timeout: 1_000 }).toBe(id);
  } catch {
    // A title-bar click that lands right after the card was drawn (a card just dropped) can race
    // litegraph's own click detection and leave the selection cleared; a second click, well past
    // its double-click window, always settles it.
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => page.evaluate(() => window.__graphcode.selected())).toBe(id);
  }
}

/** Types into a card's text field through the editor and commits with ⌘Enter (multiline) or Enter. */
async function fillField(page: Page, project: string, id: string, name: string, text: string, multiline = true): Promise<void> {
  const p = await widgetPoint(page, project, id, name);
  await page.mouse.click(p.x, p.y);
  const editor = page.getByTestId("field-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("data-field", name);
  await editor.fill(text);
  await editor.press(multiline ? "Meta+Enter" : "Enter");
  await expect(editor).toHaveCount(0);
}

async function openAlpha(page: Page, h: Harness): Promise<void> {
  await openApp(page, h);
  await expect.poll(() => nodeCount(page, h.alpha)).toBe(9);
  await expect(page.getByTestId("node-type")).toHaveCount(5);
  // Live cards draw their fields once the types are loaded.
  await expect.poll(async () => (await cardByID(page, h.alpha, ID.build))?.values.summary).toBe("Build the feature behind a flag");
}

async function openBeta(page: Page, h: Harness): Promise<void> {
  await openApp(page, h);
  await page.getByTestId("tab-name").nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
  await expect(page.getByTestId("node-type")).toHaveCount(5);
  await expect.poll(async () => (await cardByID(page, h.beta, ID.betaTwo))?.values.summary).toBe("Second project's loop");
}

const canvasJSON = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, ".graphcode", "canvas.json"), "utf8")) as { version: number; nodes: Record<string, { pos: [number, number]; size?: [number, number] }>; drafts: Record<string, unknown>; draftEdges: unknown[] };

test.describe("phase 2 surface", () => {
  let h: Harness;
  test.afterEach(async () => { await h?.close(); });

  test("P2-01 dropping a node type makes a draft card where it was dropped, sends nothing, and survives a reload", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const at = await emptyPoint(page);
    const id = await dropType(page, "agent/goal", at);
    const card = (await cardByID(page, h.alpha, id))!;
    expect(card.mode).toBe("draft");
    expect(card.values).toEqual({ summary: "", predicate: "", model: "standard", backend: "claudeCode" });
    expect(await g(page)).toEqual({ drafts: 1, wires: 0 });
    expect(await page.evaluate(() => window.__graphcode.selected())).toBe(id);
    const expected = await page.evaluate(([x, y]) => {
      const v = window.__graphcode.viewport()!;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return [(x - rect.left) / v.scale - v.offset[0], (y - rect.top) / v.scale - v.offset[1]];
    }, [at.x, at.y] as const);
    expect(Math.abs(card.pos[0] - expected[0]!)).toBeLessThan(2);
    expect(Math.abs(card.pos[1] - expected[1]!)).toBeLessThan(2);
    await page.waitForTimeout(300);
    expect(receivedGraphCommands(h, "createNode")).toEqual([]);
    expect(await nodeCount(page, h.alpha)).toBe(9);
    await shot(page, "P2-01-draft-card");
    await expect.poll(() => fs.existsSync(path.join(h.alpha, ".graphcode", "canvas.json")) && id in canvasJSON(h.alpha).drafts, { timeout: 5_000 }).toBe(true);
    expect(canvasJSON(h.alpha).version).toBe(2);
    await page.reload();
    await openAlpha(page, h);
    await expect.poll(async () => (await cardByID(page, h.alpha, id))?.mode).toBe("draft");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-02 a text field opens the editor over itself; ⌘Enter keeps the text, Escape drops it, and the card stays put", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    const before = (await cardByID(page, h.alpha, id))!.pos;
    const p = await widgetPoint(page, h.alpha, id, "summary");
    await page.mouse.click(p.x, p.y);
    const editor = page.getByTestId("field-editor");
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    const box = (await editor.boundingBox())!;
    expect(p.x).toBeGreaterThan(box.x);
    expect(p.x).toBeLessThan(box.x + box.width);
    expect(p.y).toBeGreaterThan(box.y);
    expect(p.y).toBeLessThan(box.y + box.height);
    await editor.fill("Write the changelog\nfor 1.2");
    await shot(page, "P2-02a-editor-open");
    await editor.press("Meta+Enter");
    await expect(editor).toHaveCount(0);
    expect((await cardByID(page, h.alpha, id))!.values.summary).toBe("Write the changelog\nfor 1.2");
    await page.mouse.click(p.x, p.y);
    await expect(editor).toBeVisible();
    await editor.fill("thrown away");
    await editor.press("Escape");
    await expect(editor).toHaveCount(0);
    expect((await cardByID(page, h.alpha, id))!.values.summary).toBe("Write the changelog\nfor 1.2");
    expect((await cardByID(page, h.alpha, id))!.pos).toEqual(before);
    await fillField(page, h.alpha, id, "predicate", "test -f CHANGELOG.md", false);
    expect((await cardByID(page, h.alpha, id))!.values.predicate).toBe("test -f CHANGELOG.md");
    await shot(page, "P2-02b-fields-filled");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-03 litegraph's combo, number and toggle widgets set values on the card", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const timed = await dropType(page, "agent/timed", await emptyPoint(page));
    const model = await widgetPoint(page, h.alpha, timed, "Model");
    await page.mouse.click(model.x, model.y);
    await page.locator(".litecontextmenu .litemenu-entry", { hasText: "capable" }).click();
    await expect.poll(async () => (await cardByID(page, h.alpha, timed))!.values.model).toBe("capable");
    const interval = await widgetPoint(page, h.alpha, timed, "Every (seconds)");
    await page.mouse.click(interval.x, interval.y);
    // litegraph's own value dialog for a number widget.
    const dialog = page.locator(".graphdialog input");
    await expect(dialog).toBeVisible();
    await dialog.fill("900");
    await dialog.press("Enter");
    await expect.poll(async () => (await cardByID(page, h.alpha, timed))!.values.interval).toBe(900);
    await shot(page, "P2-03a-combo-and-number");
    const turn = await dropType(page, "agent/turn", await emptyPoint2(page));
    expect((await cardByID(page, h.alpha, turn))!.values.pauseWrites).toBe(false);
    const toggle = await widgetPoint(page, h.alpha, turn, "Pause only before writes");
    await page.mouse.click(toggle.x, toggle.y);
    await expect.poll(async () => (await cardByID(page, h.alpha, turn))!.values.pauseWrites).toBe(true);
    await shot(page, "P2-03b-toggle");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-04 a card resizes from its corner and the size is saved", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    const before = (await cardByID(page, h.alpha, id))!.size;
    const corner = await cardPoint(page, h.alpha, id, [before[0] - 4, before[1] - 4]);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + 60, corner.y + 80, { steps: 10 });
    await page.mouse.up();
    const after = (await cardByID(page, h.alpha, id))!.size;
    const scale = (await page.evaluate(() => window.__graphcode.viewport()!.scale));
    expect(after[0] - before[0]).toBeCloseTo(60 / scale, 0);
    expect(after[1] - before[1]).toBeCloseTo(80 / scale, 0);
    await shot(page, "P2-04-resized");
    // expect.poll does not retry a thrown error (unlike a mismatched value), so guard the read
    // the same way P2-01 does: the file may not exist yet on the first tick or two.
    await expect.poll(() => fs.existsSync(path.join(h.alpha, ".graphcode", "canvas.json")) ? canvasJSON(h.alpha).nodes[id]?.size?.[1] : undefined, { timeout: 5_000 }).toBe(after[1]);
    expect(h.pageErrors).toEqual([]);
  });

  const slots: Array<{ row: string; slot: number; kind: string; condition: string; slug: string }> = [
    { row: "P2-05a", slot: 0, kind: "handoff", condition: "always", slug: "wire-handoff" },
    { row: "P2-05b", slot: 1, kind: "handoff", condition: "onSuccess", slug: "wire-on-success" },
    { row: "P2-05c", slot: 2, kind: "handoff", condition: "onFailure", slug: "wire-on-failure" },
    { row: "P2-05d", slot: 3, kind: "message", condition: "always", slug: "wire-message" },
    { row: "P2-05e", slot: 4, kind: "spawn", condition: "always", slug: "wire-spawn" },
  ];
  for (const s of slots) {
    test(`${s.row} a wire from the "${s.kind} ${s.condition}" output is a draft until Start, then that edge`, async ({ page }) => {
      h = await launch();
      await openBeta(page, h);
      const id = await dropType(page, "agent/goal", await emptyPoint(page));
      await fillField(page, h.beta, id, "summary", "Ship it");
      await dragLink(page, h.beta, id, s.slot, ID.betaOne);
      await expect.poll(() => g(page)).toEqual({ drafts: 1, wires: 1 });
      await page.waitForTimeout(200);
      expect(receivedGraphCommands(h, "createEdge")).toEqual([]);
      await shot(page, `${s.row}-${s.slug}-draft`);
      const start = await buttonPoint(page, h.beta, id, "Start");
      await page.mouse.click(start.x, start.y);
      await expect.poll(() => receivedGraphCommands(h, "createEdge").length).toBe(1);
      expect(receivedGraphCommands(h, "createNode")[0]!.createNode._0).toMatchObject({ id, loopType: "goalBased", goal: { summary: "Ship it" } });
      expect(receivedGraphCommands(h, "createEdge")[0]!.createEdge).toEqual({ from: id, to: ID.betaOne, spec: { kind: s.kind, condition: s.condition, payloadTransform: { none: {} } } });
      await expect.poll(async () => (await cardByID(page, h.beta, id))?.mode).toBe("live");
      await expect.poll(() => edgeCount(page, h.beta)).toBe(2);
      await expect.poll(() => g(page)).toEqual({ drafts: 0, wires: 0 });
      await shot(page, `${s.row}-${s.slug}-live`);
      expect(h.pageErrors).toEqual([]);
    });
  }

  test("P2-06 a draft with a problem cannot start: the card says why, and Start all names it and sends nothing", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    await shot(page, "P2-06-problem-on-card");
    const start = await buttonPoint(page, h.alpha, id, "Start");
    await page.mouse.click(start.x, start.y);
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "createNode")).toEqual([]);
    expect((await cardByID(page, h.alpha, id))!.mode).toBe("draft");
    await expect(page.getByTestId("start-all")).toBeEnabled();
    await page.getByTestId("start-all").click();
    await expect(page.getByTestId("status")).toContainText("Goal is required.");
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "createNode")).toEqual([]);
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-07 Start all sends every draft, then the wire between them, and both cards come back live", async ({ page }) => {
    h = await launch();
    await openBeta(page, h);
    const a = await dropType(page, "agent/goal", await emptyPoint(page));
    await fillField(page, h.beta, a, "summary", "First");
    await fillField(page, h.beta, a, TITLE_FIELD, "Alpha stage", false);
    const b = await dropType(page, "agent/main", await emptyPoint2(page));
    await dragLink(page, h.beta, a, 1, b);
    await expect.poll(() => g(page)).toEqual({ drafts: 2, wires: 1 });
    await expect(page.getByTestId("start-count")).toHaveText("3");
    await shot(page, "P2-07a-two-drafts-wired");
    await page.getByTestId("start-all").click();
    await expect.poll(() => receivedGraphCommands(h, "createEdge").length).toBe(1);
    const commands = receivedCommands(h, "graphCommand").map((c) => Object.keys(c.graphCommand.command)[0]);
    expect(commands).toEqual(["createNode", "createNode", "createEdge"]);
    expect(receivedGraphCommands(h, "createNode").map((c) => c.createNode._0.id).sort()).toEqual([a, b].sort());
    expect(receivedGraphCommands(h, "createNode").find((c) => c.createNode._0.id === a)!.createNode._0.title).toBe("Alpha stage");
    expect(receivedGraphCommands(h, "createEdge")[0]!.createEdge).toEqual({ from: a, to: b, spec: { kind: "handoff", condition: "onSuccess", payloadTransform: { none: {} } } });
    await expect.poll(async () => (await cards(page, h.beta)).filter((c) => c.mode === "live").length).toBe(4);
    await expect.poll(() => edgeCount(page, h.beta)).toBe(2);
    await expect.poll(() => g(page)).toEqual({ drafts: 0, wires: 0 });
    await expect(page.getByTestId("start-all")).toBeDisabled();
    await shot(page, "P2-07b-started");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-08 a draft the daemon refuses shows starting, then goes back to draft with the error", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/main", await emptyPoint(page));
    await fillField(page, h.alpha, id, TITLE_FIELD, REJECTED_TITLE, false);
    const start = await buttonPoint(page, h.alpha, id, "Start");
    await page.mouse.click(start.x, start.y);
    await expect.poll(() => receivedGraphCommands(h, "createNode").length).toBe(1);
    await expect(page.getByTestId("status")).toContainText("draft rejected");
    await expect.poll(async () => (await cardByID(page, h.alpha, id))?.mode).toBe("draft");
    await expect(page.getByTestId("status")).toContainText("1 card went back to draft");
    expect(await nodeCount(page, h.alpha)).toBe(9);
    await shot(page, "P2-08-refused");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-09 the Delete key removes a draft outright, and asks before a live card is deleted", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    await selectCard(page, h.alpha, id);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await cardByID(page, h.alpha, id))).toBeUndefined();
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "deleteNode")).toEqual([]);
    await selectCard(page, h.alpha, ID.build);
    page.once("dialog", (d) => d.dismiss());
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect(receivedGraphCommands(h, "deleteNode")).toEqual([]);
    expect(await nodeCount(page, h.alpha)).toBe(9);
    await selectCard(page, h.alpha, ID.build);
    page.once("dialog", (d) => {
      expect(d.message()).toContain('Delete "Build the feature"?');
      void d.accept();
    });
    await page.keyboard.press("Backspace");
    await expect.poll(() => receivedGraphCommands(h, "deleteNode").length).toBe(1);
    expect(receivedGraphCommands(h, "deleteNode")[0]!.deleteNode._0).toBe(ID.build);
    await expect.poll(() => nodeCount(page, h.alpha)).toBe(8);
    expect(await edgeCount(page, h.alpha)).toBe(4);
    await shot(page, "P2-09-deleted");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-10 a draft wire picked off its input moves to another card or goes away; a live edge asks before deleteEdge", async ({ page }) => {
    h = await launch();
    await openBeta(page, h);
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    await dragLink(page, h.beta, id, 0, ID.betaOne);
    await expect.poll(() => g(page)).toEqual({ drafts: 1, wires: 1 });
    // Moving the wire: off betaOne's input, onto betaTwo. Still one wire, now into betaTwo.
    await dragInputTo(page, h.beta, ID.betaOne, 0, ID.betaTwo);
    await expect.poll(async () => (await page.evaluate((p) => window.__graphcode.document(p)!.draftEdges, h.beta)) as Array<{ from: string; to: string }>)
      .toEqual([expect.objectContaining({ from: id, to: ID.betaTwo })]);
    expect(await g(page)).toEqual({ drafts: 1, wires: 1 });
    // betaTwo's inputs: the live edge from betaOne (0), then the moved draft wire (1). Off to empty canvas: gone.
    await dragOffInput(page, h.beta, ID.betaTwo, 1);
    await expect.poll(() => g(page)).toEqual({ drafts: 1, wires: 0 });
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "deleteEdge")).toEqual([]);
    await shot(page, "P2-10a-draft-wire-moved-then-gone");
    // betaTwo's only input is the live edge from betaOne.
    page.once("dialog", (d) => d.dismiss());
    await dragOffInput(page, h.beta, ID.betaTwo, 0);
    await page.waitForTimeout(300);
    expect(receivedGraphCommands(h, "deleteEdge")).toEqual([]);
    expect(await edgeCount(page, h.beta)).toBe(1);
    page.once("dialog", (d) => {
      expect(d.message()).toContain("Delete this edge?");
      void d.accept();
    });
    await dragOffInput(page, h.beta, ID.betaTwo, 0);
    await expect.poll(() => receivedGraphCommands(h, "deleteEdge").length).toBe(1);
    expect(receivedGraphCommands(h, "deleteEdge")[0]!.deleteEdge._0).toBe(EDGE.betaOneToTwo);
    await expect.poll(() => edgeCount(page, h.beta)).toBe(0);
    await shot(page, "P2-10b-live-edge-deleted");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-11 Stop and Restart are buttons on a live card, and Stop is off where it does not apply", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const stop = await buttonPoint(page, h.alpha, ID.build, "Stop");
    await page.mouse.click(stop.x, stop.y);
    await expect.poll(() => receivedGraphCommands(h, "stopNode").length).toBe(1);
    expect(receivedGraphCommands(h, "stopNode")[0]!.stopNode._0).toBe(ID.build);
    await expect.poll(async () => Object.keys((await graphOf(page, h.alpha)).nodes.find((n) => n.id === ID.build)!.state)[0]).toBe("stopped");
    await shot(page, "P2-11a-stopped");
    await page.mouse.click(stop.x, stop.y);
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "stopNode")).toHaveLength(1);
    const restart = await buttonPoint(page, h.alpha, ID.build, "Restart");
    await page.mouse.click(restart.x, restart.y);
    await expect.poll(() => receivedGraphCommands(h, "restartNode").length).toBe(1);
    await expect.poll(async () => Object.keys((await graphOf(page, h.alpha)).nodes.find((n) => n.id === ID.build)!.state)[0]).toBe("running");
    const idleStop = await buttonPoint(page, h.alpha, ID.plan, "Stop");
    await page.mouse.click(idleStop.x, idleStop.y);
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "stopNode")).toHaveLength(1);
    await shot(page, "P2-11b-restarted");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-12 the title field renames a live loop through the daemon, and a draft's title locally", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await fillField(page, h.alpha, ID.plan, TITLE_FIELD, "Plan v2", false);
    await expect.poll(() => receivedGraphCommands(h, "renameNode").length).toBe(1);
    expect(receivedGraphCommands(h, "renameNode")[0]!.renameNode).toEqual({ _0: ID.plan, title: "Plan v2" });
    await expect.poll(async () => (await cardByID(page, h.alpha, ID.plan))?.title).toBe("Plan v2");
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    await fillField(page, h.alpha, id, TITLE_FIELD, "Changelog", false);
    expect((await cardByID(page, h.alpha, id))!.title).toBe("Changelog");
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "renameNode")).toHaveLength(1);
    await shot(page, "P2-12-renamed");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-13 Save workflow writes every card and wire to a file and lists it in the Workflows tab", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/main", await emptyPoint(page));
    await dragLink(page, h.alpha, ID.ship, 3, id);
    page.once("dialog", (d) => { void d.accept("Release pipeline"); });
    await page.getByTestId("save-workflow").click();
    const file = path.join(h.workflowsDir, "Release pipeline.json");
    await expect.poll(() => fs.existsSync(file), { timeout: 5_000 }).toBe(true);
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { version: number; name: string; cards: Record<string, { type: string; title: string; values: Record<string, unknown>; pos: [number, number]; size: [number, number] }>; edges: Array<{ from: string; to: string; kind: string; condition: string }> };
    expect(saved.version).toBe(1);
    expect(saved.name).toBe("Release pipeline");
    expect(Object.keys(saved.cards)).toHaveLength(10);
    expect(saved.cards[ID.build]).toMatchObject({ type: "agent/goal", title: "Build the feature", values: { summary: "Build the feature behind a flag", predicate: "pnpm test", model: "standard" } });
    expect(saved.cards[ID.ci]!.type).toBe("agent/timed");
    expect(saved.cards[id]!.type).toBe("agent/main");
    expect(saved.edges).toHaveLength(8);
    expect(saved.edges).toContainEqual({ from: ID.build, to: ID.review, kind: "handoff", condition: "onSuccess" });
    expect(saved.edges).toContainEqual({ from: ID.ship, to: id, kind: "message", condition: "always" });
    await page.getByTestId("sidebar-tab-workflows").click();
    await expect(page.locator('[data-testid="workflow-item"][data-name="Release pipeline"]')).toBeVisible();
    await shot(page, "P2-13-saved");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-14 loading a workflow onto another project drafts every card and wire, with fresh ids, to the right", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    page.once("dialog", (d) => { void d.accept("alpha as template"); });
    await page.getByTestId("save-workflow").click();
    await expect.poll(() => fs.existsSync(path.join(h.workflowsDir, "alpha as template.json")), { timeout: 5_000 }).toBe(true);
    await page.getByTestId("tab-name").nth(1).click();
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
    const rightEdge = Math.max(...(await cards(page, h.beta)).map((c) => c.pos[0] + c.size[0]));
    await page.getByTestId("sidebar-tab-workflows").click();
    await page.locator('[data-testid="workflow-item"][data-name="alpha as template"]').click();
    await expect.poll(async () => (await cards(page, h.beta)).length).toBe(11);
    const loaded = await drafts(page, h.beta);
    expect(loaded).toHaveLength(9);
    expect(loaded.every((c) => c.mode === "draft")).toBe(true);
    expect(loaded.every((c) => !Object.values(ID).includes(c.id as never))).toBe(true);
    expect(Math.min(...loaded.map((c) => c.pos[0]))).toBeGreaterThan(rightEdge);
    expect(loaded.find((c) => c.title === "Build the feature")!.values.summary).toBe("Build the feature behind a flag");
    await expect.poll(() => g(page)).toEqual({ drafts: 9, wires: 7 });
    await page.waitForTimeout(200);
    expect(receivedGraphCommands(h, "createNode")).toEqual([]);
    expect(await nodeCount(page, h.beta)).toBe(2);
    await shot(page, "P2-14-loaded");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-15 the Projects tab lists recents and opens them", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    await page.getByTestId("sidebar-tab-projects").click();
    await expect(page.getByTestId("recent-project")).toHaveCount(3);
    await page.getByTestId("recent-project").nth(2).click();
    await expect(page.getByTestId("status")).toContainText(`no project at ${h.gamma}`);
    await page.getByTestId("recent-project").nth(1).click();
    await expect.poll(() => receivedCommands(h, "openProject").length).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__graphcode.active())).toBe(h.beta);
    await shot(page, "P2-15-projects-tab");
  });

  test("P2-16 zoomed out past the quality threshold, cards draw as boxes without text and without errors", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const empty = await emptyPoint(page);
    await page.mouse.move(empty.x, empty.y);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 240);
    await expect.poll(() => page.evaluate(() => window.__graphcode.viewport()!.scale)).toBeLessThan(0.5);
    await shot(page, "P2-16-low-quality");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-17 a live card shows its values read-only: a click on a field opens no editor", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const card = (await cardByID(page, h.alpha, ID.docs))!;
    expect(card.values).toMatchObject({ instruction: "Update the docs for the new flag", check: "Each page renders" });
    const p = await widgetPoint(page, h.alpha, ID.docs, "instruction");
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
    await expect(page.getByTestId("field-editor")).toHaveCount(0);
    expect((await cardByID(page, h.alpha, ID.docs))!.pos).toEqual(card.pos);
    await shot(page, "P2-17-live-read-only");
    expect(h.pageErrors).toEqual([]);
  });

  test("P2-18 the editor follows the canvas when it pans", async ({ page }) => {
    h = await launch();
    await openAlpha(page, h);
    const id = await dropType(page, "agent/goal", await emptyPoint(page));
    const p = await widgetPoint(page, h.alpha, id, "summary");
    await page.mouse.click(p.x, p.y);
    const editor = page.getByTestId("field-editor");
    await expect(editor).toBeVisible();
    const before = (await editor.boundingBox())!;
    // Pan with the wheel while the editor is open (a drag would blur it): litegraph pans on shift+wheel? No: it zooms on wheel.
    // Zoom out one step instead: the editor must shrink and move with its field.
    const empty = await emptyPoint(page);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await editor.boundingBox())!.width).toBeLessThan(before.width);
    const after = (await editor.boundingBox())!;
    const expected = await widgetPoint(page, h.alpha, id, "summary");
    expect(expected.x).toBeGreaterThan(after.x);
    expect(expected.x).toBeLessThan(after.x + after.width);
    expect(expected.y).toBeGreaterThan(after.y);
    expect(expected.y).toBeLessThan(after.y + after.height);
    await shot(page, "P2-18-editor-follows");
    expect(h.pageErrors).toEqual([]);
  });
});
