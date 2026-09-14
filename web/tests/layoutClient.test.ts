import { describe, expect, it } from "vitest";
import { emptyCanvasDoc } from "../app/canvas/document.ts";
import { getLayout, putLayout } from "../app/canvas/layoutClient.ts";

const fakeFetch = (status: number, body?: unknown): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe("putLayout", () => {
  it("resolves on a 204", async () => {
    await expect(putLayout("/p", emptyCanvasDoc(), fakeFetch(204))).resolves.toBeUndefined();
  });

  it("rejects with a message naming the status on a refusal", async () => {
    await expect(putLayout("/p", emptyCanvasDoc(), fakeFetch(400))).rejects.toThrow("HTTP 400");
  });
});

describe("getLayout", () => {
  it("returns the empty document on a non-OK answer", async () => {
    await expect(getLayout("/p", fakeFetch(500))).resolves.toEqual(emptyCanvasDoc());
  });

  it("returns the normalised document on OK", async () => {
    const raw = { version: 2, nodes: { A: { pos: [1, 2] } }, drafts: { D: { type: "agent/goal", title: "T", values: { summary: "s" } } }, draftEdges: [] };
    await expect(getLayout("/p", fakeFetch(200, raw))).resolves.toEqual({
      version: 2,
      nodes: { A: { pos: [1, 2] } },
      drafts: { D: { type: "agent/goal", title: "T", values: { summary: "s" } } },
      draftEdges: [],
    });
  });
});
