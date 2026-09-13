import { describe, expect, it } from "vitest";
import { ageLabel, appleSecondsToDate } from "../app/canvas/time.ts";

describe("time", () => {
  it("converts Apple epoch seconds", () => {
    expect(appleSecondsToDate(810996584.651497).toISOString()).toBe("2026-09-13T12:49:44.651Z");
  });
  it("labels ages", () => {
    const now = appleSecondsToDate(811000000);
    expect(ageLabel(811000000 - 30, now)).toBe("0m");
    expect(ageLabel(811000000 - 3 * 60, now)).toBe("3m");
    expect(ageLabel(811000000 - (2 * 3600 + 10 * 60), now)).toBe("2h 10m");
    expect(ageLabel(811000000 - (7 * 86400 + 6 * 3600), now)).toBe("7d 6h");
  });
});
