const TRUNCATE_INPUT_CAP = 200;
/** Enough for a long goal; beyond it the field shows the first screens and the editor holds the rest. */
const WRAP_INPUT_CAP = 2000;

export interface TruncateCache { text: string; width: number; result: string }

export function truncate(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut + "…";
}

/**
 * Truncates `text` to fit `width`, reusing `prev` when the (capped) text and width are unchanged.
 * Widgets draw every frame, and the character-by-character measurement in `truncate` is expensive
 * on a long string, so this keeps it to one measurement pass per distinct (text, width).
 */
export function cachedTruncate(prev: TruncateCache | undefined, ctx: CanvasRenderingContext2D, text: string, width: number): TruncateCache {
  const capped = text.length > TRUNCATE_INPUT_CAP ? text.slice(0, TRUNCATE_INPUT_CAP) : text;
  if (prev && prev.text === capped && prev.width === width) return prev;
  return { text: capped, width, result: truncate(ctx, capped, width) };
}

export interface WrapCache { text: string; width: number; lines: string[] }

/** Greedy word wrap on measured widths. A newline always starts a line; a word wider than the line is cut where it stops fitting. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (rest && ctx.measureText(rest).width > width) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** `wrapLines` with the same reuse rule as `cachedTruncate`. */
export function cachedWrap(prev: WrapCache | undefined, ctx: CanvasRenderingContext2D, text: string, width: number): WrapCache {
  const capped = text.length > WRAP_INPUT_CAP ? text.slice(0, WRAP_INPUT_CAP) : text;
  if (prev && prev.text === capped && prev.width === width) return prev;
  return { text: capped, width, lines: wrapLines(ctx, capped, width) };
}
