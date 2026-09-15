import { expect, test, type Page } from "@playwright/test";
import { launch, openApp, receivedGraphCommands, type Harness } from "./fixture/harness.ts";
import type { GraphcodeWindow } from "./fixture/window.ts";

declare global {
  interface Window { __graphcode: GraphcodeWindow }
}

async function canvasPixels(page: Page) {
  return page.locator("canvas").evaluate((element: HTMLCanvasElement) => {
    const rect = element.getBoundingClientRect();
    const context = element.getContext("2d")!;
    return {
      width: element.width,
      height: element.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      cornerAlpha: context.getImageData(Math.floor(element.width * 0.9), Math.floor(element.height * 0.9), 1, 1).data[3],
    };
  });
}

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`canvas at ${deviceScaleFactor}x display scale`, () => {
    test.use({ deviceScaleFactor });
    let h: Harness;
    test.afterEach(async () => { await h?.close(); });

    test("paints the whole canvas and tracks container resizing", async ({ page }) => {
      h = await launch();
      await openApp(page, h);
      await expect(page.getByTestId("node-type")).toHaveCount(5);
      await expect.poll(async () => (await canvasPixels(page)).cornerAlpha).toBe(255);
      const pixels = await canvasPixels(page);
      expect(pixels.width).toBe(Math.round(pixels.cssWidth * deviceScaleFactor));
      expect(pixels.height).toBe(Math.round(pixels.cssHeight * deviceScaleFactor));

      await page.locator(".canvas-host").evaluate((host: HTMLElement) => { host.style.maxHeight = "450px"; });
      await expect.poll(async () => (await canvasPixels(page)).height).toBe(450 * deviceScaleFactor);
      await expect.poll(async () => (await canvasPixels(page)).cornerAlpha).toBe(255);
      expect(h.pageErrors).toEqual([]);
    });

    test("draws a dropped card under the pointer and aligns its editable field", async ({ page }) => {
      h = await launch();
      h.daemon!.graphs.get(h.alpha)!.nodes = [];
      h.daemon!.graphs.get(h.alpha)!.edges = [];
      await openApp(page, h);
      await expect(page.getByTestId("node-type")).toHaveCount(5);
      const surface = page.locator("canvas");
      const rect = (await surface.boundingBox())!;
      const at = { x: rect.width * 0.6, y: 100 };
      await page.locator('[data-testid="node-type"][data-type="agent/goal"]').dragTo(surface, { targetPosition: at });
      await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.length, h.alpha)).toBe(1);
      const card = (await page.evaluate((p) => window.__graphcode.cards(p)![0]!, h.alpha));

      const titlePixel = await surface.evaluate((element: HTMLCanvasElement, point) => {
        window.__graphcode.widgetBox(window.__graphcode.active()!, window.__graphcode.cards(window.__graphcode.active()!)![0]!.id, "__title");
        return Array.from(element.getContext("2d")!.getImageData(
          Math.round((point.x + 240) * devicePixelRatio),
          Math.round((point.y - 15) * devicePixelRatio), 1, 1,
        ).data);
      }, at);
      expect(titlePixel[3]).toBe(255);
      expect(titlePixel[1]).toBeGreaterThan(titlePixel[0]! + 30);

      const field = await page.evaluate(([p, id]) => {
        const w = window.__graphcode;
        const card = w.cards(p)!.find((c) => c.id === id)!;
        const box = w.widgetBox(p, id, "summary")!;
        const v = w.viewport()!;
        return {
          x: (card.pos[0] + box[0] + v.offset[0]) * v.scale,
          y: (card.pos[1] + box[1] + v.offset[1]) * v.scale,
          width: box[2] * v.scale,
          height: box[3] * v.scale,
        };
      }, [h.alpha, card.id] as const);
      await page.mouse.click(rect.x + field.x + field.width / 2, rect.y + field.y + field.height / 2);
      const editor = page.getByTestId("field-editor");
      await expect(editor).toBeVisible();
      const editorBox = (await editor.boundingBox())!;
      expect(editorBox.x).toBeCloseTo(rect.x + field.x, 0);
      expect(editorBox.y).toBeCloseTo(rect.y + field.y, 0);
      await editor.fill("Draft only, do not start an agent");
      await editor.press("Control+Enter");
      await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)![0]!.values.summary, h.alpha)).toBe("Draft only, do not start an agent");
      expect(receivedGraphCommands(h, "createNode")).toEqual([]);
      expect(h.pageErrors).toEqual([]);
      await page.screenshot({ path: `e2e/out/canvas-${deviceScaleFactor}x.png` });
    });

    test("uses a distinct title color for each built-in node type", async ({ page }) => {
      h = await launch();
      h.daemon!.graphs.get(h.alpha)!.nodes = [];
      h.daemon!.graphs.get(h.alpha)!.edges = [];
      await page.setViewportSize({ width: 2200, height: 1000 });
      await openApp(page, h);
      await expect(page.getByTestId("node-type")).toHaveCount(5);
      const types = ["agent/main", "agent/goal", "agent/timed", "agent/turn", "group/composite"];
      const colors: string[] = [];
      for (const [index, type] of types.entries()) {
        const at = { x: 40 + index * 360, y: 100 };
        await page.locator(`[data-testid="node-type"][data-type="${type}"]`).dragTo(page.locator("canvas"), { targetPosition: at });
        await expect.poll(() => page.evaluate((p) => window.__graphcode.cards(p)?.length, h.alpha)).toBe(index + 1);
        colors.push(await page.locator("canvas").evaluate((element: HTMLCanvasElement, point) => {
          const w = window.__graphcode;
          const project = w.active()!;
          w.widgetBox(project, w.cards(project)![0]!.id, "__title");
          return Array.from(element.getContext("2d")!.getImageData(
            Math.round((point.x + 240) * devicePixelRatio),
            Math.round((point.y - 15) * devicePixelRatio), 1, 1,
          ).data).join(",");
        }, at));
      }
      expect(new Set(colors).size).toBe(5);
      expect(receivedGraphCommands(h, "createNode")).toEqual([]);
      expect(h.pageErrors).toEqual([]);
      await page.screenshot({ path: `e2e/out/node-colors-${deviceScaleFactor}x.png` });
    });
  });
}
