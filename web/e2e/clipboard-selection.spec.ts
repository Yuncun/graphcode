import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { WorkflowFile } from "../app/canvas/document.ts";
import { ID } from "./fixture/graph.ts";
import { launch, openApp, receivedCommands, shot, type Harness } from "./fixture/harness.ts";
import type { GraphcodeWindow } from "./fixture/window.ts";

declare global {
  interface Window { __graphcode: GraphcodeWindow }
}

const cards = (page: Page, project: string) => page.evaluate((p) => window.__graphcode.cards(p) ?? [], project);
const doc = (page: Page, project: string) => page.evaluate((p) => window.__graphcode.document(p), project);
const clipboard = (page: Page): Promise<WorkflowFile> => page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()));

async function point(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => {
    const v = window.__graphcode.viewport()!;
    const r = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: r.left + (x + v.offset[0]) * v.scale, y: r.top + (y + v.offset[1]) * v.scale };
  }, [x, y] as const);
}

async function pasteEvent(page: Page, text: string) {
  return page.locator("canvas").evaluate((canvas, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  }, text);
}

async function copyEvent(page: Page): Promise<WorkflowFile> {
  const text = await page.locator("canvas").evaluate((canvas) => {
    const data = new DataTransfer();
    canvas.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  return JSON.parse(text);
}

const workflow: WorkflowFile = {
  version: 1, name: "Reusable pair",
  cards: {
    a: { type: "agent/main", title: "Choose scope", values: { note: "Custom brief", extra: { tags: ["keep"] } }, pos: [10, 20], size: [360, 500] },
    b: { type: "agent/goal", title: "Build safely", values: { summary: "Stay a draft" }, pos: [430, 60], size: [320, 500] },
  },
  edges: [
    { from: "a", to: "b", kind: "message", condition: "onSuccess" },
    { from: "a", to: "b", kind: "spawn", condition: "onFailure" },
  ],
};

test.describe("workflow clipboard and selection", () => {
  let h: Harness;
  test.beforeEach(async ({ page, context }) => {
    h = await launch({ before: ({ beta }) => {
      fs.mkdirSync(path.join(beta, ".graphcode"), { recursive: true });
      fs.writeFileSync(path.join(beta, ".graphcode", "canvas.json"), JSON.stringify({
        version: 2,
        nodes: {
          [ID.betaOne]: { pos: [60, 60] }, [ID.betaTwo]: { pos: [420, 60] },
          outside: { pos: [840, 60] },
        },
        drafts: { outside: { type: "agent/goal", title: "Outside selection", values: { summary: "Not copied" } } },
        draftEdges: [{ from: ID.betaTwo, to: "outside", kind: "message", condition: "always" }],
      }));
    } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openApp(page, h);
    await page.getByTestId("tab-name").nth(1).click();
    await expect.poll(() => cards(page, h.beta).then((c) => c.length)).toBe(3);
    await expect(page.getByTestId("node-type")).toHaveCount(5);
  });
  test.afterEach(async () => { await h?.close(); });

  test("Cmd-drag rectangle selects only enclosed cards; OS clipboard copies internal wires across canvas and browser tabs", async ({ page, context }) => {
    const start = await point(page, 40, 10);
    const end = await point(page, 750, 540);
    const viewport = await page.evaluate(() => window.__graphcode.viewport());
    const originals = await cards(page, h.beta);
    await page.keyboard.down("Meta");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
    await page.keyboard.up("Meta");
    expect(await page.evaluate(() => window.__graphcode.viewport())).toEqual(viewport);
    await page.keyboard.press("Meta+c");
    const file = await clipboard(page);
    expect(Object.keys(file.cards).sort()).toEqual([ID.betaOne, ID.betaTwo]);
    expect(file.cards[ID.betaTwo]!.values.summary).toBe("Second project's loop");
    expect(file.edges).toEqual([{ from: ID.betaOne, to: ID.betaTwo, kind: "handoff", condition: "always" }]);
    expect(await cards(page, h.beta)).toEqual(originals);
    await shot(page, "clipboard-rectangle-selection");

    await page.getByTestId("tab-name").nth(0).click();
    await expect.poll(() => cards(page, h.alpha).then((c) => c.length)).toBe(9);
    const target = await point(page, 100, 120);
    await page.mouse.move(target.x, target.y);
    await page.locator("canvas").focus();
    await page.keyboard.press("Meta+v");
    await expect.poll(() => page.evaluate(() => window.__graphcode.counts())).toEqual({ drafts: 2, wires: 1 });
    const pasted = (await cards(page, h.alpha)).filter((c) => c.mode === "draft");
    expect(pasted.every((c) => !Object.keys(file.cards).includes(c.id))).toBe(true);
    expect(pasted.map((c) => c.title).sort()).toEqual(["Beta one", "Beta two"]);
    expect((await copyEvent(page)).edges).toHaveLength(1);
    await expect.poll(() => {
      const saved = JSON.parse(fs.readFileSync(path.join(h.alpha, ".graphcode", "canvas.json"), "utf8"));
      return Object.keys(saved.drafts).sort();
    }).toEqual(pasted.map((c) => c.id).sort());

    const other = await context.newPage();
    try {
      await openApp(other, h);
      await expect(other.getByTestId("node-type")).toHaveCount(5);
      await other.getByTestId("tab-name").nth(1).click();
      await expect.poll(() => cards(other, h.beta).then((c) => c.length)).toBe(3);
      await other.locator("canvas").focus();
      await other.keyboard.press("Meta+v");
      await expect.poll(() => cards(other, h.beta).then((c) => c.length)).toBe(5);
      const fresh = (await cards(other, h.beta)).filter((c) => c.mode === "draft" && c.id !== "outside");
      expect(fresh.every((c) => !pasted.some((p) => p.id === c.id))).toBe(true);
      expect(fresh.map((c) => c.title).sort()).toEqual(["Beta one", "Beta two"]);
    } finally {
      await other.close();
    }
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
    expect(h.pageErrors).toEqual([]);
  });

  test("Cmd/Ctrl+A copies the whole workflow; Shift-click stays additive", async ({ page }) => {
    for (const modifier of ["Meta", "Control"]) {
      await page.locator("canvas").focus();
      await page.keyboard.press(`${modifier}+a`);
      const file = await copyEvent(page);
      expect(Object.keys(file.cards)).toHaveLength(3);
      expect(file.edges).toHaveLength(2);
    }
    const empty = await point(page, 40, 10);
    await page.mouse.click(empty.x, empty.y);
    const first = await point(page, 100, 45);
    const second = await point(page, 460, 45);
    await page.mouse.click(first.x, first.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up("Shift");
    expect(Object.keys((await copyEvent(page)).cards).sort()).toEqual([ID.betaOne, ID.betaTwo]);
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Meta+c");
    expect(Object.keys((await clipboard(page)).cards)).toHaveLength(3);
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
  });

  test("Cmd/Ctrl+C/V leave browser clipboard events enabled and never use native node cloning", async ({ page }) => {
    await page.locator("canvas").focus();
    await page.keyboard.press("Meta+a");
    const before = await doc(page, h.beta);
    for (const modifier of ["ctrlKey", "metaKey"]) {
      for (const [key, keyCode] of [["c", 67], ["v", 86]] as const) {
        const prevented = await page.locator("canvas").evaluate((canvas, { modifier, key, keyCode }) => {
          const event = new KeyboardEvent("keydown", { key, keyCode, [modifier]: true, bubbles: true, cancelable: true });
          canvas.dispatchEvent(event);
          return event.defaultPrevented;
        }, { modifier, key, keyCode });
        expect(prevented).toBe(false);
      }
    }
    expect(Object.keys((await copyEvent(page)).cards)).toHaveLength(3);
    expect(await doc(page, h.beta)).toEqual(before);
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
  });

  test("ClipboardEvents paste fresh selected drafts near the pointer with exact custom values, sizes and conditional wires", async ({ page }) => {
    const at = await point(page, 100, 120);
    await page.mouse.move(at.x, at.y);
    expect(await pasteEvent(page, JSON.stringify(workflow))).toBe(true);
    await expect.poll(() => cards(page, h.beta).then((c) => c.length)).toBe(5);
    const file = await copyEvent(page);
    const entries = Object.entries(file.cards);
    expect(entries).toHaveLength(2);
    expect(entries.every(([id]) => id !== "a" && id !== "b")).toBe(true);
    const a = entries.find(([, c]) => c.title === "Choose scope")!;
    const b = entries.find(([, c]) => c.title === "Build safely")!;
    expect(a[1].values).toMatchObject({ note: "Custom brief", extra: { tags: ["keep"] } });
    expect(a[1].size).toEqual([360, 500]);
    expect(b[1].size).toEqual([320, 500]);
    expect(a[1].pos[0]).toBeCloseTo(120, 0);
    expect(a[1].pos[1]).toBeCloseTo(140, 0);
    expect(b[1].pos[0] - a[1].pos[0]).toBe(420);
    expect(b[1].pos[1] - a[1].pos[1]).toBe(40);
    expect(file.edges).toEqual([
      { from: a[0], to: b[0], kind: "message", condition: "onSuccess" },
      { from: a[0], to: b[0], kind: "spawn", condition: "onFailure" },
    ]);
    await pasteEvent(page, JSON.stringify(file));
    const again = await copyEvent(page);
    expect(Object.keys(again.cards).every((id) => !Object.hasOwn(file.cards, id))).toBe(true);
    expect((await cards(page, h.beta)).filter((c) => c.mode === "draft")).toHaveLength(5);
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
    expect(h.pageErrors).toEqual([]);
  });

  test("malformed JSON and unavailable types leave the entire canvas unchanged and report the problem", async ({ page }) => {
    const before = await doc(page, h.beta);
    for (const text of ["not JSON", JSON.stringify({ ...workflow, edges: [{ from: "a", to: "missing", kind: "message", condition: "always" }] }), JSON.stringify({
      ...workflow, cards: { ...workflow.cards, b: { ...workflow.cards.b, type: "unavailable/node" } },
    })]) {
      await pasteEvent(page, text);
      await expect(page.locator(".status .error")).toContainText(/paste/i);
      expect(await doc(page, h.beta)).toEqual(before);
    }
    await expect(page.getByTestId("status")).toContainText("unavailable/node");
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
  });

  test("text editor and sidebar keep normal select-all, copy and paste without copying cards", async ({ page }) => {
    const p = await point(page, 880, 45);
    await page.mouse.dblclick(p.x, p.y, { delay: 60 });
    const editor = page.getByTestId("field-editor");
    await expect(editor).toBeVisible();
    await editor.fill("Only this title");
    await editor.press("Meta+a");
    await editor.press("Meta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Only this title");
    await editor.press("Meta+v");
    await expect(editor).toHaveValue("Only this title");
    await editor.press("Enter");
    expect((await cards(page, h.beta)).find((c) => c.id === "outside")!.title).toBe("Only this title");
    const field = await page.evaluate((project) => window.__graphcode.widgetBox(project, "outside", "summary"), h.beta);
    const fieldPoint = await point(page, 840 + field![0] + field![2] / 2, 60 + field![1] + field![3] / 2);
    await page.mouse.click(fieldPoint.x, fieldPoint.y);
    await expect(editor).toHaveAttribute("data-field", "summary");
    await editor.fill("Only this\nmultiline brief");
    await editor.press("Meta+a");
    await editor.press("Meta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Only this\nmultiline brief");
    await editor.press("Meta+v");
    await expect(editor).toHaveValue("Only this\nmultiline brief");
    await editor.press("Meta+Enter");
    expect((await cards(page, h.beta)).find((c) => c.id === "outside")!.values.summary).toBe("Only this\nmultiline brief");
    const search = page.getByTestId("node-search");
    await search.fill("goal");
    await search.press("Meta+a");
    await search.press("Meta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("goal");
    await search.press("Meta+v");
    await expect(search).toHaveValue("goal");
    expect(await cards(page, h.beta)).toHaveLength(3);
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
  });

  test("keyboard paste cannot change the previous canvas while another tab is loading", async ({ context }) => {
    const page = await context.newPage();
    await openApp(page, h);
    await expect.poll(() => cards(page, h.alpha).then((items) => items.length)).toBe(9);
    const before = await doc(page, h.alpha);
    let release!: () => void;
    const loading = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/canvas?project=*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("project") === h.beta) await loading;
      await route.continue();
    });
    const requested = page.waitForRequest((request) => new URL(request.url()).searchParams.get("project") === h.beta && request.url().includes("/api/canvas"));
    try {
      await page.getByTestId("tab-name").nth(1).click();
      await requested;
      await pasteEvent(page, JSON.stringify(workflow));
      expect(await doc(page, h.alpha)).toEqual(before);
      await expect(page.getByTestId("status")).toContainText("active canvas changed");
    } finally {
      release();
      await expect.poll(() => cards(page, h.beta).then((items) => items.length)).toBe(3);
      await page.close();
    }
  });

  test("Ctrl-drag rectangle selects cards without panning", async ({ page }) => {
    const start = await point(page, 40, 10);
    const end = await point(page, 750, 540);
    const before = await page.evaluate(() => window.__graphcode.viewport());
    await page.keyboard.down("Control");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 15 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    expect(await page.evaluate(() => window.__graphcode.viewport())).toEqual(before);
    expect(Object.keys((await copyEvent(page)).cards).sort()).toEqual([ID.betaOne, ID.betaTwo]);
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
  });

  test("plain dragging pans without moving cards; Space and middle drag also pan, while the wheel zooms", async ({ page }) => {
    const at = await point(page, 40, 10);
    await page.locator("canvas").focus();
    const originalCards = await cards(page, h.beta);
    const before = await page.evaluate(() => window.__graphcode.viewport()!);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 40, at.y + 40, { steps: 8 });
    await page.mouse.up();
    const plain = await page.evaluate(() => window.__graphcode.viewport()!);
    expect(plain.offset).not.toEqual(before.offset);
    expect(plain.scale).toBe(before.scale);
    expect(await cards(page, h.beta)).toEqual(originalCards);
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const space = await page.evaluate(() => window.__graphcode.viewport()!);
    expect(space.offset).not.toEqual(plain.offset);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(at.x + 80, at.y + 80, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    const middle = await page.evaluate(() => window.__graphcode.viewport()!.offset);
    expect(middle).not.toEqual(space.offset);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.evaluate(() => window.__graphcode.viewport()!.scale)).toBeLessThan(before.scale);
    const zoom = await page.evaluate(() => window.__graphcode.viewport()!.scale);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 120);
    await page.keyboard.up("Control");
    await expect.poll(() => page.evaluate(() => window.__graphcode.viewport()!.scale)).toBeLessThan(zoom);
    expect(await cards(page, h.beta)).toEqual(originalCards);
    expect(receivedCommands(h, "graphCommand")).toEqual([]);
  });
});
