import { createBounds, type LGraphCanvas, type LGraphNode } from "@comfyorg/litegraph";

/** Graph-space padding around the cards when fitting. */
export const FIT_PADDING = 60;
/** Fraction of the canvas the fitted graph may fill (litegraph's default is 0.75). */
export const FIT_ZOOM = 0.9;
/** Below this, litegraph's default low_quality_zoom_threshold (0.6) stops drawing titles, badges and slot labels. */
export const FIT_MIN_SCALE = 0.6;

export interface Viewport { scale: number; offset: [number, number] }

type Scaler = Pick<LGraphCanvas["ds"], "scale" | "offset" | "fitToBounds">;

/**
 * Fits every card into view, but never closer than 1:1: two cards should not fill the screen as two
 * giant cards. Returns false when there is nothing to fit.
 */
export function fitToNodes(canvas: { ds: Scaler; setDirty(fg: boolean, bg: boolean): void }, nodes: Iterable<LGraphNode>): boolean {
  const bounds = createBounds(nodes, FIT_PADDING);
  if (!bounds) return false;
  canvas.ds.fitToBounds(bounds, { zoom: FIT_ZOOM });
  if (canvas.ds.scale > 1) {
    // zoom 0 keeps the current scale and only recentres.
    canvas.ds.scale = 1;
    canvas.ds.fitToBounds(bounds, { zoom: 0 });
  }
  if (canvas.ds.scale < FIT_MIN_SCALE) {
    // A huge graph is shown at a readable size and overflows; the user pans. Below this scale
    // litegraph draws boxes without text.
    canvas.ds.scale = FIT_MIN_SCALE;
    canvas.ds.fitToBounds(bounds, { zoom: 0 });
  }
  canvas.setDirty(true, true);
  return true;
}

export function readViewport(ds: Pick<Scaler, "scale" | "offset">): Viewport {
  return { scale: ds.scale, offset: [ds.offset[0]!, ds.offset[1]!] };
}

export function applyViewport(ds: Pick<Scaler, "scale" | "offset">, viewport: Viewport): void {
  ds.scale = viewport.scale;
  ds.offset[0] = viewport.offset[0];
  ds.offset[1] = viewport.offset[1];
}
