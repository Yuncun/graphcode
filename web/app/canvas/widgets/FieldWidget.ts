import { cachedTruncate, cachedWrap, type TruncateCache, type WrapCache } from "../textLayout.ts";

/** Node edge to field box (litegraph's own widgets use 15). */
export const FIELD_MARGIN = 12;
export const LABEL_HEIGHT = 14;
export const SINGLE_LINE_HEIGHT = LABEL_HEIGHT + 22;
export const MULTILINE_MIN_HEIGHT = LABEL_HEIGHT + 58;
const LINE_HEIGHT = 15;
const PAD = 5;
const FONT = "12px -apple-system, 'Helvetica Neue', sans-serif";
const LABEL_FONT = "11px -apple-system, 'Helvetica Neue', sans-serif";

export interface FieldOptions { multiline?: boolean; placeholder?: string; required?: boolean }

/** What the widget needs from its card: the width, and someone to open the editor. */
export interface FieldOwner { size: ArrayLike<number>; onEditField?(widget: FieldWidget): void }

/**
 * A text field drawn on the card: a label, a box, and the value wrapped inside it. Pointer down on
 * the box asks the card to open the one shared editor over it (`FieldEditor`); the widget never owns a
 * DOM element, so cards stack and pan with nothing to keep in step.
 *
 * litegraph's custom widget contract (0.17.2): it sets `last_y` before each `draw`, `computedHeight`
 * from `computeLayoutSize` (no `maxHeight` means "take the free height"), and calls `mouse` on pointer
 * down and again on pointer up.
 */
export class FieldWidget {
  readonly type = "gc-field";
  name: string;
  label: string;
  value: string;
  options: Record<string, never> = {};
  y = 0;
  last_y?: number;
  computedHeight?: number;
  hidden?: boolean;
  disabled?: boolean;
  multiline: boolean;
  placeholder: string;
  required: boolean;
  /** A live card's field: drawn dimmer, no editor. */
  readOnly = false;
  private wrap: WrapCache | undefined;
  private line: TruncateCache | undefined;

  constructor(name: string, label: string, value: string, { multiline = false, placeholder = "", required = false }: FieldOptions = {}) {
    this.name = name;
    this.label = label;
    this.value = value;
    this.multiline = multiline;
    this.placeholder = placeholder;
    this.required = required;
  }

  computeLayoutSize(): { minHeight: number; maxHeight?: number; minWidth: number } {
    return this.multiline
      ? { minHeight: MULTILINE_MIN_HEIGHT, minWidth: 160 }
      : { minHeight: SINGLE_LINE_HEIGHT, maxHeight: SINGLE_LINE_HEIGHT, minWidth: 160 };
  }

  /** The box in node space as [x, y, w, h]; the editor is placed over exactly this. */
  boxRect(node: FieldOwner): [number, number, number, number] {
    const top = (this.last_y ?? this.y) + LABEL_HEIGHT;
    const height = (this.computedHeight ?? this.computeLayoutSize().minHeight) - LABEL_HEIGHT - 4;
    return [FIELD_MARGIN, top, node.size[0]! - FIELD_MARGIN * 2, height];
  }

  draw(ctx: CanvasRenderingContext2D, node: FieldOwner, _width: number, y: number, _h: number, lowQuality = false): void {
    const [bx, by, bw, bh] = this.boxRect(node);
    ctx.save();
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    if (!lowQuality) {
      ctx.fillStyle = "#8b909a";
      ctx.font = LABEL_FONT;
      ctx.fillText(this.required ? `${this.label} *` : this.label, bx, y + 1);
    }
    ctx.fillStyle = "#17191d";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = this.readOnly ? "#2a2e35" : "#3a3f48";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    if (lowQuality) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    const empty = this.value === "";
    ctx.fillStyle = empty ? "#5c626c" : this.readOnly ? "#a6a9b0" : "#e8e6e1";
    ctx.font = FONT;
    const text = empty ? this.placeholder : this.value;
    if (this.multiline) {
      this.wrap = cachedWrap(this.wrap, ctx, text, bw - PAD * 2);
      const maxLines = Math.max(1, Math.floor((bh - PAD) / LINE_HEIGHT));
      this.wrap.lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, bx + PAD, by + PAD + i * LINE_HEIGHT));
    } else {
      this.line = cachedTruncate(this.line, ctx, text, bw - PAD * 2);
      ctx.fillText(this.line.result, bx + PAD, by + PAD);
    }
    ctx.restore();
  }

  /** Pointer down opens the editor. Pointer up, which litegraph also routes here, is ignored. */
  mouse(event: { type: string }, _pos: ArrayLike<number>, node: FieldOwner): boolean {
    if (event.type !== "pointerdown" || this.readOnly) return false;
    node.onEditField?.(this);
    return true;
  }
}
