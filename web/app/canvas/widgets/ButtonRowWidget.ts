import { FIELD_MARGIN } from "./FieldWidget.ts";

export const BUTTON_ROW_HEIGHT = 30;
const GAP = 6;
const FONT = "12px -apple-system, 'Helvetica Neue', sans-serif";

export interface RowButton { label: string; enabled: boolean; onClick(): void }

/** Up to a few buttons in one row on the card: Start on a draft; Stop and Restart on a live loop. */
export class ButtonRowWidget {
  readonly type = "gc-buttons";
  name = "actions";
  value = null;
  options: Record<string, never> = {};
  y = 0;
  last_y?: number;
  computedHeight?: number;
  hidden?: boolean;
  buttons: RowButton[] = [];

  computeLayoutSize(): { minHeight: number; maxHeight: number; minWidth: number } {
    return { minHeight: BUTTON_ROW_HEIGHT, maxHeight: BUTTON_ROW_HEIGHT, minWidth: 0 };
  }

  /** Each button's box in node space, left to right. */
  boxes(node: { size: ArrayLike<number> }): Array<[number, number, number, number]> {
    const n = this.buttons.length;
    if (!n) return [];
    const top = this.last_y ?? this.y;
    const width = (node.size[0]! - FIELD_MARGIN * 2 - GAP * (n - 1)) / n;
    return this.buttons.map((_, i) => [FIELD_MARGIN + i * (width + GAP), top, width, BUTTON_ROW_HEIGHT - 4]);
  }

  draw(ctx: CanvasRenderingContext2D, node: { size: ArrayLike<number> }, _width: number, _y: number, _h: number, lowQuality = false): void {
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    this.boxes(node).forEach(([x, y, w, h], i) => {
      const button = this.buttons[i]!;
      ctx.fillStyle = button.enabled ? "#2f6fcf" : "#23262c";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = button.enabled ? "#2f6fcf" : "#2f333a";
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (lowQuality) return;
      ctx.fillStyle = button.enabled ? "#ffffff" : "#5c626c";
      ctx.fillText(button.label, x + w / 2, y + h / 2);
    });
    ctx.restore();
  }

  mouse(event: { type: string }, pos: ArrayLike<number>, node: { size: ArrayLike<number> }): boolean {
    if (event.type !== "pointerdown") return false;
    const boxes = this.boxes(node);
    const hit = boxes.findIndex(([x, y, w, h]) => pos[0]! >= x && pos[0]! <= x + w && pos[1]! >= y && pos[1]! <= y + h);
    const button = hit === -1 ? undefined : this.buttons[hit];
    if (button?.enabled) button.onClick();
    return true;
  }
}
