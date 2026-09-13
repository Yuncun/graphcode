import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder } from "../server/framing.ts";

describe("encodeFrame", () => {
  it("prefixes the JSON with a 4-byte big-endian length", () => {
    const frame = encodeFrame({ listRecentProjects: {} });
    const body = Buffer.from('{"listRecentProjects":{}}');
    expect(frame.readUInt32BE(0)).toBe(body.length);
    expect(frame.subarray(4).toString()).toBe(body.toString());
  });
});

describe("FrameDecoder", () => {
  const a = encodeFrame({ errorOccurred: { _0: "one" } });
  const b = encodeFrame({ recentProjectsListed: { _0: [] } });

  it("decodes one frame", () => {
    expect(new FrameDecoder().push(a)).toEqual([{ errorOccurred: { _0: "one" } }]);
  });

  it("decodes two frames from one chunk", () => {
    expect(new FrameDecoder().push(Buffer.concat([a, b]))).toEqual([
      { errorOccurred: { _0: "one" } },
      { recentProjectsListed: { _0: [] } },
    ]);
  });

  it("reassembles a frame split across chunks, including inside the length prefix", () => {
    const d = new FrameDecoder();
    const all = Buffer.concat([a, b]);
    expect(d.push(all.subarray(0, 2))).toEqual([]);
    expect(d.push(all.subarray(2, 10))).toEqual([]);
    expect(d.push(all.subarray(10, a.length + 3))).toEqual([{ errorOccurred: { _0: "one" } }]);
    expect(d.push(all.subarray(a.length + 3))).toEqual([{ recentProjectsListed: { _0: [] } }]);
  });

  it("round-trips non-ASCII text", () => {
    const value = { errorOccurred: { _0: "M2.1–M2.5 — done" } };
    expect(new FrameDecoder().push(encodeFrame(value))).toEqual([value]);
  });
});
