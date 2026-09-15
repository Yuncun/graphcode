// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { FieldEditor } from "../app/canvas/FieldEditor.ts";
import { FieldWidget, FIELD_MARGIN, LABEL_HEIGHT } from "../app/canvas/widgets/FieldWidget.ts";

const canvas = (scale = 1, offset: [number, number] = [0, 0]) => ({ ds: { scale, offset } }) as never;
const card = (pos: [number, number] = [100, 200], size: [number, number] = [300, 260]) => ({ pos, size }) as never;

function setup(multiline = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new FieldEditor(host);
  const widget = new FieldWidget("summary", "Goal", "before", { multiline });
  widget.last_y = 50;
  widget.computedHeight = 80;
  const commit = vi.fn();
  return { host, editor, widget, commit };
}

const element = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-testid="field-editor"]');

describe("FieldEditor", () => {
  it("opens a textarea for a multiline field and an input otherwise, holding the value, over the box", () => {
    const { host, editor, widget, commit } = setup(true);
    editor.open(canvas(2, [10, 20]), card(), widget, commit);
    const el = element(host)!;
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.value).toBe("before");
    expect(el.dataset.field).toBe("summary");
    expect(editor.isOpen()).toBe(true);
    // Box: x = 12, y = 50 + 14 = 64, w = 300 - 24, h = 80 - 14 - 4; on screen: (card.pos + box + offset) * scale.
    expect(el.style.left).toBe(`${(100 + FIELD_MARGIN + 10) * 2}px`);
    expect(el.style.top).toBe(`${(200 + 50 + LABEL_HEIGHT + 20) * 2}px`);
    expect(el.style.width).toBe(`${(300 - FIELD_MARGIN * 2) * 2}px`);
    expect(el.style.height).toBe(`${(80 - LABEL_HEIGHT - 4) * 2}px`);
    expect(el.style.fontSize).toBe("24px");
    editor.close(false);
    const single = setup(false);
    single.editor.open(canvas(), card(), single.widget, single.commit);
    expect(element(single.host)!.tagName).toBe("INPUT");
  });

  it("follows a pan or zoom on reposition", () => {
    const { host, editor, widget, commit } = setup();
    const c = canvas(1, [0, 0]);
    editor.open(c, card(), widget, commit);
    (c as { ds: { offset: [number, number]; scale: number } }).ds.offset = [50, 0];
    (c as { ds: { offset: [number, number]; scale: number } }).ds.scale = 0.5;
    editor.reposition();
    expect(element(host)!.style.left).toBe(`${(100 + FIELD_MARGIN + 50) * 0.5}px`);
    expect(element(host)!.style.fontSize).toBe("6px");
  });

  it("commits on Enter for a single-line field, and only with ⌘ or Ctrl for a multiline one", () => {
    const single = setup(false);
    single.editor.open(canvas(), card(), single.widget, single.commit);
    let el = element(single.host)!;
    el.value = "after";
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(single.commit).toHaveBeenCalledWith("after");
    expect(element(single.host)).toBe(null);
    expect(single.editor.isOpen()).toBe(false);

    const multi = setup(true);
    multi.editor.open(canvas(), card(), multi.widget, multi.commit);
    el = element(multi.host)!;
    el.value = "line";
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(multi.commit).not.toHaveBeenCalled();
    expect(multi.editor.isOpen()).toBe(true);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(multi.commit).toHaveBeenCalledWith("line");
  });

  it("discards on Escape, commits on blur, and never commits an unchanged value", () => {
    const { host, editor, widget, commit } = setup();
    editor.open(canvas(), card(), widget, commit);
    let el = element(host)!;
    el.value = "typed";
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(editor.isOpen()).toBe(false);
    editor.open(canvas(), card(), widget, commit);
    el = element(host)!;
    el.dispatchEvent(new FocusEvent("blur"));
    expect(commit).not.toHaveBeenCalled();
    expect(editor.isOpen()).toBe(false);
    editor.open(canvas(), card(), widget, commit);
    el = element(host)!;
    el.value = "blurred";
    el.dispatchEvent(new FocusEvent("blur"));
    expect(commit).toHaveBeenCalledWith("blurred");
  });

  it("opening another field commits the first", () => {
    const { host, editor, widget, commit } = setup();
    editor.open(canvas(), card(), widget, commit);
    element(host)!.value = "first";
    const other = new FieldWidget("predicate", "Done when", "");
    const otherCommit = vi.fn();
    editor.open(canvas(), card(), other, otherCommit);
    expect(commit).toHaveBeenCalledWith("first");
    expect(host.querySelectorAll('[data-testid="field-editor"]')).toHaveLength(1);
    expect(element(host)!.dataset.field).toBe("predicate");
  });

  it("keeps its key events from litegraph", () => {
    const { host, editor, widget, commit } = setup();
    const reached = vi.fn();
    host.addEventListener("keydown", reached);
    editor.open(canvas(), card(), widget, commit);
    element(host)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(reached).not.toHaveBeenCalled();
  });
});
