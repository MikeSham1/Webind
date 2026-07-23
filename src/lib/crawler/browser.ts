import { chromium, type Browser } from "playwright";

/**
 * Shared headless-browser lifecycle and crawl admission control.
 *
 * The crawler used to call `chromium.launch()` per report. A Chromium process
 * costs ~150-300MB and a second or two of startup, so N concurrent visitors
 * meant N browsers — the container runs out of memory long before it runs out
 * of anything else, and an anonymous public endpoint is exactly where that gets
 * exercised. One browser is launched lazily and reused; isolation between
 * crawls comes from a fresh BrowserContext, which is cheap.
 *
 * Admission control is the second half: without a cap, a burst still queues
 * unbounded work inside the one browser. {@link withCrawlSlot} bounds both the
 * number of crawls running at once and how many may wait, so overload fails
 * fast and loudly instead of degrading into timeouts.
 */

/** Crawls allowed to run at the same time. */
const MAX_CONCURRENT = positiveIntFromEnv("CRAWL_CONCURRENCY", 3);
/** Crawls allowed to queue behind those before we start shedding load. */
const MAX_QUEUED = positiveIntFromEnv("CRAWL_QUEUE_DEPTH", 12);

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Thrown when the crawler is saturated. Callers should surface a retry hint. */
export class CrawlerBusyError extends Error {
  constructor() {
    super("The analyzer is at capacity right now. Please try again shortly.");
    this.name = "CrawlerBusyError";
  }
}

let browserPromise: Promise<Browser> | null = null;

/**
 * The shared browser, launched on first use. If it ever dies (crash, OOM kill)
 * the cached promise is dropped so the next caller launches a fresh one rather
 * than handing out a dead handle forever.
 */
export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: true })
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null; // don't cache a failed launch
        throw err;
      });
  }
  return browserPromise;
}

/** Shut the shared browser down. Used by tests and graceful shutdown. */
export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  if (!pending) return;
  browserPromise = null;
  try {
    await (await pending).close();
  } catch {
    // Already gone — nothing to clean up.
  }
}

let active = 0;
const waiting: (() => void)[] = [];

/**
 * Run `fn` holding one of the limited crawl slots. Slots are handed directly
 * from a finishing crawl to the next waiter, so `active` never exceeds the cap
 * and no wake-up can be lost between release and re-acquire.
 *
 * @throws {CrawlerBusyError} when the queue is already at its depth limit.
 */
export async function withCrawlSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUED) throw new CrawlerBusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    active++;
  }

  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    // Hand the slot over rather than decrementing, so it is never briefly free.
    if (next) next();
    else active--;
  }
}

/** Current admission-control state. Exposed for tests and health checks. */
export function crawlSlotStats(): {
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueued: number;
} {
  return {
    active,
    queued: waiting.length,
    maxConcurrent: MAX_CONCURRENT,
    maxQueued: MAX_QUEUED,
  };
}
