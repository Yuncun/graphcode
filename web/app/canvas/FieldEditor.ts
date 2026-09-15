import type { FieldWidget } from "./widgets/FieldWidget.ts";

/** What the editor reads from litegraph's canvas: the pan and zoom. */
interface Scaled { ds: { scale: number; offset: ArrayLike<number> } }
/** What it reads from a card: where it is and how wide. */
interface PlacedCard { pos: ArrayLike<number>; size: ArrayLike<number> }

const FONT_PX = 12;
const LINE_PX = 15;

/**
 * The one text editor for every field on every card: a textarea or input placed over the field's box
 * and kept in step with pan and zoom by `reposition()`, which the canvas calls on every frame it draws. It
 * commits on blur, on Enter for a single-line field and ⌘/Ctrl+Enter for a multiline one, and
 * discards on Escape. Its key events never reach litegraph, so Delete inside the editor deletes text.
 */
export class FieldEditor {
  private readonly host: HTMLElement;
  private el: HTMLTextAreaElement | HTMLInputElement | null = null;
  private target: { canvas: Scaled; card: PlacedCard; widget: FieldWidget; commit: (text: string) => void } | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  isOpen(): boolean {
    return this.el !== null;
  }

  open(canvas: Scaled, card: PlacedCard, widget: FieldWidget, commit: (text: string) => void): void {
    this.close(true);
    const el = document.createElement(widget.multiline ? "textarea" : "input");
    el.value = widget.value;
    el.className = "field-editor";
    el.dataset.testid = "field-editor";
    el.dataset.field = widget.name;
    el.setAttribute("aria-label", widget.label);
    el.spellcheck = false;
    el.addEventListener("keydown", (evt) => {
      const event = evt as KeyboardEvent;
      if (event.key === "Escape") { event.preventDefault(); this.close(false); }
      else if (event.key === "Enter" && (!widget.multiline || event.metaKey || event.ctrlKey)) { event.preventDefault(); this.close(true); }
      event.stopPropagation();
    });
    el.addEventListener("blur", () => this.close(true));
    this.host.appendChild(el);
    this.el = el;
    this.target = { canvas, card, widget, commit };
    this.reposition();
    // litegraph focuses its canvas as part of the same pointer down; take focus after that has run.
    requestAnimationFrame(() => el.focus());
  }

  /** Places the element over the field's box under the current pan and zoom. */
  reposition(): void {
    if (!this.el || !this.target) return;
    const { canvas, card, widget } = this.target;
    const { scale, offset } = canvas.ds;
    const [x, y, w, h] = widget.boxRect(card);
    Object.assign(this.el.style, {
      left: `${(card.pos[0]! + x + offset[0]!) * scale}px`,
      top: `${(card.pos[1]! + y + offset[1]!) * scale}px`,
      width: `${w * scale}px`,
      height: `${h * scale}px`,
      fontSize: `${FONT_PX * scale}px`,
      lineHeight: `${LINE_PX * scale}px`,
      padding: `${4 * scale}px ${5 * scale}px`,
    });
  }

  /** Removes the element; commits its text when asked and when the text changed. */
  close(commit: boolean): void {
    const el = this.el;
    const target = this.target;
    if (!el || !target) return;
    this.el = null;
    this.target = null;
    el.remove();
    if (commit && el.value !== target.widget.value) target.commit(el.value);
  }
}
