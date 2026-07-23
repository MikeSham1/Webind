import { describe, it, expect } from "vitest";
import { CrawlerBusyError, crawlSlotStats, withCrawlSlot } from "./browser";

/** A task that stays in flight until the returned `finish` is called. */
function blockingTask() {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { gate, finish: () => finish() };
}

describe("withCrawlSlot", () => {
  const { maxConcurrent, maxQueued } = crawlSlotStats();

  it("starts idle", () => {
    expect(crawlSlotStats().active).toBe(0);
    expect(crawlSlotStats().queued).toBe(0);
  });

  it("runs up to the concurrency cap and queues the rest", async () => {
    const tasks = Array.from({ length: maxConcurrent + 2 }, blockingTask);
    let started = 0;

    const runs = tasks.map((task) =>
      withCrawlSlot(async () => {
        started++;
        await task.gate;
        return started;
      }),
    );

    // Let the admitted tasks reach their gate.
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toBe(maxConcurrent);
    expect(crawlSlotStats().active).toBe(maxConcurrent);
    expect(crawlSlotStats().queued).toBe(2);

    for (const task of tasks) task.finish();
    await Promise.all(runs);

    expect(started).toBe(tasks.length);
    expect(crawlSlotStats().active).toBe(0);
    expect(crawlSlotStats().queued).toBe(0);
  });

  it("sheds load once the queue is full instead of growing without bound", async () => {
    const tasks = Array.from(
      { length: maxConcurrent + maxQueued },
      blockingTask,
    );
    const runs = tasks.map((task) => withCrawlSlot(() => task.gate));

    await Promise.resolve();
    await Promise.resolve();
    expect(crawlSlotStats().queued).toBe(maxQueued);

    // One more than the pipeline can hold is refused immediately, rather than
    // waiting behind a queue it can never clear in time.
    await expect(withCrawlSlot(async () => "never")).rejects.toBeInstanceOf(
      CrawlerBusyError,
    );

    for (const task of tasks) task.finish();
    await Promise.all(runs);
    expect(crawlSlotStats().active).toBe(0);
  });

  it("releases the slot when the task throws", async () => {
    await expect(
      withCrawlSlot(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(crawlSlotStats().active).toBe(0);
  });
});
