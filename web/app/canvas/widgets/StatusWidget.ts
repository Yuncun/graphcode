import { cachedTruncate, type TruncateCache } from "../textLayout.ts";
import { FIELD_MARGIN } from "./FieldWidget.ts";

export const STATUS_HEIGHT = 32;
const FONT = "11px ui-monospace, Menlo, monospace";

/** The card's bottom block: the live line (or, on a draft with a problem, that problem) over the meta row. */
export class StatusWidget {
  readonly type = "gc-status";
  name = "status";
  value = null;
  options: Record<string, never> = {};
  y = 0;
  last_y?: number;
  computedHeight?: number;
  hidden?: boolean;
  live = "";
  meta = "";
  warning = "";
  private firstCache: TruncateCache | undefined;
  private metaCache: TruncateCache | undefined;

  computeLayoutSize(): { minHeight: number; maxHeight: number; minWidth: number } {
    const lines = Number(Boolean(this.warning || this.live)) + Number(Boolean(this.meta));
    const height = lines ? lines * 15 + 2 : 0;
    return { minHeight: height, maxHeight: height, minWidth: 0 };
  }

  draw(ctx: CanvasRenderingContext2D, node: { size: ArrayLike<number> }, _width: number, y: number, _h: number, lowQuality = false): void {
    if (lowQuality) return;
    const width = node.size[0]! - FIELD_MARGIN * 2;
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.warning ? "#f4b58f" : "#c8cbd0";
    this.firstCache = cachedTruncate(this.firstCache, ctx, this.warning || this.live, width);
    if (this.warning || this.live) ctx.fillText(this.firstCache.result, FIELD_MARGIN, y + 2);
    ctx.fillStyle = "#8b909a";
    this.metaCache = cachedTruncate(this.metaCache, ctx, this.meta, width);
    if (this.meta) ctx.fillText(this.metaCache.result, FIELD_MARGIN, y + (this.warning || this.live ? 17 : 2));
    ctx.restore();
  }
}
