/** 4-byte big-endian length, then UTF-8 JSON. Mirrors GraphcodeKit FramedMessageIO.swift. */
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0);

  /** Feed bytes as they arrive; returns every complete value now available. */
  push(chunk: Buffer): unknown[] {
    this.pending = this.pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.pending, chunk]);
    const out: unknown[] = [];
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32BE(0);
      if (this.pending.length < 4 + length) break;
      const json = this.pending.subarray(4, 4 + length).toString("utf8");
      this.pending = this.pending.subarray(4 + length);
      out.push(JSON.parse(json));
    }
    return out;
  }
}
