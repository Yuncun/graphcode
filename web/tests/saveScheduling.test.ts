import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveScheduler } from "../app/canvas/saveScheduler.ts";

const DELAY = 500;

function newScheduler() {
  const saved: string[] = [];
  const scheduler = createSaveScheduler({ delayMs: DELAY, save: async (project) => { saved.push(project); } });
  return { scheduler, saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createSaveScheduler", () => {
  it("writes once for a burst of moves inside the delay", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.schedule("/p/a");
    vi.advanceTimersByTime(DELAY - 1);
    scheduler.schedule("/p/a");
    vi.advanceTimersByTime(DELAY - 1);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual(["/p/a"]);
  });

  it("writes again for a move after the previous one was written", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.schedule("/p/a");
    vi.advanceTimersByTime(DELAY);
    scheduler.schedule("/p/a");
    vi.advanceTimersByTime(DELAY);
    expect(saved).toEqual(["/p/a", "/p/a"]);
  });

  it("flushes immediately and leaves no timer behind", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.schedule("/p/a");
    scheduler.flush("/p/a");
    expect(saved).toEqual(["/p/a"]);
    vi.advanceTimersByTime(DELAY * 2);
    expect(saved).toEqual(["/p/a"]);
  });

  it("flushes nothing when the project has no pending move", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.flush("/p/a");
    vi.advanceTimersByTime(DELAY);
    expect(saved).toEqual([]);
  });

  it("keeps a separate timer per project", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.schedule("/p/a");
    vi.advanceTimersByTime(DELAY - 100);
    scheduler.schedule("/p/b");
    vi.advanceTimersByTime(100);
    expect(saved).toEqual(["/p/a"]);
    vi.advanceTimersByTime(DELAY);
    expect(saved).toEqual(["/p/a", "/p/b"]);
  });

  it("flushing one project does not write another's pending move", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.schedule("/p/a");
    scheduler.schedule("/p/b");
    scheduler.flush("/p/a");
    expect(saved).toEqual(["/p/a"]);
    vi.advanceTimersByTime(DELAY);
    expect(saved).toEqual(["/p/a", "/p/b"]);
  });

  it("drops a pending move on clear", () => {
    const { scheduler, saved } = newScheduler();
    scheduler.schedule("/p/a");
    scheduler.clear("/p/a");
    vi.advanceTimersByTime(DELAY * 2);
    expect(saved).toEqual([]);
  });
});
