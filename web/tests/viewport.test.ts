// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LGraphNode } from "@comfyorg/litegraph";
import { applyViewport, FIT_MIN_SCALE, FIT_ZOOM, fitToNodes, readViewport } from "../app/canvas/viewport.ts";

/** Stands in for litegraph's DragAndScale with the same fitToBounds arithmetic (litegraph.es.js, `fitToBounds`). */
function fakeCanvas(width: number, height: number) {
  const calls: Array<{ zoom: number | undefined }> = [];
  const ds = {
    scale: 1,
    offset: [0, 0] as [number, number],
    max_scale: 10,
    fitToBounds(bounds: readonly number[], { zoom = 0.75 }: { zoom?: number } = {}) {
      calls.push({ zoom });
      let target = this.scale;
      if (zoom > 0) target = Math.min(zoom * width / Math.max(bounds[2]!, 300), zoom * height / Math.max(bounds[3]!, 300), this.max_scale);
      this.offset = [-bounds[0]! - bounds[2]! / 2 + width / target / 2, -bounds[1]! - bounds[3]! / 2 + height / target / 2];
      this.scale = target;
    },
  };
  let dirty = 0;
  return { ds, calls, dirty: () => dirty, setDirty: () => { dirty++; } };
}

const card = (x: number, y: number, w = 300, h = 150) => ({ boundingRect: [x, y, w, h] }) as unknown as LGraphNode;

describe("fitToNodes", () => {
  it("does nothing for an empty graph", () => {
    const c = fakeCanvas(1400, 900);
    expect(fitToNodes(c as never, [])).toBe(false);
    expect(c.calls).toEqual([]);
    expect(c.dirty()).toBe(0);
  });

  it("never zooms in past 1:1 for a small graph", () => {
    const c = fakeCanvas(1400, 900);
    expect(fitToNodes(c as never, [card(40, 40), card(380, 40)])).toBe(true);
    expect(c.calls).toEqual([{ zoom: FIT_ZOOM }, { zoom: 0 }]);
    expect(c.ds.scale).toBe(1);
    // Centred: the two cards span x 40..680, so the view centre 700/1 - offset must sit at 360.
    expect(700 - c.ds.offset[0]).toBeCloseTo(360, 5);
    expect(c.dirty()).toBe(1);
  });

  it("zooms out for a large graph but never below FIT_MIN_SCALE", () => {
    const c = fakeCanvas(1400, 900);
    expect(fitToNodes(c as never, [card(40, 40), card(1000, 40)])).toBe(true);
    expect(c.calls).toEqual([{ zoom: FIT_ZOOM }]);
    expect(c.ds.scale).toBeGreaterThanOrEqual(FIT_MIN_SCALE);
    expect(c.ds.scale).toBeLessThan(1);
    const huge = fakeCanvas(1400, 900);
    expect(fitToNodes(huge as never, [card(40, 40), card(3000, 2500)])).toBe(true);
    expect(huge.calls).toEqual([{ zoom: FIT_ZOOM }, { zoom: 0 }]);
    expect(huge.ds.scale).toBe(FIT_MIN_SCALE);
  });

  it("shows the start of a graph that is wider than the view at the floor, not its middle", () => {
    const wide = fakeCanvas(1400, 900);
    // Cards from x 40 to x 3300 (bounds start at -20 with the padding): far wider than 1400 / 0.6.
    expect(fitToNodes(wide as never, [card(40, 40), card(3000, 40)])).toBe(true);
    expect(wide.ds.scale).toBe(FIT_MIN_SCALE);
    // The padded left edge sits exactly at the left of the view.
    expect(wide.ds.offset[0]).toBe(20);
    expect((-20 + wide.ds.offset[0]) * wide.ds.scale).toBe(0);
    // Vertical centring is untouched: the row is 150 tall plus padding, centred in 900 / 0.6.
    expect(wide.ds.offset[1]).toBeCloseTo(-(-20) - 270 / 2 + 900 / FIT_MIN_SCALE / 2, 5);
    // A graph that fits keeps the centred placement.
    const fits = fakeCanvas(1400, 900);
    fitToNodes(fits as never, [card(40, 40), card(1000, 40)]);
    expect((-20 + fits.ds.offset[0]) * fits.ds.scale).toBeGreaterThan(0);
  });
});

describe("readViewport / applyViewport", () => {
  it("round-trips scale and offset as a fresh copy", () => {
    const c = fakeCanvas(800, 600);
    c.ds.scale = 0.5;
    c.ds.offset = [12, 34];
    const v = readViewport(c.ds);
    c.ds.offset[0] = 99;
    expect(v).toEqual({ scale: 0.5, offset: [12, 34] });
    const other = fakeCanvas(800, 600);
    applyViewport(other.ds, v);
    expect(other.ds.scale).toBe(0.5);
    expect(other.ds.offset).toEqual([12, 34]);
  });
});
