export interface SaveScheduler {
  /** Dragging a card calls this on every move; the write happens once the moves stop. */
  schedule(project: string): void;
  /** Write a project's pending move now rather than leaving it to sit out the rest of its wait. */
  flush(project: string): void;
  /** Forget a project's pending move without writing it. */
  clear(project: string): void;
}

export interface SaveSchedulerOptions {
  delayMs: number;
  save(project: string): Promise<void>;
}

/**
 * Debounces canvas saves per project, so a drag writes once when it settles rather than on
 * every frame, and a move in one project cannot cancel the pending write of another.
 */
export function createSaveScheduler(options: SaveSchedulerOptions): SaveScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Cancels a project's timer, answering whether there was one to cancel. */
  function cancel(project: string): boolean {
    const pending = timers.get(project);
    if (pending === undefined) return false;
    clearTimeout(pending);
    timers.delete(project);
    return true;
  }

  return {
    schedule(project: string): void {
      cancel(project);
      timers.set(project, setTimeout(() => {
        timers.delete(project);
        void options.save(project);
      }, options.delayMs));
    },
    flush(project: string): void {
      if (cancel(project)) void options.save(project);
    },
    clear(project: string): void {
      cancel(project);
    },
  };
}
