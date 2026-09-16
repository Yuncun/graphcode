import { describe, expect, it, vi } from "vitest";
import { FieldWidget, FIELD_MARGIN, LABEL_HEIGHT, MULTILINE_MIN_HEIGHT, SINGLE_LINE_HEIGHT } from "../app/canvas/widgets/FieldWidget.ts";
import { StatusWidget, STATUS_HEIGHT } from "../app/canvas/widgets/StatusWidget.ts";

/** Enough of a 2D context for the widgets' draw calls. */
function fakeCtx() {
  const text: string[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, strokeRect() {}, setLineDash() {},
    fillText(s: string) { text.push(s); },
    measureText(s: string) { return { width: s.length * 6 } as TextMetrics; },
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "left", textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, text };
}

const node = (width = 300) => ({ size: [width, 200] as [number, number], onEditField: vi.fn() });

describe("FieldWidget", () => {
  it("sizes a single-line field to a fixed height and lets a multiline one grow", () => {
    expect(new FieldWidget("predicate", "Done when", "").computeLayoutSize()).toEqual({ minHeight: SINGLE_LINE_HEIGHT, maxHeight: SINGLE_LINE_HEIGHT, minWidth: 160 });
    expect(new FieldWidget("summary", "Goal", "", { multiline: true }).computeLayoutSize()).toEqual({ minHeight: MULTILINE_MIN_HEIGHT, minWidth: 160 });
  });

  it("places its box under the label, inside the margins, as tall as litegraph allotted", () => {
    const w = new FieldWidget("summary", "Goal", "", { multiline: true });
    w.last_y = 100;
    w.computedHeight = 120;
    expect(w.boxRect(node(300))).toEqual([FIELD_MARGIN, 100 + LABEL_HEIGHT, 300 - FIELD_MARGIN * 2, 120 - LABEL_HEIGHT - 4]);
    // Before the first draw it falls back to `y` and its minimum height.
    const fresh = new FieldWidget("predicate", "Done when", "");
    fresh.y = 40;
    expect(fresh.boxRect(node(260))).toEqual([FIELD_MARGIN, 40 + LABEL_HEIGHT, 260 - FIELD_MARGIN * 2, SINGLE_LINE_HEIGHT - LABEL_HEIGHT - 4]);
  });

  it("asks the card to open the editor on pointer down only, and never when read-only", () => {
    const w = new FieldWidget("summary", "Goal", "x");
    const n = node();
    expect(w.mouse({ type: "pointerup" }, [0, 0], n)).toBe(false);
    expect(n.onEditField).not.toHaveBeenCalled();
    expect(w.mouse({ type: "pointerdown" }, [0, 0], n)).toBe(true);
    expect(n.onEditField).toHaveBeenCalledWith(w);
    w.readOnly = true;
    expect(w.mouse({ type: "pointerdown" }, [0, 0], n)).toBe(false);
    expect(n.onEditField).toHaveBeenCalledTimes(1);
  });

  it("draws the label, the value or the placeholder, and nothing but boxes at low quality", () => {
    const w = new FieldWidget("summary", "Goal", "", { multiline: true, placeholder: "What done looks like", required: true });
    const { ctx, text } = fakeCtx();
    w.last_y = 50; w.computedHeight = 80;
    w.draw(ctx, node(), 300, 50, 20, false);
    expect(text).toEqual(["Goal *", "What done looks like"]);
    w.value = "line one\nline two";
    text.length = 0;
    w.draw(ctx, node(), 300, 50, 20, false);
    expect(text).toEqual(["Goal *", "line one", "line two"]);
    text.length = 0;
    w.draw(ctx, node(), 300, 50, 20, true);
    expect(text).toEqual([]);
  });
});


describe("StatusWidget", () => {
  it("reserves space only for visible warning, activity and metadata lines", () => {
    const w = new StatusWidget();
    expect(w.computeLayoutSize()).toEqual({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    w.live = "editing src/app.ts"; w.meta = "Goal · 2h 0m";
    expect(w.computeLayoutSize()).toEqual({ minHeight: STATUS_HEIGHT, maxHeight: STATUS_HEIGHT, minWidth: 0 });
    const { ctx, text } = fakeCtx();
    w.draw(ctx, node(), 300, 100, 20, false);
    expect(text).toEqual(["editing src/app.ts", "Goal · 2h 0m"]);
    w.warning = "Goal is required.";
    text.length = 0;
    w.draw(ctx, node(), 300, 100, 20, false);
    expect(text).toEqual(["Goal is required.", "Goal · 2h 0m"]);
    text.length = 0;
    w.draw(ctx, node(), 300, 100, 20, true);
    expect(text).toEqual([]);
  });
});
